import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountFreshnessService } from './account-freshness.service';
import { MarketDataService } from '../market-data/market-data.service';
import {
  MARKET_INSIGHT_THRESHOLDS,
  computeLoanState,
  standardMonthlyPaymentCents,
} from '@moneypulse/shared';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Market-joined insights (11.7) — the payoff of the market data module (11.6): deterministic
 * rules that join market_metrics against the user's OWN loans/balances/spend. Like the 11.5
 * watchdog detectors, these are the sole source of truth for their insight types; AI never
 * decides whether they fire. Run monthly/weekly from `alert-cron.processor.ts`.
 */
@Injectable()
export class MarketInsightDetectorService {
  private readonly logger = new Logger(MarketInsightDetectorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
    private readonly freshnessService: AccountFreshnessService,
    private readonly marketDataService: MarketDataService,
  ) {}

  private async activeUsers(): Promise<Array<{ id: string }>> {
    return this.db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.deletedAt));
  }

  // ── 1. Refi watcher (monthly) ────────────────────────────────

  async checkRefiOpportunitiesAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.checkRefiOpportunities(user.id);
      } catch (err: any) {
        this.logger.error(`Refi check failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  async checkRefiOpportunities(userId: string): Promise<void> {
    const loans = await this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.userId, userId), eq(schema.loans.isActive, true), isNull(schema.loans.deletedAt)));

    if (loans.length === 0) return;

    const mortgageMarket = await this.marketDataService.getLatestWithDeltas('mortgage_30y');

    for (const loan of loans) {
      // Auto loans need a configured benchmark series; skip if none is set (11.6 only
      // ships a mortgage series today, so auto support is env-gated for when one exists).
      const market =
        loan.loanType === 'mortgage'
          ? mortgageMarket
          : loan.loanType === 'auto' && process.env.MARKET_AUTO_RATE_METRIC_KEY
            ? await this.marketDataService.getLatestWithDeltas(process.env.MARKET_AUTO_RATE_METRIC_KEY)
            : null;

      if (!market || market.latestValue == null) continue;

      const loanAprPercent = loan.aprBps / 100;
      const spread = loanAprPercent - market.latestValue;
      if (spread < MARKET_INSIGHT_THRESHOLDS.REFI_SPREAD_THRESHOLD_PP) continue;

      const state = computeLoanState(
        {
          originalBalanceCents: loan.originalBalanceCents,
          aprBps: loan.aprBps,
          scheduledPaymentCents: loan.scheduledPaymentCents,
          startDate: loan.startDate,
        },
        [],
      );
      if (state.currentBalanceCents <= 0) continue;

      const remainingTermMonths = loan.termMonths
        ? Math.max(1, loan.termMonths - state.monthsElapsed)
        : 360 - state.monthsElapsed; // 30-yr default fallback if term wasn't recorded
      if (remainingTermMonths <= 0) continue;

      const marketAprBps = Math.round(market.latestValue * 100);
      const marketPaymentCents = standardMonthlyPaymentCents(
        state.currentBalanceCents,
        marketAprBps,
        remainingTermMonths,
      );
      const savingsCents = loan.scheduledPaymentCents - marketPaymentCents;
      if (savingsCents <= 0) continue;

      // Dedupe per loan per quarter — a persistent spread shouldn't spam monthly.
      const now = new Date();
      const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
      const dedupeKey = `refi_${loan.id}_${now.getUTCFullYear()}-Q${quarter}`;
      if (await this.notificationsService.findByMetadata(userId, dedupeKey)) continue;

      await this.notificationsService.createAndDispatch({
        userId,
        type: 'refi_opportunity',
        source: 'market',
        severity: 'insight',
        title: 'Possible refinance opportunity',
        message: `30-yr avg is ${market.latestValue.toFixed(2)}%, yours (${loan.name}) is ${loanAprPercent.toFixed(2)}% — refi could save ~${formatCents(savingsCents)}/mo.`,
        dedupeKey,
        metadata: {
          dedupeKey,
          loanId: loan.id,
          loanAprPercent,
          marketRatePercent: market.latestValue,
          spreadPercent: spread,
          currentBalanceCents: state.currentBalanceCents,
          remainingTermMonths,
          currentPaymentCents: loan.scheduledPaymentCents,
          marketPaymentCents,
          estimatedMonthlySavingsCents: savingsCents,
        },
      });
    }
  }

  // ── 2. Idle cash (monthly) ───────────────────────────────────

  async checkIdleCashAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.checkIdleCash(user.id);
      } catch (err: any) {
        this.logger.error(`Idle-cash check failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  async checkIdleCash(userId: string): Promise<void> {
    const accounts = await this.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
          sql`${schema.accounts.accountType} IN ('checking', 'savings')`,
        ),
      );
    if (accounts.length === 0) return;

    // Freshness gate (11.2): a stale checking/savings account means the balance can't be
    // trusted, so skip firing entirely rather than risk an incorrect "you have idle cash".
    const overview = await this.freshnessService.getAccountFreshness(userId);
    const staleAccountIds = new Set(
      overview.accounts.filter((a) => a.status === 'stale').map((a) => a.accountId),
    );
    const relevantAccountIds = accounts.map((a: any) => a.id);
    const anyStale = relevantAccountIds.some((id: string) => staleAccountIds.has(id));
    if (anyStale) {
      this.logger.debug(`Idle-cash check skipped for user ${userId}: stale checking/savings balance.`);
      return;
    }

    // Latest balance per relevant account.
    const balanceRows = await this.db.execute(sql`
      SELECT DISTINCT ON (account_id) account_id, balance_cents
      FROM ${schema.accountBalanceSnapshots}
      WHERE account_id = ANY(${relevantAccountIds})
      ORDER BY account_id, snapshot_date DESC
    `);
    const totalBalanceCents = (balanceRows.rows ?? balanceRows).reduce(
      (sum: number, r: any) => sum + Number(r.balance_cents),
      0,
    );

    // Trailing-3-month average monthly expenses (all debit spend, all accounts).
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
    const trailing3MonthTotalCents = Number((expenseRows.rows ?? expenseRows)[0]?.total_cents ?? 0);
    const avgMonthlyExpenseCents = Math.round(trailing3MonthTotalCents / 3);

    const settingsRows = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId));
    const bufferMonths =
      settingsRows[0]?.idleCashBufferMonths ?? MARKET_INSIGHT_THRESHOLDS.IDLE_CASH_BUFFER_MONTHS;
    const bufferCents = avgMonthlyExpenseCents * bufferMonths;

    const idleCents = totalBalanceCents - bufferCents;
    if (idleCents <= 0) return;

    const hysa = await this.marketDataService.getLatestWithDeltas('fed_funds_rate');
    if (hysa.latestValue == null) return;

    const foregoneCentsPerYear = Math.round(idleCents * (hysa.latestValue / 100));
    if (foregoneCentsPerYear < MARKET_INSIGHT_THRESHOLDS.IDLE_CASH_MIN_FOREGONE_CENTS_PER_YEAR) return;

    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const dedupeKey = `idle_cash_${userId}_${periodKey}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'idle_cash',
      source: 'market',
      severity: 'insight',
      title: 'Idle cash could be earning more',
      message: `You're holding ~${formatCents(idleCents)} above your ${bufferMonths}-month buffer — moving it to a HYSA at ~${hysa.latestValue.toFixed(2)}% could earn ~${formatCents(foregoneCentsPerYear)}/yr.`,
      dedupeKey,
      metadata: {
        dedupeKey,
        totalBalanceCents,
        bufferCents,
        idleCents,
        hysaApyPercent: hysa.latestValue,
        foregoneCentsPerYear,
      },
    });
  }

  // ── 3 & 4. Personal vs market fuel/power (monthly) ───────────

  async checkFuelVsMarketAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.checkCategoryVsMarket(user.id, 'fuel_vs_market', 'Fuel', 'gas_retail_regular', 'gas');
      } catch (err: any) {
        this.logger.error(`Fuel-vs-market check failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  async checkPowerVsMarketAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.checkCategoryVsMarket(
          user.id,
          'power_vs_market',
          'Electric',
          'electricity_residential',
          'electricity',
        );
      } catch (err: any) {
        this.logger.error(`Power-vs-market check failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  private async checkCategoryVsMarket(
    userId: string,
    insightType: 'fuel_vs_market' | 'power_vs_market',
    categoryName: string,
    metricKey: string,
    label: string,
  ): Promise<void> {
    const monthTotals = await this.db.execute(sql`
      SELECT
        date_trunc('month', date) AS month,
        SUM(amount_cents)::bigint AS total_cents,
        COUNT(*)::int AS txn_count
      FROM ${schema.transactions} t
      JOIN ${schema.categories} c ON c.id = t.category_id
      WHERE t.user_id = ${userId}
        AND c.name = ${categoryName}
        AND t.is_credit = false
        AND t.is_split_parent = false
        AND t.parent_transaction_id IS NULL
        AND t.deleted_at IS NULL
        AND t.date >= NOW() - INTERVAL '2 months'
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 2
    `);
    const rows = monthTotals.rows ?? monthTotals;
    if (rows.length < 2) return;

    const [current, previous] = rows;
    if (Number(current.txn_count) < MARKET_INSIGHT_THRESHOLDS.FUEL_MIN_TXNS) return;
    if (Number(previous.total_cents) <= 0) return;

    const personalMoMPercent =
      ((Number(current.total_cents) - Number(previous.total_cents)) / Number(previous.total_cents)) * 100;

    const market = await this.marketDataService.getLatestWithDeltas(metricKey);
    if (market.latestValue == null || market.delta4Week == null) return;
    const priorMarketValue = market.latestValue - market.delta4Week;
    if (priorMarketValue <= 0) return;
    const marketMoMPercent = (market.delta4Week / priorMarketValue) * 100;

    const divergence = personalMoMPercent - marketMoMPercent;
    if (Math.abs(divergence) <= MARKET_INSIGHT_THRESHOLDS.FUEL_POWER_DIVERGENCE_PP) return;

    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const dedupeKey = `${insightType}_${userId}_${periodKey}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const cause =
      divergence > 0
        ? `you're using more ${label}, not just paying more for it`
        : `${label} prices moved more than your spending did`;
    const message = `Your ${categoryName} spend is ${pct(personalMoMPercent)} MoM vs the ${pct(marketMoMPercent)} market move — ${cause}.`;

    await this.notificationsService.createAndDispatch({
      userId,
      type: insightType,
      source: 'market',
      severity: 'insight',
      title: insightType === 'fuel_vs_market' ? 'Fuel spend vs market price' : 'Utility spend vs market price',
      message,
      dedupeKey,
      metadata: {
        dedupeKey,
        categoryName,
        personalMoMPercent,
        marketMoMPercent,
        divergencePercent: divergence,
        currentMonthCents: Number(current.total_cents),
        previousMonthCents: Number(previous.total_cents),
        txnCount: Number(current.txn_count),
      },
    });
  }

  // ── 5. Gas dip note (weekly) ──────────────────────────────────

  async checkGasDipAllUsers(): Promise<void> {
    for (const user of await this.activeUsers()) {
      try {
        await this.checkGasDip(user.id);
      } catch (err: any) {
        this.logger.error(`Gas-dip check failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  async checkGasDip(userId: string): Promise<void> {
    const region = this.marketDataService.getGasState();
    const rows = await this.db
      .select()
      .from(schema.marketMetrics)
      .where(and(eq(schema.marketMetrics.metricKey, 'gas_retail_regular'), eq(schema.marketMetrics.region, region)))
      .orderBy(sql`period_date DESC`)
      .limit(2);
    if (rows.length < 2) return;

    const [latest, prior] = rows;
    const latestValue = Number(latest.value);
    const priorValue = Number(prior.value);
    if (priorValue <= 0) return;

    const wowPercent = ((latestValue - priorValue) / priorValue) * 100;
    if (Math.abs(wowPercent) < MARKET_INSIGHT_THRESHOLDS.GAS_WOW_PERCENT) return;

    const dedupeKey = `gas_dip_${userId}_${latest.periodDate}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const direction = wowPercent > 0 ? 'up' : 'down';
    await this.notificationsService.createAndDispatch({
      userId,
      type: 'market_update',
      source: 'market',
      severity: 'insight',
      title: 'Gas price move',
      message: `State gas prices moved ${direction} ${pct(Math.abs(wowPercent))} week-over-week to $${latestValue.toFixed(2)}/gal.`,
      dedupeKey,
      metadata: {
        dedupeKey,
        region,
        latestValue,
        priorValue,
        wowPercent,
        periodDate: latest.periodDate,
      },
    });
  }
}
