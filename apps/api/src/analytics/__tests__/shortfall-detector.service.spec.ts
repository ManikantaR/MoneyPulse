import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShortfallDetectorService } from '../shortfall-detector.service';

const USER_ID = 'user-1';
const PRIMARY_ACCOUNT_ID = 'acct-checking-1';

/**
 * checkAndAlertUser's Promise.all fires getFloorCents() and
 * getPrimaryCheckingAccountId() synchronously in array order (each runs up to
 * its first await before the next element starts), so db.execute is called
 * 1) floor lookup, 2) primary-checking lookup, in that deterministic order.
 */
function buildMockDb(floorCents: number | null = null) {
  return {
    execute: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ cashflow_floor_cents: floorCents }] })
      .mockResolvedValueOnce({ rows: [{ account_id: PRIMARY_ACCOUNT_ID }] }),
  };
}

function buildMockForecast(series: Array<{ date: string; projectedCents: number }>) {
  return {
    forecast: vi.fn().mockResolvedValue({
      accounts: [{ accountId: PRIMARY_ACCOUNT_ID, accountName: 'Checking', series }],
      netWorthSeries: [],
      alerts: [],
    }),
  };
}

function buildMockBills(bills: any[]) {
  return {
    findUpcoming: vi.fn().mockResolvedValue(bills),
  };
}

function buildMockNotifications(alreadySent = false) {
  return {
    findByMetadata: vi.fn().mockResolvedValue(alreadySent),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBill(overrides: Record<string, any> = {}) {
  return {
    id: 'bill-mortgage',
    normalizedName: 'Mortgage',
    expectedAmountCents: 200_000, // $2,000
    nextExpectedDate: new Date(2026, 8, 7), // 2026-09-07, local
    ...overrides,
  };
}

describe('ShortfallDetectorService', () => {
  let db: ReturnType<typeof buildMockDb>;

  beforeEach(() => {
    db = buildMockDb();
  });

  it('emits a cashflow_shortfall notification with the right amount and voiceSummary when the forecast dips below the floor before a bill', async () => {
    // Default floor: $500 (50,000 cents). Series nets to -$1,200 by the bill's due
    // date once the $2,000 mortgage payment is accounted for, so the shortfall is
    // $500 - (-$1,200) = $1,700 below floor.
    const series = [
      { date: '2026-09-06', projectedCents: 90_000 }, // $900, before the bill lands
      { date: '2026-09-07', projectedCents: 80_000 }, // $800, due date
    ];
    const forecast = buildMockForecast(series);
    const bills = buildMockBills([makeBill()]);
    const notifications = buildMockNotifications();

    const svc = new ShortfallDetectorService(db as any, forecast as any, bills as any, notifications as any);
    const result = await svc.checkAndAlertUser(USER_ID);

    expect(result.alerted).toBe(true);
    expect(notifications.createAndDispatch).toHaveBeenCalledTimes(1);
    const call = notifications.createAndDispatch.mock.calls[0][0];
    expect(call.type).toBe('cashflow_shortfall');
    expect(call.metadata.shortfallCents).toBe(170_000); // $1,700
    expect(call.voiceSummary).toContain('1700 dollars short');
    expect(call.voiceSummary).toContain('Mortgage');
    expect(call.message).toContain('$1700');
  });

  it('emits nothing when the projected balance stays above the floor', async () => {
    const series = [
      { date: '2026-09-06', projectedCents: 900_000 }, // $9,000
      { date: '2026-09-07', projectedCents: 890_000 }, // $8,900, still well above floor after the bill
    ];
    const forecast = buildMockForecast(series);
    const bills = buildMockBills([makeBill({ expectedAmountCents: 10_000 })]); // $100 bill
    const notifications = buildMockNotifications();

    const svc = new ShortfallDetectorService(db as any, forecast as any, bills as any, notifications as any);
    const result = await svc.checkAndAlertUser(USER_ID);

    expect(result.alerted).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });

  it('does not repeat an already-sent shortfall for the same bill/due-date (dedup)', async () => {
    const series = [
      { date: '2026-09-06', projectedCents: 90_000 },
      { date: '2026-09-07', projectedCents: 80_000 },
    ];
    const forecast = buildMockForecast(series);
    const bills = buildMockBills([makeBill()]);
    const notifications = buildMockNotifications(true); // findByMetadata → already sent

    const svc = new ShortfallDetectorService(db as any, forecast as any, bills as any, notifications as any);
    const result = await svc.checkAndAlertUser(USER_ID);

    expect(result.alerted).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
    expect(notifications.findByMetadata).toHaveBeenCalledWith(
      USER_ID,
      'cashflow_shortfall_bill-mortgage_2026-09-07',
    );
  });

  it('has no upcoming bills or no checking account → emits nothing', async () => {
    const forecast = buildMockForecast([]);
    const bills = buildMockBills([]);
    const notifications = buildMockNotifications();

    const svc = new ShortfallDetectorService(db as any, forecast as any, bills as any, notifications as any);
    const result = await svc.checkAndAlertUser(USER_ID);

    expect(result.alerted).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });
});
