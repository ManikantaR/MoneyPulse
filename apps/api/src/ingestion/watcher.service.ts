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
import { readFile } from 'fs/promises';
import { basename, relative } from 'path';
import { createHash } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, isNull } from 'drizzle-orm';
import { INGESTION_QUEUE, WATCH_FOLDER_DIR } from '@moneypulse/shared';

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

  async onModuleInit() {
    try {
      this.watcher = chokidar.watch(this.watchDir, {
        persistent: true,
        ignoreInitial: true,
        depth: 1, // {slug}/file.csv — one level deep
        ignored: /(^|[/\\])\.archived/,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 500,
        },
      });

      this.watcher.on('add', (filePath) => this.handleNewFile(filePath));
      this.logger.log(`Watch folder active: ${this.watchDir}`);
    } catch (err) {
      this.logger.warn(
        `Watch folder not available: ${err}. Auto-import disabled.`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  private async handleNewFile(filePath: string) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls', 'pdf'].includes(ext || '')) {
      this.logger.debug(`Ignoring non-data file: ${filePath}`);
      return;
    }

    this.logger.log(`New file detected: ${filePath}`);

    try {
      const relativePath = relative(this.watchDir, filePath);
      const parts = relativePath.split('/');
      if (parts.length < 2) {
        this.logger.warn(`File not in account subfolder: ${filePath}`);
        return;
      }

      const slug = parts[0];

      const account = await this.findAccountBySlug(slug);
      if (!account) {
        this.logger.warn(`No account found for slug "${slug}". Skipping.`);
        return;
      }

      const buffer = await readFile(filePath);
      const fileHash = createHash('sha256').update(buffer).digest('hex');

      const existing = await this.db
        .select()
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.fileHash, fileHash))
        .limit(1);

      if (existing.length > 0) {
        this.logger.log(`Duplicate file skipped: ${filePath}`);
        return;
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
    } catch (err: any) {
      this.logger.error(`Watch folder error for ${filePath}: ${err.message}`);
    }
  }

  private async findAccountBySlug(slug: string) {
    const accounts = await this.db
      .select()
      .from(schema.accounts)
      .where(isNull(schema.accounts.deletedAt));

    for (const account of accounts) {
      const accountSlug = this.generateSlug(account.nickname, account.lastFour);
      if (accountSlug === slug) return account;
    }

    return null;
  }

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
