import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sqlArray } from '../db/sql-array';
import { NotificationsService } from '../notifications/notifications.service';
import { RecommendationSuppressionService } from './recommendation-suppression.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { InvestmentsService } from '../investments/investments.service';
import { ContributionPlanner, InvestmentCoachSettingsLike } from './contribution-planner';
import { buildInvestmentCoachNarration } from './investment-coach-narration';
import { INVESTMENT_COACH_AGENT_MANIFEST } from './investment-coach.manifest';

const INVESTMENT_COACH_NOTIFICATION_TYPE = 'investment_coach_contribution';

/**
 * 12.6 — Investment Coach agent. Gathers sanitized (no lastFour/account-number)
 * inputs, runs them through the deterministic `ContributionPlanner`, applies 12.1's
 * decision-aware suppression, and persists a `recommendation` notification when the
 * plan clears the "worth telling the user" bar (i.e. it isn't a no-op no_surplus
 * result). Only a `status === 'recommend'` (or `fund_buffer_first`) result is worth
 * a notification — `no_surplus`/`missing_setting` are surfaced on-demand only (advisor
 * chat), never as a monthly nag, since there's nothing new to say.
 */
@Injectable()
export class InvestmentCoachService {
  private readonly logger = new Logger(InvestmentCoachService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
    private readonly suppressionService: RecommendationSuppressionService,
    private readonly analyticsService: AnalyticsService,
    private readonly investmentsService: InvestmentsService,
  ) {}

  private async activeUsers(): Promise<Array<{ id: string }>> {
    return this.db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.deletedAt));
  }

  async runForAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.runForUser(user.id);
      } catch (err: any) {
        this.logger.error(`Investment Coach run failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  private async latestSuitabilitySettings(userId: string): Promise<InvestmentCoachSettingsLike | null> {
    const rows = await this.db
      .select()
      .from(schema.suitabilitySettings)
      .where(eq(schema.suitabilitySettings.userId, userId))
      .orderBy(sql`version DESC`)
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      version: r.version,
      emergencyFundTargetMonths: r.emergencyFundTargetMonths,
      liquidityHorizonMonths: r.liquidityHorizonMonths,
      riskTolerance: r.riskTolerance,
      taxState: r.taxState,
      monthlyInvestingTargetCents: r.monthlyInvestingTargetCents,
      targetAllocation: r.targetAllocation ?? [],
      dcaDayOfMonth: r.dcaDayOfMonth,
      dcaAmountCents: r.dcaAmountCents,
      tickerAssetClassMap: r.tickerAssetClassMap ?? {},
    };
  }

  /** Sum of liquid (checking/savings) balances — same basis 12.5's Cash Manager uses
   * for its buffer math, reused here for the emergency-fund gate. */
  private async currentEmergencyFundCents(userId: string): Promise<number> {
    const accounts = await this.db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
          sql`${schema.accounts.accountType} IN ('checking', 'savings')`,
        ),
      );
    if (accounts.length === 0) return 0;
    const accountIds = accounts.map((a: any) => a.id);

    const balanceRows = await this.db.execute(sql`
      SELECT DISTINCT ON (account_id) account_id, balance_cents
      FROM ${schema.accountBalanceSnapshots}
      WHERE account_id = ANY(${sqlArray(accountIds, 'uuid')})
      ORDER BY account_id, snapshot_date DESC
    `);
    return (balanceRows.rows ?? balanceRows).reduce((sum: number, r: any) => sum + Number(r.balance_cents), 0);
  }

  private async avgMonthlyExpenseCents(userId: string): Promise<number> {
    const expenseRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
      FROM ${schema.transactions}
      WHERE user_id = ${userId}
        AND is_credit = false
        AND is_split_parent = false
        AND parent_transaction_id IS NULL
        AND deleted_at IS NULL
        AND date >= NOW() - INTERVAL '3 months'
    `);
    return Math.round(Number((expenseRows.rows ?? expenseRows)[0]?.total_cents ?? 0) / 3);
  }

  async runForUser(
    userId: string,
  ): Promise<{ ran: boolean; suppressed: boolean; recommended: boolean }> {
    const manifest = INVESTMENT_COACH_AGENT_MANIFEST;
    const settings = await this.latestSuitabilitySettings(userId);

    const [avgMonthlyExpenseCents, currentEmergencyFundCents, savingsRate, portfolio, allocation] =
      await Promise.all([
        this.avgMonthlyExpenseCents(userId),
        this.currentEmergencyFundCents(userId),
        this.analyticsService.savingsRate(userId, { months: 1 }),
        this.investmentsService.getPortfolioValue(userId),
        this.investmentsService.getAllocation(userId),
      ]);

    const trailingMonthlySurplusCents = savingsRate.current
      ? savingsRate.current.incomeCents - savingsRate.current.expenseCents
      : 0;

    const tickerAssetClassMap: Record<string, string> = settings?.tickerAssetClassMap ?? {};
    const currentAllocationByAssetClass = new Map<string, number>();
    for (const a of allocation.allocations) {
      const assetClass = tickerAssetClassMap[a.ticker];
      if (!assetClass) continue; // unmapped ticker — cannot attribute to a target class, skip rather than guess
      currentAllocationByAssetClass.set(assetClass, (currentAllocationByAssetClass.get(assetClass) ?? 0) + a.valueCents);
    }

    const planner = new ContributionPlanner();
    const result = planner.plan(settings, {
      asOfDate: new Date().toISOString().slice(0, 10),
      avgMonthlyExpenseCents,
      currentEmergencyFundCents,
      trailingMonthlySurplusCents,
      monthlyGoalContributionCents: 0, // goals feature not yet shipped in this codebase
      totalPortfolioValueCents: portfolio.totalCents,
      currentAllocationByAssetClass: Array.from(currentAllocationByAssetClass.entries()).map(
        ([assetClass, valueCents]) => ({ assetClass, valueCents }),
      ),
    });

    if (result.status !== 'recommend' && result.status !== 'fund_buffer_first') {
      return { ran: true, suppressed: false, recommended: false };
    }

    const suppression = await this.suppressionService.checkAndSuppress(
      userId,
      INVESTMENT_COACH_NOTIFICATION_TYPE,
      'calculationVersion' in result ? result.calculationVersion : 'contribution-planner-v1',
      result.status === 'recommend' ? { contributionCents: result.contributionCents } : { gapCents: result.gapCents },
      result.status === 'recommend'
        ? { contributionCents: Math.max(10_000, result.contributionCents * 0.1) }
        : { gapCents: 10_000 },
    );
    if (suppression.suppressed) {
      return { ran: true, suppressed: true, recommended: false };
    }

    const message = buildInvestmentCoachNarration(result);
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const dedupeKey = `investment_coach_${userId}_${periodKey}`;

    await this.notificationsService.createAndDispatch({
      userId,
      type: INVESTMENT_COACH_NOTIFICATION_TYPE,
      source: 'advisor',
      severity: 'insight',
      title: result.status === 'recommend' ? 'Your monthly contribution plan' : 'Fund your emergency buffer first',
      message,
      dedupeKey,
      kind: 'recommendation',
      actionSummary:
        result.status === 'recommend'
          ? `Contribute ~$${(result.contributionCents / 100).toFixed(2)} to ${result.destinationAssetClass}`
          : `Save ~$${(result.gapCents / 100).toFixed(2)} more toward your emergency buffer`,
      expectedImpact: result.status === 'recommend' ? result.impact : { minCentsPerYear: 0, maxCentsPerYear: 0, basis: 'No investment impact until the emergency buffer is funded.' },
      evidence: result.evidence,
      assumptions: result.assumptions,
      confidenceBand: result.confidenceBand,
      calculationVersion: result.calculationVersion,
      producer: { id: manifest.id, version: manifest.version },
      expiresAt: new Date(now.getTime() + 30 * 24 * 3600_000),
      metadata: { dedupeKey },
    });

    return { ran: true, suppressed: false, recommended: result.status === 'recommend' };
  }
}
