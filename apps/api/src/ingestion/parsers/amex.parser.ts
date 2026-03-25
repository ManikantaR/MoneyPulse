import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Amex CSV Parser
 *
 * Format:
 *   Date,Description,Amount
 *   03/15/2026,UBER EATS,34.50
 *
 * Sign: **POSITIVE = charge** (opposite of BofA/Chase!), negative = credit/refund
 * Only 3 columns — detect by column count + absence of other headers.
 */
export class AmexParser implements BankParser {
  institution = 'amex' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.length <= 4 && // Amex has 3 columns (sometimes a trailing empty)
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('amount') &&
      !normalized.includes('reference number') && // Not BofA
      !normalized.includes('post date') && // Not Chase
      !normalized.includes('status') // Not Citi
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Date'] || row['date'];
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

        // AMEX: positive = charge (debit!), negative = credit/refund
        const isCredit = amountCents < 0;

        transactions.push({
          externalId: null,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: normalizeDescription(description),
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
