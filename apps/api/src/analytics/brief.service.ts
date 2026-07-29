import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, eq } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';
import { ForecastService, type ForecastResult } from './forecast.service';
import { BillsService } from '../bills/bills.service';
import { LoansService } from '../loans/loans.service';

interface BriefSection {
  label: string;
  value: string;
}

export interface SafeToSpendResult {
  safeToSpendCents: number;
  minProjectedCents: number;
  minDate: string | null;
  goalContributionsCents: number;
}

/**
 * Derives "safe to spend today" from a cash-flow forecast: the lowest projected
 * combined balance within the horizon, which is already net of every known
 * recurring bill (see `ForecastService.forecast`'s `netWorthSeries`). Optionally
 * subtracts money already earmarked toward active goals (`goalContributionsCents`)
 * per #40's formula: `balance + scheduled inflows − (remaining bills + goal
 * contributions)`. Clamped at zero — a negative floor isn't "safe to spend", it's
 * a shortfall.
 *
 * Kept as ONE standalone exported function so #40's goal planner can reuse the
 * exact same math without depending on BriefService's delivery/formatting concerns.
 */
export function computeSafeToSpend(
  forecast: Pick<ForecastResult, 'netWorthSeries'>,
  horizonDays = 14,
  goalContributionsCents = 0,
): SafeToSpendResult {
  const window = forecast.netWorthSeries.slice(0, horizonDays);
  if (window.length === 0) {
    return { safeToSpendCents: 0, minProjectedCents: 0, minDate: null, goalContributionsCents };
  }

  let min = window[0];
  for (const point of window) {
    if (point.projectedCents < min.projectedCents) min = point;
  }

  return {
    safeToSpendCents: Math.max(0, min.projectedCents - goalContributionsCents),
    minProjectedCents: min.projectedCents,
    minDate: min.date,
    goalContributionsCents,
  };
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatShortDate(dateStr: string): string {
  // Parse as a local calendar date (not UTC) to avoid off-by-one display shifts.
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Today, in the user's local timezone, as a Date whose Y/M/D reflect local wall-clock time. */
function getLocalToday(timezone: string): Date {
  const localStr = new Date().toLocaleString('en-US', { timeZone: timezone });
  return new Date(localStr);
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Current local hour (0-23) for a timezone, used to match against the user's configured brief hour. */
function getLocalHour(timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hourPart = parts.find((p) => p.type === 'hour');
  return hourPart ? parseInt(hourPart.value, 10) : new Date().getHours();
}

interface BuiltBrief {
  title: string;
  message: string;
  sections: BriefSection[];
  insightIds: string[];
}

@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
    private readonly forecastService: ForecastService,
    private readonly billsService: BillsService,
    private readonly loansService: LoansService,
  ) {}

  /** Builds today's brief content for a single user. No side effects. */
  async buildBrief(userId: string, timezone: string): Promise<BuiltBrief> {
    const sections: BriefSection[] = [];

    // 1. Safe to spend today
    const forecastResult = await this.forecastService.forecast(userId, 14);
    const sts = computeSafeToSpend(forecastResult, 14);
    sections.push({ label: 'Safe to spend today', value: formatDollars(sts.safeToSpendCents) });

    // 2. Yesterday: total spend, txn count, largest txn
    const yesterday = getLocalToday(timezone);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = toDateStr(yesterday);

    const yRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total,
             COUNT(*) AS count,
             COALESCE(MAX(amount_cents), 0) AS largest_amount,
             (
               SELECT COALESCE(merchant_name, description)
               FROM ${schema.transactions} t2
               WHERE t2.user_id = ${userId}
                 AND t2.is_credit = false
                 AND t2.is_split_parent = false
                 AND t2.deleted_at IS NULL
                 AND t2.date = ${yStr}::date
               ORDER BY t2.amount_cents DESC
               LIMIT 1
             ) AS largest_merchant
      FROM ${schema.transactions}
      WHERE user_id = ${userId}
        AND is_credit = false
        AND is_split_parent = false
        AND deleted_at IS NULL
        AND date = ${yStr}::date
    `);
    const yRow = (yRows.rows ?? yRows)[0] as
      | { total: number; count: number; largest_amount: number; largest_merchant: string | null }
      | undefined;
    const yTotal = Number(yRow?.total ?? 0);
    const yCount = Number(yRow?.count ?? 0);
    const yLargest = Number(yRow?.largest_amount ?? 0);

    let yesterdayValue = `${formatDollars(yTotal)} across ${yCount} txn${yCount === 1 ? '' : 's'}`;
    if (yCount > 0 && yRow?.largest_merchant) {
      yesterdayValue += `, largest ${yRow.largest_merchant} ${formatDollars(yLargest)}`;
    }
    sections.push({ label: 'Yesterday', value: yesterdayValue });

    // 3. Budget pace: monthly budgets whose projected month-end spend exceeds 100%
    const today = getLocalToday(timezone);
    const dayOfMonth = today.getDate();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - dayOfMonth;

    const budgetRows = await this.db.execute(sql`
      SELECT c.name AS category_name,
             b.amount_cents AS budget_cents,
             COALESCE(SUM(t.amount_cents), 0) AS spent_cents
      FROM ${schema.budgets} b
      JOIN ${schema.categories} c ON b.category_id = c.id
      LEFT JOIN ${schema.transactions} t
        ON t.category_id = b.category_id
        AND t.user_id = b.user_id
        AND t.is_credit = false
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND date_trunc('month', t.date) = date_trunc('month', NOW())
      WHERE b.user_id = ${userId}
        AND b.deleted_at IS NULL
        AND b.period = 'monthly'
      GROUP BY b.id, c.name, b.amount_cents
    `);
    const budgets = (budgetRows.rows ?? budgetRows) as {
      category_name: string;
      budget_cents: number;
      spent_cents: number;
    }[];

    const overPace = budgets
      .map((b) => {
        const spent = Number(b.spent_cents);
        const budgetCents = Number(b.budget_cents);
        const projected = dayOfMonth > 0 ? (spent / dayOfMonth) * daysInMonth : spent;
        const pct = budgetCents > 0 ? Math.round((projected / budgetCents) * 100) : 0;
        return { name: b.category_name, pct };
      })
      .filter((b) => b.pct > 100)
      .sort((a, b) => b.pct - a.pct);

    if (overPace.length > 0) {
      sections.push({
        label: `Budget pace (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`,
        value: overPace.map((b) => `${b.name} ${b.pct}%`).join(', '),
      });
    }

    // 4. Bills due within 7 days (incl. loan payments)
    const [upcomingBills, upcomingLoans] = await Promise.all([
      this.billsService.findUpcoming(userId, 7),
      this.loansService.findDueWithin(userId, 7),
    ]);

    const billItems = [
      ...(upcomingBills as any[]).map((b) => ({
        name: b.normalizedName as string,
        date: b.nextExpectedDate ? new Date(b.nextExpectedDate).toISOString().slice(0, 10) : null,
        amountCents: b.expectedAmountCents as number,
      })),
      ...upcomingLoans.map((l) => ({ name: l.name, date: l.dueDate, amountCents: l.amountCents })),
    ].filter((b) => b.date !== null) as { name: string; date: string; amountCents: number }[];

    billItems.sort((a, b) => a.date.localeCompare(b.date));

    if (billItems.length > 0) {
      sections.push({
        label: 'Bills due this week',
        value: billItems
          .map((b) => `${b.name} ${formatDollars(b.amountCents)} (${formatShortDate(b.date)})`)
          .join(', '),
      });
    }

    // 5. Batched brief-mode insights (watchdog, market, freshness) from 11.3
    const insights = await this.notificationsService.getUnbriefedInsights(userId, 5);
    if (insights.length > 0) {
      sections.push({
        label: 'Also worth knowing',
        value: (insights as any[]).map((i) => i.title).join('; '),
      });
    }

    const title = 'Your Morning Brief';
    const message = sections.map((s) => `${s.label}: ${s.value}`).join('. ') + '.';

    return { title, message, sections, insightIds: (insights as any[]).map((i) => i.id) };
  }

  /** Delivers today's brief to a user. Idempotent — skips if already delivered today (local date). */
  async deliver(userId: string): Promise<boolean> {
    const settings = await this.getUserSettings(userId);
    if (!settings || !settings.dailyBriefEnabled) return false;

    const timezone = settings.timezone ?? 'America/New_York';
    const periodKey = toDateStr(getLocalToday(timezone));
    const dedupeKey = `brief_daily_${userId}_${periodKey}`;

    const alreadySent = await this.notificationsService.findByMetadata(userId, dedupeKey);
    if (alreadySent) {
      this.logger.debug(`Brief already sent: ${dedupeKey}`);
      return false;
    }

    const { title, message, sections, insightIds } = await this.buildBrief(userId, timezone);

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'daily_brief',
      title,
      message,
      voiceSummary: message,
      severity: 'info',
      source: 'system',
      dedupeKey,
      metadata: { dedupeKey, sections },
      notificationType: 'daily_brief',
    });

    if (insightIds.length > 0) {
      await this.notificationsService.markBriefed(insightIds);
    }

    this.logger.log(`Daily brief delivered: ${dedupeKey}`);
    return true;
  }

  /**
   * Called hourly by the scheduler. Delivers to every enabled user whose local
   * wall-clock hour matches their configured `dailyBriefHour` (default 7 AM).
   */
  async deliverAllEnabled(): Promise<void> {
    const rows = await this.db
      .select({
        userId: schema.userSettings.userId,
        timezone: schema.userSettings.timezone,
        dailyBriefHour: schema.userSettings.dailyBriefHour,
      })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.dailyBriefEnabled, true))
      .limit(10000);

    this.logger.log(`Brief sweep: ${rows.length} user(s) enabled`);

    for (const row of rows) {
      try {
        const timezone = row.timezone ?? 'America/New_York';
        const targetHour = row.dailyBriefHour ?? 7;
        if (getLocalHour(timezone) !== targetHour) continue;
        await this.deliver(row.userId);
      } catch (err) {
        this.logger.error(`Brief delivery failed for user ${row.userId}: ${(err as Error).message}`);
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────

  private async getUserSettings(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }
}
