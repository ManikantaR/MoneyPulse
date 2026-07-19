import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';
import { WATCHDOG_THRESHOLDS } from '@moneypulse/shared';

/** Absolute floor for the flat large-debit fallback (used when we lack merchant history). */
const LARGE_DEBIT_THRESHOLD_CENTS = 50_000; // $500.00

/** Trailing window used to build a merchant's spending baseline. */
const BASELINE_WINDOW_MONTHS = 6;

/**
 * Minimum number of prior transactions before WatchdogDetectorService's
 * `stat_anomaly` z-score rule is trusted — kept in sync with that detector's
 * own threshold so this flat fallback defers to it at exactly the point it
 * takes over, with no coverage gap in between.
 */
const MIN_HISTORY = WATCHDOG_THRESHOLDS.STAT_ANOMALY_MIN_SAMPLES;

interface MerchantStats {
  avgCents: number;
  stddevCents: number;
  count: number;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

@Injectable()
export class AnomalyDetectorService {
  private readonly logger = new Logger(AnomalyDetectorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Run anomaly checks on newly-inserted transactions.
   * Designed to be called post-import; never throws — all errors are logged.
   */
  async detectAnomalies(userId: string, transactionIds: string[]): Promise<void> {
    for (const txnId of transactionIds) {
      try {
        await this.checkTransaction(userId, txnId);
      } catch (err: any) {
        this.logger.error(`Anomaly check failed for txn ${txnId}: ${err.message}`, err.stack);
      }
    }
  }

  private async checkTransaction(userId: string, txnId: string): Promise<void> {
    const [txn] = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, txnId),
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.deletedAt),
        ),
      )
      .limit(1);

    if (!txn) return;

    // Skip income/refunds, split parents, and split children
    if (txn.isCredit) return;
    if (txn.isSplitParent) return;
    if (txn.parentTransactionId) return;

    const merchantKey = txn.normalizedMerchantName ?? txn.merchantName;

    // Build the merchant baseline once and share it across the large-debit check.
    // NOTE: the amount-anomaly (z-score) and duplicate-charge rules that used to
    // live here have been absorbed into WatchdogDetectorService's `stat_anomaly`
    // and `duplicate_charge` detectors (11.5) — do not re-add them here, or the
    // same condition will fire two insights instead of one.
    const stats = merchantKey ? await this.merchantStats(userId, txn, merchantKey) : null;

    await this.checkLargeDebit(userId, txn, merchantKey, stats);
  }

  /**
   * Trailing-window mean/stddev/count of prior debits at the same merchant.
   * Excludes the transaction under test, credits, and split parents/children.
   */
  private async merchantStats(
    userId: string,
    txn: any,
    merchantKey: string,
  ): Promise<MerchantStats | null> {
    const rows = await this.db.execute(sql`
      SELECT
        AVG(amount_cents)::float                       AS avg_cents,
        COALESCE(STDDEV_POP(amount_cents), 0)::float   AS stddev_cents,
        COUNT(*)::int                                  AS txn_count
      FROM ${schema.transactions}
      WHERE user_id              = ${userId}
        AND COALESCE(normalized_merchant_name, merchant_name) = ${merchantKey}
        AND is_credit            = false
        AND is_split_parent      = false
        AND parent_transaction_id IS NULL
        AND deleted_at           IS NULL
        AND id                  != ${txn.id}
        AND date >= NOW() - (${BASELINE_WINDOW_MONTHS} || ' months')::interval
    `);

    const row = (rows.rows ?? rows)[0];
    if (!row) return null;

    const count = Number(row.txn_count) || 0;
    if (count === 0) return null;

    return {
      avgCents: parseFloat(row.avg_cents),
      stddevCents: parseFloat(row.stddev_cents) || 0,
      count,
    };
  }

  /**
   * Large-debit fallback. Only fires when we lack the history to judge
   * whether a big charge is normal for the merchant — when we DO have enough
   * history, WatchdogDetectorService's `stat_anomaly` z-score rule is the sole
   * judge, so normal recurring large charges (rent, mortgage, utilities) don't
   * also generate "large purchase" noise here.
   */
  private async checkLargeDebit(
    userId: string,
    txn: any,
    merchantKey: string | null,
    stats: MerchantStats | null,
  ): Promise<void> {
    if (txn.amountCents < LARGE_DEBIT_THRESHOLD_CENTS) return;

    // Enough history to judge normality → defer to the z-score rule; don't
    // double-alert on the flat threshold.
    if (stats && stats.count >= MIN_HISTORY) return;

    const dedupeKey = `anomaly_large_${txn.id}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const label = merchantKey ?? txn.description ?? 'unknown merchant';
    await this.notificationsService.createAndDispatch({
      userId,
      type: 'spending_anomaly',
      title: 'Large purchase detected',
      message: `Large purchase: ${formatCents(txn.amountCents)} at ${label}.`,
      dedupeKey,
      metadata: { dedupeKey, transactionId: txn.id, rule: 'large_debit', amountCents: txn.amountCents },
    });
  }
}
