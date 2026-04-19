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
import { mkdir, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { INGESTION_QUEUE, MAX_UPLOAD_SIZE_BYTES } from '@moneypulse/shared';
import type { FileType } from '@moneypulse/shared';

@Injectable()
export class IngestionService {
  private readonly uploadDir: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR') ?? '/tmp/moneypulse/uploads';
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
