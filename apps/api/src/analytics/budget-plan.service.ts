import { Injectable, Inject } from '@nestjs/common';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';

/** Pay periods per calendar year for each supported pay frequency (used to smooth a
 *  single paycheck's gross into a monthly figure — NOT what literally landed in the
 *  bank that month). */
const PAY_PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semi_monthly: 24,
  monthly: 12,
};

/** Target bands for the 50/30/20 (Ramit Sethi / Vivian Tu Conscious Spending Plan
 *  blend) dashboard. `max: null` means "at least this much", no upper bound. */
const TARGETS = {
  needs: { min: 0.5, max: 0.6 },
  wants: { min: 0.2, max: 0.35 },
  savings: { min: 0.2, max: null as number | null },
};

/** Last calendar day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  // Day 0 of next month == last day of this month.
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

function startOfMonth(month: string): string {
  return `${month}-01`;
}

@Injectable()
export class BudgetPlanService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /** Extract raw rows from a Drizzle execute() result. */
  private extractRows(result: any): any[] {
    return result.rows ?? result;
  }

  /**
   * Computes the 50/30/20 (Needs/Wants/Savings) budget plan for a given month against
   * the paycheck profile that was in effect for that month (the most recent profile with
   * `effectiveDate <=` the last day of the month — forward-only, never backfilled).
   *
   * @param userId - The authenticated user's ID.
   * @param month - `YYYY-MM` month to compute the plan for.
   * @returns `hasProfile: false` (with all figures null) when no paycheck profile exists
   *   yet as of that month, rather than guessing or dividing by zero.
   */
  async budgetPlan(userId: string, month: string) {
    const lastDay = endOfMonth(month);
    const firstDay = startOfMonth(month);

    const profileRows = await this.db
      .select()
      .from(schema.paycheckProfiles)
      .where(
        and(
          eq(schema.paycheckProfiles.userId, userId),
          isNull(schema.paycheckProfiles.deletedAt),
          lte(schema.paycheckProfiles.effectiveDate, lastDay),
        ),
      )
      .orderBy(desc(schema.paycheckProfiles.effectiveDate))
      .limit(1);

    const profile = profileRows[0];

    if (!profile) {
      return {
        month,
        hasProfile: false,
        profile: null,
        needs: null,
        wants: null,
        savings: null,
        targets: TARGETS,
      };
    }

    const payPeriodsPerYear = PAY_PERIODS_PER_YEAR[profile.payFrequency] ?? 12;
    const monthlyGrossCents = Math.round(
      (profile.grossPayCents * payPeriodsPerYear) / 12,
    );

    const bucketResult = await this.db.execute(sql`
      SELECT
        c.bucket AS bucket,
        SUM(t.amount_cents) AS total_cents
      FROM ${schema.transactions} t
      JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND t.is_split_parent = false
        AND t.is_credit = false
        AND c.bucket IS NOT NULL
        AND t.date >= ${firstDay}
        AND t.date <= ${lastDay}
      GROUP BY c.bucket
    `);

    const bucketTotals: Record<string, number> = {
      needs: 0,
      wants: 0,
      savings_debt: 0,
    };
    for (const row of this.extractRows(bucketResult)) {
      bucketTotals[row.bucket] = Number(row.total_cents) || 0;
    }

    const savingsFromProfileCents =
      (profile.pretax401kCents ?? 0) +
      (profile.hsaCents ?? 0) +
      (profile.esppContributionCents ?? 0);

    const needsCents = bucketTotals.needs;
    const wantsCents = bucketTotals.wants;
    const savingsCents = savingsFromProfileCents + bucketTotals.savings_debt;

    const pct = (cents: number) =>
      monthlyGrossCents > 0
        ? Math.round((cents / monthlyGrossCents) * 1000) / 1000
        : null;

    return {
      month,
      hasProfile: true,
      profile: {
        id: profile.id,
        effectiveDate: profile.effectiveDate,
        payFrequency: profile.payFrequency,
        monthlyGrossCents,
      },
      needs: {
        actualCents: needsCents,
        actualPercent: pct(needsCents),
        target: TARGETS.needs,
      },
      wants: {
        actualCents: wantsCents,
        actualPercent: pct(wantsCents),
        target: TARGETS.wants,
      },
      savings: {
        actualCents: savingsCents,
        actualPercent: pct(savingsCents),
        target: TARGETS.savings,
      },
      targets: TARGETS,
    };
  }
}
