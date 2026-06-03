import { Injectable, Logger, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';

const LOW_BALANCE_THRESHOLD_CENTS = 100_000; // $1,000 default
const LOOKBACK_DAYS = 90;

/** Asset account types eligible for low-balance alerts. */
const ASSET_TYPES = ['checking', 'savings'];

export interface ForecastPoint {
  date: string;
  projectedCents: number;
}

export interface AccountForecast {
  accountId: string;
  accountName: string;
  series: ForecastPoint[];
  lowBalanceDate?: string;
}

export interface ForecastAlert {
  accountId: string;
  date: string;
  projectedCents: number;
}

export interface ForecastResult {
  accounts: AccountForecast[];
  netWorthSeries: ForecastPoint[];
  alerts: ForecastAlert[];
}

type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';

/** Advance a date by one billing cycle, month-end aware. */
function addFrequency(date: Date, frequency: BillFrequency): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly': {
      // Month-end-aware: if we're on day 31 and next month has 30 days, clamp
      const originalDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, maxDay));
      break;
    }
    case 'quarterly': {
      const originalDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 3);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, maxDay));
      break;
    }
    case 'semi_annual': {
      const originalDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 6);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, maxDay));
      break;
    }
    case 'annual':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

/** Format a Date as YYYY-MM-DD without timezone conversion. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** ISO week key (YYYY-Www) for deduplication of weekly alerts. */
function isoWeekKey(d: Date): string {
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((tmp.getTime() - week1.getTime()) / 86400000 + ((week1.getDay() + 6) % 7)) / 7,
  );
  return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Project account balances for the next `days` days.
   *
   * Algorithm:
   * 1. Current balance per account (computed: starting_balance + signed tx sum).
   * 2. Active+confirmed recurring bills, fast-forwarded to the next future occurrence.
   * 3. Per-account average daily net from last 90 days of non-transfer, non-bill transactions.
   * 4. Per-account series: balance[d] = balance[d-1] + avgDailyNet[account].
   *    Low-balance date flagged for checking/savings accounts only.
   * 5. Combined net-worth series: sum of per-account balances MINUS bill deductions on their
   *    projected dates (bills are user-level, so applied only at the combined level).
   */
  async forecast(userId: string, days = 90): Promise<ForecastResult> {
    // ── Step 1: current balance per account ─────────────────
    const balRows = await this.db.execute(sql`
      SELECT
        a.id            AS account_id,
        a.nickname      AS nickname,
        a.account_type  AS account_type,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS balance_cents
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
      WHERE a.deleted_at IS NULL
        AND a.user_id = ${userId}
      GROUP BY a.id, a.nickname, a.account_type, a.starting_balance_cents
      ORDER BY a.nickname
    `);
    const accounts = (balRows.rows ?? []) as Array<{
      account_id: string;
      nickname: string;
      account_type: string;
      balance_cents: string;
    }>;

    if (accounts.length === 0) {
      return { accounts: [], netWorthSeries: [], alerts: [] };
    }

    const accountIds = accounts.map((a) => a.account_id);

    // ── Step 2: active+confirmed recurring bills ─────────────
    const billRows = await this.db.execute(sql`
      SELECT
        id,
        normalized_name,
        expected_amount_cents,
        frequency,
        next_expected_date
      FROM recurring_bills
      WHERE user_id = ${userId}
        AND is_active = true
        AND is_confirmed = true
        AND next_expected_date IS NOT NULL
    `);
    const rawBills = (billRows.rows ?? []) as Array<{
      id: string;
      normalized_name: string;
      expected_amount_cents: string;
      frequency: string;
      next_expected_date: string;
    }>;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + days);

    // Map: dateStr → total bill deduction in cents on that day
    const billDeductions = new Map<string, number>();
    for (const bill of rawBills) {
      const amount = Number(bill.expected_amount_cents);
      const freq = bill.frequency as BillFrequency;
      // Fast-forward stale nextExpectedDate to first future occurrence
      let next = new Date(bill.next_expected_date);
      next.setHours(0, 0, 0, 0);
      while (next < today) {
        next = addFrequency(next, freq);
      }
      // Collect all occurrences within the forecast window
      while (next <= horizon) {
        const key = toDateStr(next);
        billDeductions.set(key, (billDeductions.get(key) ?? 0) + amount);
        next = addFrequency(next, freq);
      }
    }

    // ── Step 3: per-account avg daily net (excl. bill transactions) ─
    const spendRows = await this.db.execute(sql`
      SELECT
        t.account_id,
        COALESCE(SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE 0 END), 0)     AS total_credit,
        COALESCE(SUM(CASE WHEN NOT t.is_credit THEN t.amount_cents ELSE 0 END), 0) AS total_debit
      FROM transactions t
      -- Exclude transactions matching any active recurring bill (avoid double-counting)
      LEFT JOIN recurring_bills rb
        ON rb.user_id = ${userId}
        AND rb.is_active = true
        AND LOWER(t.normalized_merchant_name) = LOWER(rb.normalized_name)
      WHERE t.account_id = ANY(ARRAY[${sql.raw(accountIds.map((id) => `'${id}'`).join(','))}]::uuid[])
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_transfer = false
        AND t.date >= CURRENT_DATE - INTERVAL '${sql.raw(String(LOOKBACK_DAYS))} days'
        AND rb.id IS NULL   -- exclude bill-matching transactions
      GROUP BY t.account_id
    `);
    const spendMap = new Map<string, { credit: number; debit: number }>();
    for (const r of (spendRows.rows ?? []) as Array<{
      account_id: string;
      total_credit: string;
      total_debit: string;
    }>) {
      spendMap.set(r.account_id, {
        credit: Number(r.total_credit),
        debit: Number(r.total_debit),
      });
    }

    // ── Step 4: per-account projection ──────────────────────
    const accountForecasts: AccountForecast[] = [];
    const combinedStartCents = accounts.reduce(
      (sum, a) => sum + Number(a.balance_cents),
      0,
    );
    // Combined daily net (all asset accounts, excl. bill transactions)
    const combinedDailyNet = accounts.reduce((sum, a) => {
      const spend = spendMap.get(a.account_id);
      const net = spend ? (spend.credit - spend.debit) / LOOKBACK_DAYS : 0;
      return sum + net;
    }, 0);

    const alerts: ForecastAlert[] = [];

    for (const acct of accounts) {
      const spend = spendMap.get(acct.account_id);
      const avgCredit = spend ? spend.credit / LOOKBACK_DAYS : 0;
      const avgDebit = spend ? spend.debit / LOOKBACK_DAYS : 0;
      const avgDailyNet = avgCredit - avgDebit;

      let balance = Number(acct.balance_cents);
      const series: ForecastPoint[] = [];
      let lowBalanceDate: string | undefined;

      const isAsset = ASSET_TYPES.includes(acct.account_type);

      for (let d = 1; d <= days; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        const dateStr = toDateStr(date);

        balance = Math.round(balance + avgDailyNet);
        series.push({ date: dateStr, projectedCents: balance });

        if (isAsset && !lowBalanceDate && balance < LOW_BALANCE_THRESHOLD_CENTS) {
          lowBalanceDate = dateStr;
          alerts.push({ accountId: acct.account_id, date: dateStr, projectedCents: balance });
        }
      }

      accountForecasts.push({
        accountId: acct.account_id,
        accountName: acct.nickname,
        series,
        lowBalanceDate,
      });
    }

    // ── Step 5: combined net-worth series (includes bill deductions) ─
    const netWorthSeries: ForecastPoint[] = [];
    let combined = combinedStartCents;

    for (let d = 1; d <= days; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      const dateStr = toDateStr(date);

      const billHit = billDeductions.get(dateStr) ?? 0;
      combined = Math.round(combined + combinedDailyNet - billHit);
      netWorthSeries.push({ date: dateStr, projectedCents: combined });
    }

    return { accounts: accountForecasts, netWorthSeries, alerts };
  }

  /**
   * Run forecast for all users with accounts and dispatch low-balance notifications.
   * De-duplicates by ISO-week so the same account crossing the threshold fires once per week.
   */
  async checkAndAlertAll(): Promise<void> {
    const userRows = await this.db.execute(sql`
      SELECT DISTINCT user_id FROM accounts WHERE deleted_at IS NULL
    `);
    const userIds = (userRows.rows ?? []).map((r: { user_id: string }) => r.user_id);

    for (const userId of userIds) {
      try {
        const result = await this.forecast(userId);
        const weekKey = isoWeekKey(new Date());

        for (const alert of result.alerts) {
          const dedupeKey = `cashflow_low_${alert.accountId}_${weekKey}`;
          const alreadySent = await this.notificationsService.findByMetadata(userId, dedupeKey);
          if (alreadySent) continue;

          const acct = result.accounts.find((a) => a.accountId === alert.accountId);
          const accountName = acct?.accountName ?? 'Account';
          const formattedBalance = `$${(alert.projectedCents / 100).toFixed(0)}`;

          await this.notificationsService.createAndDispatch({
            userId,
            type: 'cashflow_low',
            title: 'Low balance alert',
            message: `${accountName} is projected to drop to ${formattedBalance} by ${alert.date}. Consider transferring funds or reducing spending.`,
            voiceSummary: `${accountName} projected below one thousand dollars by ${alert.date}.`,
            dedupeKey,
            metadata: { dedupeKey, accountId: alert.accountId, projectedDate: alert.date },
          });
          this.logger.log(`Low-balance alert sent: ${accountName} (${userId}) by ${alert.date}`);
        }
      } catch (err: any) {
        this.logger.error(`Forecast alert failed for user ${userId}: ${err.message}`);
      }
    }
  }
}
