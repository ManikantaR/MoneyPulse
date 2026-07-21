import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { ForecastService } from './forecast.service';
import { AccountFreshnessService } from './account-freshness.service';
import { BudgetPlanService } from './budget-plan.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  analyticsQuerySchema,
  spendingTrendQuerySchema,
  topMerchantsQuerySchema,
  forecastQuerySchema,
  savingsRateQuerySchema,
  budgetPlanQuerySchema,
} from '@moneypulse/shared';
import type {
  AnalyticsQuery,
  SpendingTrendQuery,
  TopMerchantsQuery,
  ForecastQuery,
  SavingsRateQuery,
  BudgetPlanQuery,
  AuthTokenPayload,
} from '@moneypulse/shared';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly balanceSnapshotService: BalanceSnapshotService,
    private readonly forecastService: ForecastService,
    private readonly accountFreshnessService: AccountFreshnessService,
    private readonly budgetPlanService: BudgetPlanService,
  ) {}

  /**
   * GET /analytics/income-vs-expenses — Monthly income vs expense aggregates.
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated date/account/household filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ month, incomeCents, expenseCents }> }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('income-vs-expenses')
  @ApiOperation({ summary: 'Monthly income vs expenses' })
  async incomeVsExpenses(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.incomeVsExpenses(
      user.sub,
      query,
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/category-breakdown — Per-category spend totals with icon/color metadata.
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated date/account/household filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ categoryId, categoryName, totalCents, percentage, ... }> }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('category-breakdown')
  @ApiOperation({ summary: 'Spending by category with totals' })
  async categoryBreakdown(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.categoryBreakdown(
      user.sub,
      query,
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/spending-trend — Time-series spend at configurable granularity.
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated granularity/date/account/household filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ period, income, expenses }> }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('spending-trend')
  @ApiOperation({ summary: 'Spending trend over time' })
  async spendingTrend(
    @Query(new ZodValidationPipe(spendingTrendQuerySchema))
    query: SpendingTrendQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.spendingTrend(
      user.sub,
      query,
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/account-balances — Computed balances for all active accounts.
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated date/account/household filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ accountId, nickname, institution, accountType, balanceCents }> }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('account-balances')
  @ApiOperation({ summary: 'Per-account current balances' })
  async accountBalances(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.accountBalances(
      user.sub,
      query,
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/credit-utilization — Credit card utilization rates (balance / limit).
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated household filter parameter.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ accountId, nickname, balanceCents, limitCents, utilizationPercent }> }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('credit-utilization')
  @ApiOperation({ summary: 'Credit card utilization rates' })
  async creditUtilization(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.creditUtilization(
      user.sub,
      { household: query.household },
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/net-worth — Net worth snapshot: assets + investments - liabilities.
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated household filter parameter.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: { assets, liabilities, investments, netWorth } }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('net-worth')
  @ApiOperation({ summary: 'Net worth snapshot' })
  async netWorth(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.netWorth(
      user.sub,
      { household: query.household },
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/net-worth-deltas — 30/90/365-day net-worth deltas from stored snapshots.
   *
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: { current, delta30, delta90, delta365 } }`
   */
  @Get('net-worth-deltas')
  @ApiOperation({ summary: 'Net worth deltas (30/90/365 day)' })
  async netWorthDeltas(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.analyticsService.netWorthDeltas(user.sub);
    return { data };
  }

  /**
   * GET /analytics/savings-rate — Trailing monthly savings rate series `(income - expenses) / income`.
   *
   * @param query - Validated household filter + optional `months` window.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: { current, series } }`
   */
  @Get('savings-rate')
  @ApiOperation({ summary: 'Savings rate (trailing monthly series)' })
  async savingsRate(
    @Query(new ZodValidationPipe(savingsRateQuerySchema)) query: SavingsRateQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.savingsRate(
      user.sub,
      { months: query.months, household: query.household },
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/cash-runway — Liquid balances / trailing-3-month avg expenses, in months.
   *
   * @param query - Validated household filter parameter.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: { liquidCents, avgMonthlyExpenseCents, months } }`
   */
  @Get('cash-runway')
  @ApiOperation({ summary: 'Cash runway in months' })
  async cashRunway(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.cashRunway(
      user.sub,
      { household: query.household },
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/yoy-comparison — This-month vs same-month-last-year by category.
   * Returns `insufficientHistory: true` gracefully when <12 months of data exist.
   *
   * @param query - Validated household filter parameter.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: { insufficientHistory, monthsAvailable, categories } }`
   */
  @Get('yoy-comparison')
  @ApiOperation({ summary: 'Year-over-year comparison by category' })
  async yoyComparison(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.yoyComparison(
      user.sub,
      { household: query.household },
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/subscription-total — Monthly recurring subscription total + 12-month trend.
   *
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: { monthlyTotalCents, activeCount, trend } }`
   */
  @Get('subscription-total')
  @ApiOperation({ summary: 'Monthly subscription total + trend' })
  async subscriptionTotal(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.analyticsService.subscriptionTotal(user.sub);
    return { data };
  }

  /**
   * GET /analytics/top-merchants — Top merchants ranked by total spend.
   * Scoped to the authenticated user or their household.
   *
   * @param query - Validated date/account/limit/household filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ merchantName, totalCents, transactionCount }> }`
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('top-merchants')
  @ApiOperation({ summary: 'Top merchants by spend' })
  async topMerchants(
    @Query(new ZodValidationPipe(topMerchantsQuerySchema))
    query: TopMerchantsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.topMerchants(
      user.sub,
      query,
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/budget-progress — Budget vs actual spending per category.
   * Defaults to current month when no date range is specified.
   *
   * @param query - Validated date/account/household filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<BudgetProgressItem> }` sorted by spentCents descending.
   */
  @Get('budget-progress')
  @ApiOperation({ summary: 'Budget vs actual progress per category' })
  async budgetProgress(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.analyticsService.budgetProgress(
      user.sub,
      query,
      user.householdId,
    );
    return { data };
  }

  /**
   * GET /analytics/balance-history — Time series of account balance snapshots.
   * Returns per-account series when accountId is provided, otherwise sums all accounts.
   *
   * @param query - Validated date/account filter parameters.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: Array<{ date: string, balanceCents: number }> }` ordered by date.
   */
  @Get('balance-history')
  @ApiOperation({ summary: 'Account balance history from daily snapshots' })
  async balanceHistory(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.balanceSnapshotService.history(user.sub, {
      accountId: query.accountId,
      from: query.from,
      to: query.to,
    });
    return { data };
  }

  /**
   * GET /analytics/forecast?days= — Project account balances for the next 30/60/90 days.
   * Uses recurring bills + average daily net spend to project each account and combined net-worth.
   *
   * @param query - Validated days parameter (30, 60, or 90).
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: ForecastResult }` with per-account series, net-worth series, and alerts.
   */
  @Get('forecast')
  @ApiOperation({ summary: 'Cash-flow forecast for the next 30/60/90 days' })
  async forecast(
    @Query(new ZodValidationPipe(forecastQuerySchema)) query: ForecastQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.forecastService.forecast(user.sub, query.days);
    return { data };
  }

  /**
   * GET /analytics/freshness — Data freshness status for all active accounts.
   * Returns per-account freshness status and overall coverage metrics.
   *
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: FreshnessOverview }` with per-account status and coverage summary.
   * @throws {UnauthorizedException} If the request is not authenticated.
   */
  @Get('freshness')
  @ApiOperation({ summary: 'Data freshness status for all accounts' })
  async freshness(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.accountFreshnessService.getAccountFreshness(
      user.sub,
    );
    return { data };
  }

  /**
   * GET /analytics/budget-plan?month=YYYY-MM — 50/30/20 (Needs/Wants/Savings) budget
   * plan for the given month against the paycheck profile in effect that month.
   *
   * @param query - Validated `month` (YYYY-MM) query parameter.
   * @param user - JWT token payload containing user identity.
   * @returns `{ data: BudgetPlanResult }` — `hasProfile: false` when no paycheck
   *   profile exists yet as of that month.
   */
  @Get('budget-plan')
  @ApiOperation({ summary: '50/30/20 budget plan for a given month' })
  async budgetPlan(
    @Query(new ZodValidationPipe(budgetPlanQuerySchema)) query: BudgetPlanQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const data = await this.budgetPlanService.budgetPlan(user.sub, query.month);
    return { data };
  }
}
