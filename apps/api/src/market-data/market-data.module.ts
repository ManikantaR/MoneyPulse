import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { MarketDataController } from './market-data.controller';
import { EiaClient } from './eia.client';
import { FredClient } from './fred.client';
import { StooqClient } from './stooq.client';
import { AlphaVantageClient } from './alphavantage.client';
import { SecurityPricesService } from './security-prices.service';

@Module({
  controllers: [MarketDataController],
  providers: [
    MarketDataService,
    EiaClient,
    FredClient,
    StooqClient,
    AlphaVantageClient,
    SecurityPricesService,
  ],
  exports: [MarketDataService, SecurityPricesService],
})
export class MarketDataModule {}
