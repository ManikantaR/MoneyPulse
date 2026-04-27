import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncBackfillService } from '../sync-backfill.service';

/**
 * Unit tests for SyncBackfillService.
 * Uses in-memory stubs for the DB and OutboxService.
 */

function makeTxn(overrides: Partial<{
  id: string;
  accountId: string;
  userId: string;
  amountCents: number;
  date: string;
  categoryId: string | null;
  isCredit: boolean;
  isManual: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 'txn-default',
    accountId: overrides.accountId ?? 'acc-1',
    userId: overrides.userId ?? 'user-1',
    amountCents: overrides.amountCents ?? 1000,
    date: overrides.date ?? '2026-01-01',
    categoryId: overrides.categoryId ?? null,
    isCredit: overrides.isCredit ?? false,
    isManual: overrides.isManual ?? false,
  };
}

function makeOutboxRow(status: string, aggregateId: string) {
  return { id: 'outbox-' + aggregateId, status, aggregateId };
}

function buildService(opts: {
  transactions: any[];
  outboxRows: any[];
}) {
  const mockEnqueue = vi.fn().mockResolvedValue(undefined);
  const mockToAliasId = vi.fn((type: string, id: string) => `alias_${type}_${id}`);

  // Fake DB that returns configured data
  const db = {
    _transactions: opts.transactions,
    _outboxRows: opts.outboxRows,

    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockImplementation(function (this: any) { return this; }),
    // Terminal call — returns data based on the last method called
  };

  // The service needs selectFrom(transactions).where(userId).limit().offset() → txns
  // and selectFrom(outboxEvents).where(aggregateId, status).limit(1) → existing rows
  // We use a simple approach: query the transactions array, then for each txn, check outbox

  const outbox = { enqueue: mockEnqueue };
  const aliasMapper = { toAliasId: mockToAliasId };

  const svc = new SyncBackfillService(db as any, outbox as any, aliasMapper as any);

  // Override the private query methods with testable implementations
  (svc as any)._fetchTransactionBatch = vi.fn(async (userId: string, batchSize: number, offset: number) => {
    const userTxns = opts.transactions.filter((t) => t.userId === userId);
    return userTxns.slice(offset, offset + batchSize);
  });

  (svc as any)._findExistingOutboxEntry = vi.fn(async (txnId: string) => {
    return opts.outboxRows.find(
      (r) =>
        r.aggregateId === txnId &&
        r.status !== 'policy_failed' &&
        r.status !== 'dead_letter',
    ) ?? null;
  });

  return { svc, mockEnqueue, mockToAliasId };
}

describe('SyncBackfillService', () => {
  describe('backfillPending', () => {
    it('enqueues transactions that have no outbox entry', async () => {
      const txns = [
        makeTxn({ id: 'txn-1', userId: 'user-1' }),
        makeTxn({ id: 'txn-2', userId: 'user-1' }),
      ];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows: [] });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(result.enqueued).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('skips transactions that already have a pending outbox entry', async () => {
      const txns = [
        makeTxn({ id: 'txn-1', userId: 'user-1' }),
        makeTxn({ id: 'txn-2', userId: 'user-1' }),
      ];
      const outboxRows = [makeOutboxRow('pending', 'txn-1')];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(result.enqueued).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('skips transactions that already have a delivered outbox entry', async () => {
      const txns = [makeTxn({ id: 'txn-1', userId: 'user-1' })];
      const outboxRows = [makeOutboxRow('delivered', 'txn-1')];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(result.enqueued).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('skips transactions that already have a retry outbox entry', async () => {
      const txns = [makeTxn({ id: 'txn-1', userId: 'user-1' })];
      const outboxRows = [makeOutboxRow('retry', 'txn-1')];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(result.enqueued).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('re-enqueues transactions with policy_failed outbox status', async () => {
      const txns = [makeTxn({ id: 'txn-1', userId: 'user-1' })];
      const outboxRows = [makeOutboxRow('policy_failed', 'txn-1')];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(result.enqueued).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('re-enqueues transactions with dead_letter outbox status', async () => {
      const txns = [makeTxn({ id: 'txn-1', userId: 'user-1' })];
      const outboxRows = [makeOutboxRow('dead_letter', 'txn-1')];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(result.enqueued).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('returns correct enqueued/skipped counts for mixed statuses', async () => {
      const txns = [
        makeTxn({ id: 'txn-1', userId: 'user-1' }),  // no outbox → enqueue
        makeTxn({ id: 'txn-2', userId: 'user-1' }),  // pending → skip
        makeTxn({ id: 'txn-3', userId: 'user-1' }),  // delivered → skip
        makeTxn({ id: 'txn-4', userId: 'user-1' }),  // policy_failed → enqueue
        makeTxn({ id: 'txn-5', userId: 'user-1' }),  // dead_letter → enqueue
      ];
      const outboxRows = [
        makeOutboxRow('pending', 'txn-2'),
        makeOutboxRow('delivered', 'txn-3'),
        makeOutboxRow('policy_failed', 'txn-4'),
        makeOutboxRow('dead_letter', 'txn-5'),
      ];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).toHaveBeenCalledTimes(3);
      expect(result.enqueued).toBe(3);
      expect(result.skipped).toBe(2);
    });

    it('enqueues with event type transaction.projected.v1', async () => {
      const txns = [makeTxn({ id: 'txn-1', userId: 'user-1' })];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows: [] });

      await svc.backfillPending('user-1');

      const call = mockEnqueue.mock.calls[0][0];
      expect(call.eventType).toBe('transaction.projected.v1');
    });

    it('enqueues payload without tags field', async () => {
      const txns = [makeTxn({ id: 'txn-1', userId: 'user-1' })];
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows: [] });

      await svc.backfillPending('user-1');

      const call = mockEnqueue.mock.calls[0][0];
      expect(call.payload).not.toHaveProperty('tags');
    });

    it('handles empty transaction list gracefully', async () => {
      const { svc, mockEnqueue } = buildService({ transactions: [], outboxRows: [] });

      const result = await svc.backfillPending('user-1');

      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(result.enqueued).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('processes multiple batches when transactions exceed batchSize', async () => {
      const txns = Array.from({ length: 5 }, (_, i) =>
        makeTxn({ id: `txn-${i + 1}`, userId: 'user-1' }),
      );
      const { svc, mockEnqueue } = buildService({ transactions: txns, outboxRows: [] });

      const result = await svc.backfillPending('user-1', 2);

      expect(mockEnqueue).toHaveBeenCalledTimes(5);
      expect(result.enqueued).toBe(5);
    });
  });
});
