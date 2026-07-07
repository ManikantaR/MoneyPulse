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
    // Daily budget sweep at 8 AM
    await this.alertsQueue.upsertJobScheduler(
      'daily-budget-check',
      { pattern: '0 8 * * *' },
      { name: 'budget-sweep' },
    );

    // Digest sweeps (UTC fixed times — user-local period key handles timezone dedupe)
    await this.alertsQueue.upsertJobScheduler(
      'daily-digest',
      { pattern: '0 7 * * *' },
      { name: 'digest-daily' },
    );
    await this.alertsQueue.upsertJobScheduler(
      'weekly-digest',
      { pattern: '0 8 * * 1' },
      { name: 'digest-weekly' },
    );
    await this.alertsQueue.upsertJobScheduler(
      'monthly-digest',
      { pattern: '0 8 1 * *' },
      { name: 'digest-monthly' },
    );

    // Proactive weekly advisor recap — Monday 13:00 UTC (~8–9 AM ET), after the
    // basic weekly digest. ISO-week dedupe handles timezone spread.
    await this.alertsQueue.upsertJobScheduler(
      'advisor-digest-weekly',
      { pattern: '0 13 * * 1' },
      { name: 'advisor-digest-weekly' },
    );

    // Weekly bank balance reminder (Monday 9 AM)
    await this.remindersQueue.upsertJobScheduler(
      'weekly-bank',
      { pattern: '0 9 * * 1' },
      { name: 'bank-reminder' },
    );

    // Monthly investment reminder (1st of month, 9 AM)
    await this.remindersQueue.upsertJobScheduler(
      'monthly-investment',
      { pattern: '0 9 1 * *' },
      { name: 'investment-reminder' },
    );

    // Daily balance snapshots at 1 AM UTC (idempotent upsert — safe to run multiple times)
    await this.alertsQueue.upsertJobScheduler(
      'daily-snapshot',
      { pattern: '0 1 * * *' },
      { name: 'snapshot-all' },
    );

    // Daily cash-flow forecast sweep at 6 AM UTC — checks low-balance projections
    await this.alertsQueue.upsertJobScheduler(
      'daily-cashflow-check',
      { pattern: '0 6 * * *' },
      { name: 'cashflow-sweep' },
    );

    // Roll overdue recurring bills to their next occurrence (daily 5 AM UTC) so
    // "upcoming bills" + forecast stay current. Also run once now to fix stale data.
    await this.alertsQueue.upsertJobScheduler(
      'daily-bills-roll-forward',
      { pattern: '0 5 * * *' },
      { name: 'bills-roll-forward' },
    );
    await this.alertsQueue.add('bills-roll-forward', {}, { removeOnComplete: true });

    // Detect missed loan payments (daily 5:30 AM UTC) — flags a loan whose lender
    // debit didn't show up this cycle. Also run once now.
    await this.alertsQueue.upsertJobScheduler(
      'daily-loan-missed-check',
      { pattern: '30 5 * * *' },
      { name: 'loan-missed-check' },
    );
    await this.alertsQueue.add('loan-missed-check', {}, { removeOnComplete: true });

    // Frequent sync delivery sweep for outbox events.
    await this.syncQueue.upsertJobScheduler(
      'sync-delivery-sweep',
      { every: 30000 },
      { name: 'deliver-pending-sync' },
    );
  }
}
