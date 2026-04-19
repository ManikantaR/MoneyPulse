import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  extractMerchantName,
} from './base.parser';

/**
 * Chase Credit Card CSV Parser
 *
 * Format:
 *   Transaction Date,Post Date,Description,Category,Type,Amount
 *   03/15/2026,03/16/2026,STARBUCKS STORE 12345,Food & Drink,Sale,-5.75
 *
 * Sign: negative = charge, positive = payment/credit
 */
export class ChaseCcParser implements BankParser {
  institution = 'chase' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('transaction date') &&
      normalized.includes('post date') &&
      normalized.includes('description') &&
      normalized.includes('type') &&
      normalized.includes('amount') &&
      !normalized.includes('debit') // Distinguish from Chase checking
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Transaction Date'] || row['transaction date'];
        const date = parseDateMMDDYYYY(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const amountStr = row['Amount'] || row['amount'];
        const amountCents = parseAmountToCents(amountStr);
        if (amountCents === null) {
          errors.push({
            row: rowNum,
            error: `Invalid amount: "${amountStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const description = (
          row['Description'] ||
          row['description'] ||
          ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        // Chase CC: negative = charge (debit), positive = payment/credit
        const isCredit = amountCents > 0;

        transactions.push({
          externalId: null,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: extractMerchantName(description),
          runningBalanceCents: null,
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
}
