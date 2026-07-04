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
    select: vi.fn(),
    execute: vi.fn(),
  };
  // Chain: select().from().where().limit() → the transaction row
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(txn ? [txn] : []),
      }),
    }),
  });
  return mockDb;
}

/**
 * Convenience for the per-transaction execute() sequence:
 *   1. merchant baseline stats
 *   2. duplicate lookup
 * Pass `stats: null` to simulate no merchant history (empty stats row).
 */
function mockExecuteSequence(
  db: any,
  {
    stats,
    duplicateRows = [],
  }: {
    stats: { avgCents: number; stddevCents: number; count: number } | null;
    duplicateRows?: any[];
  },
) {
  const statsRows = stats
    ? [{ avg_cents: String(stats.avgCents), stddev_cents: String(stats.stddevCents), txn_count: stats.count }]
    : [];
  db.execute
    .mockResolvedValueOnce({ rows: statsRows })
    .mockResolvedValueOnce({ rows: duplicateRows });
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
  return new AnomalyDetectorService(db, notifications as any);
}

function callsForRule(notif: any, rule: string) {
  return notif.createAndDispatch.mock.calls.filter(
    (c: any[]) => c[0].metadata?.rule === rule,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnomalyDetectorService', () => {
  describe('detectAnomalies — skip conditions', () => {
    it('skips credit transactions (income/refunds)', async () => {
      const notif = buildMockNotifications();
      await makeService(buildMockDb(makeTxn({ isCredit: true })), notif).detectAnomalies(
        'user-1',
        ['txn-1'],
      );
      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips split-parent transactions', async () => {
      const notif = buildMockNotifications();
      await makeService(buildMockDb(makeTxn({ isSplitParent: true })), notif).detectAnomalies(
        'user-1',
        ['txn-1'],
      );
      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips split-child transactions (has parentTransactionId)', async () => {
      const notif = buildMockNotifications();
      await makeService(
        buildMockDb(makeTxn({ parentTransactionId: 'parent-txn-1' })),
        notif,
      ).detectAnomalies('user-1', ['txn-1']);
      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips when transaction is not found', async () => {
      const notif = buildMockNotifications();
      await makeService(buildMockDb(null), notif).detectAnomalies('user-1', ['nope']);
      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('continues processing remaining transactions when one fails', async () => {
      const db = buildMockDb(null);
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
      const notif = buildMockNotifications();
      await expect(
        makeService(db, notif).detectAnomalies('user-1', ['txn-error', 'txn-2']),
      ).resolves.not.toThrow();
    });
  });

  describe('amount anomaly (z-score)', () => {
    it('flags a statistical outlier: amount many σ above the merchant mean', async () => {
      // avg $30, σ≈0 → effective σ floored to 10% ($3); $120 is ~30σ above
      const txn = makeTxn({ amountCents: 12_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 3000, stddevCents: 0, count: 6 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      const calls = callsForRule(notif, 'amount_anomaly');
      expect(calls).toHaveLength(1);
      expect(calls[0][0].title).toBe('Unusual spend detected');
      expect(calls[0][0].message).toContain('Acme Corp');
      expect(calls[0][0].message).toContain('$120.00');
      expect(calls[0][0].metadata.zScore).toBeGreaterThanOrEqual(3);
    });

    it('does NOT flag when within the normal band (low z-score)', async () => {
      // avg $300, σ $50 → $360 is only ~1.2σ above; not an outlier
      const txn = makeTxn({ amountCents: 36_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 30_000, stddevCents: 5_000, count: 8 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(0);
    });

    it('does NOT flag a high-z but low-value merchant (absolute-delta floor)', async () => {
      // avg $2, σ≈0 → $8 is a huge z-score but only $6 over → below $25 floor
      const txn = makeTxn({ amountCents: 800, normalizedMerchantName: 'Coffee Cart' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 200, stddevCents: 0, count: 10 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(0);
    });

    it('does NOT flag when history has fewer than MIN_HISTORY transactions', async () => {
      const txn = makeTxn({ amountCents: 40_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 5_000, stddevCents: 0, count: 3 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(0);
    });

    it('skips amount anomaly when merchant name is null', async () => {
      const txn = makeTxn({ amountCents: 40_000, merchantName: null, normalizedMerchantName: null });
      const db = buildMockDb(txn);
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(0);
      // No merchant → no stats/duplicate queries issued
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('does not re-notify when the amount dedupeKey already exists', async () => {
      const txn = makeTxn({ amountCents: 12_000 });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 3000, stddevCents: 0, count: 6 } });
      const notif = buildMockNotifications([`anomaly_amount_${txn.id}`]);

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(0);
    });
  });

  describe('duplicate detection', () => {
    it('flags when a similar transaction exists within 24 hours', async () => {
      const txn = makeTxn({ amountCents: 5_000, normalizedMerchantName: 'Starbucks' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, {
        stats: { avgCents: 5_000, stddevCents: 0, count: 2 }, // too little history to flag amount
        duplicateRows: [{ id: 'other-txn' }],
      });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      const dup = callsForRule(notif, 'duplicate');
      expect(dup).toHaveLength(1);
      expect(dup[0][0].title).toBe('Possible duplicate transaction');
    });

    it('does NOT flag when no similar transaction exists', async () => {
      const txn = makeTxn({ amountCents: 5_000, normalizedMerchantName: 'Starbucks' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 5_000, stddevCents: 0, count: 2 }, duplicateRows: [] });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'duplicate')).toHaveLength(0);
    });
  });

  describe('large-debit fallback', () => {
    it('flags a large debit when there is no merchant history to judge normality', async () => {
      const txn = makeTxn({ amountCents: 60_000, normalizedMerchantName: 'Best Buy' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: null });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      const large = callsForRule(notif, 'large_debit');
      expect(large).toHaveLength(1);
      expect(large[0][0].message).toContain('$600.00');
    });

    it('flags exactly $500 with no history (boundary)', async () => {
      const txn = makeTxn({ amountCents: 50_000, normalizedMerchantName: 'Best Buy' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: null });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'large_debit')).toHaveLength(1);
    });

    it('does NOT flag $499.99 (below threshold)', async () => {
      const txn = makeTxn({ amountCents: 49_999, normalizedMerchantName: 'Best Buy' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: null });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'large_debit')).toHaveLength(0);
    });

    it('uses description as label when merchant name is null', async () => {
      const txn = makeTxn({
        amountCents: 75_000,
        merchantName: null,
        normalizedMerchantName: null,
        description: 'Wire transfer',
      });
      const db = buildMockDb(txn);
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      const large = callsForRule(notif, 'large_debit');
      expect(large).toHaveLength(1);
      expect(large[0][0].message).toContain('Wire transfer');
    });

    it('does not re-notify when the large dedupeKey already exists', async () => {
      const txn = makeTxn({ amountCents: 60_000 });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: null });
      const notif = buildMockNotifications([`anomaly_large_${txn.id}`]);

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'large_debit')).toHaveLength(0);
    });
  });

  describe('noise reduction (the point of the feature)', () => {
    it('does NOT flag a large-but-normal recurring charge (e.g. rent/mortgage)', async () => {
      // $3,000 mortgage where the merchant averages ~$3,000 with tiny variance
      const txn = makeTxn({ amountCents: 300_000, normalizedMerchantName: 'Langley Federal' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 300_000, stddevCents: 500, count: 12 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(0);
      expect(callsForRule(notif, 'large_debit')).toHaveLength(0);
      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('an unusual large charge fires amount_anomaly ONLY (large_debit is suppressed to avoid double-alert)', async () => {
      // $600 at a merchant that usually charges ~$100, with plenty of history
      const txn = makeTxn({ amountCents: 60_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 10_000, stddevCents: 1_000, count: 8 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'amount_anomaly')).toHaveLength(1);
      expect(callsForRule(notif, 'large_debit')).toHaveLength(0);
    });
  });
});
