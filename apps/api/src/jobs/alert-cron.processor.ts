import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AlertEngineService } from '../notifications/alert-engine.service';
import { DigestService } from '../analytics/digest.service';
import { BalanceSnapshotService } from '../analytics/balance-snapshot.service';

@Processor('alerts')
export class AlertCronProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertCronProcessor.name);

  constructor(
    private readonly alertEngine: AlertEngineService,
    private readonly digestService: DigestService,
    private readonly balanceSnapshotService: BalanceSnapshotService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing alert job: ${job.name}`);

    switch (job.name) {
      case 'budget-sweep': {
        const alerts = await this.alertEngine.checkBudgets();
        this.logger.log(
          `Budget sweep complete: ${alerts.length} alerts generated`,
        );
        break;
      }

      case 'post-import-check': {
        const userIds = job.data.userIds as string[];
        await this.alertEngine.checkBudgets(userIds);
        break;
      }

      case 'digest-daily':
        await this.digestService.deliverAllEnabled('daily');
        break;

      case 'digest-weekly':
        await this.digestService.deliverAllEnabled('weekly');
        break;

      case 'digest-monthly':
        await this.digestService.deliverAllEnabled('monthly');
        break;

      case 'snapshot-all':
        await this.balanceSnapshotService.snapshotAll();
        break;

      default:
        this.logger.warn(`Unknown alert job: ${job.name}`);
    }
  }
}
