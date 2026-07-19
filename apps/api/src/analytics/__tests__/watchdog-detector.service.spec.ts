import { describe, it, expect, vi } from 'vitest';
import { WatchdogDetectorService } from '../watchdog-detector.service';

function makeTxn(overrides: Record<string, any> = {}) {
  return {
    id: 'txn-1',
    accountId: 'acct-1',
    userId: 'user-1',
    txnHash: 'hash-1',
    amountCents: 5_000,
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

function buildMockDb(txn: any, executeResults: any[] = []) {
  const db: any = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(txn ? [txn] : []),
        }),
      }),
    }),
    execute: vi.fn(),
  };
  for (const result of executeResults) {
    db.execute.mockResolvedValueOnce(result);
  }
  return db;
}

function buildMockNotifications(existingKeys: string[] = []) {
  return {
    findByMetadata: vi.fn(async (_u: string, key: string) => existingKeys.includes(key)),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
}

function callsOfType(notif: any, type: string) {
  return notif.createAndDispatch.mock.calls.filter((c: any[]) => c[0].type === type);
}

describe('WatchdogDetectorService', () => {
  describe('duplicate_charge', () => {
    it('fires when a same-account/merchant/amount txn exists within 48h', async () => {
      const txn = makeTxn();
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [
        { rows: [{ id: 'other-txn', txn_hash: 'hash-2' }] }, // duplicate lookup
        { rows: [] }, // recurring occurrences lookup (only 1 → not recurring)
        { rows: [] }, // stat anomaly per-category / per-account
      ]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'duplicate_charge')).toHaveLength(1);
    });

    it('does NOT fire when no matching transaction exists', async () => {
      const txn = makeTxn();
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [{ rows: [] }, { rows: [] }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'duplicate_charge')).toHaveLength(0);
    });
  });

  describe('new_recurring', () => {
    it('fires the moment a merchant reaches the minimum occurrence count', async () => {
      const txn = makeTxn({ amountCents: 999 });
      const notif = buildMockNotifications();
      const occurrences = [
        { id: 'o1', date: new Date('2024-01-15'), amount_cents: 999 },
        { id: 'o2', date: new Date('2024-02-15'), amount_cents: 999 },
        { id: 'o3', date: new Date('2024-03-15'), amount_cents: 999 },
      ];
      const db = buildMockDb(txn, [
        { rows: [] }, // duplicate lookup
        { rows: occurrences }, // recurring occurrences
        { rows: [] }, // stat anomaly
      ]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'new_recurring')).toHaveLength(1);
    });

    it('does NOT fire when fewer than the minimum occurrences exist', async () => {
      const txn = makeTxn({ amountCents: 999 });
      const notif = buildMockNotifications();
      const occurrences = [
        { id: 'o1', date: new Date('2024-02-15'), amount_cents: 999 },
        { id: 'o2', date: new Date('2024-03-15'), amount_cents: 999 },
      ];
      const db = buildMockDb(txn, [{ rows: [] }, { rows: occurrences }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'new_recurring')).toHaveLength(0);
    });
  });

  describe('price_creep', () => {
    it('fires when the latest amount deviates from the trailing modal amount', async () => {
      const txn = makeTxn({ amountCents: 1_500 }); // was $10, now $15 → +50%
      const notif = buildMockNotifications();
      const occurrences = [
        { id: 'o1', date: new Date('2023-12-15'), amount_cents: 1_000 },
        { id: 'o2', date: new Date('2024-01-15'), amount_cents: 1_000 },
        { id: 'o3', date: new Date('2024-02-15'), amount_cents: 1_000 },
        { id: 'o4', date: new Date('2024-03-15'), amount_cents: 1_500 },
      ];
      const db = buildMockDb(txn, [{ rows: [] }, { rows: occurrences }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'price_creep')).toHaveLength(1);
    });

    it('does NOT fire when the amount is within tolerance', async () => {
      const txn = makeTxn({ amountCents: 1_005 }); // $10.05 vs $10.00 modal — under 2%/$1 floor
      const notif = buildMockNotifications();
      const occurrences = [
        { id: 'o1', date: new Date('2023-12-15'), amount_cents: 1_000 },
        { id: 'o2', date: new Date('2024-01-15'), amount_cents: 1_000 },
        { id: 'o3', date: new Date('2024-02-15'), amount_cents: 1_000 },
        { id: 'o4', date: new Date('2024-03-15'), amount_cents: 1_005 },
      ];
      const db = buildMockDb(txn, [{ rows: [] }, { rows: occurrences }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'price_creep')).toHaveLength(0);
    });
  });

  describe('fee_detected', () => {
    it('fires when the description matches a fee/interest pattern', async () => {
      const txn = makeTxn({ description: 'Overdraft Fee charged', categoryId: null });
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [{ rows: [] }, { rows: [] }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'fee_detected')).toHaveLength(1);
    });

    it('does NOT fire when the description has no fee pattern', async () => {
      const txn = makeTxn({ description: 'Coffee shop purchase' });
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [{ rows: [] }, { rows: [] }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'fee_detected')).toHaveLength(0);
    });
  });

  describe('stat_anomaly', () => {
    it('fires when the amount is a z-score outlier vs a sufficiently-sampled baseline', async () => {
      const txn = makeTxn({ amountCents: 12_000, categoryId: 'cat-1' });
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [
        { rows: [] }, // duplicate lookup
        { rows: [] }, // recurring occurrences (merchantKey present but only 1 occ → not recurring; no execute call actually needed but harmless extra)
        { rows: [{ avg_cents: '3000', stddev_cents: '0', txn_count: 25 }] }, // per-category stats
      ]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'stat_anomaly')).toHaveLength(1);
    });

    it('does NOT fire when there are fewer than the minimum samples', async () => {
      const txn = makeTxn({ amountCents: 12_000, categoryId: 'cat-1' });
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [
        { rows: [] },
        { rows: [] },
        { rows: [{ avg_cents: '3000', stddev_cents: '0', txn_count: 5 }] }, // per-category: too few
        { rows: [{ avg_cents: '3000', stddev_cents: '0', txn_count: 5 }] }, // per-account fallback: also too few
      ]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'stat_anomaly')).toHaveLength(0);
    });

    it('does NOT fire for amounts at or below the minimum floor', async () => {
      const txn = makeTxn({ amountCents: 2_000, categoryId: 'cat-1' });
      const notif = buildMockNotifications();
      const db = buildMockDb(txn, [{ rows: [] }, { rows: [] }]);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.runTransactionScoped('user-1', ['txn-1']);

      expect(callsOfType(notif, 'stat_anomaly')).toHaveLength(0);
    });
  });

  describe('budget_pace', () => {
    function buildBudgetDb(budgets: any[], spentCents: number) {
      const db: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(budgets),
          }),
        }),
        execute: vi.fn().mockResolvedValue({ rows: [{ spent_cents: spentCents }] }),
      };
      return db;
    }

    it('fires when the linear projection exceeds 110% of the budget past day 7', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-10T00:00:00Z')); // day 10 of 31
      const notif = buildMockNotifications();
      const budgets = [{ id: 'budget-1', categoryId: 'cat-1', amountCents: 10_000, period: 'monthly' }];
      // Spent $6,000 by day 10 → projected ≈ $18,600 → 186% of budget
      const db = buildBudgetDb(budgets, 6_000);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.checkBudgetPace('user-1');
      vi.useRealTimers();

      expect(callsOfType(notif, 'budget_pace')).toHaveLength(1);
    });

    it('does NOT fire before day 7 of the period', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-03T00:00:00Z')); // day 3
      const notif = buildMockNotifications();
      const budgets = [{ id: 'budget-1', categoryId: 'cat-1', amountCents: 10_000, period: 'monthly' }];
      const db = buildBudgetDb(budgets, 6_000);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.checkBudgetPace('user-1');
      vi.useRealTimers();

      expect(callsOfType(notif, 'budget_pace')).toHaveLength(0);
    });

    it('does NOT fire when pace is under 110% of the budget', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-10T00:00:00Z')); // day 10 of 31
      const notif = buildMockNotifications();
      const budgets = [{ id: 'budget-1', categoryId: 'cat-1', amountCents: 10_000, period: 'monthly' }];
      // Spent $3,000 by day 10 → projected ≈ $9,300 → 93% of budget
      const db = buildBudgetDb(budgets, 3_000);
      const svc = new WatchdogDetectorService(db, notif as any);

      await svc.checkBudgetPace('user-1');
      vi.useRealTimers();

      expect(callsOfType(notif, 'budget_pace')).toHaveLength(0);
    });
  });
});
