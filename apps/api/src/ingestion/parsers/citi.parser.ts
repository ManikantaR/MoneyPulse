import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Citi CSV Parser
 *
 * Format:
 *   Status,Date,Description,Debit,Credit
 *   Cleared,03/15/2026,TARGET STORE 1234,89.50,
 *
 * Sign: Separate unsigned Debit/Credit columns (like Chase checking)
 * Identified by "Status" column presence.
 */
export class CitiParser implements BankParser {
  institution = 'citi' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('status') &&
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('debit') &&
      normalized.includes('credit')
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

        const debitStr = (row['Debit'] || row['debit'] || '').trim();
        const creditStr = (row['Credit'] || row['credit'] || '').trim();

        let amountCents: number;
        let isCredit: boolean;

        if (debitStr) {
          amountCents = parseAmountToCents(debitStr) ?? 0;
          isCredit = false;
        } else if (creditStr) {
          amountCents = parseAmountToCents(creditStr) ?? 0;
          isCredit = true;
        } else {
          errors.push({
            row: rowNum,
            error: 'No debit or credit amount',
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
