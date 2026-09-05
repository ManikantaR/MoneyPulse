import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as chokidar from 'chokidar';
import { readFile, readdir } from 'fs/promises';
import { basename, relative, join } from 'path';
import { createHash } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, isNull } from 'drizzle-orm';
import { INGESTION_QUEUE, WATCH_FOLDER_DIR } from '@moneypulse/shared';
import { decryptField } from '../common/crypto';

@Injectable()
export class WatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatcherService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private readonly watchDir: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
  ) {
    this.watchDir =
      this.config.get<string>('WATCH_FOLDER_DIR') || WATCH_FOLDER_DIR;
  }

  /**
   * Initialize the Chokidar watcher on module startup.
   * Watches `watchDir` one level deep (depth=1): `{slug}/file.csv`
   * Skips `.archived` subdirectories. Waits for write-finish before processing.
   */
  async onModuleInit() {
    try {
      // usePolling=true is required when the watch folder is a bind mount
      // on macOS/Podman — inotify events are not delivered across the VM boundary.
      const usePolling =
        this.config.get<string>('WATCH_FOLDER_POLLING') !== 'false';

      this.watcher = chokidar.watch(this.watchDir, {
        persistent: true,
        ignoreInitial: true,
        depth: 1, // {slug}/file.csv — one level deep
        ignored: /(^|[/\\])\.archived/,
        usePolling,
        interval: 3000,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 500,
        },
      });

      this.watcher.on('add', (filePath) => this.handleNewFile(filePath));

      // Startup reconciliation scan: chokidar's `ignoreInitial: true` means files
      // already sitting in the watch folder when the process (re)starts — e.g. the
      // API was down when a statement was dropped — would otherwise NEVER be
      // ingested, with no error or alert. Run an explicit scan through the same
      // handleNewFile() path once the watcher is ready so dedup + account
      // resolution + enqueue behave identically to a live `add` event. Content-hash
      // dedup makes this safe to run on every boot.
      this.watcher.once('ready', () => {
        this.scanExistingFiles().catch((err) =>
          this.logger.error(`Startup reconciliation scan failed: ${err}`),
        );
      });

      this.logger.log(`Watch folder active: ${this.watchDir}`);
    } catch (err) {
      this.logger.warn(
        `Watch folder not available: ${err}. Auto-import disabled.`,
      );
    }
  }

  /**
   * Startup reconciliation scan (Phase 0 / BS-2 fix).
   *
   * Enumerates every `*.csv`/`*.xlsx`/`*.pdf` file directly under each
   * `<watchDir>/<slug>/` subdirectory (excluding `.archived` subdirectories and
   * dot/partial files) and routes each one through `handleNewFile()` — the same
   * code path chokidar's live `add` event uses. Files already ingested are
   * skipped naturally by the content-hash dedup in `handleNewFile()`, so this is
   * idempotent and safe to run on every boot.
   */
  private async scanExistingFiles(): Promise<void> {
    let found = 0;
    let enqueued = 0;
    let skipped = 0;

    let topEntries: import('fs').Dirent[];
    try {
      topEntries = await readdir(this.watchDir, { withFileTypes: true });
    } catch (err) {
      this.logger.warn(`Startup scan: cannot read watch dir ${this.watchDir}: ${err}`);
      return;
    }

    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.archived' || entry.name.startsWith('.')) continue;

      const slugDir = join(this.watchDir, entry.name);
      let files: import('fs').Dirent[];
      try {
        files = await readdir(slugDir, { withFileTypes: true });
      } catch (err) {
        this.logger.warn(`Startup scan: cannot read ${slugDir}: ${err}`);
        continue;
      }

      for (const file of files) {
        if (!file.isFile()) continue;
        if (file.name.startsWith('.')) continue;

        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!['csv', 'xlsx', 'pdf'].includes(ext || '')) continue;

        found++;
        const filePath = join(slugDir, file.name);
        const result = await this.handleNewFile(filePath);
        if (result === 'enqueued') {
          enqueued++;
        } else {
          skipped++;
        }
      }
    }

    this.logger.log(
      `Startup reconciliation scan complete: found ${found}, enqueued ${enqueued}, skipped ${skipped}`,
    );
  }

  /**
   * Gracefully close the Chokidar watcher on module teardown.
   */
  async onModuleDestroy() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  /**
   * Handle a newly detected file in the watch folder.
   * Extracts the account slug from the parent directory name, looks up the matching
   * account, deduplicates by SHA-256, creates a `file_uploads` record, and enqueues
   * a BullMQ parse job.
   *
   * @param filePath - Absolute path to the file detected by Chokidar (or the startup scan)
   * @returns `'enqueued'` if a new parse job was queued, `'skipped'` for duplicates/no-account/
   *   invalid-path, or `'error'` if an unexpected exception occurred
   */
  private async handleNewFile(
    filePath: string,
  ): Promise<'enqueued' | 'skipped' | 'error'> {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls', 'pdf'].includes(ext || '')) {
      this.logger.debug(`Ignoring non-data file: ${filePath}`);
      return 'skipped';
    }

    this.logger.log(`New file detected: ${filePath}`);

    try {
      const relativePath = relative(this.watchDir, filePath);
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      const parts = normalizedRelativePath.split('/');
      if (parts.length < 2) {
        this.logger.warn(`File not in account subfolder: ${filePath}`);
        return 'skipped';
      }

      const slug = parts[0];

      const account = await this.findAccountBySlug(slug);
      if (!account) {
        this.logger.warn(`No account found for slug "${slug}". Skipping.`);
        return 'skipped';
      }

      const buffer = await readFile(filePath);
      const fileHash = createHash('sha256').update(buffer).digest('hex');

      const existing = await this.db
        .select()
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.fileHash, fileHash))
        .limit(1);

      if (existing.length > 0) {
        if (existing[0].status === 'failed') {
          // Remove the failed record so file can be re-processed
          await this.db
            .delete(schema.fileUploads)
            .where(eq(schema.fileUploads.id, existing[0].id));
        } else {
          this.logger.log(`Duplicate file skipped: ${filePath}`);
          return 'skipped';
        }
      }

      const fileType =
        ext === 'csv'
          ? 'csv'
          : ext === 'xlsx' || ext === 'xls'
            ? 'excel'
            : 'pdf';

      const [upload] = await this.db
        .insert(schema.fileUploads)
        .values({
          userId: account.userId,
          accountId: account.id,
          filename: basename(filePath),
          fileType,
          fileHash,
          status: 'pending',
        })
        .returning();

      await this.ingestionQueue.add('parse-file', {
        uploadId: upload.id,
        userId: account.userId,
        accountId: account.id,
        filePath,
        fileType,
      });

      this.logger.log(
        `Auto-import queued: ${filePath} → account ${account.nickname}`,
      );
      return 'enqueued';
    } catch (err: any) {
      this.logger.error(`Watch folder error for ${filePath}: ${err.message}`);
      return 'error';
    }
  }

  /**
   * Find an active (non-deleted) account whose generated slug matches the given string.
   *
   * @param slug - Slug string extracted from the watch-folder subdirectory name (e.g. `bofa-checking-1234`)
   * @returns The matching account row or `null` if no match is found
   */
  private async findAccountBySlug(slug: string) {
    const accounts = await this.db
      .select()
      .from(schema.accounts)
      .where(isNull(schema.accounts.deletedAt));

    for (const account of accounts) {
      const plainLastFour = decryptField(account.lastFour);
      const accountSlug = this.generateSlug(account.nickname, plainLastFour);
      if (accountSlug === slug) return account;
    }

    return null;
  }

  /**
   * Generate a URL-friendly slug from an account's nickname and last-four digits.
   * Example: "BofA Checking" + "1234" → "bofa-checking-1234"
   *
   * @param nickname - Account display name
   * @param lastFour - Last four digits of the account number
   * @returns Lowercase hyphen-separated slug
   */
  private generateSlug(nickname: string, lastFour: string): string {
    return (
      nickname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      lastFour
    );
  }
}
