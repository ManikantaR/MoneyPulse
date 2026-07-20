import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { MarketDataController } from './market-data.controller';
import { EiaClient } from './eia.client';
import { FredClient } from './fred.client';

@Module({
  controllers: [MarketDataController],
  providers: [MarketDataService, EiaClient, FredClient],
  exports: [MarketDataService],
})
export class MarketDataModule {}
