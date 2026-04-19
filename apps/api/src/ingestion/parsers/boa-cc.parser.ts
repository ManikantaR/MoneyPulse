import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  type BankParser,
  type ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  extractMerchantName,
} from './base.parser';

/**
 * Bank of America Credit Card CSV Parser
 *
 * Format:
 *   Posted Date,Reference Number,Payee,Address,Amount
 *   04/17/2026,10720401530020859090131,"Int Sch Pymt Transfer","",234.00
 *
 * Sign convention: positive = credit (payment), negative = debit (charge)
 */
export class BoaCcParser implements BankParser {
  institution = 'boa' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('posted date') &&
      normalized.includes('payee') &&
      normalized.includes('amount') &&
      normalized.includes('reference number')
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Posted Date'] || row['posted date'];
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
          row['Payee'] || row['payee'] || ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty payee/description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        const externalId =
          (row['Reference Number'] || row['reference number'] || '').trim() ||
          null;

        // BofA CC: positive = credit (payment), negative = debit (charge)
        const isCredit = amountCents > 0;

        transactions.push({
          externalId,
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
