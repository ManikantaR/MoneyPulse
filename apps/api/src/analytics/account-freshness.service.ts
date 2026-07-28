import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, and, eq } from 'drizzle-orm';
import { sqlArray } from '../db/sql-array';

export type FreshnessStatus = 'fresh' | 'stale' | 'dormant';

export interface AccountFreshness {
  accountId: string;
  nickname: string;
  institution: string;
  lastTransactionDate: Date | null;
  lastImportAt: Date | null;
  staleDays: number;
  status: FreshnessStatus;
  expectedImportCadenceDays: number | null;
}

export interface FreshnessOverview {
  accounts: AccountFreshness[];
  coverage: {
    activeAccounts: number;
    freshAccounts: number;
    staleAccounts: number;
  };
  overallCoverage: string; // "N of M active accounts fresh"
}

@Injectable()
export class AccountFreshnessService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Get freshness status for all active accounts for a user
   */
  async getAccountFreshness(userId: string): Promise<FreshnessOverview> {
    // Fetch user settings for freshness threshold
    const userSettings = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId));

    const freshnessThresholdDays = userSettings[0]?.freshnessThresholdDays ?? 14;

    // Fetch all active accounts for the user
    const accounts = await this.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          sql`${schema.accounts.deletedAt} IS NULL`,
        ),
      );

    const freshnessData: AccountFreshness[] = [];
    let freshCount = 0;
    let staleCount = 0;
    let activeCount = 0;

    for (const account of accounts) {
      // Get last transaction date for the account
      const lastTxn = await this.db.execute(sql`
        SELECT date
        FROM ${schema.transactions}
        WHERE ${schema.transactions.accountId} = ${account.id}
          AND ${schema.transactions.deletedAt} IS NULL
        ORDER BY date DESC
        LIMIT 1
      `);

      const lastTransactionDate = lastTxn.rows?.[0]?.date ?? null;

      // Get last import date from file_uploads
      const lastImport = await this.db.execute(sql`
        SELECT updated_at
        FROM ${schema.fileUploads}
        WHERE ${schema.fileUploads.accountId} = ${account.id}
          AND ${schema.fileUploads.status} = 'completed'
        ORDER BY updated_at DESC
        LIMIT 1
      `);

      const lastImportAt = lastImport.rows?.[0]?.updated_at ?? null;

      // Determine status
      let status: FreshnessStatus = 'fresh';
      let staleDays = 0;

      if (account.isDormant) {
        status = 'dormant';
      } else {
        // Not dormant - this is an active account
        activeCount++;

        if (lastTransactionDate) {
          const daysSinceLastTxn = Math.floor(
            (Date.now() - new Date(lastTransactionDate).getTime()) /
              (1000 * 60 * 60 * 24),
          );
          staleDays = daysSinceLastTxn;

          if (daysSinceLastTxn > freshnessThresholdDays) {
            status = 'stale';
            staleCount++;
          } else {
            freshCount++;
          }
        } else {
          // No transactions yet - treat as fresh
          staleDays = 0;
          freshCount++;
        }
      }

      freshnessData.push({
        accountId: account.id,
        nickname: account.nickname,
        institution: account.institution,
        lastTransactionDate: lastTransactionDate
          ? new Date(lastTransactionDate)
          : null,
        lastImportAt: lastImportAt ? new Date(lastImportAt) : null,
        staleDays,
        status,
        expectedImportCadenceDays: account.expectedImportCadenceDays,
      });
    }

    const overallCoverage =
      activeCount > 0 ? `${freshCount} of ${activeCount}` : '0 of 0';

    return {
      accounts: freshnessData,
      coverage: {
        activeAccounts: activeCount,
        freshAccounts: freshCount,
        staleAccounts: staleCount,
      },
      overallCoverage,
    };
  }

  /**
   * Get freshness status for a specific account
   */
  async getAccountFreshnessById(
    userId: string,
    accountId: string,
  ): Promise<AccountFreshness | null> {
    const overview = await this.getAccountFreshness(userId);
    return (
      overview.accounts.find((acc) => acc.accountId === accountId) || null
    );
  }

  /**
   * Check if an account is stale
   */
  async isAccountStale(
    userId: string,
    accountId: string,
  ): Promise<boolean> {
    const freshness = await this.getAccountFreshnessById(userId, accountId);
    return freshness?.status === 'stale' || false;
  }

  /**
   * Get all stale account IDs for a user
   */
  async getStaleAccountIds(userId: string): Promise<string[]> {
    const overview = await this.getAccountFreshness(userId);
    return overview.accounts
      .filter((acc) => acc.status === 'stale')
      .map((acc) => acc.accountId);
  }

  /**
   * Get accounts involved in a set of transactions
   */
  async getAccountsByTransactionIds(
    userIds: string[],
    transactionIds: string[],
  ): Promise<string[]> {
    if (transactionIds.length === 0) {
      return [];
    }

    const result = await this.db.execute(sql`
      SELECT DISTINCT account_id
      FROM ${schema.transactions}
      WHERE ${schema.transactions.id} = ANY(${sqlArray(transactionIds, 'uuid')})
        AND ${schema.transactions.userId} = ANY(${sqlArray(userIds, 'uuid')})
        AND ${schema.transactions.deletedAt} IS NULL
    `);

    return result.rows?.map((row: { account_id: string }) => row.account_id) ?? [];
  }
}
