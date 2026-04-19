import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AlertCronProcessor } from './alert-cron.processor';
import { ReminderProcessor } from './reminder.processor';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'alerts' }),
    BullModule.registerQueue({ name: 'reminders' }),
    NotificationsModule,
  ],
  providers: [AlertCronProcessor, ReminderProcessor],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue('alerts') private readonly alertsQueue: Queue,
    @InjectQueue('reminders') private readonly remindersQueue: Queue,
  ) {}

  async onModuleInit() {
    // Daily budget sweep at 8 AM
    await this.alertsQueue.upsertJobScheduler(
      'daily-budget-check',
      { pattern: '0 8 * * *' },
      { name: 'budget-sweep' },
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
  }
}
