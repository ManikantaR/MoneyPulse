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
 * Convenience for the per-transaction execute() call: merchant baseline stats
 * used by the large-debit fallback. Pass `stats: null` to simulate no
 * merchant history (empty stats row).
 */
function mockExecuteSequence(
  db: any,
  {
    stats,
  }: {
    stats: { avgCents: number; stddevCents: number; count: number } | null;
  },
) {
  const statsRows = stats
    ? [{ avg_cents: String(stats.avgCents), stddev_cents: String(stats.stddevCents), txn_count: stats.count }]
    : [];
  db.execute.mockResolvedValueOnce({ rows: statsRows });
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

  // Amount-anomaly (z-score) and duplicate-charge detection have moved to
  // WatchdogDetectorService (`stat_anomaly` / `duplicate_charge`, 11.5) — see
  // watchdog-detector.service.spec.ts for their coverage.

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
      mockExecuteSequence(db, { stats: { avgCents: 300_000, stddevCents: 500, count: 25 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'large_debit')).toHaveLength(0);
      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });

    it('does NOT flag large_debit once enough history exists to defer to stat_anomaly', async () => {
      // Plenty of history (>= MIN_HISTORY) → large-debit fallback steps aside
      // even though the merchant's usual charge is much smaller; stat_anomaly
      // (WatchdogDetectorService) is the sole judge once history is sufficient.
      const txn = makeTxn({ amountCents: 60_000, normalizedMerchantName: 'Acme Corp' });
      const db = buildMockDb(txn);
      mockExecuteSequence(db, { stats: { avgCents: 10_000, stddevCents: 1_000, count: 25 } });
      const notif = buildMockNotifications();

      await makeService(db, notif).detectAnomalies('user-1', ['txn-1']);

      expect(callsForRule(notif, 'large_debit')).toHaveLength(0);
    });
  });
});
