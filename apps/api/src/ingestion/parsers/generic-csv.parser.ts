import type {
  ParsedTransaction,
  FileUploadError,
  CsvFormatConfig,
} from '@moneypulse/shared';
import {
  type ParseResult,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';
import { parse as parseDate, format as formatDate } from 'date-fns';

/**
 * Generic CSV Parser — configurable per-account.
 * Uses CsvFormatConfig stored on the account to map columns.
 */
export class GenericCsvParser {
  constructor(private config: CsvFormatConfig) {}

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        // Parse date
        const dateStr = (row[this.config.dateColumn] || '').trim();
        const date = this.parseConfigDate(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}" (expected ${this.config.dateFormat})`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        // Parse amount based on sign convention
        let amountCents: number;
        let isCredit: boolean;

        if (this.config.signConvention === 'split_columns') {
          const { debitColumn, creditColumn } = this.config;

          if (!debitColumn || !creditColumn) {
            errors.push({
              row: rowNum,
              error:
                'Invalid CSV format config: debitColumn and creditColumn are required when signConvention is "split_columns".',
              raw: JSON.stringify(row),
            });
            continue;
          }

          const debitStr = (row[debitColumn] || '').trim();
          const creditStr = (row[creditColumn] || '').trim();

          if (debitStr) {
            amountCents = parseAmountToCents(debitStr) ?? 0;
            isCredit = false;
          } else if (creditStr) {
            amountCents = parseAmountToCents(creditStr) ?? 0;
            isCredit = true;
          } else {
            errors.push({
              row: rowNum,
              error: 'No debit or credit',
              raw: JSON.stringify(row),
            });
            continue;
          }
        } else {
          const amountStr = (row[this.config.amountColumn!] || '').trim();
          const rawCents = parseAmountToCents(amountStr);
          if (rawCents === null) {
            errors.push({
              row: rowNum,
              error: `Invalid amount: "${amountStr}"`,
              raw: JSON.stringify(row),
            });
            continue;
          }

          if (this.config.signConvention === 'negative_debit') {
            isCredit = rawCents > 0;
          } else {
            // positive_debit: positive = debit (Amex)
            isCredit = rawCents < 0;
          }
          amountCents = Math.abs(rawCents);
        }

        // Description
        const description = (row[this.config.descriptionColumn] || '').trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        // Optional fields
        const externalId = this.config.externalIdColumn
          ? (row[this.config.externalIdColumn] || '').trim() || null
          : null;
        const merchantName = this.config.merchantColumn
          ? (row[this.config.merchantColumn] || '').trim() || null
          : normalizeDescription(description);
        const runningBalanceCents = this.config.balanceColumn
          ? parseAmountToCents(row[this.config.balanceColumn] || '')
          : null;

        transactions.push({
          externalId,
          date,
          description,
          amountCents,
          isCredit,
          merchantName,
          runningBalanceCents,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }

  /**
   * Parse date using the configured format.
   */
  private parseConfigDate(dateStr: string): string | null {
    if (!dateStr) return null;

    try {
      const formatMap: Record<string, string> = {
        'MM/DD/YYYY': 'MM/dd/yyyy',
        'M/D/YYYY': 'M/d/yyyy',
        'DD/MM/YYYY': 'dd/MM/yyyy',
        'YYYY-MM-DD': 'yyyy-MM-dd',
        'MM-DD-YYYY': 'MM-dd-yyyy',
      };

      const dateFnsFormat = formatMap[this.config.dateFormat];
      if (!dateFnsFormat) return null;

      const parsed = parseDate(dateStr.trim(), dateFnsFormat, new Date());
      if (isNaN(parsed.getTime())) return null;

      return formatDate(parsed, 'yyyy-MM-dd');
    } catch {
      return null;
    }
  }
}
