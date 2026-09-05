import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { mkdir, writeFile, access } from 'fs/promises';
import { join, basename } from 'path';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { INGESTION_QUEUE, MAX_UPLOAD_SIZE_BYTES, WATCH_FOLDER_DIR } from '@moneypulse/shared';
import type { FileType, CsvFormatConfig } from '@moneypulse/shared';

/** Upload statuses that a reprocess (or reassign, which reprocesses) may act on. */
const REPROCESSABLE_STATUSES = ['failed', 'stalled', 'empty', 'orphaned'] as const;

@Injectable()
export class IngestionService {
  private readonly uploadDir: string;
  private readonly watchDir: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR') ?? '/tmp/moneypulse/uploads';
    this.watchDir = this.config.get<string>('WATCH_FOLDER_DIR') || WATCH_FOLDER_DIR;
  }

  /**
   * Handle file upload:
   * 1. Verify account belongs to (or is shared with) the uploading user
   * 2. Compute SHA256 hash → reject duplicate file
   * 3. Save to UPLOAD_DIR using a sanitized server-side filename
   * 4. Create file_uploads record (status: pending)
   * 5. Enqueue BullMQ job
   */
  async uploadFile(
    userId: string,
    accountId: string,
    file: Express.Multer.File,
  ) {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB`,
      );
    }

    // Verify the account belongs to this user (return 404 to avoid enumeration)
    const account = await this.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.id, accountId),
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
        ),
      )
      .limit(1);

    if (account.length === 0) {
      throw new NotFoundException('Account not found');
    }

    // Determine file type
    const fileType = this.detectFileType(file.originalname);

    // Compute SHA256
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // Check for duplicate file — allow re-upload if previous attempt failed
    const existing = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.fileHash, fileHash))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].status === 'failed') {
        // Remove the failed record so user can retry
        await this.db
          .delete(schema.fileUploads)
          .where(eq(schema.fileUploads.id, existing[0].id));
      } else {
        throw new BadRequestException(
          `This file has already been uploaded (matched by SHA256 hash). Upload ID: ${existing[0].id}`,
        );
      }
    }

    // Sanitize the original filename: strip path separators and control chars,
    // then use it as a display-only label. The actual file is stored under a
    // server-controlled name (hash + sanitized basename) to prevent traversal.
    const safeBasename = basename(file.originalname).replace(/[^\w.\-]/g, '_');
    const uploadDir = join(this.uploadDir, userId);
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, `${fileHash}_${safeBasename}`);
    await writeFile(filePath, file.buffer);

    // Create DB record (store original name for display, safe path on disk)
    const rows = await this.db
      .insert(schema.fileUploads)
      .values({
        userId,
        accountId,
        filename: file.originalname,
        fileType,
        fileHash,
        status: 'pending',
      })
      .returning();

    const upload = rows[0];

    // Enqueue processing job
    await this.ingestionQueue.add(
      'parse-file',
      {
        uploadId: upload.id,
        userId,
        accountId,
        filePath,
        fileType,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return upload;
  }

  /**
   * Get upload status (polling endpoint).
   * Scoped to userId — returns 404 for uploads not owned by this user.
   */
  async getUploadStatus(uploadId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(
        and(
          eq(schema.fileUploads.id, uploadId),
          eq(schema.fileUploads.userId, userId),
        ),
      )
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Upload not found');
    return rows[0];
  }

  /**
   * List all file upload records for a user, ordered by creation date (most recent last).
   *
   * @param userId - The user whose uploads to list
   * @returns Array of `FileUpload` rows
   */
  async listUploads(userId: string) {
    return this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.userId, userId))
      .orderBy(schema.fileUploads.createdAt);
  }

  /**
   * Import Pipeline Radar Phase 3 — cheap counts for the pipeline summary cards.
   * Scoped to the caller's uploads (rows without a resolvable userId, e.g.
   * `orphaned` watcher failures, are intentionally excluded — same scoping as
   * `listUploads`).
   */
  async getPipelineSummary(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.userId, userId));

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    let processed = 0;
    let needsAttention = 0;
    let txnsImported = 0;

    for (const row of rows as any[]) {
      if (['orphaned', 'failed', 'stalled', 'empty'].includes(row.status)) {
        needsAttention++;
      }
      const createdAt = new Date(row.createdAt);
      if (createdAt >= startOfMonth && row.status === 'completed') {
        processed++;
        txnsImported += row.rowsImported ?? 0;
      }
    }

    return { processed, needsAttention, txnsImported };
  }

  /**
   * Patch status fields on a file upload record (called by the BullMQ job processor).
   *
   * @param uploadId - The upload UUID to update
   * @param data - Partial update: status, row counts, error log, archived path
   */
  async updateUploadStatus(
    uploadId: string,
    data: {
      status?: string;
      rowsImported?: number;
      rowsSkipped?: number;
      rowsErrored?: number;
      errorLog?: any[];
      archivedPath?: string;
    },
  ) {
    await this.db
      .update(schema.fileUploads)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.fileUploads.id, uploadId));
  }

  /**
   * Resolve the on-disk path of the source file for an upload, in priority order:
   * 1. `archivedPath`, if set and the file still exists there.
   * 2. The original staged path, reconstructed from provenance columns:
   *    - Watcher-ingested files live at `{watchDir}/{watcherSlug}/{originalFilename}`.
   *    - Manually-uploaded files live at `{uploadDir}/{userId}/{fileHash}_{sanitized filename}`
   *      (the same server-controlled name `uploadFile()` writes to).
   *
   * @returns The resolved path, or `null` if no candidate exists on disk.
   */
  private async resolveSourceFilePath(upload: any): Promise<string | null> {
    const candidates: string[] = [];
    if (upload.archivedPath) candidates.push(upload.archivedPath);

    if (upload.watcherSlug) {
      const name = upload.originalFilename ?? upload.filename;
      if (name) candidates.push(join(this.watchDir, upload.watcherSlug, name));
    }
    if (upload.userId && upload.fileHash && upload.filename) {
      const safeBasename = basename(upload.filename).replace(/[^\w.\-]/g, '_');
      candidates.push(join(this.uploadDir, upload.userId, `${upload.fileHash}_${safeBasename}`));
    }

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // not found here — try next candidate
      }
    }
    return null;
  }

  /**
   * Reset a `file_uploads` row for a clean re-run and re-enqueue the parse job.
   * Shared by `reprocessUpload()` and `reassignUpload()` — the only difference
   * between the two callers is which `accountId` / `csvFormatConfig` end up on
   * the job.
   */
  private async runReprocess(
    upload: any,
    accountId: string,
    csvFormatConfig?: CsvFormatConfig,
  ) {
    const filePath = await this.resolveSourceFilePath(upload);
    if (!filePath) {
      throw new BadRequestException(
        'Source file no longer available on disk — re-drop it to import.',
      );
    }

    await this.db
      .update(schema.fileUploads)
      .set({
        status: 'pending',
        errorLog: [],
        rowsImported: 0,
        rowsSkipped: 0,
        rowsErrored: 0,
        updatedAt: new Date(),
      })
      .where(eq(schema.fileUploads.id, upload.id));

    await this.ingestionQueue.add(
      'parse-file',
      {
        uploadId: upload.id,
        userId: upload.userId,
        accountId,
        filePath,
        fileType: upload.fileType,
        ...(csvFormatConfig ? { csvFormatConfig } : {}),
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return this.getUploadStatus(upload.id, upload.userId);
  }

  /**
   * POST /uploads/:id/reprocess — re-run ingestion for a file that previously
   * failed, stalled, or produced no rows, without requiring a re-drop.
   * Dedup on `txnHash` makes this idempotent — no double-imported transactions.
   *
   * Rejects uploads that are pending/processing (already running) or
   * completed/orphaned (completed has nothing new to do; orphaned has no
   * account yet — use `reassignUpload()` instead).
   */
  async reprocessUpload(uploadId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(
        and(eq(schema.fileUploads.id, uploadId), eq(schema.fileUploads.userId, userId)),
      )
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Upload not found');
    const upload = rows[0];

    if (upload.status === 'pending' || upload.status === 'processing') {
      throw new BadRequestException(
        'This upload is already being processed.',
      );
    }
    if (upload.status === 'orphaned') {
      throw new BadRequestException(
        'This file has no account assigned — use fix-and-rerun (reassign) to pick an account first.',
      );
    }
    if (upload.status === 'completed') {
      throw new BadRequestException(
        'This upload already completed successfully — nothing to reprocess.',
      );
    }
    if (!upload.accountId) {
      throw new BadRequestException(
        'This upload has no account assigned — use fix-and-rerun (reassign) instead.',
      );
    }

    return this.runReprocess(upload, upload.accountId);
  }

  /**
   * POST /uploads/:id/reassign — fix-and-rerun: point an `orphaned` file (or
   * one imported under the wrong account) at the correct account, optionally
   * overriding CSV format config for this run, and re-run ingestion.
   *
   * If the upload had already imported transactions (status `completed` or
   * `empty`) under the old/wrong account, those transactions are deleted
   * first (keyed on `sourceFileId`, same as the Delete-upload path) so no
   * stale rows are left behind under the wrong account.
   */
  async reassignUpload(
    uploadId: string,
    userId: string,
    dto: { accountId: string; csvFormatConfig?: CsvFormatConfig },
  ) {
    // Orphaned rows (and lightweight watcher-failure rows) have no `userId`
    // yet — they aren't owned by anyone until a user claims them via reassign
    // — so look up by id alone and enforce ownership explicitly, rather than
    // filtering by userId up front (which would 404 every orphaned row for
    // every user, making them impossible to ever claim).
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.id, uploadId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Upload not found');
    const upload = rows[0];

    if (upload.userId && upload.userId !== userId) {
      throw new NotFoundException('Upload not found');
    }

    if (upload.status === 'pending' || upload.status === 'processing') {
      throw new BadRequestException(
        'This upload is already being processed.',
      );
    }

    // Verify the target account belongs to this user (404 to avoid enumeration).
    const account = await this.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.id, dto.accountId),
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
        ),
      )
      .limit(1);
    if (account.length === 0) throw new NotFoundException('Account not found');

    // Remove any transactions already imported from this file under the old
    // account so reassigning never leaves stale rows behind (same delete
    // logic as the Delete-upload path, keyed on sourceFileId).
    await this.db
      .delete(schema.transactions)
      .where(eq(schema.transactions.sourceFileId, uploadId));

    await this.db
      .update(schema.fileUploads)
      .set({
        accountId: dto.accountId,
        userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.fileUploads.id, uploadId));

    return this.runReprocess(
      { ...upload, accountId: dto.accountId, userId },
      dto.accountId,
      dto.csvFormatConfig,
    );
  }

  /**
   * Handle a watcher-stage event from the laptop watcher (POST
   * /ingestion/watcher-events). This is the future hand-off point that will
   * let the watcher report `detected` / `renamed` / `staged` / `failed`
   * stages before (or instead of) the file ever reaching the NAS watch
   * folder — making watcher-side failures visible in `file_uploads` (BS-5)
   * instead of vanishing before ingestion ever sees them.
   *
   * Matching strategy (best-effort, never creates a spurious
   * transactions-bearing row):
   *   1. Try to match an existing row by `watcherSlug` + filename
   *      (renamedFilename, falling back to originalFilename).
   *   2. If found, upsert the provenance columns onto it (and flip status to
   *      'failed' with the error for a `failed` stage event).
   *   3. If not found and the stage is `failed`, create a lightweight
   *      `failed` row so the watcher-side failure is still visible.
   *   4. If not found and the stage is anything else, there is nothing safe
   *      to attach the provenance to yet — log and return so a later ingest
   *      can populate it once the file actually arrives.
   *
   * @returns `'matched'` if an existing row was updated, `'created'` if a
   *   lightweight failed row was created, or `'unmatched'` if neither applied
   */
  async recordWatcherEvent(event: {
    stage: 'detected' | 'renamed' | 'staged' | 'failed';
    slug: string;
    originalFilename: string;
    renamedFilename?: string;
    bank?: string;
    detectedAt?: string;
    stagedAt?: string;
    error?: string;
  }): Promise<'matched' | 'created' | 'unmatched'> {
    const candidateFilenames = [event.renamedFilename, event.originalFilename].filter(
      (f): f is string => !!f,
    );

    let existing: any[] = [];
    for (const filename of candidateFilenames) {
      existing = await this.db
        .select()
        .from(schema.fileUploads)
        .where(
          and(
            eq(schema.fileUploads.watcherSlug, event.slug),
            eq(schema.fileUploads.originalFilename, filename),
          ),
        )
        .limit(1);
      if (existing.length > 0) break;
    }

    const provenance: Record<string, unknown> = {
      watcherSlug: event.slug,
      updatedAt: new Date(),
    };
    if (event.bank) provenance.watcherBank = event.bank;
    if (event.detectedAt) provenance.detectedAt = new Date(event.detectedAt);
    if (event.stagedAt) provenance.stagedAt = new Date(event.stagedAt);
    if (event.renamedFilename) provenance.originalFilename = event.renamedFilename;
    else if (event.originalFilename) provenance.originalFilename = event.originalFilename;

    if (existing.length > 0) {
      if (event.stage === 'failed') {
        provenance.status = 'failed';
        provenance.errorLog = [
          { row: 0, error: event.error ?? 'Watcher reported a failure', raw: '' },
        ];
      }
      await this.db
        .update(schema.fileUploads)
        .set(provenance)
        .where(eq(schema.fileUploads.id, existing[0].id));
      return 'matched';
    }

    if (event.stage === 'failed') {
      // Lightweight row: no user/account is known yet (both nullable),
      // just enough to surface the failure in the same table (BS-5).
      await this.db.insert(schema.fileUploads).values({
        filename: event.renamedFilename ?? event.originalFilename,
        originalFilename: event.originalFilename,
        watcherSlug: event.slug,
        watcherBank: event.bank,
        detectedAt: event.detectedAt ? new Date(event.detectedAt) : undefined,
        stagedAt: event.stagedAt ? new Date(event.stagedAt) : undefined,
        fileType: 'csv',
        fileHash: createHash('sha256')
          .update(`watcher-failed:${event.slug}:${event.originalFilename}:${Date.now()}`)
          .digest('hex'),
        status: 'failed',
        errorLog: [
          { row: 0, error: event.error ?? 'Watcher reported a failure', raw: '' },
        ],
      });
      return 'created';
    }

    return 'unmatched';
  }

  /**
   * Delete an upload record and its associated transactions.
   * Only allowed for completed or failed uploads (not in-progress).
   */
  async deleteUpload(uploadId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(
        and(
          eq(schema.fileUploads.id, uploadId),
          eq(schema.fileUploads.userId, userId),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw new NotFoundException('Upload not found');
    const upload = rows[0];

    if (upload.status === 'processing' || upload.status === 'pending') {
      throw new BadRequestException(
        'Cannot delete an upload that is still being processed',
      );
    }

    // Delete associated transactions first (FK constraint)
    await this.db
      .delete(schema.transactions)
      .where(eq(schema.transactions.sourceFileId, uploadId));

    // Delete the upload record
    await this.db
      .delete(schema.fileUploads)
      .where(eq(schema.fileUploads.id, uploadId));

    // Try to remove the file from disk (best-effort)
    if (upload.archivedPath) {
      try { await unlink(upload.archivedPath); } catch { /* file may already be gone */ }
    }

    return { deleted: true };
  }

  /**
   * Map a file extension to its `FileType` discriminant.
   * Throws `BadRequestException` for `.xls` (not supported by exceljs)
   * and for any unrecognised extension.
   *
   * @param filename - The original filename (extension is case-insensitive)
   * @returns `'csv' | 'excel' | 'pdf'`
   * @throws BadRequestException for `.xls` or unknown extensions
   */
  private detectFileType(filename: string): FileType {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'xlsx') return 'excel';
    if (ext === 'xls') {
      throw new BadRequestException(
        'Legacy .xls files are not supported. Please convert to .xlsx or .csv and re-upload.',
      );
    }
    if (ext === 'pdf') return 'pdf';
    throw new BadRequestException(
      `Unsupported file type: .${ext}. Allowed: .csv, .xlsx, .pdf`,
    );
  }
}
