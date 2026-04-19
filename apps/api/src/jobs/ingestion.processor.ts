import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { selectParser } from '../ingestion/parsers/parser-registry';
import { parseExcelToRows } from '../ingestion/parsers/excel.parser';
import { DedupService } from '../ingestion/dedup.service';
import { ArchiverService } from '../ingestion/archiver.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { PdfProxyService } from '../ingestion/parsers/pdf-proxy.service';
import { AuditService } from '../audit/audit.service';
import { CategorizationService } from '../categorization/categorization.service';
import type { ParsedTransaction } from '@moneypulse/shared';

interface IngestionJobData {
  uploadId: string;
  userId: string;
  accountId: string;
  filePath: string;
  fileType: 'csv' | 'excel' | 'pdf';
}

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly dedupService: DedupService,
    private readonly archiverService: ArchiverService,
    private readonly ingestionService: IngestionService,
    private readonly pdfProxyService: PdfProxyService,
    private readonly auditService: AuditService,
    private readonly categorizationService: CategorizationService,
    @InjectQueue('alerts') private readonly alertsQueue: Queue,
  ) {
    super();
  }

  /**
   * BullMQ job handler — processes a single file upload through the full pipeline:
   * read → parse (CSV/Excel) → select parser → apply skipRows → dedup → batch-insert → archive.
   * Updates the `file_uploads` record with status and row counts on completion or failure.
   *
   * @param job - BullMQ job containing `{ uploadId, userId, accountId, filePath, fileType }`
   */
  async process(job: Job<IngestionJobData>): Promise<void> {
    const { uploadId, userId, accountId, filePath, fileType } = job.data;
    this.logger.log(`Processing upload ${uploadId}: ${filePath}`);

    try {
      // Mark as processing
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'processing',
      });

      // Get account info for parser selection
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      // Read file
      const buffer = await readFile(filePath);

      // Parse file → rows
      let headers: string[];
      let rows: Record<string, string>[];

      if (fileType === 'excel') {
        const result = await parseExcelToRows(buffer);
        headers = result.headers;
        rows = result.rows;
      } else if (fileType === 'csv') {
        const records = parse(buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: true,
        }) as Record<string, string>[];
        headers = records.length > 0 ? Object.keys(records[0]) : [];
        rows = records;
      } else if (fileType === 'pdf') {
        // Forward PDF to the Python PDF parser microservice
        const pdfResult = await this.pdfProxyService.parsePdf(
          buffer,
          filePath,
          account.institution,
        );

        if (pdfResult.transactions.length === 0 && pdfResult.errors.length > 0) {
          await this.ingestionService.updateUploadStatus(uploadId, {
            status: 'failed',
            errorLog: pdfResult.errors,
          });
          return;
        }

        // Continue with standard dedup + insert pipeline
        const dedupResult = await this.dedupService.dedup(
          accountId,
          pdfResult.transactions,
        );

        if (dedupResult.newTransactions.length > 0) {
          await this.insertTransactions(
            dedupResult.newTransactions,
            accountId,
            userId,
            uploadId,
          );

          // Categorize PDF transactions
          try {
            const insertedIds = await this.getInsertedTransactionIds(
              accountId,
              uploadId,
              userId,
            );
            const categorizationStats =
              await this.categorizationService.categorizeBatch(
                insertedIds,
                userId,
              );
            this.logger.log(
              `PDF categorization: ${categorizationStats.categorizedByRule} by rules, ` +
                `${categorizationStats.categorizedByAi} by AI, ` +
                `${categorizationStats.uncategorized} uncategorized`,
            );
          } catch (err: any) {
            this.logger.warn(
              `PDF categorization failed (transactions still imported): ${err.message}`,
            );
          }
        }

        // Archive the PDF file
        let archivedPath: string | null = null;
        try {
          archivedPath = await this.archiverService.archiveFile(filePath);
        } catch (err) {
          this.logger.warn(`Failed to archive PDF: ${err}`);
        }

        await this.ingestionService.updateUploadStatus(uploadId, {
          status: 'completed',
          rowsImported: dedupResult.newTransactions.length,
          rowsSkipped: dedupResult.skippedCount,
          rowsErrored: pdfResult.errors.length,
          errorLog: pdfResult.errors,
          archivedPath: archivedPath ?? undefined,
        });

        // Audit log for PDF import
        await this.auditService.log({
          userId,
          action: 'file_imported',
          entityType: 'file_upload',
          entityId: uploadId,
          newValue: {
            filename: filePath,
            fileType: 'pdf',
            imported: dedupResult.newTransactions.length,
            skipped: dedupResult.skippedCount,
            errors: pdfResult.errors.length,
          },
        });

        this.logger.log(
          `PDF upload ${uploadId} complete: ${dedupResult.newTransactions.length} imported, ` +
            `${dedupResult.skippedCount} skipped, ${pdfResult.errors.length} errors`,
        );

        // Trigger budget alert check after successful import
        if (dedupResult.newTransactions.length > 0) {
          await this.alertsQueue.add('post-import-check', { userIds: [userId] });
        }

        return;
      } else {
        throw new Error(`Unsupported file type: ${fileType}`);
      }

      if (rows.length === 0) {
        await this.ingestionService.updateUploadStatus(uploadId, {
          status: 'completed',
          rowsImported: 0,
          rowsSkipped: 0,
          rowsErrored: 0,
        });
        return;
      }

      // Select parser
      const parser = selectParser(
        headers,
        account.institution,
        account.csvFormatConfig,
      );

      // Apply skipRows from generic config (skip non-header leading rows)
      const skipRows =
        account.csvFormatConfig?.skipRows ?? 0;
      const dataRows = skipRows > 0 ? rows.slice(skipRows) : rows;
      // rowOffset: 1-based; row 1 = header, data starts at row 2 + any skipped rows
      const rowOffset = 2 + skipRows;

      // Parse rows → transactions
      const parseResult = parser.parseRows(dataRows, rowOffset);

      // Dedup
      const dedupResult = await this.dedupService.dedup(
        accountId,
        parseResult.transactions,
      );

      // Insert new transactions
      if (dedupResult.newTransactions.length > 0) {
        await this.insertTransactions(
          dedupResult.newTransactions,
          accountId,
          userId,
          uploadId,
        );

        // Categorize new transactions
        try {
          const insertedIds = await this.getInsertedTransactionIds(
            accountId,
            uploadId,
            userId,
          );
          const categorizationStats =
            await this.categorizationService.categorizeBatch(
              insertedIds,
              userId,
            );
          this.logger.log(
            `Categorization: ${categorizationStats.categorizedByRule} by rules, ` +
              `${categorizationStats.categorizedByAi} by AI, ` +
              `${categorizationStats.uncategorized} uncategorized`,
          );
        } catch (err: any) {
          this.logger.warn(
            `Categorization failed (transactions still imported): ${err.message}`,
          );
        }
      }

      // Archive the file
      let archivedPath: string | null = null;
      try {
        archivedPath = await this.archiverService.archiveFile(filePath);
      } catch (err) {
        this.logger.warn(`Failed to archive file: ${err}`);
      }

      // Update status
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'completed',
        rowsImported: dedupResult.newTransactions.length,
        rowsSkipped: dedupResult.skippedCount,
        rowsErrored: parseResult.errors.length,
        errorLog: parseResult.errors,
        archivedPath: archivedPath ?? undefined,
      });

      // Audit log
      await this.auditService.log({
        userId,
        action: 'file_imported',
        entityType: 'file_upload',
        entityId: uploadId,
        newValue: {
          filename: filePath,
          imported: dedupResult.newTransactions.length,
          skipped: dedupResult.skippedCount,
          errors: parseResult.errors.length,
        },
      });

      this.logger.log(
        `Upload ${uploadId} complete: ${dedupResult.newTransactions.length} imported, ` +
          `${dedupResult.skippedCount} skipped, ${parseResult.errors.length} errors`,
      );

      // Trigger budget alert check after successful import
      if (dedupResult.newTransactions.length > 0) {
        await this.alertsQueue.add('post-import-check', { userIds: [userId] });
      }
    } catch (err: any) {
      this.logger.error(`Upload ${uploadId} failed: ${err.message}`, err.stack);
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'failed',
        errorLog: [{ row: 0, error: err.message, raw: '' }],
      });
      throw err; // Let BullMQ handle retries
    }
  }

  /**
   * Fetch a single account row by its UUID.
   *
   * @param accountId - Account UUID
   * @returns The account row or `null` if not found
   */
  private async getAccount(accountId: string) {
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Batch-insert parsed transactions into the database in chunks of 100.
   * Each transaction's `txnHash` is computed via `DedupService.computeHash()`.
   *
   * @param transactions - Parsed and deduped transactions to insert
   * @param accountId - Account the transactions belong to
   * @param userId - User who owns the account
   * @param sourceFileId - Upload record UUID to link as the source file
   */
  private async insertTransactions(
    transactions: ParsedTransaction[],
    accountId: string,
    userId: string,
    sourceFileId: string,
  ): Promise<void> {
    const BATCH_SIZE = 100;
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);
      await this.db.insert(schema.transactions).values(
        batch.map((txn) => ({
          accountId,
          userId,
          externalId: txn.externalId,
          txnHash: this.dedupService.computeHash(accountId, txn),
          date: new Date(txn.date),
          description: txn.description,
          originalDescription: txn.description,
          amountCents: txn.amountCents,
          isCredit: txn.isCredit,
          merchantName: txn.merchantName,
          sourceFileId,
          tags: [],
        })),
      );
    }
  }

  private async getInsertedTransactionIds(
    accountId: string,
    sourceFileId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.accountId, accountId),
          eq(schema.transactions.sourceFileId, sourceFileId),
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.deletedAt),
        ),
      );
    return rows.map((r: any) => r.id);
  }
}
