import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { DigestService } from './digest.service';
import { DigestController } from './digest.controller';
import { BriefService } from './brief.service';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { ForecastService } from './forecast.service';
import { AccountFreshnessService } from './account-freshness.service';
import { FreshnessDetectorService } from './freshness-detector.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { BillsModule } from '../bills/bills.module';
import { LoansModule } from '../loans/loans.module';

@Module({
  imports: [NotificationsModule, CategorizationModule, BillsModule, LoansModule],
  providers: [AnalyticsService, AnomalyDetectorService, DigestService, BriefService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService],
  controllers: [AnalyticsController, DigestController],
  exports: [AnalyticsService, AnomalyDetectorService, DigestService, BriefService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService],
})
export class AnalyticsModule {}
