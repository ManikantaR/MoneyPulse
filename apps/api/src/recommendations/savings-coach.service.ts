import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RecommendationSuppressionService } from './recommendation-suppression.service';
import {
  rankCandidate,
  aggregateSavingsCoach,
  SavingsCandidate,
  RankedSavingsItem,
  SAVINGS_COACH_CALCULATION_VERSION,
  PRICE_CREEP_MATERIAL_CHANGE_CENTS,
} from './savings-coach-calculator';
import { buildSavingsCoachNarration } from './savings-coach-narration';
import { SAVINGS_COACH_AGENT_MANIFEST } from './savings-coach.manifest';
import { WATCHDOG_THRESHOLDS } from '@moneypulse/shared';

const SAVINGS_COACH_NOTIFICATION_TYPE = 'savings_coach';
const LOOKBACK_DAYS_SUBSCRIPTIONS = 60;
const LOOKBACK_DAYS_FEES = 90;

/** Per-item suppression topic — distinct per candidate id so rejecting ONE candidate
 * (e.g. one subscription) never suppresses the others aggregated alongside it. */
function itemTopic(candidate: Pick<SavingsCandidate, 'kind' | 'id'>): string {
  return `savings_coach_item:${candidate.kind}:${candidate.id}`;
}

function toleranceFor(candidate: SavingsCandidate): Record<string, number> {
  if (candidate.kind === 'subscription_price_creep') {
    return { deltaCents: PRICE_CREEP_MATERIAL_CHANGE_CENTS, newAmountCents: PRICE_CREEP_MATERIAL_CHANGE_CENTS };
  }
  if (candidate.kind === 'fee_elimination') {
    return { avgMonthlyCents: 500 }; // $5/mo
  }
  return { overageCents: 1_000 }; // $10
}

/**
 * 12.7 — Savings Coach agent. Composes the 11.5 watchdog detectors' already-persisted
 * observations (price-creep, fee, budget-pace) into ONE monthly, dollar-ized
 * "savings actions" recommendation. Never re-derives detection logic — only reads
 * back what `WatchdogDetectorService` already found and applies 12.1's decision-aware
 * suppression PER CANDIDATE (a separate suppression topic per item id) so rejecting
 * one candidate never suppresses the others bundled in the same monthly recommendation.
 */
@Injectable()
export class SavingsCoachService {
  private readonly logger = new Logger(SavingsCoachService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
    private readonly suppressionService: RecommendationSuppressionService,
  ) {}

  private async activeUsers(): Promise<Array<{ id: string }>> {
    return this.db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.deletedAt));
  }

  async runForAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.runForUser(user.id);
      } catch (err: any) {
        this.logger.error(`Savings Coach run failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  /** Latest price-creep candidate per merchant within the lookback window, sourced
   * from the watchdog detector's own already-persisted `price_creep` notifications —
   * never re-derived from raw transactions here. */
  private async gatherPriceCreepCandidates(userId: string): Promise<SavingsCandidate[]> {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (metadata->>'merchant')
        id, metadata, created_at
      FROM ${schema.notifications}
      WHERE user_id = ${userId}
        AND type = 'price_creep'
        AND created_at >= NOW() - (${LOOKBACK_DAYS_SUBSCRIPTIONS} || ' days')::interval
      ORDER BY metadata->>'merchant', created_at DESC
    `);
    return (rows.rows ?? rows).map((r: any) => {
      const meta = r.metadata ?? {};
      return {
        kind: 'subscription_price_creep' as const,
        id: `price_creep:${meta.merchant}`,
        merchant: meta.merchant,
        previousAmountCents: Number(meta.previousAmountCents ?? 0),
        newAmountCents: Number(meta.newAmountCents ?? 0),
        observedAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString().slice(0, 10),
      };
    });
  }

  /** Aggregate ALL fee_detected notifications in the trailing window into one
   * "recurring fees" candidate — the watchdog detector only records per-transaction
   * fee hits, so this is the aggregation/dollar-izing step this issue is about. */
  private async gatherFeeCandidate(userId: string): Promise<SavingsCandidate[]> {
    const windowMonths = Math.round(LOOKBACK_DAYS_FEES / 30);
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS occurrences, COALESCE(SUM((metadata->>'amountCents')::bigint), 0)::bigint AS total_cents
      FROM ${schema.notifications}
      WHERE user_id = ${userId}
        AND type = 'fee_detected'
        AND created_at >= NOW() - (${LOOKBACK_DAYS_FEES} || ' days')::interval
    `);
    const row = (rows.rows ?? rows)[0];
    const occurrences = Number(row?.occurrences ?? 0);
    const totalCents = Number(row?.total_cents ?? 0);
    if (occurrences === 0 || totalCents === 0) return [];

    return [
      {
        kind: 'fee_elimination' as const,
        id: 'fee_elimination:recurring',
        label: 'Recurring bank/card',
        occurrences,
        totalCentsTrailingWindow: totalCents,
        windowMonths: Math.max(1, windowMonths),
        observedAt: new Date().toISOString().slice(0, 10),
      },
    ];
  }

  /** Currently over-pace monthly budgets — mirrors `checkBudgetPace`'s projection math
   * (11.5) so the dollar figures agree with what the watchdog already flagged; not a
   * new heuristic, just re-reading the same signal for dollar-ization. */
  private async gatherBudgetPaceCandidates(userId: string): Promise<SavingsCandidate[]> {
    const now = new Date();
    const dayOfMonth = now.getDate();
    if (dayOfMonth < WATCHDOG_THRESHOLDS.BUDGET_PACE_MIN_DAY) return [];

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const budgets = await this.db
      .select({
        id: schema.budgets.id,
        categoryId: schema.budgets.categoryId,
        amountCents: schema.budgets.amountCents,
        period: schema.budgets.period,
        categoryName: schema.categories.name,
      })
      .from(schema.budgets)
      .leftJoin(schema.categories, eq(schema.categories.id, schema.budgets.categoryId))
      .where(and(eq(schema.budgets.userId, userId), isNull(schema.budgets.deletedAt)));

    const candidates: SavingsCandidate[] = [];
    for (const budget of budgets) {
      if (budget.period !== 'monthly') continue;

      const rows = await this.db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS spent_cents
        FROM ${schema.transactions}
        WHERE user_id = ${userId}
          AND category_id = ${budget.categoryId}
          AND is_credit = false
          AND deleted_at IS NULL
          AND date >= ${monthStart.toISOString()}::timestamptz
      `);
      const spentCents = Number((rows.rows ?? rows)[0]?.spent_cents ?? 0);
      const projected = Math.round((spentCents / dayOfMonth) * daysInMonth);
      const ratio = budget.amountCents > 0 ? projected / budget.amountCents : 0;
      if (ratio <= WATCHDOG_THRESHOLDS.BUDGET_PACE_PROJECTION_RATIO) continue;

      candidates.push({
        kind: 'budget_pace_trim',
        id: `budget_pace:${budget.id}`,
        categoryLabel: budget.categoryName ?? 'Budget',
        budgetCents: budget.amountCents,
        projectedCents: projected,
        periodKey,
        observedAt: now.toISOString().slice(0, 10),
      });
    }
    return candidates;
  }

  /** Persist a lightweight, non-dispatched record of THIS candidate's own evidence so
   * a future decision on it (via the feed's per-item decision action) can be looked up
   * by `RecommendationSuppressionService` — reusing #117's logic unmodified rather than
   * inventing a parallel per-item decision store. */
  private async persistItemRecord(userId: string, candidate: SavingsCandidate, item: RankedSavingsItem): Promise<void> {
    await this.db.insert(schema.notifications).values({
      userId,
      type: itemTopic(candidate),
      title: item.label,
      message: item.label,
      severity: 'insight',
      source: 'advisor',
      kind: 'insight',
      evidence: item.evidence,
      assumptions: ['Part of the monthly Savings Coach aggregate recommendation.'],
      confidenceBand: 'medium',
      calculationVersion: SAVINGS_COACH_CALCULATION_VERSION,
      metadata: { inputsFingerprint: item.inputsFingerprint, aggregateType: SAVINGS_COACH_NOTIFICATION_TYPE },
    });
  }

  async runForUser(userId: string): Promise<{ ran: boolean; recommended: boolean; suppressedCount: number }> {
    const manifest = SAVINGS_COACH_AGENT_MANIFEST;

    const [priceCreep, fees, budgetPace] = await Promise.all([
      this.gatherPriceCreepCandidates(userId),
      this.gatherFeeCandidate(userId),
      this.gatherBudgetPaceCandidates(userId),
    ]);
    const candidates = [...priceCreep, ...fees, ...budgetPace];

    if (candidates.length === 0) {
      return { ran: true, recommended: false, suppressedCount: 0 };
    }

    const surviving: RankedSavingsItem[] = [];
    const survivingCandidates: SavingsCandidate[] = [];
    let suppressedCount = 0;

    for (const candidate of candidates) {
      const item = rankCandidate(candidate);
      const suppression = await this.suppressionService.checkAndSuppress(
        userId,
        itemTopic(candidate),
        SAVINGS_COACH_CALCULATION_VERSION,
        item.inputsFingerprint,
        toleranceFor(candidate),
      );
      if (suppression.suppressed) {
        suppressedCount += 1;
        continue;
      }
      surviving.push(item);
      survivingCandidates.push(candidate);
    }

    const result = aggregateSavingsCoach(surviving);

    if (!result.shouldRecommend) {
      return { ran: true, recommended: false, suppressedCount };
    }

    const message = buildSavingsCoachNarration(result);
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const dedupeKey = `savings_coach_${userId}_${periodKey}`;

    await this.notificationsService.createAndDispatch({
      userId,
      type: SAVINGS_COACH_NOTIFICATION_TYPE,
      source: 'advisor',
      severity: 'insight',
      title: 'Monthly savings actions',
      message,
      dedupeKey,
      kind: 'recommendation',
      actionSummary: `${result.items.length} savings action(s) worth up to $${(result.impact.maxCentsPerYear / 100).toFixed(2)}/yr`,
      expectedImpact: result.impact,
      evidence: result.evidence,
      assumptions: result.assumptions,
      confidenceBand: result.confidenceBand,
      calculationVersion: result.calculationVersion,
      producer: { id: manifest.id, version: manifest.version },
      expiresAt: new Date(now.getTime() + 30 * 24 * 3600_000),
      metadata: {
        dedupeKey,
        items: result.items.map((i) => ({ id: i.id, kind: i.kind, label: i.label })),
      },
    });

    // Fire-and-record per-item audit rows AFTER the aggregate write succeeds, so a
    // failure here never blocks the (already-dispatched) user-facing recommendation.
    for (let i = 0; i < surviving.length; i++) {
      try {
        await this.persistItemRecord(userId, survivingCandidates[i], surviving[i]);
      } catch (err: any) {
        this.logger.error(`Failed to persist Savings Coach item record for user ${userId}: ${err.message}`, err.stack);
      }
    }

    return { ran: true, recommended: true, suppressedCount };
  }
}
