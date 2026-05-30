import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, count, inArray } from 'drizzle-orm';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import type { TransactionAttachment } from '@moneypulse/shared';

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);
  private readonly attachmentsDir: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly config: ConfigService,
  ) {
    this.attachmentsDir =
      this.config.get<string>('ATTACHMENTS_DIR') ?? '/config/attachments';
  }

  /**
   * Verify that a transaction exists, belongs to the given user, and is not soft-deleted.
   * Throws NotFoundException otherwise.
   */
  async verifyTransactionOwnership(
    transactionId: string,
    userId: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Transaction not found');
    }
  }

  /**
   * Persist an uploaded file for a transaction.
   * Writes the file buffer to disk first, then inserts a DB record.
   * Rolls back the file if the DB insert fails.
   */
  async createAttachment(
    transactionId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<TransactionAttachment> {
    const filename = `${randomUUID()}${extname(file.originalname)}`;
    const dir = join(this.attachmentsDir, userId, transactionId);
    const storagePath = join(dir, filename);

    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      this.logger.error(`Failed to create directory ${dir}`, err);
      throw new InternalServerErrorException('Storage error');
    }

    try {
      writeFileSync(storagePath, file.buffer);
    } catch (err) {
      this.logger.error(`Failed to write file ${storagePath}`, err);
      throw new InternalServerErrorException('Storage error');
    }

    try {
      const rows = await this.db
        .insert(schema.transactionAttachments)
        .values({
          transactionId,
          userId,
          filename,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storagePath,
        })
        .returning();

      return this.toDto(rows[0]);
    } catch (err) {
      // Roll back file on DB failure
      try {
        unlinkSync(storagePath);
      } catch {
        this.logger.warn(`Could not remove orphaned file ${storagePath}`);
      }
      this.logger.error('DB insert failed for attachment', err);
      throw new InternalServerErrorException('Failed to save attachment');
    }
  }

  /** List all attachments for a transaction owned by the given user. */
  async listAttachments(
    transactionId: string,
    userId: string,
  ): Promise<TransactionAttachment[]> {
    await this.verifyTransactionOwnership(transactionId, userId);

    const rows = await this.db
      .select()
      .from(schema.transactionAttachments)
      .where(
        and(
          eq(schema.transactionAttachments.transactionId, transactionId),
          eq(schema.transactionAttachments.userId, userId),
        ),
      );

    return rows.map((r: any) => this.toDto(r));
  }

  /** Find a single attachment by ID. Returns null if not found. */
  async findById(id: string): Promise<TransactionAttachment | null> {
    const rows = await this.db
      .select()
      .from(schema.transactionAttachments)
      .where(eq(schema.transactionAttachments.id, id))
      .limit(1);

    return rows.length > 0 ? this.toDto(rows[0]) : null;
  }

  /**
   * Delete an attachment by ID.
   * Verifies ownership, removes the file from disk (ignores ENOENT),
   * then deletes the DB record.
   */
  async deleteAttachment(id: string, userId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.transactionAttachments)
      .where(eq(schema.transactionAttachments.id, id))
      .limit(1);

    if (rows.length === 0 || rows[0].userId !== userId) {
      throw new NotFoundException('Attachment not found');
    }

    const attachment = rows[0];

    if (existsSync(attachment.storagePath)) {
      try {
        unlinkSync(attachment.storagePath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          this.logger.error(
            `Failed to delete file ${attachment.storagePath}`,
            err,
          );
          throw new InternalServerErrorException('Failed to delete file');
        }
      }
    }

    await this.db
      .delete(schema.transactionAttachments)
      .where(eq(schema.transactionAttachments.id, id));
  }

  /** Count attachments per transaction for a given user (for list enrichment). */
  async countByTransactionIds(
    transactionIds: string[],
    userId: string,
  ): Promise<Record<string, number>> {
    if (transactionIds.length === 0) return {};

    const counts = await this.db
      .select({
        transactionId: schema.transactionAttachments.transactionId,
        attachmentCount: count(),
      })
      .from(schema.transactionAttachments)
      .where(
        and(
          inArray(
            schema.transactionAttachments.transactionId,
            transactionIds,
          ),
          eq(schema.transactionAttachments.userId, userId),
        ),
      )
      .groupBy(schema.transactionAttachments.transactionId);

    return Object.fromEntries(
      counts.map((c: any) => [c.transactionId, Number(c.attachmentCount)]),
    );
  }

  private toDto(row: any): TransactionAttachment {
    return {
      id: row.id,
      transactionId: row.transactionId,
      userId: row.userId,
      filename: row.filename,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      storagePath: row.storagePath,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : row.createdAt,
    };
  }
}
