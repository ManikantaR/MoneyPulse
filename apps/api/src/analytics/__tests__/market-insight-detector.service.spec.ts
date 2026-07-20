import { describe, it, expect, vi } from 'vitest';
import { MarketInsightDetectorService } from '../market-insight-detector.service';
import { standardMonthlyPaymentCents, computeLoanState } from '@moneypulse/shared';

function arrWithChain(data: any[]) {
  return Object.assign([...data], {
    orderBy: () => ({ limit: (n: number) => Promise.resolve(data.slice(0, n)) }),
  });
}

function buildDb(selectQueue: any[], executeQueue: any[] = []) {
  const db: any = {
    select: vi.fn(() => ({
      from: () => ({ where: () => selectQueue.shift() }),
    })),
    execute: vi.fn(),
  };
  for (const r of executeQueue) db.execute.mockResolvedValueOnce(r);
  return db;
}

function buildNotifications(existingKeys: string[] = []) {
  return {
    findByMetadata: vi.fn(async (_u: string, key: string) => existingKeys.includes(key)),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
}

function callsOfType(notif: any, type: string) {
  return notif.createAndDispatch.mock.calls.filter((c: any[]) => c[0].type === type);
}

describe('MarketInsightDetectorService', () => {
  describe('refi_opportunity', () => {
    it('fires and matches an independent amortization calc within $1/mo', async () => {
      const loan = {
        id: 'loan-1',
        userId: 'user-1',
        name: 'Home Mortgage',
        loanType: 'mortgage',
        originalBalanceCents: 40_000_000, // $400,000
        aprBps: 700, // 7.00%
        termMonths: 360,
        startDate: '2020-01-01',
        scheduledPaymentCents: 266_120, // ~$2,661.20 P+I at 7% / 360mo
      };
      const db = buildDb([[loan]]);
      const notif = buildNotifications();
      const freshness = { getAccountFreshness: vi.fn() };
      const marketData = {
        getLatestWithDeltas: vi.fn().mockResolvedValue({ latestValue: 6.0, delta4Week: null }),
      };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      await svc.checkRefiOpportunities('user-1');

      expect(callsOfType(notif, 'refi_opportunity')).toHaveLength(1);
      const metadata = notif.createAndDispatch.mock.calls[0][0].metadata;

      // Independent calc: replay the loan to "now" for balance/months elapsed, then the
      // standard fixed-payment formula at the market rate over the same remaining term.
      const state = computeLoanState(
        {
          originalBalanceCents: loan.originalBalanceCents,
          aprBps: loan.aprBps,
          scheduledPaymentCents: loan.scheduledPaymentCents,
          startDate: loan.startDate,
        },
        [],
      );
      const remainingTermMonths = loan.termMonths - state.monthsElapsed;
      const expectedMarketPayment = standardMonthlyPaymentCents(
        state.currentBalanceCents,
        600,
        remainingTermMonths,
      );
      const expectedSavings = loan.scheduledPaymentCents - expectedMarketPayment;

      expect(Math.abs(metadata.estimatedMonthlySavingsCents - expectedSavings)).toBeLessThanOrEqual(100);
    });

    it('does NOT fire when the spread is below threshold', async () => {
      const loan = {
        id: 'loan-1',
        userId: 'user-1',
        name: 'Home Mortgage',
        loanType: 'mortgage',
        originalBalanceCents: 40_000_000,
        aprBps: 650, // 6.50% — only 0.5pp above a 6.0% market rate
        termMonths: 360,
        startDate: '2020-01-01',
        scheduledPaymentCents: 252_800,
      };
      const db = buildDb([[loan]]);
      const notif = buildNotifications();
      const freshness = { getAccountFreshness: vi.fn() };
      const marketData = {
        getLatestWithDeltas: vi.fn().mockResolvedValue({ latestValue: 6.0, delta4Week: null }),
      };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      await svc.checkRefiOpportunities('user-1');

      expect(callsOfType(notif, 'refi_opportunity')).toHaveLength(0);
    });
  });

  describe('idle_cash', () => {
    const account = { id: 'acct-1', accountType: 'checking' };

    it('fires when idle cash exceeds the buffer and clears the $100/yr floor', async () => {
      const db = buildDb(
        [[account], [{ idleCashBufferMonths: null }]],
        [
          { rows: [{ account_id: 'acct-1', balance_cents: 5_000_000 }] }, // $50,000 balance
          { rows: [{ total_cents: 300_000 }] }, // $3,000 total trailing-3mo expenses → $1,000/mo avg
        ],
      );
      const notif = buildNotifications();
      const freshness = {
        getAccountFreshness: vi.fn().mockResolvedValue({ accounts: [{ accountId: 'acct-1', status: 'fresh' }] }),
      };
      const marketData = { getLatestWithDeltas: vi.fn().mockResolvedValue({ latestValue: 5.0 }) };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      await svc.checkIdleCash('user-1');

      expect(callsOfType(notif, 'idle_cash')).toHaveLength(1);
      const metadata = notif.createAndDispatch.mock.calls[0][0].metadata;
      expect(metadata.bufferCents).toBe(100_000); // 1 month × $1,000
      expect(metadata.idleCents).toBe(4_900_000);
      expect(metadata.foregoneCentsPerYear).toBe(Math.round(4_900_000 * 0.05));
    });

    it('is skipped (freshness-gated) when a relevant account balance is stale', async () => {
      const db = buildDb([[account], [{ idleCashBufferMonths: null }]]);
      const notif = buildNotifications();
      const freshness = {
        getAccountFreshness: vi.fn().mockResolvedValue({ accounts: [{ accountId: 'acct-1', status: 'stale' }] }),
      };
      const marketData = { getLatestWithDeltas: vi.fn() };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      await svc.checkIdleCash('user-1');

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
      expect(marketData.getLatestWithDeltas).not.toHaveBeenCalled();
    });
  });

  describe('fuel_vs_market', () => {
    it('fires when personal MoM% diverges from market MoM% by more than 10pp with >= 3 txns', async () => {
      const db = buildDb(
        [],
        [
          {
            rows: [
              { month: '2024-03-01', total_cents: 20_000, txn_count: 5 }, // +100% MoM vs prior
              { month: '2024-02-01', total_cents: 10_000, txn_count: 4 },
            ],
          },
        ],
      );
      const notif = buildNotifications();
      const freshness = { getAccountFreshness: vi.fn() };
      // Market moved from 4.00 -> 4.20 (+5% MoM) — far below the 100% personal move.
      const marketData = {
        getLatestWithDeltas: vi.fn().mockResolvedValue({ latestValue: 4.2, delta4Week: 0.2 }),
      };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      // @ts-expect-error accessing private method for a direct, single-user unit test
      await svc.checkCategoryVsMarket('user-1', 'fuel_vs_market', 'Fuel', 'gas_retail_regular', 'gas');

      expect(callsOfType(notif, 'fuel_vs_market')).toHaveLength(1);
    });

    it('does NOT fire with fewer than 3 txns this month', async () => {
      const db = buildDb(
        [],
        [
          {
            rows: [
              { month: '2024-03-01', total_cents: 20_000, txn_count: 2 },
              { month: '2024-02-01', total_cents: 10_000, txn_count: 4 },
            ],
          },
        ],
      );
      const notif = buildNotifications();
      const freshness = { getAccountFreshness: vi.fn() };
      const marketData = { getLatestWithDeltas: vi.fn() };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      // @ts-expect-error accessing private method for a direct, single-user unit test
      await svc.checkCategoryVsMarket('user-1', 'fuel_vs_market', 'Fuel', 'gas_retail_regular', 'gas');

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
      expect(marketData.getLatestWithDeltas).not.toHaveBeenCalled();
    });
  });

  describe('market_update (gas dip)', () => {
    it('fires when state gas price moved > 3% WoW', async () => {
      const rows = arrWithChain([
        { periodDate: '2024-03-15', value: '3.60' },
        { periodDate: '2024-03-08', value: '3.40' }, // +5.9% WoW
      ]);
      const db = buildDb([rows]);
      const notif = buildNotifications();
      const freshness = { getAccountFreshness: vi.fn() };
      const marketData = { getGasState: vi.fn().mockReturnValue('SCA') };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      await svc.checkGasDip('user-1');

      expect(callsOfType(notif, 'market_update')).toHaveLength(1);
      const metadata = notif.createAndDispatch.mock.calls[0][0].metadata;
      expect(metadata.wowPercent).toBeCloseTo(5.88, 1);
    });

    it('does NOT fire when the WoW move is under 3%', async () => {
      const rows = arrWithChain([
        { periodDate: '2024-03-15', value: '3.50' },
        { periodDate: '2024-03-08', value: '3.45' }, // +1.4% WoW
      ]);
      const db = buildDb([rows]);
      const notif = buildNotifications();
      const freshness = { getAccountFreshness: vi.fn() };
      const marketData = { getGasState: vi.fn().mockReturnValue('SCA') };
      const svc = new MarketInsightDetectorService(db, notif as any, freshness as any, marketData as any);

      await svc.checkGasDip('user-1');

      expect(notif.createAndDispatch).not.toHaveBeenCalled();
    });
  });
});
