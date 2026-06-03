import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForecastService } from '../forecast.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { NotificationsService } from '../../notifications/notifications.service';

/** Build a mock db.execute that returns the given rows. */
function makeDb(responses: Array<{ rows: any[] }>) {
  let callIndex = 0;
  return {
    execute: vi.fn().mockImplementation(() => {
      const r = responses[callIndex];
      callIndex = Math.min(callIndex + 1, responses.length - 1);
      return Promise.resolve(r);
    }),
  };
}

/** Checking account helper */
function checkingAccount(id = 'acct-1', balance = 500000) {
  return { account_id: id, nickname: 'Checking', account_type: 'checking', balance_cents: String(balance) };
}

describe('ForecastService', () => {
  let service: ForecastService;
  let mockDb: ReturnType<typeof makeDb>;
  let mockNotifications: Partial<NotificationsService>;

  beforeEach(async () => {
    mockNotifications = {
      findByMetadata: vi.fn().mockResolvedValue(false),
      createAndDispatch: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function buildService(dbResponses: Array<{ rows: any[] }>) {
    mockDb = makeDb(dbResponses);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(ForecastService);
    return service;
  }

  it('projects decreasing balance with avg daily spend (no bills)', async () => {
    // $5,000 balance, no recurring bills, $50/day avg debit
    const totalDebit = 50 * 100 * 90; // 90-day lookback $50/day
    const svc = await buildService([
      { rows: [checkingAccount('acct-1', 500_000)] },    // accounts: $5,000
      { rows: [] },                                        // bills: none
      { rows: [{ account_id: 'acct-1', total_credit: '0', total_debit: String(totalDebit) }] }, // spend
    ]);

    const result = await svc.forecast('user-1', 90);
    expect(result.accounts).toHaveLength(1);

    const series = result.accounts[0].series;
    expect(series).toHaveLength(90);
    // Each day decreases by ~$50 (5000 cents)
    expect(series[0].projectedCents).toBeCloseTo(500_000 - 5_000, -2);
    expect(series[89].projectedCents).toBeCloseTo(500_000 - 90 * 5_000, -2);
  });

  it('computes low-balance date correctly at $1,000 threshold', async () => {
    // $5,000 balance, $50/day → balance < $1,000 after 80 days
    const totalDebit = 50 * 100 * 90;
    const svc = await buildService([
      { rows: [checkingAccount('acct-1', 500_000)] },
      { rows: [] },
      { rows: [{ account_id: 'acct-1', total_credit: '0', total_debit: String(totalDebit) }] },
    ]);

    const result = await svc.forecast('user-1', 90);
    // Should cross below $1,000 (100,000 cents) at roughly day 80
    expect(result.accounts[0].lowBalanceDate).toBeDefined();
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].projectedCents).toBeLessThan(100_000);
  });

  it('deducts bill on exact projected date in net-worth series', async () => {
    // $5,000 balance, $0 daily net, $200 monthly bill 15 days from now
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    const svc = await buildService([
      { rows: [checkingAccount('acct-1', 500_000)] },
      { rows: [{ id: 'bill-1', normalized_name: 'Netflix', expected_amount_cents: '20000', frequency: 'monthly', next_expected_date: futureDateStr }] },
      { rows: [{ account_id: 'acct-1', total_credit: '0', total_debit: '0' }] },
    ]);

    const result = await svc.forecast('user-1', 30);
    const netSeries = result.netWorthSeries;
    // Day 14 should be $5,000; day 15 should be $5,000 - $200 = $4,800
    const day14 = netSeries[13];
    const day15 = netSeries[14];
    expect(day14.projectedCents).toBe(500_000);
    expect(day15.projectedCents).toBe(500_000 - 20_000);
  });

  it('works when there is no transaction history (flat line from balance)', async () => {
    const svc = await buildService([
      { rows: [checkingAccount('acct-1', 300_000)] },
      { rows: [] },
      { rows: [] }, // no spend data
    ]);

    const result = await svc.forecast('user-1', 30);
    expect(result.accounts[0].series).toHaveLength(30);
    // All days should stay at initial balance with no avg net
    result.accounts[0].series.forEach((p) => {
      expect(p.projectedCents).toBe(300_000);
    });
  });

  it('returns empty when user has no accounts', async () => {
    const svc = await buildService([{ rows: [] }]);
    const result = await svc.forecast('user-no-accounts', 30);
    expect(result.accounts).toHaveLength(0);
    expect(result.netWorthSeries).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
  });

  it('does not alert for credit card accounts', async () => {
    const svc = await buildService([
      { rows: [{ account_id: 'cc-1', nickname: 'Visa', account_type: 'credit_card', balance_cents: '500' }] },
      { rows: [] },
      { rows: [{ account_id: 'cc-1', total_credit: '0', total_debit: '999999' }] },
    ]);

    const result = await svc.forecast('user-1', 30);
    // Credit card is not an asset type — no alerts even if balance goes very negative
    expect(result.alerts).toHaveLength(0);
    expect(result.accounts[0].lowBalanceDate).toBeUndefined();
  });

  it('checkAndAlertAll sends notification and skips if already sent this week', async () => {
    const totalDebit = 50 * 100 * 90; // $50/day avg
    // Two users
    const userRows = { rows: [{ user_id: 'u1' }] };
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce(userRows)  // get distinct users
        // forecast for u1: accounts, bills, spend
        .mockResolvedValueOnce({ rows: [checkingAccount('acct-1', 50_000)] }) // balance < $1,000 already
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ account_id: 'acct-1', total_credit: '0', total_debit: String(totalDebit) }] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastService,
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(ForecastService);

    await service.checkAndAlertAll();
    // Should have tried to create a notification
    expect(mockNotifications.createAndDispatch).toHaveBeenCalledTimes(1);

    // Second run — findByMetadata now returns true (already sent)
    (mockNotifications.findByMetadata as vi.Mock).mockResolvedValue(true);
    db.execute
      .mockResolvedValueOnce(userRows)
      .mockResolvedValueOnce({ rows: [checkingAccount('acct-1', 50_000)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ account_id: 'acct-1', total_credit: '0', total_debit: String(totalDebit) }] });

    await service.checkAndAlertAll();
    // No additional notification — deduped
    expect(mockNotifications.createAndDispatch).toHaveBeenCalledTimes(1);
  });
});
