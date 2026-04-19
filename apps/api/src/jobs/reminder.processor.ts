import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';

@Processor('reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing reminder: ${job.name}`);

    switch (job.name) {
      case 'bank-reminder':
        await this.sendBankReminders();
        break;
      case 'investment-reminder':
        await this.sendInvestmentReminders();
        break;
    }
  }

  private async sendBankReminders() {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT a.user_id, a.nickname, a.institution,
        MAX(t.date) AS last_txn_date
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t ON a.id = t.account_id AND t.deleted_at IS NULL
      WHERE a.account_type IN ('checking', 'savings')
        AND a.deleted_at IS NULL
      GROUP BY a.id, a.user_id, a.nickname, a.institution
      HAVING MAX(t.date) < CURRENT_DATE - INTERVAL '7 days'
        OR MAX(t.date) IS NULL
    `);

    for (const row of rows.rows ?? rows) {
      await this.notificationsService.createAndDispatch({
        userId: row.user_id,
        type: 'balance_reminder',
        title: `Update ${row.nickname}`,
        message: `No recent transactions for ${row.nickname} (${row.institution}). Upload a new statement?`,
      });
    }

    this.logger.log(`Sent ${(rows.rows ?? rows).length} bank reminders`);
  }

  private async sendInvestmentReminders() {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ia.user_id, ia.nickname, ia.institution,
        MAX(s.date) AS last_snapshot
      FROM ${schema.investmentAccounts} ia
      LEFT JOIN ${schema.investmentSnapshots} s ON ia.id = s.investment_account_id
      WHERE ia.deleted_at IS NULL
      GROUP BY ia.id, ia.user_id, ia.nickname, ia.institution
      HAVING MAX(s.date) < CURRENT_DATE - INTERVAL '30 days'
        OR MAX(s.date) IS NULL
    `);

    for (const row of rows.rows ?? rows) {
      await this.notificationsService.createAndDispatch({
        userId: row.user_id,
        type: 'balance_reminder',
        title: `Update ${row.nickname}`,
        message: `No recent update for investment account ${row.nickname} (${row.institution}). Add a balance snapshot?`,
      });
    }

    this.logger.log(`Sent ${(rows.rows ?? rows).length} investment reminders`);
  }
}
