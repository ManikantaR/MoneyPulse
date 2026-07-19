import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';
import {
  WATCHDOG_THRESHOLDS,
  FEE_DESCRIPTION_PATTERNS,
  EXPECTED_FEE_CATEGORY_NAMES,
} from '@moneypulse/shared';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Slugify a merchant name into a stable token safe for use inside a dedupe key. */
function merchantSlug(merchantKey: string): string {
  return merchantKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

interface OccurrenceRow {
  id: string;
  date: Date;
  amount_cents: number;
}

/**
 * Six deterministic watchdog detectors (11.5), pure rules over Postgres.
 * AI is never the detector of record — this service is the sole source of
 * truth for these insight types. Trigger points: post-import (txn-scoped)
 * from `ingestion.processor.ts`, and nightly (period-scoped) from
 * `alert-cron.processor.ts`.
 *
 * Absorbs/replaces the overlapping duplicate + amount-anomaly rules that
 * previously lived in `AnomalyDetectorService` (see `duplicate_charge` and
 * `stat_anomaly` below) so each condition fires exactly one insight.
 */
@Injectable()
export class WatchdogDetectorService {
  private readonly logger = new Logger(WatchdogDetectorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Post-import hook: run the transaction-scoped detectors against a batch of
   * newly-inserted transaction ids. Never throws — all errors are logged and
   * do not block ingestion.
   */
  async runTransactionScoped(userId: string, transactionIds: string[]): Promise<void> {
    for (const txnId of transactionIds) {
      try {
        await this.checkTransaction(userId, txnId);
      } catch (err: any) {
        this.logger.error(`Watchdog check failed for txn ${txnId}: ${err.message}`, err.stack);
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
    if (txn.isSplitParent || txn.parentTransactionId) return;

    await this.checkFeeDetected(userId, txn);

    if (txn.isCredit) return; // remaining rules only apply to debits

    const merchantKey = txn.normalizedMerchantName ?? txn.merchantName;

    await this.checkDuplicateCharge(userId, txn, merchantKey);
    if (merchantKey) {
      await this.checkRecurringAndPriceCreep(userId, txn, merchantKey);
    }
    await this.checkStatAnomaly(userId, txn, merchantKey);
  }

  // ── 1. Duplicate charge ────────────────────────────────────
  // Same account + normalized merchant + exact amount, 2 txns within 48h.

  private async checkDuplicateCharge(
    userId: string,
    txn: any,
    merchantKey: string | null,
  ): Promise<void> {
    if (!merchantKey) return;

    const dateStr = txn.date instanceof Date ? txn.date.toISOString() : txn.date;
    const windowHours = WATCHDOG_THRESHOLDS.DUPLICATE_WINDOW_HOURS;

    const rows = await this.db.execute(sql`
      SELECT id, txn_hash FROM ${schema.transactions}
      WHERE account_id = ${txn.accountId}
        AND amount_cents = ${txn.amountCents}
        AND COALESCE(normalized_merchant_name, merchant_name) = ${merchantKey}
        AND date BETWEEN ${dateStr}::timestamptz - (${windowHours} || ' hours')::interval
                     AND ${dateStr}::timestamptz + (${windowHours} || ' hours')::interval
        AND id        != ${txn.id}
        AND is_credit  = false
        AND is_split_parent = false
        AND parent_transaction_id IS NULL
        AND deleted_at IS NULL
      ORDER BY date ASC
      LIMIT 1
    `);

    const match = (rows.rows ?? rows)[0];
    if (!match) return;

    // Order the pair deterministically so both txns of the pair produce the
    // same dedupeKey regardless of which one is processed first/second.
    const hashes = [txn.txnHash, match.txn_hash].sort();
    const dedupeKey = `dup_${hashes[0]}_${hashes[1]}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const dateLabel = new Date(txn.date).toLocaleDateString();
    await this.notificationsService.createAndDispatch({
      userId,
      type: 'duplicate_charge',
      source: 'watchdog',
      severity: 'warning',
      title: 'Possible duplicate charge',
      message: `Possible duplicate: ${formatCents(txn.amountCents)} at ${merchantKey} on ${dateLabel}.`,
      dedupeKey,
      metadata: {
        dedupeKey,
        transactionIds: [txn.id, match.id],
        merchant: merchantKey,
        amountCents: txn.amountCents,
      },
    });
  }

  // ── 2 & 3. New recurring merchant + subscription price creep ───

  private async checkRecurringAndPriceCreep(
    userId: string,
    txn: any,
    merchantKey: string,
  ): Promise<void> {
    const rows = await this.db.execute(sql`
      SELECT id, date, amount_cents FROM ${schema.transactions}
      WHERE user_id = ${userId}
        AND COALESCE(normalized_merchant_name, merchant_name) = ${merchantKey}
        AND is_credit = false
        AND is_split_parent = false
        AND parent_transaction_id IS NULL
        AND deleted_at IS NULL
      ORDER BY date ASC
    `);

    const occurrences: OccurrenceRow[] = (rows.rows ?? rows).map((r: any) => ({
      id: r.id,
      date: new Date(r.date),
      amount_cents: Number(r.amount_cents),
    }));

    const { RECURRING_MIN_OCCURRENCES, RECURRING_INTERVAL_TOLERANCE_DAYS } = WATCHDOG_THRESHOLDS;
    if (occurrences.length < RECURRING_MIN_OCCURRENCES) return;

    const isRecurring = this.hasModalInterval(occurrences, RECURRING_INTERVAL_TOLERANCE_DAYS);
    if (!isRecurring) return;

    // Only fire "new recurring" the FIRST time the merchant crosses the
    // threshold (i.e. this is the txn that brought the count to exactly
    // RECURRING_MIN_OCCURRENCES).
    if (occurrences.length === RECURRING_MIN_OCCURRENCES) {
      const dedupeKey = `newrec_${merchantSlug(merchantKey)}`;
      if (!(await this.notificationsService.findByMetadata(userId, dedupeKey))) {
        await this.notificationsService.createAndDispatch({
          userId,
          type: 'new_recurring',
          source: 'watchdog',
          severity: 'insight',
          title: 'New recurring charge detected',
          message: `${merchantKey} looks like a new recurring charge (${occurrences.length} occurrences so far).`,
          dedupeKey,
          metadata: { dedupeKey, merchant: merchantKey, occurrences: occurrences.length },
        });
      }
      return; // don't also evaluate price-creep on the very first qualifying txn
    }

    // Price creep: compare the latest amount against the trailing-3 modal amount.
    const trailing = occurrences.slice(-4, -1); // 3 occurrences before this one
    if (trailing.length < 3) return;

    const modalAmount = this.modalAmount(trailing.map((o) => o.amount_cents));
    const newAmount = txn.amountCents;
    const deltaCents = newAmount - modalAmount;
    const minDelta = Math.max(
      Math.round(modalAmount * WATCHDOG_THRESHOLDS.PRICE_CREEP_MIN_PERCENT),
      WATCHDOG_THRESHOLDS.PRICE_CREEP_MIN_ABS_CENTS,
    );
    if (deltaCents <= minDelta) return;

    const dedupeKey = `creep_${merchantSlug(merchantKey)}_${newAmount}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'price_creep',
      source: 'watchdog',
      severity: 'insight',
      title: 'Subscription price increase',
      message: `${merchantKey} increased from ${formatCents(modalAmount)} to ${formatCents(newAmount)}.`,
      dedupeKey,
      metadata: {
        dedupeKey,
        merchant: merchantKey,
        previousAmountCents: modalAmount,
        newAmountCents: newAmount,
      },
    });
  }

  /** True if the successive gaps between occurrences cluster around a modal interval (weekly/monthly/etc). */
  private hasModalInterval(occurrences: OccurrenceRow[], toleranceDays: number): boolean {
    if (occurrences.length < 2) return false;
    const gapsDays: number[] = [];
    for (let i = 1; i < occurrences.length; i++) {
      const days = (occurrences[i].date.getTime() - occurrences[i - 1].date.getTime()) / 86_400_000;
      gapsDays.push(days);
    }
    // Bucket gaps by rounding to the nearest common cadence and find the modal bucket.
    const buckets = new Map<number, number>();
    for (const g of gapsDays) {
      const bucket = Math.round(g / toleranceDays) * toleranceDays;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const count of buckets.values()) maxCount = Math.max(maxCount, count);
    // Majority of gaps must agree on a cadence.
    return maxCount >= Math.ceil(gapsDays.length / 2);
  }

  private modalAmount(amounts: number[]): number {
    const counts = new Map<number, number>();
    for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
    let best = amounts[0];
    let bestCount = 0;
    for (const [amount, count] of counts.entries()) {
      if (count > bestCount) {
        best = amount;
        bestCount = count;
      }
    }
    return best;
  }

  // ── 4. Fee / interest detector ──────────────────────────────

  private async checkFeeDetected(userId: string, txn: any): Promise<void> {
    const description: string = (txn.description ?? '').toLowerCase();
    const isFeeLike = FEE_DESCRIPTION_PATTERNS.some((p) => description.includes(p));
    if (!isFeeLike) return;

    if (txn.categoryId) {
      const [category] = await this.db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.id, txn.categoryId))
        .limit(1);
      if (category && EXPECTED_FEE_CATEGORY_NAMES.includes(category.name)) return;
    }

    const dedupeKey = `fee_${txn.txnHash}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'fee_detected',
      source: 'watchdog',
      severity: 'warning',
      title: 'Fee or interest charge detected',
      message: `Possible fee/interest charge: ${formatCents(txn.amountCents)} — "${txn.description}".`,
      dedupeKey,
      metadata: { dedupeKey, transactionId: txn.id, amountCents: txn.amountCents },
    });
  }

  // ── 5. Budget pace ──────────────────────────────────────────
  // Period-scoped: run nightly from alert-cron.processor.ts.

  /** Nightly sweep: check budget pace for every active user. Never throws. */
  async checkBudgetPaceAllUsers(): Promise<void> {
    const users = await this.db
      .select()
      .from(schema.users)
      .where(isNull(schema.users.deletedAt));

    for (const user of users) {
      try {
        await this.checkBudgetPace(user.id);
      } catch (err: any) {
        this.logger.error(`Budget pace check failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
  }

  async checkBudgetPace(userId: string): Promise<void> {
    const budgets = await this.db
      .select()
      .from(schema.budgets)
      .where(and(eq(schema.budgets.userId, userId), isNull(schema.budgets.deletedAt)));

    const now = new Date();
    const dayOfMonth = now.getDate();
    if (dayOfMonth < WATCHDOG_THRESHOLDS.BUDGET_PACE_MIN_DAY) return;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    for (const budget of budgets) {
      if (budget.period !== 'monthly') continue; // weekly pacing not yet modeled

      const rows = await this.db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS spent_cents
        FROM ${schema.transactions}
        WHERE user_id = ${userId}
          AND category_id = ${budget.categoryId}
          AND is_credit = false
          AND deleted_at IS NULL
          AND date >= ${monthStart.toISOString()}::timestamptz
      `);
      const spentCents = Number((rows.rows ?? rows)[0]?.spent_cents ?? 0);

      const projected = (spentCents / dayOfMonth) * daysInMonth;
      const ratio = budget.amountCents > 0 ? projected / budget.amountCents : 0;
      if (ratio <= WATCHDOG_THRESHOLDS.BUDGET_PACE_PROJECTION_RATIO) continue;

      const dedupeKey = `pace_${budget.id}_${periodKey}`;
      if (await this.notificationsService.findByMetadata(userId, dedupeKey)) continue;

      await this.notificationsService.createAndDispatch({
        userId,
        type: 'budget_pace',
        source: 'watchdog',
        severity: 'warning',
        title: 'Budget pacing over target',
        message: `You're on pace to spend ${formatCents(Math.round(projected))} this month, ${Math.round(
          ratio * 100,
        )}% of your ${formatCents(budget.amountCents)} budget.`,
        dedupeKey,
        metadata: {
          dedupeKey,
          budgetId: budget.id,
          periodKey,
          spentCents,
          projectedCents: Math.round(projected),
          budgetCents: budget.amountCents,
        },
      });
    }
  }

  // ── 6. Statistical anomaly ──────────────────────────────────
  // z-score > 3 vs 6-month per-category distribution (fallback per-account),
  // min 20 samples, amount > $25.

  private async checkStatAnomaly(userId: string, txn: any, merchantKey: string | null): Promise<void> {
    if (txn.isCredit) return;
    if (txn.amountCents <= WATCHDOG_THRESHOLDS.STAT_ANOMALY_MIN_AMOUNT_CENTS) return;

    const months = WATCHDOG_THRESHOLDS.STAT_ANOMALY_WINDOW_MONTHS;

    let stats = txn.categoryId
      ? await this.distributionStats(userId, months, sql`category_id = ${txn.categoryId}`, txn.id)
      : null;

    if (!stats || stats.count < WATCHDOG_THRESHOLDS.STAT_ANOMALY_MIN_SAMPLES) {
      stats = await this.distributionStats(userId, months, sql`account_id = ${txn.accountId}`, txn.id);
    }

    if (!stats || stats.count < WATCHDOG_THRESHOLDS.STAT_ANOMALY_MIN_SAMPLES) return;

    const stddev = Math.max(stats.stddevCents, 1);
    const z = (txn.amountCents - stats.avgCents) / stddev;
    if (z <= WATCHDOG_THRESHOLDS.STAT_ANOMALY_Z_THRESHOLD) return;

    const dedupeKey = `anom_${txn.txnHash}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const label = merchantKey ?? txn.description ?? 'this transaction';
    await this.notificationsService.createAndDispatch({
      userId,
      type: 'stat_anomaly',
      source: 'watchdog',
      severity: 'warning',
      title: 'Unusual spend detected',
      message: `Unusual spend: ${formatCents(txn.amountCents)} at ${label} — well above your typical ${formatCents(
        Math.round(stats.avgCents),
      )}.`,
      dedupeKey,
      metadata: {
        dedupeKey,
        transactionId: txn.id,
        amountCents: txn.amountCents,
        avgCents: Math.round(stats.avgCents),
        zScore: Number(z.toFixed(2)),
      },
    });
  }

  private async distributionStats(
    userId: string,
    windowMonths: number,
    scopeCondition: ReturnType<typeof sql>,
    excludeTxnId: string,
  ): Promise<{ avgCents: number; stddevCents: number; count: number } | null> {
    const rows = await this.db.execute(sql`
      SELECT
        AVG(amount_cents)::float                     AS avg_cents,
        COALESCE(STDDEV_POP(amount_cents), 0)::float AS stddev_cents,
        COUNT(*)::int                                AS txn_count
      FROM ${schema.transactions}
      WHERE user_id = ${userId}
        AND ${scopeCondition}
        AND is_credit = false
        AND is_split_parent = false
        AND parent_transaction_id IS NULL
        AND deleted_at IS NULL
        AND id != ${excludeTxnId}
        AND date >= NOW() - (${windowMonths} || ' months')::interval
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
}
