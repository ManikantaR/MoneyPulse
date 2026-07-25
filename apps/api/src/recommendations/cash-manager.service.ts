import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RecommendationSuppressionService } from './recommendation-suppression.service';
import {
  CashPlacementCalculator,
  CashCandidate,
  CASH_MANAGER_CALCULATION_VERSION,
  CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS,
} from './cash-placement-calculator';
import { buildCashManagerNarration } from './cash-manager-narration';
import { CASH_MANAGER_AGENT_MANIFEST } from './cash-manager.manifest';

const INTEREST_PATTERNS = ['INTEREST PAID', 'INTEREST PAYMENT', 'DIVIDEND'];

/** Shared with the 11.7 idle-cash detector's dedupe topic so the user is never
 * nagged twice for the same underlying "cash looks idle" signal — the detector is
 * the cheap monthly observation, this agent is the full placement recommendation. */
const CASH_MANAGER_NOTIFICATION_TYPE = 'idle_cash';

/** 3-month Treasury bill yield — the standard short-duration risk-free-rate
 * benchmark, and one of `TREASURY_WATCHLIST_SERIES`'s own comparison points, so a
 * benchmark move is inherently relevant to this agent's own recommendation inputs. */
const BENCHMARK_RATE_METRIC_KEY = 'treasury_bill_13w';
/** Manifest schedule: "benchmark-rate-move(>=25bps)". */
const BENCHMARK_RATE_MOVE_THRESHOLD_BPS = 25;
/** Manifest schedule: "liquid-balance-move(>=20%)". */
const LIQUID_BALANCE_MOVE_THRESHOLD_PCT = 0.2;

/**
 * 12.5 — Cash Manager agent. Gathers sanitized (no lastFour/account-number) inputs,
 * runs them through the deterministic `CashPlacementCalculator`, applies 12.1's
 * decision-aware suppression, and persists a `recommendation` notification when the
 * best option clears the $/yr bar. No LLM call is required for the deterministic
 * result to be correct — this service can run entirely on its own; narration is a
 * pure, numeric-spot-check-safe rendering of the same result (`cash-manager-narration.ts`).
 */
@Injectable()
export class CashManagerService {
  private readonly logger = new Logger(CashManagerService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
    private readonly suppressionService: RecommendationSuppressionService,
  ) {}

  private async activeUsers(): Promise<Array<{ id: string }>> {
    return this.db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.deletedAt));
  }

  /** `userIds`, when given, restricts the run to those users (used by the event-triggered
   * legs below); omitted/empty means "all active users" (the monthly scheduled leg). */
  async runForAllUsers(userIds?: string[]): Promise<void> {
    const targets =
      userIds && userIds.length > 0
        ? userIds.map((id) => ({ id }))
        : await this.activeUsers();
    for (const user of targets) {
      try {
        await this.runForUser(user.id);
      } catch (err: any) {
        this.logger.error(`Cash Manager run failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  /**
   * Event trigger leg 1 (manifest: "benchmark-rate-move(>=25bps)"). Only meaningful right
   * after a market-data refresh actually wrote a new value for the benchmark series today
   * — `refreshedMetricKeys` should be the `refreshed` list from that same
   * `MarketDataService.refreshAll()` call, so a day where the series was merely *skipped*
   * (already fetched, or upstream outage) never re-compares the same two rows and re-fires.
   * Compares the two most recent stored values for the benchmark series; a straightforward
   * latest-vs-previous comparison, no new detector framework.
   */
  async checkBenchmarkRateMove(refreshedMetricKeys: string[]): Promise<boolean> {
    if (!refreshedMetricKeys.includes(BENCHMARK_RATE_METRIC_KEY)) return false;

    const rows = await this.db
      .select({ value: schema.marketMetrics.value, periodDate: schema.marketMetrics.periodDate })
      .from(schema.marketMetrics)
      .where(eq(schema.marketMetrics.metricKey, BENCHMARK_RATE_METRIC_KEY))
      .orderBy(desc(schema.marketMetrics.periodDate))
      .limit(2);
    if (rows.length < 2) return false;

    const [latest, previous] = rows;
    const deltaBps = Math.round(Math.abs(Number(latest.value) - Number(previous.value)) * 100);
    return deltaBps >= BENCHMARK_RATE_MOVE_THRESHOLD_BPS;
  }

  /**
   * Event trigger leg 2 (manifest: "liquid-balance-move(>=20%)"). Compares each user's
   * latest two liquid (checking+savings) balance snapshot totals — a straightforward
   * latest-vs-previous comparison over `account_balance_snapshots`, reusing the same
   * checking/savings account-type filter as `runForUser`'s own liquid-balance query.
   * Users with fewer than two snapshot dates, or a zero/negative prior total (nothing
   * to compute a meaningful percentage move against), are skipped rather than flagged.
   */
  async findUsersWithLiquidBalanceMove(): Promise<string[]> {
    const rows = await this.db.execute(sql`
      WITH liquid_accounts AS (
        SELECT id, user_id FROM ${schema.accounts}
        WHERE deleted_at IS NULL AND account_type IN ('checking', 'savings')
      ),
      by_date AS (
        SELECT la.user_id, abs.snapshot_date, SUM(abs.balance_cents) AS total_cents
        FROM ${schema.accountBalanceSnapshots} abs
        JOIN liquid_accounts la ON la.id = abs.account_id
        GROUP BY la.user_id, abs.snapshot_date
      ),
      ranked AS (
        SELECT
          user_id,
          total_cents,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY snapshot_date DESC) AS rnk
        FROM by_date
      )
      SELECT
        user_id,
        MAX(CASE WHEN rnk = 1 THEN total_cents END) AS latest_cents,
        MAX(CASE WHEN rnk = 2 THEN total_cents END) AS prior_cents
      FROM ranked
      WHERE rnk <= 2
      GROUP BY user_id
    `);

    const moved: string[] = [];
    for (const r of rows.rows ?? rows) {
      const priorCents = Number(r.prior_cents ?? 0);
      const latestCents = Number(r.latest_cents ?? 0);
      if (r.prior_cents === null || r.latest_cents === null || priorCents <= 0) continue;
      const pctMove = Math.abs(latestCents - priorCents) / priorCents;
      if (pctMove >= LIQUID_BALANCE_MOVE_THRESHOLD_PCT) moved.push(r.user_id);
    }
    return moved;
  }

  /** Trailing-12mo interest credits / avg balance, per checking+savings account —
   * mirrors the MCP `get_earned_apy` tool's math, but only the resulting bps figure
   * (never the underlying interest transactions) leaves this method. */
  private async computeBlendedEarnedApyBps(
    userId: string,
    accountIds: string[],
  ): Promise<{ apyBps: number; asOfDate: string }> {
    const today = new Date().toISOString().slice(0, 10);
    if (accountIds.length === 0) return { apyBps: 0, asOfDate: today };

    // Parameterized OR of ILIKE clauses (values interpolated as bind params by drizzle's
    // `sql` tag — never string-concatenated into the query text).
    const likeClause = sql.join(
      INTEREST_PATTERNS.map((p) => sql`t.description ILIKE ${'%' + p + '%'}`),
      sql` OR `,
    );

    const interestRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
      FROM ${schema.transactions} t
      WHERE t.account_id = ANY(${accountIds})
        AND t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND t.is_split_parent = false
        AND t.is_credit = true
        AND t.date >= NOW() - INTERVAL '12 months'
        AND (${likeClause})
    `);
    const interestCents = Number((interestRows.rows ?? interestRows)[0]?.total_cents ?? 0);

    const snapshotRows = await this.db.execute(sql`
      SELECT AVG(balance_cents)::numeric AS avg_cents
      FROM ${schema.accountBalanceSnapshots}
      WHERE account_id = ANY(${accountIds}) AND snapshot_date >= NOW() - INTERVAL '12 months'
    `);
    const avgBalanceCents = Number((snapshotRows.rows ?? snapshotRows)[0]?.avg_cents ?? 0);

    if (avgBalanceCents <= 0) return { apyBps: 0, asOfDate: today };
    const apyBps = Math.round((interestCents / avgBalanceCents) * 10_000);
    return { apyBps, asOfDate: today };
  }

  async runForUser(userId: string): Promise<{ ran: boolean; suppressed: boolean; recommended: boolean }> {
    const manifest = CASH_MANAGER_AGENT_MANIFEST;

    // Select only the columns this agent needs — deliberately never `lastFour`/account
    // number/routing number (see recommendation-evidence.ts's no-credentials rule).
    const accounts = await this.db
      .select({ id: schema.accounts.id, nickname: schema.accounts.nickname })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
          sql`${schema.accounts.accountType} IN ('checking', 'savings')`,
        ),
      );
    if (accounts.length === 0) return { ran: false, suppressed: false, recommended: false };
    const accountIds = accounts.map((a: any) => a.id);

    const balanceRows = await this.db.execute(sql`
      SELECT DISTINCT ON (account_id) account_id, balance_cents
      FROM ${schema.accountBalanceSnapshots}
      WHERE account_id = ANY(${accountIds})
      ORDER BY account_id, snapshot_date DESC
    `);
    const liquidBalanceCents = (balanceRows.rows ?? balanceRows).reduce(
      (sum: number, r: any) => sum + Number(r.balance_cents),
      0,
    );

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
    const avgMonthlyExpenseCents = Math.round(
      Number((expenseRows.rows ?? expenseRows)[0]?.total_cents ?? 0) / 3,
    );

    const settingsRows = await this.db
      .select()
      .from(schema.suitabilitySettings)
      .where(eq(schema.suitabilitySettings.userId, userId))
      .orderBy(sql`version DESC`)
      .limit(1);
    const emergencyFundTargetMonths = settingsRows[0]?.emergencyFundTargetMonths ?? 6;
    const idleCashBufferMonths = 1; // 11.7 default; overridden by user_settings when present, handled upstream

    const { apyBps: currentEarnedApyBps, asOfDate: earnedApyAsOf } = await this.computeBlendedEarnedApyBps(
      userId,
      accountIds,
    );

    const watchlistRows = await this.db
      .select()
      .from(schema.rateWatchlist)
      .where(eq(schema.rateWatchlist.userId, userId));

    const candidates: CashCandidate[] = watchlistRows.map((r: any) => ({
      id: r.id,
      institution: r.institution,
      productType: r.productType,
      apyBps: r.apyBps,
      termMonths: r.termMonths,
      asOfDate: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt)).toISOString().slice(0, 10),
      stateTaxExempt: r.productType === 'treasury',
    }));

    const calculator = new CashPlacementCalculator();
    const result = calculator.compute({
      liquidBalanceCents,
      balanceAsOfDate: new Date().toISOString().slice(0, 10),
      avgMonthlyExpenseCents,
      emergencyFundTargetMonths,
      idleCashBufferMonths,
      currentEarnedApyBps,
      currentEarnedApyAsOfDate: earnedApyAsOf,
      candidates,
      taxState: settingsRows[0]?.taxState ?? null,
    });

    if (!result.shouldRecommend) {
      return { ran: true, suppressed: false, recommended: false };
    }

    const suppression = await this.suppressionService.checkAndSuppress(
      userId,
      CASH_MANAGER_NOTIFICATION_TYPE,
      CASH_MANAGER_CALCULATION_VERSION,
      {
        movableCashCents: result.movableCashCents,
        bestNetAnnualBenefitCents: result.options[0]?.netAnnualBenefitCents ?? 0,
      },
      { movableCashCents: liquidBalanceCents * 0.2, bestNetAnnualBenefitCents: CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS },
    );
    if (suppression.suppressed) {
      return { ran: true, suppressed: true, recommended: false };
    }

    const message = buildCashManagerNarration(result);
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const dedupeKey = `idle_cash_${userId}_${periodKey}`;

    await this.notificationsService.createAndDispatch({
      userId,
      type: CASH_MANAGER_NOTIFICATION_TYPE,
      source: 'advisor',
      severity: 'insight',
      title: 'Your idle cash could earn more',
      message,
      dedupeKey,
      kind: 'recommendation',
      actionSummary: `Move ~$${(result.movableCashCents / 100).toFixed(2)} to ${result.options[0].institution}`,
      expectedImpact: result.impact,
      evidence: result.evidence,
      assumptions: result.assumptions,
      confidenceBand: result.confidenceBand,
      calculationVersion: result.calculationVersion,
      producer: { id: manifest.id, version: manifest.version },
      expiresAt: new Date(now.getTime() + 30 * 24 * 3600_000),
      metadata: {
        dedupeKey,
        inputsFingerprint: {
          movableCashCents: result.movableCashCents,
          bestNetAnnualBenefitCents: result.options[0]?.netAnnualBenefitCents ?? 0,
        },
      },
    });

    return { ran: true, suppressed: false, recommended: true };
  }
}
