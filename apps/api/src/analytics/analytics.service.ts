import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';
import type {
  AnalyticsQuery,
  SpendingTrendQuery,
  TopMerchantsQuery,
  BillFrequency,
} from '@moneypulse/shared';
import { annualCostCents } from '../bills/bills.service';
import { computeLoanState } from '@moneypulse/shared';

/** A single contributing row in the net-worth breakdown (one account/asset/loan). */
export interface LineItem {
  id: string;
  nickname: string;
  institution: string | null;
  accountType: string;
  balanceCents: number;
  source: 'account' | 'investment_account' | 'manual_asset' | 'loan';
  /**
   * True when `balanceCents` may be incomplete/outdated: e.g. one or more
   * holdings in this investment account had no matching `securityPrices` row
   * (new ticker, delisted, or a price-feed gap) and the account's value was
   * either backfilled from its latest manual snapshot or, absent a snapshot,
   * computed from priced holdings only (see #184).
   */
  stale?: boolean;
}

/** Net-worth totals, expressed as the line items that sum to each of `netWorth()`'s figures. */
export interface NetWorthBreakdown {
  assets: {
    liquid: LineItem[];
    investments: LineItem[];
    manualAssets: LineItem[];
  };
  liabilities: {
    creditCards: LineItem[];
    loans: LineItem[];
  };
}

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
   * Credits on credit_card-type accounts (e.g. statement credits/refunds) are excluded from income:
   * they reduce prior spend rather than representing new money in, unlike a checking/savings deposit.
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
      ? sql`t.user_id IN (
          SELECT id FROM ${schema.users} WHERE household_id = ${householdId}
        )`
      : sql`t.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
        SUM(CASE WHEN t.is_credit = true AND (a.account_type IS NULL OR a.account_type != 'credit_card') THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN t.is_credit = false THEN t.amount_cents ELSE 0 END) AS expense_cents
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      LEFT JOIN ${schema.accounts} a ON t.account_id = a.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND COALESCE(c.is_transfer, false) = false
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY date_trunc('month', t.date)
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
        c.parent_id::text AS parent_id,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        AND COALESCE(c.is_transfer, false) = false
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY c.id, c.name, c.icon, c.color, c.parent_id
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
      parentId: r.parent_id ?? null,
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
        SUM(CASE WHEN t.is_credit = true AND (a.account_type IS NULL OR a.account_type != 'credit_card') THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN t.is_credit = false THEN t.amount_cents ELSE 0 END) AS expense_cents
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      LEFT JOIN ${schema.accounts} a ON t.account_id = a.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND COALESCE(c.is_transfer, false) = false
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
   * Returns a full net worth snapshot across every asset/liability source the app
   * tracks (see Phase 13 epic #158 decisions):
   *  - Liquid = checking + savings + cash_sweep regular accounts (starting balance
   *    + summed non-deleted transactions).
   *  - Investments = per investment_account, holdings x latest EOD close when the
   *    account has declared holdings, ELSE its latest manual investment_snapshot
   *    — never both (decision #2) — plus brokerage/edu_529 balances held as
   *    regular accounts (starting balance + transactions, same as liquid).
   *  - Manual assets = latest carry-forward manual_asset_snapshots value per
   *    non-deleted manual_asset (home/car/gold/other).
   *  - Liabilities = credit_card account balances plus loan balances
   *    (manual-statement-wins else amortized via `computeLoanState`).
   * Scoped to the authenticated user or their household members.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {Pick<AnalyticsQuery, 'household'>} query - Household flag for scoping.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<{ assets: number; liabilities: number; investments: number; netWorth: number }>}
   *   Net worth snapshot with assets (liquid + investments + manual assets),
   *   liabilities (credit cards + loans), investments, and net total.
   * @throws {Error} If the database query fails.
   */
  async netWorth(
    userId: string,
    query: Pick<AnalyticsQuery, 'household'>,
    householdId?: string | null,
  ) {
    const breakdown = await this.netWorthBreakdown(userId, query, householdId);
    const sum = (items: Array<{ balanceCents: number }>) =>
      items.reduce((s, i) => s + i.balanceCents, 0);

    const liquidCents = sum(breakdown.assets.liquid);
    const investmentCents = sum(breakdown.assets.investments);
    const manualAssetCents = sum(breakdown.assets.manualAssets);
    const creditCardLiabilityCents = sum(breakdown.liabilities.creditCards);
    const loanLiabilityCents = sum(breakdown.liabilities.loans);

    const assets = liquidCents + investmentCents + manualAssetCents;
    const liabilities = creditCardLiabilityCents + loanLiabilityCents;

    return {
      assets,
      liabilities,
      investments: investmentCents,
      netWorth: assets - liabilities,
    };
  }

  /**
   * Returns the same net-worth aggregation as `netWorth()`, but as line items (one row
   * per contributing account/asset/loan) instead of pre-summed totals. `netWorth()` is
   * built FROM this method's output (summing each bucket) so the dashboard's hero totals
   * and the drill-down panel's line items can never drift out of sync with each other —
   * see #192.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {Pick<AnalyticsQuery, 'household'>} query - Household flag for scoping.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<NetWorthBreakdown>} Line items grouped into
   *   assets.{liquid,investments,manualAssets} and liabilities.{creditCards,loans}.
   * @throws {Error} If the database query fails.
   */
  async netWorthBreakdown(
    userId: string,
    query: Pick<AnalyticsQuery, 'household'>,
    householdId?: string | null,
  ): Promise<NetWorthBreakdown> {
    const acctUserScope = householdId && query.household
      ? sql`a.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`a.user_id = ${userId}`;
    const invUserScope = householdId && query.household
      ? sql`ia.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`ia.user_id = ${userId}`;
    const maUserScope = householdId && query.household
      ? sql`ma.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`ma.user_id = ${userId}`;
    const loanUserScope = householdId && query.household
      ? sql`l.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`l.user_id = ${userId}`;

    // Regular `accounts` rows (checking/savings/cash_sweep/brokerage/edu_529/credit_card),
    // one row per account, balance = starting balance + summed non-deleted transactions.
    const acctRows = await this.db.execute(sql`
      SELECT
        a.id AS account_id,
        a.nickname,
        a.institution,
        a.account_type,
        a.starting_balance_cents + COALESCE(sub.net, 0) AS balance_cents
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
        AND ${acctUserScope}
    `);

    const liquid: LineItem[] = [];
    const regularInvestments: LineItem[] = [];
    const creditCards: LineItem[] = [];
    for (const r of this.extractRows(acctRows)) {
      const item: LineItem = {
        id: r.account_id,
        nickname: r.nickname,
        institution: r.institution,
        accountType: r.account_type,
        balanceCents:
          r.account_type === 'credit_card'
            ? Math.abs(Number(r.balance_cents))
            : Number(r.balance_cents),
        source: 'account',
      };
      if (['checking', 'savings', 'cash_sweep'].includes(r.account_type)) {
        liquid.push(item);
      } else if (['brokerage', 'edu_529'].includes(r.account_type)) {
        regularInvestments.push(item);
      } else if (r.account_type === 'credit_card') {
        creditCards.push(item);
      }
    }

    // Manual investment_accounts (Phase 8): per account, holdings x latest EOD
    // close when holdings exist, else the latest manual snapshot — never both.
    const investmentRows = await this.db.execute(sql`
      WITH acct AS (
        SELECT ia.id, ia.nickname, ia.institution, ia.account_type,
          EXISTS (
            SELECT 1 FROM ${schema.investmentHoldings} ih
            WHERE ih.investment_account_id = ia.id
          ) AS has_holdings
        FROM ${schema.investmentAccounts} ia
        WHERE ia.deleted_at IS NULL
          AND ${invUserScope}
      ),
      holdings_value AS (
        SELECT
          ih.investment_account_id,
          SUM(ih.share_count * COALESCE(sp.close_cents, 0)) AS value_cents,
          COUNT(*) FILTER (WHERE sp.close_cents IS NULL) AS missing_price_count
        FROM ${schema.investmentHoldings} ih
        JOIN acct ON acct.id = ih.investment_account_id AND acct.has_holdings
        LEFT JOIN LATERAL (
          SELECT close_cents
          FROM ${schema.securityPrices} sp2
          WHERE sp2.ticker = ih.ticker
          ORDER BY sp2.price_date DESC
          LIMIT 1
        ) sp ON true
        GROUP BY ih.investment_account_id
      ),
      latest_snapshot AS (
        SELECT DISTINCT ON (s.investment_account_id)
          s.investment_account_id, s.balance_cents
        FROM ${schema.investmentSnapshots} s
        ORDER BY s.investment_account_id, s.date DESC, s.created_at DESC
      )
      SELECT
        acct.id AS investment_account_id,
        acct.nickname,
        acct.institution,
        acct.account_type,
        CASE
          -- Fully priced holdings: use the priced total, nothing stale.
          WHEN acct.has_holdings AND COALESCE(hv.missing_price_count, 0) = 0
            THEN COALESCE(hv.value_cents, 0)
          -- Holdings with at least one unpriced ticker: prefer the account's
          -- latest manual snapshot over silently zeroing the unpriced shares.
          WHEN acct.has_holdings AND snap.balance_cents IS NOT NULL
            THEN snap.balance_cents
          -- Holdings with missing prices and no snapshot to fall back on:
          -- best-effort partial total from priced holdings only (flagged stale).
          WHEN acct.has_holdings THEN COALESCE(hv.value_cents, 0)
          ELSE COALESCE(snap.balance_cents, 0)
        END AS balance_cents,
        (
          acct.has_holdings AND COALESCE(hv.missing_price_count, 0) > 0
        ) AS stale
      FROM acct
      LEFT JOIN holdings_value hv ON hv.investment_account_id = acct.id
      LEFT JOIN latest_snapshot snap ON snap.investment_account_id = acct.id
    `);
    const investmentAccountItems: LineItem[] = this.extractRows(investmentRows).map(
      (r: any) => ({
        id: r.investment_account_id,
        nickname: r.nickname,
        institution: r.institution,
        accountType: r.account_type,
        balanceCents: Number(r.balance_cents),
        source: 'investment_account' as const,
        ...(r.stale ? { stale: true } : {}),
      }),
    );

    // Manual assets (home/car/gold/other): latest carry-forward value per asset.
    const manualAssetRows = await this.db.execute(sql`
      SELECT ma.id, ma.name, ma.asset_type, latest.value_cents
      FROM ${schema.manualAssets} ma
      LEFT JOIN LATERAL (
        SELECT value_cents
        FROM ${schema.manualAssetSnapshots} mas
        WHERE mas.manual_asset_id = ma.id
        ORDER BY mas.snapshot_month DESC
        LIMIT 1
      ) latest ON true
      WHERE ma.deleted_at IS NULL
        AND ${maUserScope}
    `);
    const manualAssetItems: LineItem[] = this.extractRows(manualAssetRows).map(
      (r: any) => ({
        id: r.id,
        nickname: r.name,
        institution: null,
        accountType: r.asset_type,
        balanceCents: Number(r.value_cents ?? 0),
        source: 'manual_asset' as const,
      }),
    );

    // Loans: manual-statement-wins else amortized via computeLoanState.
    const loanRows = await this.db.execute(sql`
      SELECT
        l.id,
        l.name,
        l.loan_type,
        l.original_balance_cents,
        l.apr_bps,
        l.scheduled_payment_cents,
        l.start_date::text AS start_date,
        latest.balance_cents AS manual_balance_cents,
        latest.source AS latest_source
      FROM ${schema.loans} l
      LEFT JOIN LATERAL (
        SELECT balance_cents, source
        FROM ${schema.loanBalanceSnapshots} lbs
        WHERE lbs.loan_id = l.id
        ORDER BY lbs.snapshot_month DESC
        LIMIT 1
      ) latest ON true
      WHERE l.deleted_at IS NULL
        AND l.is_active = true
        AND ${loanUserScope}
    `);
    const loanItems: LineItem[] = this.extractRows(loanRows).map((l: any) => {
      let balanceCents: number;
      if (l.latest_source === 'manual_statement' && l.manual_balance_cents != null) {
        balanceCents = Number(l.manual_balance_cents);
      } else {
        const state = computeLoanState(
          {
            originalBalanceCents: Number(l.original_balance_cents),
            aprBps: Number(l.apr_bps),
            scheduledPaymentCents: Number(l.scheduled_payment_cents),
            startDate: l.start_date,
          },
          [],
        );
        balanceCents = state.currentBalanceCents;
      }
      return {
        id: l.id,
        nickname: l.name,
        institution: null,
        accountType: l.loan_type,
        balanceCents,
        source: 'loan' as const,
      };
    });

    return {
      assets: {
        liquid,
        investments: [...investmentAccountItems, ...regularInvestments],
        manualAssets: manualAssetItems,
      },
      liabilities: {
        creditCards,
        loans: loanItems,
      },
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
        COALESCE(t.normalized_merchant_name, t.merchant_name, t.description) AS merchant,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        AND COALESCE(c.is_transfer, false) = false
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY COALESCE(t.normalized_merchant_name, t.merchant_name, t.description)
      ORDER BY total_cents DESC
      LIMIT ${limit}
    `);
    return this.extractRows(result).map((r: any) => ({
      merchantName: r.merchant,
      totalCents: Number(r.total_cents),
      transactionCount: Number(r.txn_count),
    }));
  }

  /**
   * Returns monthly credit card payment totals per account.
   * Only includes transactions categorized with `is_transfer = true` categories
   * on credit card accounts, showing how much was paid toward each card per month.
   */
  async creditCardPayments(
    userId: string,
    query: AnalyticsQuery,
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`a.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`a.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
        a.id::text AS account_id,
        a.nickname AS account_name,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS payment_count
      FROM ${schema.transactions} t
      JOIN ${schema.accounts} a ON t.account_id = a.id
      JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND c.is_transfer = true
        AND a.account_type = 'credit_card'
        AND ${userScope}
        ${query.from ? sql`AND t.date >= ${query.from}::date` : sql``}
        ${query.to ? sql`AND t.date <= ${query.to}::date` : sql``}
      GROUP BY date_trunc('month', t.date), a.id, a.nickname
      ORDER BY month DESC, a.nickname
    `);

    return this.extractRows(result).map((r: any) => ({
      month: r.month,
      accountId: r.account_id,
      accountName: r.account_name,
      totalCents: Number(r.total_cents),
      paymentCount: Number(r.payment_count),
    }));
  }

  /**
   * Returns budget vs actual spending progress per category for a given period.
   * Defaults to start-of-current-month → today when no date range is provided.
   * Excludes transfer categories and deleted budgets/categories.
   * Scoped to the authenticated user (and optionally their household).
   */
  async budgetProgress(
    userId: string,
    query: AnalyticsQuery,
    householdId?: string | null,
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const defaultTo = now.toISOString().slice(0, 10);

    const periodStart = query.from ?? defaultFrom;
    const periodEnd = query.to ?? defaultTo;

    // Transaction user scope for spending calculation
    const txnUserScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    // Budget ownership scope (personal or household)
    const budgetScope = householdId && query.household
      ? sql`(b.user_id = ${userId} OR b.household_id = ${householdId})`
      : sql`b.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        b.id::text                 AS budget_id,
        b.category_id::text        AS category_id,
        c.name                     AS category_name,
        c.icon                     AS category_icon,
        c.color                    AS category_color,
        b.amount_cents             AS budget_cents,
        b.period,
        COALESCE(SUM(t.amount_cents), 0) AS spent_cents
      FROM ${schema.budgets} b
      JOIN ${schema.categories} c ON b.category_id = c.id
      LEFT JOIN ${schema.transactions} t
        ON  t.category_id    = b.category_id
        AND t.is_credit      = false
        AND t.is_split_parent = false
        AND t.deleted_at     IS NULL
        AND ${txnUserScope}
        AND t.date >= ${periodStart}::date
        AND t.date <= ${periodEnd}::date
      WHERE ${budgetScope}
        AND b.deleted_at IS NULL
        AND c.deleted_at IS NULL
        AND c.is_transfer = false
      GROUP BY b.id, b.category_id, c.name, c.icon, c.color, b.amount_cents, b.period
      ORDER BY spent_cents DESC
    `);

    return this.extractRows(result).map((r: any) => {
      const budgetCents = Number(r.budget_cents);
      const spentCents = Number(r.spent_cents);
      const percentUsed = budgetCents > 0
        ? Math.round((spentCents / budgetCents) * 100)
        : 0;
      const remainingCents = budgetCents - spentCents;
      const status: 'on_track' | 'warning' | 'over_budget' =
        percentUsed > 100 ? 'over_budget'
          : percentUsed >= 70 ? 'warning'
          : 'on_track';

      return {
        budgetId: r.budget_id,
        categoryId: r.category_id,
        categoryName: r.category_name,
        categoryIcon: r.category_icon,
        categoryColor: r.category_color,
        budgetCents,
        spentCents,
        period: r.period as 'monthly' | 'weekly',
        percentUsed,
        remainingCents,
        status,
      };
    });
  }

  /**
   * Returns monthly savings rate `(income - expenses) / income` for a trailing window,
   * plus the latest month's rate as the headline figure. Excludes transfers throughout, and
   * excludes credit-card statement credits/refunds from income (they are not new money in).
   * A month with zero income yields a `null` rate (avoids divide-by-zero / misleading 0%).
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {{ months?: number; household?: boolean }} query - Trailing window size (default 12) and household flag.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<{ current: { month: string; rate: number | null } | null; series: Array<{ month: string; incomeCents: number; expenseCents: number; rate: number | null }> }>}
   */
  async savingsRate(
    userId: string,
    query: { months?: number; household?: boolean },
    householdId?: string | null,
  ) {
    const months = Math.min(Math.max(query.months ?? 12, 1), 60);
    const userScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    const result = await this.db.execute(sql`
      SELECT
        to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
        SUM(CASE WHEN t.is_credit = true AND (a.account_type IS NULL OR a.account_type != 'credit_card') THEN t.amount_cents ELSE 0 END) AS income_cents,
        SUM(CASE WHEN t.is_credit = false THEN t.amount_cents ELSE 0 END) AS expense_cents
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      LEFT JOIN ${schema.accounts} a ON t.account_id = a.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND COALESCE(c.is_transfer, false) = false
        AND ${userScope}
        AND t.date >= date_trunc('month', CURRENT_DATE) - (${months - 1} || ' months')::interval
      GROUP BY date_trunc('month', t.date)
      ORDER BY month ASC
    `);

    const series = this.extractRows(result).map((r: any) => {
      const incomeCents = Number(r.income_cents);
      const expenseCents = Number(r.expense_cents);
      const rate = incomeCents > 0
        ? Math.round(((incomeCents - expenseCents) / incomeCents) * 1000) / 1000
        : null;
      return { month: r.month, incomeCents, expenseCents, rate };
    });

    return {
      current: series.length > 0 ? series[series.length - 1] : null,
      series,
    };
  }

  /**
   * Returns cash runway: liquid (checking + savings) balances divided by the trailing
   * 3-month average monthly expenses. Returns `months: null` when there is no expense
   * history to divide by (avoids divide-by-zero / infinite runway).
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {{ household?: boolean }} query - Household flag for scoping.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   * @returns {Promise<{ liquidCents: number; avgMonthlyExpenseCents: number; months: number | null }>}
   */
  async cashRunway(
    userId: string,
    query: { household?: boolean },
    householdId?: string | null,
  ) {
    const acctScope = householdId && query.household
      ? sql`a.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`a.user_id = ${userId}`;
    const txnScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    const liquidRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(
        a.starting_balance_cents + COALESCE(sub.net, 0)
      ), 0) AS liquid_cents
      FROM ${schema.accounts} a
      LEFT JOIN LATERAL (
        SELECT SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END) AS net
        FROM ${schema.transactions} t
        WHERE t.account_id = a.id AND t.is_split_parent = false AND t.deleted_at IS NULL
      ) sub ON true
      WHERE a.deleted_at IS NULL
        AND a.account_type IN ('checking', 'savings')
        AND ${acctScope}
    `);
    const liquidCents = Number(this.extractRows(liquidRows)[0]?.liquid_cents ?? 0);

    // Trailing 3 full calendar months (excludes the current, in-progress month).
    const expenseRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(t.amount_cents), 0) AS total_cents
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        AND COALESCE(c.is_transfer, false) = false
        AND ${txnScope}
        AND t.date >= date_trunc('month', CURRENT_DATE) - INTERVAL '3 months'
        AND t.date < date_trunc('month', CURRENT_DATE)
    `);
    const trailingExpenseCents = Number(this.extractRows(expenseRows)[0]?.total_cents ?? 0);
    const avgMonthlyExpenseCents = Math.round(trailingExpenseCents / 3);

    return {
      liquidCents,
      avgMonthlyExpenseCents,
      months: avgMonthlyExpenseCents > 0
        ? Math.round((liquidCents / avgMonthlyExpenseCents) * 10) / 10
        : null,
    };
  }

  /**
   * Returns net-worth deltas over 30/90/365-day lookback windows, computed from stored
   * balance snapshots (see `BalanceSnapshotService`). A window is `null` when there is
   * no snapshot old enough to compare against yet.
   *
   * @param {string} userId - The authenticated user's ID.
   * @returns {Promise<{ current: number | null; delta30: number | null; delta90: number | null; delta365: number | null }>}
   */
  async netWorthDeltas(userId: string) {
    const rows = await this.db.execute(sql`
      SELECT abs.snapshot_date::text AS snapshot_date, SUM(abs.balance_cents) AS total_cents
      FROM ${schema.accountBalanceSnapshots} abs
      JOIN ${schema.accounts} a ON abs.account_id = a.id
      WHERE a.user_id = ${userId} AND a.deleted_at IS NULL
      GROUP BY abs.snapshot_date
      ORDER BY abs.snapshot_date ASC
    `);
    const points = this.extractRows(rows).map((r: any) => ({
      date: r.snapshot_date as string,
      cents: Number(r.total_cents),
    }));
    if (points.length === 0) {
      return { current: null, delta30: null, delta90: null, delta365: null };
    }
    const current = points[points.length - 1].cents;
    const findAsOf = (daysAgo: number): number | null => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysAgo);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      // Latest point on or before the cutoff date.
      const candidates = points.filter((p) => p.date <= cutoffStr);
      return candidates.length > 0 ? candidates[candidates.length - 1].cents : null;
    };
    const delta = (daysAgo: number): number | null => {
      const past = findAsOf(daysAgo);
      return past === null ? null : current - past;
    };
    return {
      current,
      delta30: delta(30),
      delta90: delta(90),
      delta365: delta(365),
    };
  }

  /**
   * Compares this calendar month to the same calendar month one year ago, per category.
   * If fewer than 12 months of transaction history exist, returns `insufficientHistory`
   * with the number of months actually available instead of erroring.
   *
   * @param {string} userId - The authenticated user's ID.
   * @param {{ household?: boolean }} query - Household flag for scoping.
   * @param {string | null} [householdId] - Optional household ID for multi-user scoping.
   */
  async yoyComparison(
    userId: string,
    query: { household?: boolean },
    householdId?: string | null,
  ) {
    const userScope = householdId && query.household
      ? sql`t.user_id IN (SELECT id FROM ${schema.users} WHERE household_id = ${householdId})`
      : sql`t.user_id = ${userId}`;

    const historyRows = await this.db.execute(sql`
      SELECT MIN(t.date)::text AS min_date
      FROM ${schema.transactions} t
      WHERE t.is_split_parent = false AND t.deleted_at IS NULL AND ${userScope}
    `);
    const minDate = this.extractRows(historyRows)[0]?.min_date as string | null;
    const monthsOfHistory = minDate
      ? Math.floor(
          (Date.now() - new Date(minDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
        )
      : 0;

    if (!minDate || monthsOfHistory < 12) {
      return {
        insufficientHistory: true,
        monthsAvailable: monthsOfHistory,
        message: `Only ${monthsOfHistory} month${monthsOfHistory === 1 ? '' : 's'} of history available; year-over-year comparison needs 12.`,
        categories: [],
      };
    }

    const result = await this.db.execute(sql`
      SELECT
        COALESCE(c.id::text, 'uncategorized') AS category_id,
        c.name AS category_name,
        SUM(CASE
          WHEN date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE) THEN t.amount_cents
          ELSE 0
        END) AS this_month_cents,
        SUM(CASE
          WHEN date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE) - INTERVAL '1 year' THEN t.amount_cents
          ELSE 0
        END) AS last_year_cents
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        AND COALESCE(c.is_transfer, false) = false
        AND ${userScope}
        AND (
          date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
          OR date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE) - INTERVAL '1 year'
        )
      GROUP BY c.id, c.name
      HAVING SUM(t.amount_cents) > 0
      ORDER BY this_month_cents DESC
    `);

    const categories = this.extractRows(result).map((r: any) => {
      const thisMonth = Number(r.this_month_cents);
      const lastYear = Number(r.last_year_cents);
      return {
        categoryId: r.category_id,
        categoryName: r.category_name ?? 'Uncategorized',
        thisMonthCents: thisMonth,
        lastYearCents: lastYear,
        deltaCents: thisMonth - lastYear,
        deltaPercent: lastYear > 0
          ? Math.round(((thisMonth - lastYear) / lastYear) * 1000) / 10
          : null,
      };
    });

    return {
      insufficientHistory: false,
      monthsAvailable: monthsOfHistory,
      categories,
    };
  }

  /**
   * Returns the current monthly recurring subscription total (from active recurring
   * bills, normalized to a monthly-equivalent cadence) plus a 12-month spend trend for
   * transactions matched to those recurring bills' normalized merchant names.
   *
   * @param {string} userId - The authenticated user's ID.
   * @returns {Promise<{ monthlyTotalCents: number; activeCount: number; trend: Array<{ month: string; totalCents: number }> }>}
   */
  async subscriptionTotal(userId: string) {
    const billRows = await this.db.execute(sql`
      SELECT normalized_name, expected_amount_cents, frequency
      FROM ${schema.recurringBills}
      WHERE user_id = ${userId} AND is_active = true
    `);
    const bills = this.extractRows(billRows);
    // Reuse the single canonical per-frequency annualization (bills.service.ts) so
    // this total can't drift from the one shown on /subscriptions — a duplicate
    // multiplier table here previously used a slightly different weekly constant
    // and didn't handle semi_annual at all.
    const monthlyTotalCents = Math.round(
      bills.reduce((sum: number, b: any) => {
        const frequency = (b.frequency ?? 'monthly') as BillFrequency;
        return sum + annualCostCents(Number(b.expected_amount_cents), frequency) / 12;
      }, 0),
    );

    const normalizedNames = bills.map((b: any) => b.normalized_name as string);
    let trend: Array<{ month: string; totalCents: number }> = [];
    if (normalizedNames.length > 0) {
      const trendRows = await this.db.execute(sql`
        SELECT
          to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
          SUM(t.amount_cents) AS total_cents
        FROM ${schema.transactions} t
        WHERE t.user_id = ${userId}
          AND t.is_split_parent = false
          AND t.deleted_at IS NULL
          AND t.is_credit = false
          AND t.normalized_merchant_name = ANY(${normalizedNames})
          AND t.date >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
        GROUP BY date_trunc('month', t.date)
        ORDER BY month ASC
      `);
      trend = this.extractRows(trendRows).map((r: any) => ({
        month: r.month,
        totalCents: Number(r.total_cents),
      }));
    }

    return {
      monthlyTotalCents,
      activeCount: bills.length,
      trend,
    };
  }
}
