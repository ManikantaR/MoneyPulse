import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  extractMerchantName,
} from './base.parser';

/**
 * Bank of America CSV Parser
 *
 * Format:
 *   Date,Reference Number,Description,Amount,Running Bal.
 *   03/15/2026,1234567890,WHOLE FOODS MARKET,-85.23,4234.56
 *
 * Sign convention: negative = debit, positive = credit
 */
export class BoaParser implements BankParser {
  institution = 'boa' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('amount') &&
      (normalized.includes('reference number') ||
        normalized.includes('running bal.'))
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

        const externalId =
          (row['Reference Number'] || row['reference number'] || '').trim() ||
          null;
        const balanceStr = row['Running Bal.'] || row['running bal.'] || '';
        const runningBalanceCents = parseAmountToCents(balanceStr);

        // BofA: negative = debit, positive = credit
        const isCredit = amountCents > 0;

        transactions.push({
          externalId,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: extractMerchantName(description),
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
}
