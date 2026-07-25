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
import { WatchdogDetectorService } from './watchdog-detector.service';
import { MarketInsightDetectorService } from './market-insight-detector.service';
import { BudgetPlanService } from './budget-plan.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { BillsModule } from '../bills/bills.module';
import { LoansModule } from '../loans/loans.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [NotificationsModule, CategorizationModule, BillsModule, LoansModule, MarketDataModule, AiLogsModule],
  providers: [AnalyticsService, AnomalyDetectorService, DigestService, BriefService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService, WatchdogDetectorService, MarketInsightDetectorService, BudgetPlanService],
  controllers: [AnalyticsController, DigestController],
  exports: [AnalyticsService, AnomalyDetectorService, DigestService, BriefService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService, WatchdogDetectorService, MarketInsightDetectorService, BudgetPlanService],
})
export class AnalyticsModule {}
