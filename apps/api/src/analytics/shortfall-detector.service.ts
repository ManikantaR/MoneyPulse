import { Injectable, Logger, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { ForecastService } from './forecast.service';
import { BillsService } from '../bills/bills.service';
import { NotificationsService } from '../notifications/notifications.service';

/** #cashflow-shortfall-radar notification type — registered in db/schema.ts + DEFAULT_PREFERENCES. */
export const CASHFLOW_SHORTFALL_NOTIFICATION_TYPE = 'cashflow_shortfall';

/** Falls back to this when `user_settings.cashflow_floor_cents` is NULL ($500). */
export const DEFAULT_CASHFLOW_FLOOR_CENTS = 50_000;

/** How far out to project — long enough to see most monthly bills coming, short
 *  enough that the daily-net-drift forecast (which doesn't model seasonality)
 *  stays reasonably trustworthy. */
const FORECAST_HORIZON_DAYS = 35;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "Heads up ... before the mortgage on the 1st." style phrasing. */
function formatDueDate(dateStr: string): string {
  const [, , dStr] = dateStr.split('-');
  return `the ${ordinal(Number(dStr))}`;
}

export interface ShortfallCheckResult {
  alerted: boolean;
  reason?: string;
}

@Injectable()
export class ShortfallDetectorService {
  private readonly logger = new Logger(ShortfallDetectorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly forecastService: ForecastService,
    private readonly billsService: BillsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Daily sweep entry point — one shortfall notification per user per sweep, at most. */
  async checkAndAlertAllUsers(): Promise<void> {
    const userRows = await this.db.execute(sql`
      SELECT DISTINCT user_id FROM accounts WHERE deleted_at IS NULL
    `);
    const userIds = (userRows.rows ?? []).map((r: { user_id: string }) => r.user_id);

    for (const userId of userIds) {
      try {
        await this.checkAndAlertUser(userId);
      } catch (err) {
        this.logger.warn(
          `Shortfall sweep failed for user ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async getFloorCents(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT cashflow_floor_cents FROM user_settings WHERE user_id = ${userId} LIMIT 1
    `);
    const raw = (rows.rows ?? rows)[0]?.cashflow_floor_cents;
    return raw === null || raw === undefined ? DEFAULT_CASHFLOW_FLOOR_CENTS : Number(raw);
  }

  /** Picks the checking account with the highest current balance as "primary". */
  private async getPrimaryCheckingAccountId(userId: string): Promise<string | null> {
    const rows = await this.db.execute(sql`
      SELECT a.id AS account_id,
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
        AND a.account_type = 'checking'
      GROUP BY a.id, a.starting_balance_cents
      ORDER BY balance_cents DESC
      LIMIT 1
    `);
    const result = (rows.rows ?? rows) as Array<{ account_id: string }>;
    return result[0]?.account_id ?? null;
  }

  /**
   * Runs the shortfall check for a single user. Reuses ForecastService's cash-flow
   * projection and BillsService's upcoming-bills query — this only combines them:
   * for each upcoming bill (soonest first), find the lowest point the primary
   * checking account is projected to hit on or before that bill's due date (net
   * of every bill due on or before that same date, since they all draw down the
   * same account), and alert on the first one that dips below the user's floor.
   */
  async checkAndAlertUser(userId: string): Promise<ShortfallCheckResult> {
    const [floorCents, primaryAccountId, forecast, upcomingBills] = await Promise.all([
      this.getFloorCents(userId),
      this.getPrimaryCheckingAccountId(userId),
      this.forecastService.forecast(userId, FORECAST_HORIZON_DAYS),
      this.billsService.findUpcoming(userId, FORECAST_HORIZON_DAYS),
    ]);

    if (!primaryAccountId || upcomingBills.length === 0) {
      return { alerted: false, reason: 'no-checking-account-or-no-upcoming-bills' };
    }

    const primarySeries = forecast.accounts.find((a) => a.accountId === primaryAccountId)?.series;
    if (!primarySeries || primarySeries.length === 0) {
      return { alerted: false, reason: 'no-forecast-series' };
    }

    // Bills-service rows are already sorted ascending by nextExpectedDate.
    const bills = upcomingBills
      .filter((b: any) => b.nextExpectedDate)
      .map((b: any) => ({
        id: b.id as string,
        name: b.normalizedName as string,
        amountCents: b.expectedAmountCents as number,
        dueDateStr: toDateStr(new Date(b.nextExpectedDate)),
      }));

    if (bills.length === 0) {
      return { alerted: false, reason: 'no-upcoming-bills' };
    }

    for (const bill of bills) {
      // Every bill due on/before this bill's due date also draws on the same
      // checking account, so net all of them off the raw (bill-agnostic)
      // per-account forecast series to get a realistic minimum.
      const cumulativeBillsByDate = (dateStr: string) =>
        bills
          .filter((b) => b.dueDateStr <= dateStr)
          .reduce((sum, b) => sum + b.amountCents, 0);

      let minCents: number | null = null;
      for (const point of primarySeries) {
        if (point.date > bill.dueDateStr) break;
        const net = point.projectedCents - cumulativeBillsByDate(point.date);
        if (minCents === null || net < minCents) minCents = net;
      }

      if (minCents === null || minCents >= floorCents) continue;

      const shortfallCents = floorCents - minCents;
      const dedupeKey = `cashflow_shortfall_${bill.id}_${bill.dueDateStr}`;

      if (await this.notificationsService.findByMetadata(userId, dedupeKey)) {
        // Already announced this exact bill/due-date shortfall — don't repeat daily.
        return { alerted: false, reason: 'already-sent' };
      }

      const shortfallDollars = Math.round(shortfallCents / 100);
      const dueDatePhrase = formatDueDate(bill.dueDateStr);

      await this.notificationsService.createAndDispatch({
        userId,
        type: CASHFLOW_SHORTFALL_NOTIFICATION_TYPE,
        source: 'system',
        severity: 'warning',
        title: 'Cash flow shortfall ahead',
        message: `Checking is projected to run about $${shortfallDollars} short before the ${bill.name} bill (~$${(bill.amountCents / 100).toFixed(2)}) due ${bill.dueDateStr}. Consider moving funds or trimming spending before then.`,
        voiceSummary: `Heads up, checking looks about ${shortfallDollars} dollars short before the ${bill.name} on ${dueDatePhrase}.`,
        dedupeKey,
        metadata: { dedupeKey, billId: bill.id, dueDate: bill.dueDateStr, shortfallCents, floorCents },
      });

      this.logger.log(
        `Cashflow shortfall alert sent: user ${userId}, bill ${bill.name}, due ${bill.dueDateStr}`,
      );

      // One notification per sweep — the soonest shortfall only.
      return { alerted: true };
    }

    return { alerted: false, reason: 'no-shortfall-projected' };
  }
}
