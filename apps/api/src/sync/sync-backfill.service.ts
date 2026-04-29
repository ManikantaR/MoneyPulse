import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import { OutboxService } from './outbox.service';
import { AliasMapperService } from './alias-mapper.service';
import * as schema from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export interface BackfillResult {
  enqueued: number;
  skipped: number;
}

/**
 * SyncBackfillService
 *
 * Enqueues pre-existing transactions that have never been sent through the outbox.
 * Safe to run multiple times — idempotent by design (checks existing entries).
 *
 * Transactions are considered "already handled" when an outbox entry exists with
 * a status that is NOT policy_failed or dead_letter (i.e. pending, retry, delivered).
 * policy_failed and dead_letter entries are re-enqueued for a fresh attempt.
 */
@Injectable()
export class SyncBackfillService {
  private readonly logger = new Logger(SyncBackfillService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly outbox: OutboxService,
    private readonly aliasMapper: AliasMapperService,
  ) {}

  /**
   * Backfill pending transactions for a given user.
   *
   * @param userId    User ID to backfill transactions for.
   * @param batchSize Number of transactions to process per DB query (default 100).
   * @returns         Counts of enqueued and skipped transactions.
   */
  async backfillBudgets(userId: string): Promise<{ enqueued: number; skipped: number }> {
    const budgets = await this.db
      .select()
      .from(schema.budgets)
      .where(sql`${schema.budgets.deletedAt} IS NULL AND ${schema.budgets.userId} = ${userId}`);

    let enqueued = 0;
    let skipped = 0;

    for (const budget of budgets) {
      const existing = await this.db
        .select({ id: schema.outboxEvents.id })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.aggregateId, budget.id),
            sql`${schema.outboxEvents.eventType} = 'budget.projected.v1'`,
            sql`${schema.outboxEvents.status} NOT IN ('policy_failed', 'dead_letter')`,
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      try {
        await this.outbox.enqueue({
          eventType: 'budget.projected.v1',
          aggregateType: 'budget',
          aggregateId: budget.id,
          userId,
          payload: {
            budgetId: budget.id,
            categoryId: budget.categoryId,
            amountCents: budget.amountCents,
            period: budget.period,
          },
        });
        enqueued++;
      } catch (err) {
        this.logger.warn(`Backfill: failed to enqueue budget ${budget.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Budget backfill for user=${userId}: enqueued=${enqueued}, skipped=${skipped}`);
    return { enqueued, skipped };
  }

  async backfillCategories(userId: string): Promise<{ enqueued: number; skipped: number }> {
    const categories = await this.db
      .select()
      .from(schema.categories)
      .where(sql`${schema.categories.deletedAt} IS NULL`);

    let enqueued = 0;
    let skipped = 0;

    for (const cat of categories) {
      const existing = await this.db
        .select({ id: schema.outboxEvents.id })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.aggregateId, cat.id),
            sql`${schema.outboxEvents.status} NOT IN ('policy_failed', 'dead_letter')`,
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      try {
        await this.outbox.enqueue({
          eventType: 'category.projected.v1',
          aggregateType: 'category',
          aggregateId: cat.id,
          userId,
          payload: {
            categoryId: cat.id,
            name: cat.name,
            icon: cat.icon,
            color: cat.color,
            parentCategoryId: cat.parentId ?? null,
          },
        });
        enqueued++;
      } catch (err) {
        this.logger.warn(`Backfill: failed to enqueue category ${cat.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Category backfill for user=${userId}: enqueued=${enqueued}, skipped=${skipped}`);
    return { enqueued, skipped };
  }

  async backfillPending(userId: string, batchSize = 100): Promise<BackfillResult> {
    let enqueued = 0;
    let skipped = 0;
    let offset = 0;

    while (true) {
      const batch = await this._fetchTransactionBatch(userId, batchSize, offset);

      if (batch.length === 0) break;

      for (const txn of batch) {
        const existing = await this._findExistingOutboxEntry(txn.id);
        if (existing) {
          skipped++;
          this.logger.debug(
            `Skipping transaction ${txn.id} — outbox entry exists with status=${existing.status}`,
          );
        } else {
          await this._enqueueTransaction(txn);
          enqueued++;
        }
      }

      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    this.logger.log(
      `Backfill complete for user=${userId}: enqueued=${enqueued}, skipped=${skipped}`,
    );

    return { enqueued, skipped };
  }

  /**
   * Derive a human-readable display name from a raw bank description when
   * merchantName is not set. Strips store numbers, reference codes, and
   * trailing digits, then title-cases the first 3 significant words.
   */
  private _deriveDisplayName(description: string | null | undefined): string | null {
    if (!description) return null;
    let cleaned = description.toLowerCase().trim()
      .replace(/\s*#\d+/g, '')
      .replace(/\s*\*[\w]+/g, '')
      .replace(/\s+\d{5,}/g, '')
      .replace(/\s+store\s*\d*/gi, '')
      .replace(/\s+\d{2}\/\d{2,}/g, '')
      .trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
    if (words.length === 0) return null;
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * Fetch a page of transactions for the user.
   * Protected (not private) so tests can override it with stubs.
   */
  protected async _fetchTransactionBatch(
    userId: string,
    batchSize: number,
    offset: number,
  ): Promise<any[]> {
    return this.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, userId))
      .limit(batchSize)
      .offset(offset);
  }

  /**
   * Find an outbox entry for the given transaction that represents an active
   * or completed attempt (pending | retry | delivered). Returns null if none exists
   * or if only policy_failed / dead_letter entries exist.
   */
  protected async _findExistingOutboxEntry(txnId: string): Promise<any | null> {
    const rows = await this.db
      .select({
        id: schema.outboxEvents.id,
        status: schema.outboxEvents.status,
        aggregateId: schema.outboxEvents.aggregateId,
      })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.aggregateId, txnId),
          // Only consider rows that are "in-flight" or already delivered
          sql`${schema.outboxEvents.status} NOT IN ('policy_failed', 'dead_letter')`,
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Build the outbox payload and enqueue the transaction event.
   * Matches the same payload shape as TransactionsService.enqueueTransactionEvent
   * but without tags (excluded for security — see tags-sanitization spec).
   */
  private async _enqueueTransaction(txn: any): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        transactionAliasId: this.aliasMapper.toAliasId('transaction', txn.id),
        accountAliasId: this.aliasMapper.toAliasId('account', txn.accountId),
        amountCents: txn.amountCents,
        date: txn.date instanceof Date ? txn.date.toISOString() : txn.date,
        categoryId: txn.categoryId ?? null,
        merchantName: txn.merchantName ?? this._deriveDisplayName(txn.description),
        isCredit: txn.isCredit,
        isManual: txn.isManual ?? false,
      };

      await this.outbox.enqueue({
        eventType: 'transaction.projected.v1',
        aggregateType: 'transaction',
        aggregateId: txn.id,
        userId: txn.userId,
        payload,
      });
    } catch (err) {
      this.logger.warn(
        `Backfill: failed to enqueue transaction ${txn.id}: ${(err as Error).message}`,
      );
    }
  }
}
