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
import { join } from 'path';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
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
   * 1. Compute SHA256 hash → reject duplicate file
   * 2. Save to UPLOAD_DIR
   * 3. Create file_uploads record (status: pending)
   * 4. Enqueue BullMQ job
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

    // Determine file type
    const fileType = this.detectFileType(file.originalname);

    // Compute SHA256
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // Check for duplicate file
    const existing = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.fileHash, fileHash))
      .limit(1);

    if (existing.length > 0) {
      throw new BadRequestException(
        `This file has already been uploaded (matched by SHA256 hash). Upload ID: ${existing[0].id}`,
      );
    }

    // Save file to disk
    const uploadDir = join(this.uploadDir, userId);
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, `${fileHash}_${file.originalname}`);
    await writeFile(filePath, file.buffer);

    // Create DB record
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
   */
  async getUploadStatus(uploadId: string) {
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.id, uploadId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Upload not found');
    return rows[0];
  }

  /**
   * List uploads for a user.
   */
  async listUploads(userId: string) {
    return this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.userId, userId))
      .orderBy(schema.fileUploads.createdAt);
  }

  /**
   * Update upload status (called by job processor).
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

  private detectFileType(filename: string): FileType {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    if (ext === 'pdf') return 'pdf';
    throw new BadRequestException(
      `Unsupported file type: .${ext}. Allowed: .csv, .xlsx, .xls, .pdf`,
    );
  }
}
