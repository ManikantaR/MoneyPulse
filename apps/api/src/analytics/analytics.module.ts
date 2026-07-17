import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { DigestService } from './digest.service';
import { DigestController } from './digest.controller';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { ForecastService } from './forecast.service';
import { AccountFreshnessService } from './account-freshness.service';
import { FreshnessDetectorService } from './freshness-detector.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [NotificationsModule, CategorizationModule],
  providers: [AnalyticsService, AnomalyDetectorService, DigestService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService],
  controllers: [AnalyticsController, DigestController],
  exports: [AnalyticsService, AnomalyDetectorService, DigestService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService],
})
export class AnalyticsModule {}
