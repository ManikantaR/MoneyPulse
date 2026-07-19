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

      // Detect missed loan payments (daily 5:30 AM UTC) — flags a loan whose lender
      // debit didn't show up this cycle.
      this.alertsQueue.upsertJobScheduler(
        'daily-loan-missed-check',
        { pattern: '30 5 * * *' },
        { name: 'loan-missed-check' },
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
