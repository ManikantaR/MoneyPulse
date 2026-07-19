import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AlertEngineService } from '../notifications/alert-engine.service';
import { DigestService } from '../analytics/digest.service';
import { BriefService } from '../analytics/brief.service';
import { BalanceSnapshotService } from '../analytics/balance-snapshot.service';
import { ForecastService } from '../analytics/forecast.service';
import { FreshnessDetectorService } from '../analytics/freshness-detector.service';
import { AdvisorDigestService } from '../advisor/digest/advisor-digest.service';
import { BillsService } from '../bills/bills.service';
import { LoansService } from '../loans/loans.service';

@Processor('alerts')
export class AlertCronProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertCronProcessor.name);

  constructor(
    private readonly alertEngine: AlertEngineService,
    private readonly digestService: DigestService,
    private readonly briefService: BriefService,
    private readonly balanceSnapshotService: BalanceSnapshotService,
    private readonly forecastService: ForecastService,
    private readonly freshnessDetectorService: FreshnessDetectorService,
    private readonly advisorDigestService: AdvisorDigestService,
    private readonly billsService: BillsService,
    private readonly loansService: LoansService,
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

      case 'daily-brief-sweep':
        await this.briefService.deliverAllEnabled();
        break;

      case 'advisor-digest-weekly':
        await this.advisorDigestService.deliverAllEnabled();
        break;

      case 'snapshot-all':
        await this.balanceSnapshotService.snapshotAll();
        break;

      case 'cashflow-sweep':
        await this.forecastService.checkAndAlertAll();
        break;

      case 'bills-roll-forward': {
        const { rolled } = await this.billsService.rollForwardOverdueBills();
        this.logger.log(`Bills roll-forward: ${rolled} advanced`);
        break;
      }

      case 'loan-missed-check': {
        const { checked, missed, notified } =
          await this.loansService.checkMissedLoanPayments();
        this.logger.log(
          `Loan missed-check: ${checked} loans, ${missed} missed, ${notified} notified`,
        );
        break;
      }

      case 'freshness-check': {
        const insights = await this.freshnessDetectorService.detectAllFreshness();
        this.logger.log(
          `Freshness check complete: ${insights.length} staleness alerts generated`,
        );
        break;
      }

      default:
        this.logger.warn(`Unknown alert job: ${job.name}`);
    }
  }
}
