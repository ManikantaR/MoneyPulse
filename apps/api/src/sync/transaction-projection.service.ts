import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, inArray, isNull, and } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { OutboxService } from './outbox.service';
import { AliasMapperService } from './alias-mapper.service';

/**
 * Single source of truth for building and enqueuing `transaction.projected.v1`
 * sync events. Owning this in one place keeps the payload contract consistent
 * across every mutation path (import, manual edit, bulk categorize, split,
 * rule/AI categorization) so the web projection never goes stale. #89 #90
 *
 * Lives in SyncModule (not TransactionsService) so CategorizationService can
 * reproject without creating a circular module dependency
 * (transactions → categorization → transactions).
 */
@Injectable()
export class TransactionProjectionService {
  private readonly logger = new Logger(TransactionProjectionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly outbox: OutboxService,
    private readonly aliasMapper: AliasMapperService,
  ) {}

  /**
   * Build the PII-free projection payload for a transaction row. The local
   * category UUID is obfuscated into an alias so raw identifiers never leave the
   * NAS, and so it matches the aliased `categoryId` emitted for category docs. #90
   */
  private buildPayload(txn: any, isTransfer: boolean): Record<string, unknown> {
    return {
      transactionAliasId: this.aliasMapper.toAliasId('transaction', txn.id),
      accountAliasId: this.aliasMapper.toAliasId('account', txn.accountId),
      amountCents: txn.amountCents,
      date: txn.date instanceof Date ? txn.date.toISOString() : txn.date,
      categoryId: txn.categoryId
        ? this.aliasMapper.toAliasId('category', txn.categoryId)
        : null,
      isCredit: txn.isCredit,
      isTransfer,
      isManual: txn.isManual ?? false,
      isSplitParent: txn.isSplitParent ?? false,
      tags: txn.tags ?? [],
      originalAmountCents: txn.originalAmountCents ?? null,
      currencyCode: txn.currencyCode ?? null,
    };
  }

  /** Resolve whether a transaction's category is a transfer (drives web KPI math). */
  private async resolveIsTransfer(
    executor: any,
    categoryId: string | null | undefined,
  ): Promise<boolean> {
    if (!categoryId) return false;
    const rows = await executor
      .select({ isTransfer: schema.categories.isTransfer })
      .from(schema.categories)
      .where(eq(schema.categories.id, categoryId))
      .limit(1);
    return rows[0]?.isTransfer ?? false;
  }

  /**
   * Enqueue a projection event inside an existing DB transaction (transactional
   * outbox) so a committed domain write always has a matching outbox event.
   * If ALIAS_SECRET is missing, this throws and the caller's tx is rolled back.
   */
  async projectInTx(tx: any, eventType: string, txn: any): Promise<void> {
    const isTransfer = await this.resolveIsTransfer(tx, txn.categoryId);
    await this.outbox.enqueueInTx(tx, {
      eventType,
      aggregateType: 'transaction',
      aggregateId: txn.id,
      userId: txn.userId,
      payload: this.buildPayload(txn, isTransfer),
    });
  }

  /**
   * Best-effort projection outside a DB transaction. Aliasing/outbox errors are
   * caught and logged so the domain operation still succeeds.
   */
  async project(eventType: string, txn: any): Promise<void> {
    try {
      const isTransfer = await this.resolveIsTransfer(this.db, txn.categoryId);
      await this.outbox.enqueue({
        eventType,
        aggregateType: 'transaction',
        aggregateId: txn.id,
        userId: txn.userId,
        payload: this.buildPayload(txn, isTransfer),
      });
    } catch (err) {
      this.logger.warn(
        `Skipping outbox enqueue for transaction ${txn.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Reproject a set of transactions by id after a local mutation (categorize,
   * bulk categorize, transfer reclassification, split) so the web projection
   * eventually reflects the final local state. Best-effort per row. #89
   */
  async reprojectByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          inArray(schema.transactions.id, ids),
          isNull(schema.transactions.deletedAt),
        ),
      );
    for (const txn of rows) {
      await this.project('transaction.projected.v1', txn);
    }
  }
}
