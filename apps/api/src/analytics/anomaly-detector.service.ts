import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';

/** Absolute floor for the flat large-debit fallback (used when we lack merchant history). */
const LARGE_DEBIT_THRESHOLD_CENTS = 50_000; // $500.00

/** Trailing window used to build a merchant's spending baseline. */
const BASELINE_WINDOW_MONTHS = 6;

/** Minimum number of prior transactions before a statistical baseline is trusted. */
const MIN_HISTORY = 5;

/** How many standard deviations above the mean counts as an outlier. */
const Z_THRESHOLD = 3;

/**
 * Minimum absolute amount above the mean before we bother flagging, so low-value
 * merchants (a $2 coffee that becomes $8) don't generate noise despite a high z-score.
 */
const MIN_ABS_DELTA_CENTS = 2_500; // $25.00

interface MerchantStats {
  avgCents: number;
  stddevCents: number;
  count: number;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Effective standard deviation used for the z-score. Floored to 10% of the mean
 * (and at least 1 cent) so perfectly-recurring charges (σ ≈ 0) still require a
 * meaningful jump — ~30% above normal at Z_THRESHOLD=3 — rather than flagging on
 * a single cent of drift.
 */
function effectiveStddev(stats: MerchantStats): number {
  return Math.max(stats.stddevCents, stats.avgCents * 0.1, 1);
}

/** z-score of an amount against a merchant baseline. */
function zScore(amountCents: number, stats: MerchantStats): number {
  return (amountCents - stats.avgCents) / effectiveStddev(stats);
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

    // Build the merchant baseline once and share it across the amount/large checks.
    const stats = merchantKey ? await this.merchantStats(userId, txn, merchantKey) : null;

    // Run checks sequentially to avoid dedupe race conditions on shared keys
    await this.checkAmountAnomaly(userId, txn, merchantKey, stats);
    await this.checkDuplicate(userId, txn, merchantKey);
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
   * Rule 1: Flag when this debit is a statistical outlier for the merchant —
   * at least Z_THRESHOLD standard deviations above the trailing mean, with a
   * minimum absolute delta so low-value merchants don't generate noise.
   * Requires MIN_HISTORY prior transactions.
   */
  private async checkAmountAnomaly(
    userId: string,
    txn: any,
    merchantKey: string | null,
    stats: MerchantStats | null,
  ): Promise<void> {
    if (!merchantKey || !stats) return;
    if (stats.count < MIN_HISTORY) return;

    const delta = txn.amountCents - stats.avgCents;
    if (delta <= MIN_ABS_DELTA_CENTS) return;
    if (zScore(txn.amountCents, stats) < Z_THRESHOLD) return;

    const dedupeKey = `anomaly_amount_${txn.id}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'spending_anomaly',
      title: 'Unusual spend detected',
      message: `Unusual spend at ${merchantKey}: ${formatCents(txn.amountCents)} — well above your usual ${formatCents(Math.round(stats.avgCents))}.`,
      dedupeKey,
      metadata: {
        dedupeKey,
        transactionId: txn.id,
        rule: 'amount_anomaly',
        amountCents: txn.amountCents,
        avgCents: Math.round(stats.avgCents),
        zScore: Number(zScore(txn.amountCents, stats).toFixed(2)),
      },
    });
  }

  /**
   * Rule 2: Flag if another transaction exists with the same account + similar
   * amount (within 5%) + same merchant + within 24 hours.
   */
  private async checkDuplicate(
    userId: string,
    txn: any,
    merchantKey: string | null,
  ): Promise<void> {
    if (!merchantKey) return;

    const dedupeKey = `anomaly_dup_${txn.id}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const tolerance = Math.round(txn.amountCents * 0.05);
    const dateStr = txn.date instanceof Date ? txn.date.toISOString() : txn.date;

    const rows = await this.db.execute(sql`
      SELECT id FROM ${schema.transactions}
      WHERE account_id = ${txn.accountId}
        AND ABS(amount_cents - ${txn.amountCents}) <= ${tolerance}
        AND COALESCE(normalized_merchant_name, merchant_name) = ${merchantKey}
        AND date BETWEEN ${dateStr}::timestamptz - INTERVAL '1 day'
                     AND ${dateStr}::timestamptz + INTERVAL '1 day'
        AND id        != ${txn.id}
        AND is_credit  = false
        AND deleted_at IS NULL
      LIMIT 1
    `);

    if ((rows.rows ?? rows).length === 0) return;

    const dateLabel = new Date(txn.date).toLocaleDateString();
    await this.notificationsService.createAndDispatch({
      userId,
      type: 'spending_anomaly',
      title: 'Possible duplicate transaction',
      message: `Possible duplicate: ${formatCents(txn.amountCents)} at ${merchantKey} on ${dateLabel}.`,
      dedupeKey,
      metadata: { dedupeKey, transactionId: txn.id, rule: 'duplicate', amountCents: txn.amountCents },
    });
  }

  /**
   * Rule 3: Large-debit fallback. Only fires when we lack the history to judge
   * whether a big charge is normal for the merchant — when we DO have history,
   * the z-score rule above is the sole judge, so normal recurring large charges
   * (rent, mortgage, utilities) no longer generate "large purchase" noise.
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
