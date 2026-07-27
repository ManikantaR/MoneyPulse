import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
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
import { SecurityPricesService } from '../market-data/security-prices.service';
import { CashManagerService } from '../recommendations/cash-manager.service';
import { InvestmentCoachService } from '../recommendations/investment-coach.service';
import { SavingsCoachService } from '../recommendations/savings-coach.service';
import { RateWatchlistService } from '../rate-watchlist/rate-watchlist.service';
import { MonthlyCloseService } from '../monthly-close/monthly-close.service';

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
    private readonly securityPricesService: SecurityPricesService,
    private readonly cashManagerService: CashManagerService,
    private readonly investmentCoachService: InvestmentCoachService,
    private readonly savingsCoachService: SavingsCoachService,
    private readonly rateWatchlistService: RateWatchlistService,
    private readonly monthlyCloseService: MonthlyCloseService,
    @InjectQueue('alerts') private readonly alertsQueue: Queue,
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

      case 'snapshot-all': {
        await this.balanceSnapshotService.snapshotAll();

        // Cash Manager event trigger leg 2 (manifest: "liquid-balance-move(>=20%)") —
        // compare each user's latest liquid-balance snapshot to their prior one now
        // that today's snapshot has just been written, and re-run Cash Manager (which
        // applies its own normal suppression) for any user who crossed the threshold.
        const movedUserIds = await this.cashManagerService.findUsersWithLiquidBalanceMove();
        if (movedUserIds.length > 0) {
          await this.alertsQueue.add(
            'cash-manager-check',
            { userIds: movedUserIds },
            { removeOnComplete: true },
          );
          this.logger.log(
            `Liquid balance move >=20% detected for ${movedUserIds.length} user(s) — queued ad hoc cash-manager-check`,
          );
        }
        break;
      }

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

        // 12.3 — keep Treasury-sourced rate-watchlist rows current automatically now
        // that fresh treasury_bill_* values (if any) have just been stored.
        const syncResult = await this.rateWatchlistService.syncTreasuryRowsForAllUsers();
        this.logger.log(`Treasury watchlist auto-sync: ${syncResult.usersSynced} user(s) synced`);

        // Cash Manager event trigger leg 1 (manifest: "benchmark-rate-move(>=25bps)").
        const benchmarkMoved = await this.cashManagerService.checkBenchmarkRateMove(
          result.refreshed,
        );
        if (benchmarkMoved) {
          await this.alertsQueue.add('cash-manager-check', {}, { removeOnComplete: true });
          this.logger.log(
            'Benchmark rate move >=25bps detected — queued ad hoc cash-manager-check',
          );
        }
        break;
      }

      case 'security-prices-refresh': {
        // Same jitter rationale as market-data-refresh (11.6) — Alpha Vantage's
        // free tier is rate-limited, so avoid every daily run hitting it in the
        // same second. Skipped in tests for the same reason as above.
        if (process.env.NODE_ENV !== 'test') {
          await sleep(Math.floor(Math.random() * MARKET_DATA_JITTER_MAX_MS));
        }
        const result = await this.securityPricesService.refreshAll();
        this.logger.log(
          `Security price refresh: ${result.refreshed.length} refreshed, ` +
            `${result.failed.length} failed`,
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

      // 12.5 Cash Manager: monthly schedule (this job name, no data -> all active users)
      // + event triggers (benchmark rate move >=25bps -> all users, since the benchmark
      // is global; liquid-balance move >=20% -> only the affected `userIds`) fired ad hoc
      // by the 'market-data-refresh'/'snapshot-all' cases above via the same job name.
      case 'cash-manager-check': {
        const userIds = Array.isArray(job.data?.userIds) ? job.data.userIds : undefined;
        await this.cashManagerService.runForAllUsers(userIds);
        break;
      }

      // 12.6 Investment Coach — monthly, after month-end.
      case 'investment-coach-check':
        await this.investmentCoachService.runForAllUsers();
        break;

      // 12.7 Savings Coach — monthly, after the daily watchdog sweep has produced
      // price_creep/fee_detected observations for it to compose into dollar impacts.
      case 'savings-coach-check':
        await this.savingsCoachService.runForAllUsers();
        break;

      // 13.5 Monthly Close auto-draft — creates/refreshes the previous month's draft
      // for every active user, backfilling history on first run.
      case 'monthly-close-auto-draft': {
        const result = await this.monthlyCloseService.runAutoDraftForAllUsers();
        this.logger.log(
          `Monthly-close auto-draft: ${result.usersProcessed} user(s) processed, ${result.closesCreated} close(s) created`,
        );
        break;
      }

      default:
        this.logger.warn(`Unknown alert job: ${job.name}`);
    }
  }
}
