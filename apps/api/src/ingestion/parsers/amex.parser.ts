import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  extractMerchantName,
} from './base.parser';

/**
 * Amex CSV Parser
 *
 * Handles two Amex export formats:
 *
 * Short format (3 columns):
 *   Date,Description,Amount
 *   03/15/2026,UBER EATS,34.50
 *
 * Full format (5 columns, default Amex web export):
 *   Date,Description,Card Member,Account #,Amount
 *   03/15/2026,UBER EATS,JOHN DOE,XXXXX-12345,34.50
 *
 * Sign: **POSITIVE = charge** (opposite of BofA/Chase!), negative = credit/refund
 */
export class AmexParser implements BankParser {
  institution = 'amex' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    const hasCore =
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('amount');
    const noOtherBank =
      !normalized.includes('reference number') && // Not BofA checking
      !normalized.includes('post date') &&         // Not Chase CC
      !normalized.includes('status') &&            // Not Citi
      !normalized.includes('posted date');         // Not BofA CC
    // Only allow Amex-known columns (short or full export)
    const allKnown = normalized
      .filter((h) => h !== '') // ignore trailing empty column
      .every((h) => ['date', 'description', 'amount', 'card member', 'account #'].includes(h));
    return hasCore && noOtherBank && allKnown;
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
