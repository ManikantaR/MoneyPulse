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
import { ShortfallDetectorService } from './shortfall-detector.service';
import { StatementScheduleService } from './statement-schedule.service';
import { StatementScheduleController } from './statement-schedule.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountsModule } from '../accounts/accounts.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { BillsModule } from '../bills/bills.module';
import { LoansModule } from '../loans/loans.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [NotificationsModule, CategorizationModule, BillsModule, LoansModule, MarketDataModule, AiLogsModule, AccountsModule],
  providers: [AnalyticsService, AnomalyDetectorService, DigestService, BriefService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService, WatchdogDetectorService, MarketInsightDetectorService, BudgetPlanService, ShortfallDetectorService, StatementScheduleService],
  controllers: [AnalyticsController, DigestController, StatementScheduleController],
  exports: [AnalyticsService, AnomalyDetectorService, DigestService, BriefService, BalanceSnapshotService, ForecastService, AccountFreshnessService, FreshnessDetectorService, WatchdogDetectorService, MarketInsightDetectorService, BudgetPlanService, ShortfallDetectorService, StatementScheduleService],
})
export class AnalyticsModule {}
