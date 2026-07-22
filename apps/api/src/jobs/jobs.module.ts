import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AlertCronProcessor } from './alert-cron.processor';
import { ReminderProcessor } from './reminder.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { SyncModule } from '../sync/sync.module';
import { SyncDeliveryProcessor } from './sync-delivery.processor';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AdvisorModule } from '../advisor/advisor.module';
import { BillsModule } from '../bills/bills.module';
import { LoansModule } from '../loans/loans.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'alerts' }),
    BullModule.registerQueue({ name: 'reminders' }),
    BullModule.registerQueue({ name: 'sync-delivery' }),
    NotificationsModule,
    SyncModule,
    AnalyticsModule,
    AdvisorModule,
    BillsModule,
    LoansModule,
    MarketDataModule,
    RecommendationsModule,
  ],
  providers: [AlertCronProcessor, ReminderProcessor, SyncDeliveryProcessor],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue('alerts') private readonly alertsQueue: Queue,
    @InjectQueue('reminders') private readonly remindersQueue: Queue,
    @InjectQueue('sync-delivery') private readonly syncQueue: Queue,
  ) {}

  async onModuleInit() {
    // Every scheduler/job below targets an independent scheduler id / job name, so they
    // have no ordering dependency on each other — run them concurrently instead of
    // sequentially awaited. 13 sequential Redis round-trips at every app boot (including
    // every e2e test file's boot, since e2e runs the full AppModule) made boot time
    // intermittently exceed the 60s test hook timeout once #98/11.4 added the 13th call
    // (a real, reproducible flake — different e2e file failed on 2/2 retries). Concurrency
    // fixes the marginal latency without changing any scheduling semantics.
    await Promise.all([
      // Daily budget sweep at 8 AM
      this.alertsQueue.upsertJobScheduler(
        'daily-budget-check',
        { pattern: '0 8 * * *' },
        { name: 'budget-sweep' },
      ),

      // Digest sweeps (UTC fixed times — user-local period key handles timezone dedupe)
      this.alertsQueue.upsertJobScheduler(
        'daily-digest',
        { pattern: '0 7 * * *' },
        { name: 'digest-daily' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'weekly-digest',
        { pattern: '0 8 * * 1' },
        { name: 'digest-weekly' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'monthly-digest',
        { pattern: '0 8 1 * *' },
        { name: 'digest-monthly' },
      ),

      // Daily morning brief — runs hourly; BriefService only delivers to users whose
      // local wall-clock hour matches their configured daily_brief_hour (default 7 AM),
      // and dedupes per user-local calendar date, so this is safe to fire every hour.
      this.alertsQueue.upsertJobScheduler(
        'daily-brief-hourly-sweep',
        { pattern: '0 * * * *' },
        { name: 'daily-brief-sweep' },
      ),

      // Proactive weekly advisor recap — Monday 13:00 UTC (~8–9 AM ET), after the
      // basic weekly digest. ISO-week dedupe handles timezone spread.
      this.alertsQueue.upsertJobScheduler(
        'advisor-digest-weekly',
        { pattern: '0 13 * * 1' },
        { name: 'advisor-digest-weekly' },
      ),

      // Proactive advisor reviews (11.9) — a standing, scheduled counterpart to the
      // interactive advisor chat; delivers to the insights feed + Telegram, gated per-user
      // on proactive_advisor_enabled (default OFF). Weekly: Sunday 23:00 UTC (~6–7 PM ET,
      // Sunday evening). Monthly: 1st at 11:00 UTC, after the market-joined 2nd-of-month
      // sweeps so its net-worth/loan figures reflect a settled month.
      this.alertsQueue.upsertJobScheduler(
        'weekly-proactive-advisor-review',
        { pattern: '0 23 * * 0' },
        { name: 'proactive-advisor-review-weekly' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'monthly-proactive-advisor-review',
        { pattern: '0 11 1 * *' },
        { name: 'proactive-advisor-review-monthly' },
      ),

      // Weekly bank balance reminder (Monday 9 AM)
      this.remindersQueue.upsertJobScheduler(
        'weekly-bank',
        { pattern: '0 9 * * 1' },
        { name: 'bank-reminder' },
      ),

      // Monthly investment reminder (1st of month, 9 AM)
      this.remindersQueue.upsertJobScheduler(
        'monthly-investment',
        { pattern: '0 9 1 * *' },
        { name: 'investment-reminder' },
      ),

      // Daily balance snapshots at 1 AM UTC (idempotent upsert — safe to run multiple times)
      this.alertsQueue.upsertJobScheduler(
        'daily-snapshot',
        { pattern: '0 1 * * *' },
        { name: 'snapshot-all' },
      ),

      // Daily cash-flow forecast sweep at 6 AM UTC — checks low-balance projections
      this.alertsQueue.upsertJobScheduler(
        'daily-cashflow-check',
        { pattern: '0 6 * * *' },
        { name: 'cashflow-sweep' },
      ),

      // Roll overdue recurring bills to their next occurrence (daily 5 AM UTC) so
      // "upcoming bills" + forecast stay current.
      this.alertsQueue.upsertJobScheduler(
        'daily-bills-roll-forward',
        { pattern: '0 5 * * *' },
        { name: 'bills-roll-forward' },
      ),

      // Watchdog budget-pace sweep (11.5) — daily 7 AM UTC, distinct from the
      // 80%/100% actual-spend alerts in alert-engine.service.ts.
      this.alertsQueue.upsertJobScheduler(
        'daily-budget-pace-sweep',
        { pattern: '0 7 * * *' },
        { name: 'budget-pace-sweep' },
      ),

      // Detect missed loan payments (daily 5:30 AM UTC) — flags a loan whose lender
      // debit didn't show up this cycle.
      this.alertsQueue.upsertJobScheduler(
        'daily-loan-missed-check',
        { pattern: '30 5 * * *' },
        { name: 'loan-missed-check' },
      ),

      // Market data refresh (11.6) — daily 9 AM UTC; the processor adds random jitter
      // (up to 15min) before calling out, and MarketDataService itself skips any series
      // whose cadence means it isn't due yet (a weekly EIA series isn't refetched daily).
      this.alertsQueue.upsertJobScheduler(
        'daily-market-data-refresh',
        { pattern: '0 9 * * *' },
        { name: 'market-data-refresh' },
      ),

      // Security price refresh (12.2) — daily 9:15 AM UTC, only for tickers actually
      // held (never the whole market). Stooq primary, Alpha Vantage fallback for
      // mutual-fund NAVs; jitter added in the processor per the 11.6 pattern.
      this.alertsQueue.upsertJobScheduler(
        'daily-security-prices-refresh',
        { pattern: '15 9 * * *' },
        { name: 'security-prices-refresh' },
      ),

      // Market-joined insights (11.7) — monthly detectors run on the 2nd (after the
      // 1st-of-month market-data-adjacent digests) at staggered hours so they don't all
      // hammer the DB/notification pipeline at once; the weekly gas-dip note runs Mondays.
      this.alertsQueue.upsertJobScheduler(
        'monthly-refi-watch',
        { pattern: '0 10 2 * *' },
        { name: 'refi-watch' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'monthly-idle-cash-check',
        { pattern: '15 10 2 * *' },
        { name: 'idle-cash-check' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'monthly-fuel-vs-market-check',
        { pattern: '30 10 2 * *' },
        { name: 'fuel-vs-market-check' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'monthly-power-vs-market-check',
        { pattern: '45 10 2 * *' },
        { name: 'power-vs-market-check' },
      ),
      this.alertsQueue.upsertJobScheduler(
        'weekly-gas-dip-check',
        { pattern: '0 11 * * 1' },
        { name: 'gas-dip-check' },
      ),

      // 12.5 Cash Manager — monthly on the 2nd at 11:00 UTC (after the other monthly
      // market-joined sweeps above). Event-triggered re-runs (benchmark rate move
      // >=25bps, liquid-balance move >=20%) are fired ad hoc by the callers that detect
      // those events via `alertsQueue.add('cash-manager-check', ...)`, not by a scheduler.
      this.alertsQueue.upsertJobScheduler(
        'monthly-cash-manager-check',
        { pattern: '0 11 2 * *' },
        { name: 'cash-manager-check' },
      ),

      // Frequent sync delivery sweep for outbox events.
      this.syncQueue.upsertJobScheduler(
        'sync-delivery-sweep',
        { every: 30000 },
        { name: 'deliver-pending-sync' },
      ),
    ]);

    // Also run bills-roll-forward and loan-missed-check once now to fix stale data.
    // Sequenced after the schedulers above are registered (not interdependent, but keeps
    // the "run once now" intent readable) — these are the only two immediate-fire jobs.
    await Promise.all([
      this.alertsQueue.add('bills-roll-forward', {}, { removeOnComplete: true }),
      this.alertsQueue.add('loan-missed-check', {}, { removeOnComplete: true }),
    ]);
  }
}
