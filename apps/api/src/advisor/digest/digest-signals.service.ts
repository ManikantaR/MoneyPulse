import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../../db/db.module';
import * as schema from '../../db/schema';
import type { DigestSignal } from './types';

/** Minimum dollar swing (cents) for a week-over-week category move to be worth surfacing. */
const CATEGORY_DELTA_FLOOR_CENTS = 2000; // $20
/** How many candidate signals to hand to the ranker (it narrows to the top 3–5). */
const MAX_CANDIDATES = 12;

function formatDollars(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Timezone-local week windows for the digest.
 * `recap` is the most recently completed Mon–Sun week; `prior` is the week before it.
 * Boundaries are local calendar dates (end-exclusive) compared against the `date` column.
 */
export function localWeekWindows(timezone: string, now = new Date()) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  local.setHours(0, 0, 0, 0);
  const mondayOffset = (local.getDay() + 6) % 7; // Mon=0 … Sun=6
  const mondayThisWeek = new Date(local);
  mondayThisWeek.setDate(local.getDate() - mondayOffset);

  const recapStart = new Date(mondayThisWeek);
  recapStart.setDate(mondayThisWeek.getDate() - 7);
  const priorStart = new Date(mondayThisWeek);
  priorStart.setDate(mondayThisWeek.getDate() - 14);

  return {
    recapStart: fmtDate(recapStart),
    recapEnd: fmtDate(mondayThisWeek), // exclusive
    priorStart: fmtDate(priorStart),
    priorEnd: fmtDate(recapStart), // exclusive
  };
}

/**
 * Deterministic math engine for the weekly advisor digest.
 *
 * Produces dollar-quantified, provenance-tagged candidate signals from the user's own data.
 * Every number here is computed in SQL — the LLM downstream only ranks and narrates these,
 * it never invents figures. Output is aggregate (category totals, bill amounts, anomaly
 * amounts) — no raw transaction descriptions or account numbers.
 */
@Injectable()
export class DigestSignalsService {
  private readonly logger = new Logger(DigestSignalsService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /** Gather and pre-rank (by dollar magnitude) the week's candidate signals for a user. */
  async gather(userId: string, timezone = 'America/New_York'): Promise<DigestSignal[]> {
    const win = localWeekWindows(timezone);

    const [deltas, drivers, bills, subs, anomalies] = await Promise.all([
      this.categoryDeltas(userId, win),
      this.topDrivers(userId, win),
      this.upcomingBills(userId),
      this.subscriptionChanges(userId),
      this.recentAnomalies(userId, win.recapStart),
    ]);

    const all = [...deltas, ...drivers, ...bills, ...subs, ...anomalies];
    all.sort((a, b) => b.amountCents - a.amountCents);
    return all.slice(0, MAX_CANDIDATES);
  }

  private rows(result: any): any[] {
    return (result.rows ?? result) as any[];
  }

  /** Week-over-week spend change per category; surfaces the largest swings (either direction). */
  private async categoryDeltas(
    userId: string,
    win: { recapStart: string; recapEnd: string; priorStart: string; priorEnd: string },
  ): Promise<DigestSignal[]> {
    const result = await this.db.execute(sql`
      WITH recap AS (
        SELECT category_id, SUM(amount_cents) AS total
        FROM ${schema.transactions}
        WHERE user_id = ${userId} AND is_credit = false AND is_split_parent = false
          AND deleted_at IS NULL
          AND date >= ${win.recapStart}::date AND date < ${win.recapEnd}::date
        GROUP BY category_id
      ),
      prior AS (
        SELECT category_id, SUM(amount_cents) AS total
        FROM ${schema.transactions}
        WHERE user_id = ${userId} AND is_credit = false AND is_split_parent = false
          AND deleted_at IS NULL
          AND date >= ${win.priorStart}::date AND date < ${win.priorEnd}::date
        GROUP BY category_id
      )
      SELECT c.name AS category_name,
             COALESCE(r.total, 0) AS recap_total,
             COALESCE(p.total, 0) AS prior_total,
             COALESCE(r.total, 0) - COALESCE(p.total, 0) AS delta
      FROM recap r
      FULL OUTER JOIN prior p USING (category_id)
      JOIN ${schema.categories} c ON c.id = COALESCE(r.category_id, p.category_id)
      WHERE COALESCE(c.is_transfer, false) = false
      ORDER BY ABS(COALESCE(r.total, 0) - COALESCE(p.total, 0)) DESC
      LIMIT 5
    `);

    return this.rows(result)
      .map((r) => {
        const delta = Number(r.delta);
        const recap = Number(r.recap_total);
        const prior = Number(r.prior_total);
        return { delta, recap, prior, name: r.category_name as string };
      })
      .filter((r) => Math.abs(r.delta) >= CATEGORY_DELTA_FLOOR_CENTS)
      .map((r) => {
        const up = r.delta > 0;
        return {
          kind: 'category_delta' as const,
          label: `${r.name} ${up ? 'up' : 'down'} week-over-week`,
          amountCents: Math.abs(r.delta),
          detail: `${r.name} spending was ${formatDollars(r.recap)} last week vs ${formatDollars(
            r.prior,
          )} the week before — ${up ? 'up' : 'down'} ${formatDollars(r.delta)}.`,
          provenance: 'category spending, last week vs the week before',
        };
      });
  }

  /** Largest categories by spend in the recap week (context, not necessarily a change). */
  private async topDrivers(
    userId: string,
    win: { recapStart: string; recapEnd: string },
  ): Promise<DigestSignal[]> {
    const result = await this.db.execute(sql`
      SELECT c.name AS category_name, SUM(t.amount_cents) AS total
      FROM ${schema.transactions} t
      JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.user_id = ${userId} AND t.is_credit = false AND t.is_split_parent = false
        AND t.deleted_at IS NULL AND COALESCE(c.is_transfer, false) = false
        AND t.date >= ${win.recapStart}::date AND t.date < ${win.recapEnd}::date
      GROUP BY c.name
      ORDER BY total DESC
      LIMIT 3
    `);

    return this.rows(result).map((r) => {
      const total = Number(r.total);
      return {
        kind: 'top_driver' as const,
        label: `Top spend: ${r.category_name}`,
        amountCents: total,
        detail: `${r.category_name} was your biggest category last week at ${formatDollars(total)}.`,
        provenance: 'category spending totals for last week',
      };
    });
  }

  /** Recurring bills due in the next 7 days. */
  private async upcomingBills(userId: string): Promise<DigestSignal[]> {
    const result = await this.db.execute(sql`
      SELECT normalized_name, expected_amount_cents, next_expected_date
      FROM ${schema.recurringBills}
      WHERE user_id = ${userId} AND is_active = true
        AND next_expected_date IS NOT NULL
        AND next_expected_date >= NOW()
        AND next_expected_date < NOW() + interval '7 days'
      ORDER BY expected_amount_cents DESC
      LIMIT 5
    `);

    return this.rows(result).map((r) => {
      const amount = Number(r.expected_amount_cents);
      const due = new Date(r.next_expected_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return {
        kind: 'upcoming_bill' as const,
        label: `${r.normalized_name} due soon`,
        amountCents: amount,
        detail: `${r.normalized_name} (${formatDollars(amount)}) is due around ${due}.`,
        provenance: 'your tracked recurring bills',
      };
    });
  }

  /** Recurring bills whose most recent charge broke out of their tolerance band (price change). */
  private async subscriptionChanges(userId: string): Promise<DigestSignal[]> {
    const result = await this.db.execute(sql`
      SELECT normalized_name, expected_amount_cents, last_amount_cents, amount_tolerance_percent
      FROM ${schema.recurringBills}
      WHERE user_id = ${userId} AND is_active = true
        AND last_amount_cents IS NOT NULL
        AND ABS(last_amount_cents - expected_amount_cents)
            > (expected_amount_cents * amount_tolerance_percent / 100.0)
      ORDER BY ABS(last_amount_cents - expected_amount_cents) DESC
      LIMIT 5
    `);

    return this.rows(result).map((r) => {
      const expected = Number(r.expected_amount_cents);
      const last = Number(r.last_amount_cents);
      const diff = last - expected;
      const up = diff > 0;
      return {
        kind: 'subscription_change' as const,
        label: `${r.normalized_name} price ${up ? 'increase' : 'drop'}`,
        amountCents: Math.abs(diff),
        detail: `${r.normalized_name} last charged ${formatDollars(last)}, ${
          up ? 'up' : 'down'
        } ${formatDollars(diff)} from its usual ${formatDollars(expected)}.`,
        provenance: 'your tracked recurring bills',
      };
    });
  }

  /** Spending anomalies flagged by the anomaly engine (#32) during the recap week. */
  private async recentAnomalies(userId: string, sinceDate: string): Promise<DigestSignal[]> {
    const result = await this.db.execute(sql`
      SELECT message, metadata
      FROM ${schema.notifications}
      WHERE user_id = ${userId}
        AND type = 'spending_anomaly'
        AND created_at >= ${sinceDate}::date
      ORDER BY created_at DESC
      LIMIT 5
    `);

    return this.rows(result).map((r) => {
      const meta = (r.metadata ?? {}) as { amountCents?: number };
      const amount = Number(meta.amountCents ?? 0);
      return {
        kind: 'anomaly' as const,
        label: 'Unusual charge flagged',
        amountCents: amount,
        detail: r.message as string,
        provenance: 'MoneyPulse anomaly detection',
      };
    });
  }
}
