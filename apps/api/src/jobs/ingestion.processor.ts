import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { selectParser } from '../ingestion/parsers/parser-registry';
import { parseExcelToRows } from '../ingestion/parsers/excel.parser';
import { DedupService } from '../ingestion/dedup.service';
import { ArchiverService } from '../ingestion/archiver.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { AuditService } from '../audit/audit.service';
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
    private readonly auditService: AuditService,
  ) {
    super();
  }

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
        // PDF parsing is handled by the Python microservice (Phase 4)
        await this.ingestionService.updateUploadStatus(uploadId, {
          status: 'failed',
          errorLog: [
            {
              row: 0,
              error: 'PDF parsing requires the PDF parser service (Phase 4)',
              raw: '',
            },
          ],
        });
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

      // Parse rows → transactions
      const parseResult = parser.parseRows(rows, 2);

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
    } catch (err: any) {
      this.logger.error(`Upload ${uploadId} failed: ${err.message}`, err.stack);
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'failed',
        errorLog: [{ row: 0, error: err.message, raw: '' }],
      });
      throw err; // Let BullMQ handle retries
    }
  }

  private async getAccount(accountId: string) {
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    return rows[0] ?? null;
  }

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
}
