import { Module } from '@nestjs/common';
import { RateWatchlistService } from './rate-watchlist.service';
import { RateWatchlistController } from './rate-watchlist.controller';

@Module({
  providers: [RateWatchlistService],
  controllers: [RateWatchlistController],
  exports: [RateWatchlistService],
})
export class RateWatchlistModule {}
