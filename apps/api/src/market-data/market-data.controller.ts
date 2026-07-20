import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MarketDataService } from './market-data.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/** Thin read-only controller — global public market data, any authenticated user. */
@ApiTags('Market Data')
@Controller('market-data')
@UseGuards(JwtAuthGuard)
export class MarketDataController {
  constructor(private readonly marketData: MarketDataService) {}

  @Get()
  @ApiOperation({ summary: 'Latest value + 4-week/12-month deltas for every tracked series' })
  async getAll() {
    return this.marketData.getAllLatest();
  }

  @Get('series')
  @ApiOperation({ summary: 'Latest value + deltas for one series (optional region override)' })
  async getSeries(@Query('metricKey') metricKey: string, @Query('region') region?: string) {
    return this.marketData.getLatestWithDeltas(metricKey, region);
  }
}
