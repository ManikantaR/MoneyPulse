import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnomalyDetectorService } from '../anomaly-detector.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTxn(overrides: Record<string, any> = {}) {
  return {
    id: 'txn-1',
    userId: 'user-1',
    accountId: 'acct-1',
    amountCents: 2000,
    isCredit: false,
    isSplitParent: false,
    parentTransactionId: null,
    merchantName: 'Acme Corp',
    normalizedMerchantName: 'Acme Corp',
    categoryId: null,
    description: 'Purchase at Acme',
    date: new Date('2024-03-15T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function buildMockDb(txn: any) {
  const mockDb: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(txn ? [txn] : []),
    limit: vi.fn().mockResolvedValue(txn ? [txn] : []),
    execute: vi.fn(),
  };
  // Make the chain: select().from().where().limit() return the transaction
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(txn ? [txn] : []),
      }),
    }),
  });
  return mockDb;
}

function buildMockNotifications(existingDedupeKeys: string[] = []) {
  return {
    findByMetadata: vi.fn(async (_userId: string, key: string) =>
      existingDedupeKeys.includes(key),
    ),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(db: any, notifications: any) {
  const svc = new AnomalyDetectorService(db, notifications as any);
  return svc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnomalyDetectorService', () => {
  describe('detectAnomalies — skip conditions', () => {
    it('skips credit transactions (income/refunds)', async () => {
      const txn = makeTxn({ isCredit: true });
      const db = buildMockDb(txn);
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips split-parent transactions', async () => {
      const txn = makeTxn({ isSplitParent: true });
      const db = buildMockDb(txn);
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips split-child transactions (has parentTransactionId)', async () => {
      const txn = makeTxn({ parentTransactionId: 'parent-txn-1' });
      const db = buildMockDb(txn);
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips when transaction is not found', async () => {
      const db = buildMockDb(null);
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['nonexistent-txn']);

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('continues processing remaining transactions when one fails', async () => {
      // First txn throws, second should still be checked
      const db = buildMockDb(null); // returns no txn for both
      const notif = buildMockNotifications();
      // Simulate error on first txn by making the first select throw
      let callCount = 0;
      db.select = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('DB error');
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      });

      const svc = makeService(db, notif);
      // Should not throw even if one txn check fails
      await expect(
        svc.detectAnomalies('user-1', ['txn-error', 'txn-2']),
      ).resolves.not.toThrow();
    });
  });

  describe('amount anomaly check', () => {
    it('creates notification when transaction is > 3x the merchant average (with 3+ history)', async () => {
      const txn = makeTxn({ amountCents: 12_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValueOnce({
        rows: [{ avg_cents: '3000', txn_count: 5 }],
      });
      // subsequent execute calls (duplicate check) → no rows
      db.execute.mockResolvedValue({ rows: [] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const calls = notif.createAndDispatch.mock.calls;
      const anomalyCalls = calls.filter((c: any[]) => c[0].metadata?.rule === 'amount_anomaly');
      expect(anomalyCalls).toHaveLength(1);
      expect(anomalyCalls[0][0].message).toContain('Acme Corp');
      expect(anomalyCalls[0][0].message).toContain('$120.00');
    });

    it('does NOT flag when transaction is only 1.5x the average', async () => {
      const txn = makeTxn({ amountCents: 4_500, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [{ avg_cents: '3000', txn_count: 5 }] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const anomalyCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'amount_anomaly',
      );
      expect(anomalyCalls).toHaveLength(0);
    });

    it('does NOT flag when history has fewer than 3 transactions', async () => {
      const txn = makeTxn({ amountCents: 50_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [{ avg_cents: '5000', txn_count: 2 }] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const anomalyCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'amount_anomaly',
      );
      expect(anomalyCalls).toHaveLength(0);
    });

    it('skips amount anomaly check when merchant name is null', async () => {
      const txn = makeTxn({ amountCents: 50_000, merchantName: null, normalizedMerchantName: null });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const anomalyCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'amount_anomaly',
      );
      expect(anomalyCalls).toHaveLength(0);
    });

    it('does not create duplicate notification when dedupeKey already exists', async () => {
      const txn = makeTxn({ amountCents: 12_000 });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [{ avg_cents: '3000', txn_count: 5 }] });
      // Simulate dedupeKey already present for amount anomaly
      const notif = buildMockNotifications([`anomaly_amount_${txn.id}`]);
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const anomalyCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'amount_anomaly',
      );
      expect(anomalyCalls).toHaveLength(0);
    });
  });

  describe('duplicate detection check', () => {
    it('creates notification when a similar transaction exists within 24 hours', async () => {
      const txn = makeTxn({ amountCents: 5_000, normalizedMerchantName: 'Starbucks' });
      const db = buildMockDb(txn);
      db.execute = vi
        .fn()
        // amount anomaly: no history (txn_count < 3)
        .mockResolvedValueOnce({ rows: [{ avg_cents: '5000', txn_count: 1 }] })
        // duplicate check: found a matching txn
        .mockResolvedValueOnce({ rows: [{ id: 'other-txn' }] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const dupCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'duplicate',
      );
      expect(dupCalls).toHaveLength(1);
      expect(dupCalls[0][0].title).toBe('Possible duplicate transaction');
    });

    it('does NOT flag when no similar transaction exists', async () => {
      const txn = makeTxn({ amountCents: 5_000, normalizedMerchantName: 'Starbucks' });
      const db = buildMockDb(txn);
      db.execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ avg_cents: '5000', txn_count: 1 }] }) // amount anomaly: skip
        .mockResolvedValueOnce({ rows: [] }); // duplicate: none
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const dupCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'duplicate',
      );
      expect(dupCalls).toHaveLength(0);
    });
  });

  describe('large debit check', () => {
    it('creates notification when debit is at or above $500 threshold', async () => {
      const txn = makeTxn({ amountCents: 60_000, normalizedMerchantName: 'Best Buy' });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [] }); // no history / no dup
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const largeCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'large_debit',
      );
      expect(largeCalls).toHaveLength(1);
      expect(largeCalls[0][0].message).toContain('$600.00');
    });

    it('creates notification for exactly $500 (boundary)', async () => {
      const txn = makeTxn({ amountCents: 50_000, normalizedMerchantName: 'Best Buy' });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const largeCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'large_debit',
      );
      expect(largeCalls).toHaveLength(1);
    });

    it('does NOT flag when debit is $499.99 (below threshold)', async () => {
      const txn = makeTxn({ amountCents: 49_999, normalizedMerchantName: 'Best Buy' });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [{ avg_cents: '49999', txn_count: 1 }] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const largeCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'large_debit',
      );
      expect(largeCalls).toHaveLength(0);
    });

    it('uses description as label when merchant name is null', async () => {
      const txn = makeTxn({
        amountCents: 75_000,
        merchantName: null,
        normalizedMerchantName: null,
        description: 'Wire transfer',
      });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [] });
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const largeCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'large_debit',
      );
      expect(largeCalls).toHaveLength(1);
      expect(largeCalls[0][0].message).toContain('Wire transfer');
    });

    it('does not create duplicate large-debit notification when dedupeKey already exists', async () => {
      const txn = makeTxn({ amountCents: 60_000 });
      const db = buildMockDb(txn);
      db.execute = vi.fn().mockResolvedValue({ rows: [] });
      const notif = buildMockNotifications([`anomaly_large_${txn.id}`]);
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const largeCalls = notif.createAndDispatch.mock.calls.filter(
        (c: any[]) => c[0].metadata?.rule === 'large_debit',
      );
      expect(largeCalls).toHaveLength(0);
    });
  });

  describe('multiple rules on same transaction', () => {
    it('can trigger both amount-anomaly and large-debit for a single transaction', async () => {
      // $600 at a merchant where average is $100 (6x) with 5 history txns
      const txn = makeTxn({ amountCents: 60_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      db.execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ avg_cents: '10000', txn_count: 5 }] }) // amount anomaly: trigger
        .mockResolvedValueOnce({ rows: [] }); // duplicate: none
      const notif = buildMockNotifications();
      const svc = makeService(db, notif);

      await svc.detectAnomalies('user-1', ['txn-1']);

      const rules = notif.createAndDispatch.mock.calls.map((c: any[]) => c[0].metadata?.rule);
      expect(rules).toContain('amount_anomaly');
      expect(rules).toContain('large_debit');
    });
  });
});
