import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';
import type {
  AnalyticsQuery,
  SpendingTrendQuery,
  TopMerchantsQuery,
} from '@moneypulse/shared';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /** Extract raw rows from a Drizzle execute() result. */
  private extractRows(result: any): any[] {
    return result.rows ?? result;
  }

  /**
   * Returns monthly income vs expense totals within the given date range.
   * Groups transactions by calendar month, summing credits (income) and debits (expenses) separately.
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {AnalyticsQuery} query - Date/account/category filters and household flag.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<Array<{ month: string; incomeCents: number; expenseCents: number }>>}
   *   Array of monthly aggregates sorted by month ascending.
   */
  async incomeVsExpenses(
    userId: string,
    query: AnalyticsQuery,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`${schema.transactions.userId} IN (
          SELECT id FROM ${schema.users} WHERE household_id = ${householdId}
        )`
      : sql`${schema.transactions.userId} = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        to_char(date_trunc('month', ${schema.transactions.date}), 'YYYY-MM') AS month,
        SUM(CASE WHEN ${schema.transactions.isCredit} = true THEN ${schema.transactions.amountCents} ELSE 0 END) AS income_cents,
        SUM(CASE WHEN ${schema.transactions.isCredit} = false THEN ${schema.transactions.amountCents} ELSE 0 END) AS expense_cents
      FROM ${schema.transactions}
      WHERE ${schema.transactions.isSplitParent} = false
        AND ${schema.transactions.deletedAt} IS NULL
        AND ${userScope}
        ${query.from ? sql`AND ${schema.transactions.date} >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND ${schema.transactions.date} <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND ${schema.transactions.accountId} = ${query.accountId}` : sql``}
      GROUP BY date_trunc('month', ${schema.transactions.date})
      ORDER BY month ASC
    `);
    return this.extractRows(result).map((r: any) => ({
      month: r.month,
      incomeCents: Number(r.income_cents),
      expenseCents: Number(r.expense_cents),
    }));
  }

  /**
   * Returns per-category spending totals (expenses only).
   * Joins transactions with categories to include name, icon, and color.
   * Computes percentage of total spending per category.
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {AnalyticsQuery} query - Date/account/category filters and household flag.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<Array<{ categoryId: string; categoryName: string; categoryIcon: string; categoryColor: string; totalCents: number; transactionCount: number; percentage: number }>>}
   *   Array of category breakdowns sorted by total spend descending.
   * @throws {Error} If the database query fails.
   */
  async categoryBreakdown(
    userId: string,
    query: AnalyticsQuery,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        -- c.id is a UUID; 'uncategorized' is a safe sentinel that cannot clash with any UUID
        COALESCE(c.id::text, 'uncategorized') AS category_id,
        c.name AS category_name,
        c.icon,
        c.color,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY c.id, c.name, c.icon, c.color
      ORDER BY total_cents DESC
    `);
    const rows = this.extractRows(result);
    const grandTotal = rows.reduce(
      (sum: number, r: any) => sum + Number(r.total_cents),
      0,
    );
    return rows.map((r: any) => ({
      categoryId: r.category_id,
      categoryName: r.category_name ?? 'Uncategorized',
      categoryIcon: r.icon ?? '📝',
      categoryColor: r.color ?? '#64748b',
      totalCents: Number(r.total_cents),
      transactionCount: Number(r.txn_count),
      percentage: grandTotal > 0
        ? Math.round((Number(r.total_cents) / grandTotal) * 1000) / 10
        : 0,
    }));
  }

  /**
   * Returns time-series income and expense data at daily/weekly/monthly granularity.
   * Includes both income (credits) and expenses (debits) per period.
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {SpendingTrendQuery} query - Date/account/granularity filters and household flag.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<Array<{ period: string; income: number; expenses: number }>>}
   *   Array of period aggregates sorted ascending.
   * @throws {Error} If the database query fails.
   */
  async spendingTrend(
    userId: string,
    query: SpendingTrendQuery,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    const truncFn = {
      daily: sql`date_trunc('day', t.date)`,
      weekly: sql`date_trunc('week', t.date)`,
      monthly: sql`date_trunc('month', t.date)`,
    }[query.granularity];

    const result = await this.db.execute(sql`
      SELECT
        to_char(${truncFn}, 'YYYY-MM-DD') AS period,
        SUM(CASE WHEN t.is_credit = true THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN t.is_credit = false THEN t.amount_cents ELSE 0 END) AS expense_cents
      FROM ${schema.transactions} t
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY ${truncFn}
      ORDER BY period ASC
    `);
    return this.extractRows(result).map((r: any) => ({
      period: r.period,
      income: Number(r.income_cents),
      expenses: Number(r.expense_cents),
    }));
  }

  /**
   * Returns per-account current balances computed from starting balance + cumulative transactions.
   * Includes account metadata (nickname, institution, type, credit limit).
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {AnalyticsQuery} query - Date/account filters and household flag.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<Array<{ accountId: string; nickname: string; institution: string; accountType: string; balanceCents: number }>>}
   *   Array of account balances sorted by nickname.
   * @throws {Error} If the database query fails.
   */
  async accountBalances(
    userId: string,
    query: AnalyticsQuery,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`a.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`a.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        a.id AS account_id,
        a.nickname,
        a.institution,
        a.account_type,
        a.starting_balance_cents,
        a.credit_limit_cents,
        COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS net_change_cents,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS current_balance_cents
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t
        ON a.id = t.account_id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
      WHERE a.deleted_at IS NULL
        AND ${userScope}
        ${query.accountId ? sql`AND a.id = ${query.accountId}` : sql``}
      GROUP BY a.id, a.nickname, a.institution, a.account_type,
               a.starting_balance_cents, a.credit_limit_cents
      ORDER BY a.nickname
    `);
    return this.extractRows(result).map((r: any) => ({
      accountId: r.account_id,
      nickname: r.nickname,
      institution: r.institution,
      accountType: r.account_type,
      balanceCents: Number(r.current_balance_cents),
    }));
  }

  /**
   * Returns credit utilization for the authenticated user's credit card accounts.
   * Computes current balance as starting_balance + net transactions and utilization percentage.
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {AnalyticsQuery} query - Household flag for scoping.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<Array<{ accountId: string; nickname: string; balanceCents: number; limitCents: number; utilizationPercent: number }>>}
   *   Array of credit utilization records.
   * @throws {Error} If the database query fails.
   */
  async creditUtilization(
    userId: string,
    query: Pick<AnalyticsQuery, 'household'>,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`a.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`a.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        a.id AS account_id,
        a.nickname,
        a.credit_limit_cents,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS balance_cents
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t
        ON a.id = t.account_id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
      WHERE a.account_type = 'credit_card'
        AND a.deleted_at IS NULL
        AND a.credit_limit_cents IS NOT NULL
        AND ${userScope}
      GROUP BY a.id, a.nickname, a.credit_limit_cents, a.starting_balance_cents
    `);
    return this.extractRows(result).map((r: any) => {
      const balance = Math.abs(Number(r.balance_cents));
      const limit = Number(r.credit_limit_cents);
      return {
        accountId: r.account_id,
        nickname: r.nickname,
        balanceCents: balance,
        limitCents: limit,
        utilizationPercent:
          limit > 0 ? Math.round((balance / limit) * 1000) / 10 : 0,
      };
    });
  }

  /**
   * Returns a net worth snapshot: assets minus liabilities plus investments.
   * Assets = checking + savings balances. Liabilities = credit card balances.
   * Investments = latest snapshot balance per investment account.
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {Pick<AnalyticsQuery, 'household'>} query - Household flag for scoping.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<{ assets: number; liabilities: number; investments: number; netWorth: number }>}
   *   Net worth snapshot with assets, liabilities, investments, and net total.
   * @throws {Error} If the database query fails.
   */
  async netWorth(
    userId: string,
    query: Pick<AnalyticsQuery, 'household'>,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`a.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`a.user_id = ${userId}`;

    const invUserScope = householdId && query.household
      ? sql`ia.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`ia.user_id = ${userId}`;

    const rows = await this.db.execute(sql`
      SELECT
        SUM(CASE
          WHEN a.account_type IN ('checking', 'savings') THEN
            a.starting_balance_cents + COALESCE(sub.net, 0)
          ELSE 0
        END) AS assets_cents,
        SUM(CASE
          WHEN a.account_type = 'credit_card' THEN
            ABS(a.starting_balance_cents + COALESCE(sub.net, 0))
          ELSE 0
        END) AS liabilities_cents
      FROM ${schema.accounts} a
      LEFT JOIN LATERAL (
        SELECT SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ) AS net
        FROM ${schema.transactions} t
        WHERE t.account_id = a.id
          AND t.is_split_parent = false
          AND t.deleted_at IS NULL
      ) sub ON true
      WHERE a.deleted_at IS NULL
        AND ${userScope}
    `);

    const row = this.extractRows(rows)[0] || {
      assets_cents: 0,
      liabilities_cents: 0,
    };

    // Add investment balances (latest snapshot per account) scoped to user
    const investmentRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(latest.balance_cents), 0) AS investment_total_cents
      FROM (
        SELECT DISTINCT ON (ia.id) is2.balance_cents
        FROM ${schema.investmentAccounts} ia
        JOIN ${schema.investmentSnapshots} is2 ON ia.id = is2.investment_account_id
        WHERE ia.deleted_at IS NULL
          AND ${invUserScope}
        ORDER BY ia.id, is2.date DESC
      ) latest
    `);

    const investmentCents =
      this.extractRows(investmentRows)[0]?.investment_total_cents ?? 0;

    return {
      assets: Number(row.assets_cents) + Number(investmentCents),
      liabilities: Number(row.liabilities_cents),
      investments: Number(investmentCents),
      netWorth:
        Number(row.assets_cents) +
        Number(investmentCents) -
        Number(row.liabilities_cents),
    };
  }

  /**
   * Returns top merchants by total spend amount.
   * Falls back to transaction description when merchant_name is null.
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {TopMerchantsQuery} query - Date/account filters, limit, and household flag.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<Array<{ merchantName: string; totalCents: number; transactionCount: number }>>}
   *   Top merchants sorted by total spend descending.
   * @throws {Error} If the database query fails.
   */
  async topMerchants(
    userId: string,
    query: TopMerchantsQuery,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    const limit = query.limit ?? 10;
    const result = await this.db.execute(sql`
      SELECT
        COALESCE(t.merchant_name, t.description) AS merchant,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY COALESCE(t.merchant_name, t.description)
      ORDER BY total_cents DESC
      LIMIT ${limit}
    `);
    return this.extractRows(result).map((r: any) => ({
      merchantName: r.merchant,
      totalCents: Number(r.total_cents),
      transactionCount: Number(r.txn_count),
    }));
  }
}
