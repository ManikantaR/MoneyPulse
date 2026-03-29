import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  analyticsQuerySchema,
  spendingTrendQuerySchema,
  topMerchantsQuerySchema,
} from '@moneypulse/shared';
import type {
  AnalyticsQuery,
  SpendingTrendQuery,
  TopMerchantsQuery,
  AuthTokenPayload,
} from '@moneypulse/shared';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

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
}
