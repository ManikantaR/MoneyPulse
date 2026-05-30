import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';

const LARGE_DEBIT_THRESHOLD_CENTS = 50_000; // $500.00

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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

    // Run checks sequentially to avoid dedupe race conditions on shared keys
    await this.checkAmountAnomaly(userId, txn, merchantKey);
    await this.checkDuplicate(userId, txn, merchantKey);
    await this.checkLargeDebit(userId, txn, merchantKey);
  }

  /**
   * Rule 1: Flag if this transaction's amount is > 3x the user's historical average
   * at the same merchant (requires 3+ prior transactions).
   */
  private async checkAmountAnomaly(
    userId: string,
    txn: any,
    merchantKey: string | null,
  ): Promise<void> {
    if (!merchantKey) return;

    const dedupeKey = `anomaly_amount_${txn.id}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const rows = await this.db.execute(sql`
      SELECT
        AVG(amount_cents)::float AS avg_cents,
        COUNT(*)::int            AS txn_count
      FROM ${schema.transactions}
      WHERE user_id              = ${userId}
        AND COALESCE(normalized_merchant_name, merchant_name) = ${merchantKey}
        AND is_credit            = false
        AND is_split_parent      = false
        AND parent_transaction_id IS NULL
        AND deleted_at           IS NULL
        AND id                  != ${txn.id}
    `);

    const row = (rows.rows ?? rows)[0];
    if (!row || row.txn_count < 3) return;

    const avgCents = parseFloat(row.avg_cents);
    if (txn.amountCents <= avgCents * 3) return;

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'spending_anomaly',
      title: 'Unusual spend detected',
      message: `Unusual spend at ${merchantKey}: ${formatCents(txn.amountCents)} — your average is ${formatCents(Math.round(avgCents))}.`,
      dedupeKey,
      metadata: { dedupeKey, transactionId: txn.id, rule: 'amount_anomaly' },
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
      metadata: { dedupeKey, transactionId: txn.id, rule: 'duplicate' },
    });
  }

  /**
   * Rule 3: Flag large debits above the threshold (default $500).
   */
  private async checkLargeDebit(
    userId: string,
    txn: any,
    merchantKey: string | null,
  ): Promise<void> {
    if (txn.amountCents < LARGE_DEBIT_THRESHOLD_CENTS) return;

    const dedupeKey = `anomaly_large_${txn.id}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    const label = merchantKey ?? txn.description ?? 'unknown merchant';
    await this.notificationsService.createAndDispatch({
      userId,
      type: 'spending_anomaly',
      title: 'Large purchase detected',
      message: `Large purchase: ${formatCents(txn.amountCents)} at ${label}.`,
      dedupeKey,
      metadata: { dedupeKey, transactionId: txn.id, rule: 'large_debit' },
    });
  }
}
