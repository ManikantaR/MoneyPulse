import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, between, isNull, desc } from 'drizzle-orm';

/** Escape a string value for safe inclusion in a CSV field. */
function csvField(value: string | null | undefined): string {
  const str = value ?? '';
  return `"${str.replace(/"/g, '""')}"`;
}

@Injectable()
export class ExportService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Exports user transactions as a CSV string.
   * Joins with categories and accounts for display names.
   * Optionally filters by date range.
   *
   * @param {string} userId - The ID of the user whose transactions will be exported.
   * @param {string} [from] - Optional start date (inclusive) in ISO-8601 format.
   * @param {string} [to] - Optional end date (inclusive) in ISO-8601 format.
   * @returns {Promise<string>} A promise that resolves to the CSV-formatted transactions.
   * @throws {Error} If the database query fails or if date parsing encounters an error.
   */
  async exportCsv(userId: string, from?: string, to?: string): Promise<string> {
    const conditions = [
      eq(schema.transactions.userId, userId),
      eq(schema.transactions.isSplitParent, false),
      isNull(schema.transactions.deletedAt),
    ];

    if (from && to) {
      conditions.push(
        between(schema.transactions.date, new Date(from), new Date(to)),
      );
    }

    const rows = await this.db
      .select({
        date: schema.transactions.date,
        description: schema.transactions.description,
        amountCents: schema.transactions.amountCents,
        isCredit: schema.transactions.isCredit,
        categoryName: schema.categories.name,
        merchantName: schema.transactions.merchantName,
        accountNickname: schema.accounts.nickname,
      })
      .from(schema.transactions)
      .leftJoin(
        schema.categories,
        eq(schema.transactions.categoryId, schema.categories.id),
      )
      .leftJoin(
        schema.accounts,
        eq(schema.transactions.accountId, schema.accounts.id),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.transactions.date));

    // Build CSV with header row — all string fields are quoted and escaped
    const header = 'Date,Description,Amount,Type,Category,Merchant,Account\n';
    const lines = rows.map((r: any) => {
      const amount = (r.amountCents / 100).toFixed(2);
      const type = r.isCredit ? 'Credit' : 'Debit';
      const date = r.date.toISOString().slice(0, 10);
      return [
        date,
        csvField(r.description),
        amount,
        type,
        csvField(r.categoryName),
        csvField(r.merchantName),
        csvField(r.accountNickname),
      ].join(',');
    });

    return header + lines.join('\n');
  }
}
