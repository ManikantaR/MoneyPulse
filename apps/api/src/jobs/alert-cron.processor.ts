import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AlertEngineService } from '../notifications/alert-engine.service';
import { DigestService } from '../analytics/digest.service';
import { BriefService } from '../analytics/brief.service';
import { BalanceSnapshotService } from '../analytics/balance-snapshot.service';
import { ForecastService } from '../analytics/forecast.service';
import { FreshnessDetectorService } from '../analytics/freshness-detector.service';
import { WatchdogDetectorService } from '../analytics/watchdog-detector.service';
import { MarketInsightDetectorService } from '../analytics/market-insight-detector.service';
import { AdvisorDigestService } from '../advisor/digest/advisor-digest.service';
import { AdvisorReviewService } from '../advisor/review/advisor-review.service';
import { BillsService } from '../bills/bills.service';
import { LoansService } from '../loans/loans.service';
import { MarketDataService } from '../market-data/market-data.service';

const MARKET_DATA_JITTER_MAX_MS = 15 * 60_000; // spread load on the free EIA/FRED tiers

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    private readonly watchdogDetectorService: WatchdogDetectorService,
    private readonly marketInsightDetectorService: MarketInsightDetectorService,
    private readonly advisorDigestService: AdvisorDigestService,
    private readonly advisorReviewService: AdvisorReviewService,
    private readonly billsService: BillsService,
    private readonly loansService: LoansService,
    private readonly marketDataService: MarketDataService,
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

      case 'budget-pace-sweep':
        await this.watchdogDetectorService.checkBudgetPaceAllUsers();
        break;

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

      case 'proactive-advisor-review-weekly':
        await this.advisorReviewService.deliverAllEnabled('weekly');
        break;

      case 'proactive-advisor-review-monthly':
        await this.advisorReviewService.deliverAllEnabled('monthly');
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

      case 'market-data-refresh': {
        // Jitter so this repeatable job doesn't hit EIA/FRED's free-tier rate limits
        // at the exact same second every day. Skipped in tests — a unit test that calls
        // process() directly must never wait on a real timer (up to 15 real minutes).
        if (process.env.NODE_ENV !== 'test') {
          await sleep(Math.floor(Math.random() * MARKET_DATA_JITTER_MAX_MS));
        }
        const result = await this.marketDataService.refreshAll();
        this.logger.log(
          `Market data refresh: ${result.refreshed.length} refreshed, ` +
            `${result.skipped.length} skipped, ${result.failed.length} failed`,
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

      case 'refi-watch':
        await this.marketInsightDetectorService.checkRefiOpportunitiesAllUsers();
        break;

      case 'idle-cash-check':
        await this.marketInsightDetectorService.checkIdleCashAllUsers();
        break;

      case 'fuel-vs-market-check':
        await this.marketInsightDetectorService.checkFuelVsMarketAllUsers();
        break;

      case 'power-vs-market-check':
        await this.marketInsightDetectorService.checkPowerVsMarketAllUsers();
        break;

      case 'gas-dip-check':
        await this.marketInsightDetectorService.checkGasDipAllUsers();
        break;

      default:
        this.logger.warn(`Unknown alert job: ${job.name}`);
    }
  }
}
