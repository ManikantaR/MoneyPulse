import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  analyticsQuerySchema,
  spendingTrendQuerySchema,
} from '@moneypulse/shared';
import type { AnalyticsQuery, SpendingTrendQuery } from '@moneypulse/shared';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /** Returns monthly income vs expense aggregates. */
  @Get('income-vs-expenses')
  @ApiOperation({ summary: 'Monthly income vs expenses' })
  async incomeVsExpenses(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ) {
    const data = await this.analyticsService.incomeVsExpenses(query);
    return { data };
  }

  /** Returns per-category spend totals with icon/color metadata. */
  @Get('category-breakdown')
  @ApiOperation({ summary: 'Spending by category with totals' })
  async categoryBreakdown(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ) {
    const data = await this.analyticsService.categoryBreakdown(query);
    return { data };
  }

  /** Returns time-series spend at configurable granularity. */
  @Get('spending-trend')
  @ApiOperation({ summary: 'Spending trend over time' })
  async spendingTrend(
    @Query(new ZodValidationPipe(spendingTrendQuerySchema))
    query: SpendingTrendQuery,
  ) {
    const data = await this.analyticsService.spendingTrend(query);
    return { data };
  }

  /** Returns computed balances for all active accounts. */
  @Get('account-balances')
  @ApiOperation({ summary: 'Per-account current balances' })
  async accountBalances(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ) {
    const data = await this.analyticsService.accountBalances(query);
    return { data };
  }

  /** Returns credit card utilization rates (balance / limit). */
  @Get('credit-utilization')
  @ApiOperation({ summary: 'Credit card utilization rates' })
  async creditUtilization() {
    const data = await this.analyticsService.creditUtilization();
    return { data };
  }

  /** Returns net worth snapshot: assets + investments - liabilities. */
  @Get('net-worth')
  @ApiOperation({ summary: 'Net worth snapshot' })
  async netWorth() {
    const data = await this.analyticsService.netWorth();
    return { data };
  }

  /** Returns top merchants ranked by total spend. */
  @Get('top-merchants')
  @ApiOperation({ summary: 'Top merchants by spend' })
  async topMerchants(
    @Query(new ZodValidationPipe(analyticsQuerySchema))
    query: AnalyticsQuery & { limit?: number },
  ) {
    const data = await this.analyticsService.topMerchants(query);
    return { data };
  }
}
