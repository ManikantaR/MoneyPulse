import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, and, eq } from 'drizzle-orm';
import { AccountFreshnessService } from './account-freshness.service';

interface DataFreshnessInsight {
  userId: string;
  accountId: string;
  accountNickname: string;
  lastTransactionDate: Date | null;
  staleDays: number;
  message: string;
}

@Injectable()
export class FreshnessDetectorService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly freshnessService: AccountFreshnessService,
  ) {}

  /**
   * Check all users for data freshness issues and create insights
   */
  async detectAllFreshness(): Promise<DataFreshnessInsight[]> {
    const insights: DataFreshnessInsight[] = [];

    // Get all active users
    const users = await this.db
      .select()
      .from(schema.users)
      .where(sql`${schema.users.deletedAt} IS NULL`);

    for (const user of users) {
      const userInsights = await this.detectUserFreshness(user.id);
      insights.push(...userInsights);
    }

    return insights;
  }

  /**
   * Check a specific user for data freshness issues
   */
  async detectUserFreshness(userId: string): Promise<DataFreshnessInsight[]> {
    const insights: DataFreshnessInsight[] = [];

    // Get freshness status for all accounts
    const freshness = await this.freshnessService.getAccountFreshness(userId);

    for (const accountStatus of freshness.accounts) {
      if (accountStatus.status !== 'stale') {
        continue;
      }

      // Check if we already created an insight for this week (based on current date, not last txn)
      const dedupeKey = this.getDedupeKey(accountStatus.accountId);

      const existingInsight = await this.db.execute(sql`
        SELECT id
        FROM ${schema.notifications}
        WHERE ${schema.notifications.userId} = ${userId}
          AND ${schema.notifications.type} = 'data_freshness'
          AND ${schema.notifications.metadata}->>'dedupeKey' = ${dedupeKey}
          AND ${schema.notifications.createdAt} >= NOW() - INTERVAL '7 days'
        LIMIT 1
      `);

      if (existingInsight.rows && existingInsight.rows.length > 0) {
        continue; // Already notified this week
      }

      // Create the insight
      const lastTxnDate = accountStatus.lastTransactionDate
        ? accountStatus.lastTransactionDate.toISOString().split('T')[0]
        : 'unknown';

      const message = `${accountStatus.nickname} has no data since ${lastTxnDate} (${accountStatus.staleDays} days). Figures may be incomplete.`;

      // Insert the notification
      await this.db.execute(sql`
        INSERT INTO ${schema.notifications}
          (${schema.notifications.userId}, ${schema.notifications.type}, ${schema.notifications.title}, ${schema.notifications.message}, ${schema.notifications.metadata})
        VALUES
          (${userId}, 'data_freshness', 'Data Freshness Alert', ${message}, ${JSON.stringify({
            dedupeKey,
            accountId: accountStatus.accountId,
            accountNickname: accountStatus.nickname,
            lastTransactionDate: accountStatus.lastTransactionDate,
            staleDays: accountStatus.staleDays,
          })})
      `);

      insights.push({
        userId,
        accountId: accountStatus.accountId,
        accountNickname: accountStatus.nickname,
        lastTransactionDate: accountStatus.lastTransactionDate,
        staleDays: accountStatus.staleDays,
        message,
      });
    }

    return insights;
  }

  /**
   * Generate a dedupe key for freshness insights based on CURRENT week.
   * Format: freshness_<accountId>_<isoWeek>
   * The same account stale condition generates max one insight per week.
   * Uses current date (NOW) to compute the week, not the last transaction date,
   * so a persistently stale account dedupes correctly across week boundaries.
   */
  private getDedupeKey(accountId: string): string {
    const now = new Date();
    // Calculate ISO week number for today
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const isoWeek = Math.ceil(((d as any - (yearStart as any)) / 86400000 + 1) / 7);
    const year = d.getUTCFullYear();

    return `freshness_${accountId}_${year}-W${String(isoWeek).padStart(2, '0')}`;
  }
}
