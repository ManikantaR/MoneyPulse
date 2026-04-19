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
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
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
  async process(job: Job<any>): Promise<void> {
    // Route background AI categorization jobs
    if (job.name === 'ai-categorize') {
      return this.processAiCategorize(job);
    }

    const { uploadId, userId, accountId, filePath, fileType } = job.data as IngestionJobData;
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
        // Some bank CSVs (e.g. BofA checking) have summary/preamble lines
        // before the actual column headers. Strip everything before the real
        // header row so csv-parse doesn't choke.
        const csvText = this.stripCsvPreamble(buffer.toString('utf-8'));

        const records = this.parseCsvText(csvText);
        headers = records.length > 0 ? Object.keys(records[0]) : [];
        rows = records;
      } else if (fileType === 'pdf') {
        // Forward PDF to the Python PDF parser microservice
        const pdfResult = await this.pdfProxyService.parsePdf(
          buffer,
          filePath,
          account.institution,
        );

        if (
          pdfResult.transactions.length === 0 &&
          pdfResult.errors.length > 0
        ) {
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
          await this.alertsQueue.add('post-import-check', {
            userIds: [userId],
          });
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
      const skipRows = account.csvFormatConfig?.skipRows ?? 0;
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

        // Categorize new transactions (Phase 1: fast rules only, Phase 2: AI queued in background)
        try {
          const insertedIds = await this.getInsertedTransactionIds(
            accountId,
            uploadId,
            userId,
          );
          const ruleResult =
            await this.categorizationService.categorizeByRulesOnly(
              insertedIds,
              userId,
            );
          this.logger.log(
            `Rule categorization: ${ruleResult.categorizedByRule} by rules, ` +
              `${ruleResult.uncategorizedIds.length} remaining for AI`,
          );

          // Queue background AI categorization for remaining uncategorized (delayed by 2s)
          if (ruleResult.uncategorizedIds.length > 0) {
            await this.ingestionQueue.add(
              'ai-categorize',
              { transactionIds: ruleResult.uncategorizedIds, userId },
              { delay: 2000, attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
            );
            this.logger.log(
              `Queued AI categorization for ${ruleResult.uncategorizedIds.length} transactions`,
            );
          }
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
   * Parse CSV text with progressive fallbacks:
   * 1. Standard parse
   * 2. Standard parse with relax_quotes
   * 3. Sanitize internal quotes (e.g. BofA descriptions with unescaped
   *    nested quotes like:  Zelle payment for "Ritu class fee"  ) and re-parse
   */
  private parseCsvText(csvText: string): Record<string, string>[] {
    const baseOpts = {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    };

    // Attempt 1: standard parse
    try {
      return parse(csvText, { ...baseOpts }) as unknown as Record<string, string>[];
    } catch {
      // Attempt 2: relax_quotes (handles trailing quotes like:  Conf# abc123"  )
      try {
        return parse(csvText, { ...baseOpts, relax_quotes: true }) as unknown as Record<string, string>[];
      } catch {
        // Attempt 3: fix unescaped internal quotes then re-parse
        this.logger.warn('CSV parse failed; sanitizing internal quotes and retrying');
        const sanitized = this.sanitizeCsvQuotes(csvText);
        return parse(sanitized, { ...baseOpts }) as unknown as Record<string, string>[];
      }
    }
  }

  /**
   * Fix unescaped internal quotes in CSV text.
   *
   * Bank CSVs (e.g. BofA) sometimes embed raw quotes inside descriptions:
   *   "Zelle payment for "Ritu class fee"; Conf# xyz"
   * Standard CSV requires doubled quotes for literal quotes inside a field:
   *   "Zelle payment for ""Ritu class fee""; Conf# xyz"
   *
   * This method walks each line with a simple state machine, doubling any
   * quote character that is NOT at a field boundary (opening/closing).
   */
  private sanitizeCsvQuotes(csvText: string): string {
    return csvText
      .split(/\r?\n/)
      .map((line) => this.fixLineQuotes(line))
      .join('\n');
  }

  private fixLineQuotes(line: string): string {
    if (!line.includes('"')) return line;

    const out: string[] = [];
    let i = 0;

    while (i < line.length) {
      if (line[i] === '"') {
        // Start of a quoted field
        out.push('"');
        i++;
        // Read field contents until real closing quote (followed by , or EOL)
        while (i < line.length) {
          if (line[i] === '"') {
            if (i + 1 >= line.length || line[i + 1] === ',') {
              // Closing quote
              out.push('"');
              i++;
              break;
            } else if (line[i + 1] === '"') {
              // Already-escaped quote
              out.push('""');
              i += 2;
            } else {
              // Unescaped internal quote — double it for proper CSV
              out.push('""');
              i++;
            }
          } else {
            out.push(line[i]);
            i++;
          }
        }
      } else if (line[i] === ',') {
        out.push(',');
        i++;
      } else {
        // Unquoted field — read until comma
        while (i < line.length && line[i] !== ',') {
          out.push(line[i]);
          i++;
        }
      }
    }

    return out.join('');
  }

  /**
   * Strip preamble/summary rows that some banks (e.g. BofA checking) put before
   * the actual CSV header. Scans for the first line that looks like a real
   * header row (contains "Date" and at least one of the expected column names)
   * and discards everything above it.
   */
  private stripCsvPreamble(text: string): string {
    const lines = text.split(/\r?\n/);
    const knownHeaders = ['description', 'amount', 'reference number', 'running bal.', 'payee', 'posted date'];

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      const hasDate = lower.includes('date');
      const hasKnown = knownHeaders.some((h) => lower.includes(h));
      if (hasDate && hasKnown) {
        return lines.slice(i).join('\n');
      }
    }

    // No preamble detected — return as-is
    return text;
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

  /** Background AI categorization for transactions left uncategorized by rule engine. */
  private async processAiCategorize(
    job: Job<{ transactionIds: string[]; userId: string }>,
  ): Promise<void> {
    const { transactionIds, userId } = job.data;
    this.logger.log(
      `Background AI categorization: ${transactionIds.length} transactions`,
    );
    try {
      const stats = await this.categorizationService.categorizeBatch(
        transactionIds,
        userId,
      );
      this.logger.log(
        `Background AI done: ${stats.categorizedByRule} rules, ${stats.categorizedByAi} AI, ${stats.uncategorized} uncategorized`,
      );
    } catch (err: any) {
      this.logger.warn(`Background AI categorization failed: ${err.message}`);
    }
  }
}
