import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { HealthModule } from './health/health.module';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { CategoriesModule } from './categories/categories.module';
import { CategorizationModule } from './categorization/categorization.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BudgetsModule } from './budgets/budgets.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { JobsModule } from './jobs/jobs.module';
import { AiLogsModule } from './ai-logs/ai-logs.module';
import { SyncModule } from './sync/sync.module';
import { BillsModule } from './bills/bills.module';
import { LoansModule } from './loans/loans.module';
import { PaycheckProfilesModule } from './paycheck-profiles/paycheck-profiles.module';
import { CarAffordabilityModule } from './car-affordability/car-affordability.module';
import { CollegePlannerModule } from './college-planner/college-planner.module';
import { InvestmentsModule } from './investments/investments.module';
import { AdvisorModule } from './advisor/advisor.module';
import { MarketDataModule } from './market-data/market-data.module';
import { RateWatchlistModule } from './rate-watchlist/rate-watchlist.module';
import { SuitabilitySettingsModule } from './suitability-settings/suitability-settings.module';
import { ManualAssetsModule } from './monthly-close/manual-assets.module';
import { MonthlyCloseModule } from './monthly-close/monthly-close.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    DbModule,
    RedisModule,
    AuditModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    TransactionsModule,
    IngestionModule,
    CategoriesModule,
    CategorizationModule,
    AnalyticsModule,
    BudgetsModule,
    NotificationsModule,
    RecommendationsModule,
    SyncModule,
    JobsModule,
    AiLogsModule,
    BillsModule,
    LoansModule,
    PaycheckProfilesModule,
    CarAffordabilityModule,
    CollegePlannerModule,
    InvestmentsModule,
    AdvisorModule,
    MarketDataModule,
    RateWatchlistModule,
    SuitabilitySettingsModule,
    ManualAssetsModule,
    MonthlyCloseModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
