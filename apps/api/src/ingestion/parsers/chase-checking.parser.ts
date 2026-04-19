import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  extractMerchantName,
} from './base.parser';

/**
 * Chase Checking CSV Parser
 *
 * Format:
 *   Transaction Date,Posting Date,Description,Category,Debit,Credit,Balance
 *   03/15/2026,03/15/2026,AMAZON.COM,Shopping,45.99,,3200.00
 *
 * Sign: Separate unsigned Debit/Credit columns (one populated per row)
 */
export class ChaseCheckingParser implements BankParser {
  institution = 'chase' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('transaction date') &&
      (normalized.includes('posting date') ||
        normalized.includes('post date')) &&
      normalized.includes('debit') &&
      normalized.includes('credit') &&
      normalized.includes('balance')
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

        const debitStr = (row['Debit'] || row['debit'] || '').trim();
        const creditStr = (row['Credit'] || row['credit'] || '').trim();

        let amountCents: number;
        let isCredit: boolean;

        if (debitStr && !creditStr) {
          amountCents = parseAmountToCents(debitStr) ?? 0;
          isCredit = false;
        } else if (creditStr && !debitStr) {
          amountCents = parseAmountToCents(creditStr) ?? 0;
          isCredit = true;
        } else if (debitStr && creditStr) {
          const d = parseAmountToCents(debitStr) ?? 0;
          const c = parseAmountToCents(creditStr) ?? 0;
          if (d >= c) {
            amountCents = d;
            isCredit = false;
          } else {
            amountCents = c;
            isCredit = true;
          }
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

        const balanceStr = row['Balance'] || row['balance'] || '';
        const runningBalanceCents = parseAmountToCents(balanceStr);

        transactions.push({
          externalId: null,
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
