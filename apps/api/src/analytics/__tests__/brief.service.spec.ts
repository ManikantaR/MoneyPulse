import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BriefService, computeSafeToSpend } from '../brief.service';

describe('computeSafeToSpend', () => {
  it('returns the minimum projected balance within the horizon', () => {
    const forecast = {
      netWorthSeries: [
        { date: '2026-07-20', projectedCents: 500_00 },
        { date: '2026-07-21', projectedCents: 300_00 },
        { date: '2026-07-22', projectedCents: 800_00 },
      ],
    };
    const result = computeSafeToSpend(forecast, 14);
    expect(result.safeToSpendCents).toBe(300_00);
    expect(result.minProjectedCents).toBe(300_00);
    expect(result.minDate).toBe('2026-07-21');
  });

  it('clamps a negative minimum projection to zero', () => {
    const forecast = {
      netWorthSeries: [{ date: '2026-07-20', projectedCents: -50_00 }],
    };
    const result = computeSafeToSpend(forecast, 14);
    expect(result.safeToSpendCents).toBe(0);
    expect(result.minProjectedCents).toBe(-50_00);
  });

  it('only considers points within the horizon window', () => {
    const forecast = {
      netWorthSeries: [
        { date: '2026-07-20', projectedCents: 500_00 },
        { date: '2026-07-21', projectedCents: 1_00 }, // outside 1-day horizon
      ],
    };
    const result = computeSafeToSpend(forecast, 1);
    expect(result.safeToSpendCents).toBe(500_00);
  });

  it('returns zero for an empty series', () => {
    const result = computeSafeToSpend({ netWorthSeries: [] }, 14);
    expect(result).toEqual({ safeToSpendCents: 0, minProjectedCents: 0, minDate: null });
  });
});

const mockDb = {
  execute: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};

const mockNotifications = {
  findByMetadata: vi.fn().mockResolvedValue(false),
  createAndDispatch: vi.fn().mockResolvedValue({ id: 'notif-1' }),
  getUnbriefedInsights: vi.fn().mockResolvedValue([]),
  markBriefed: vi.fn().mockResolvedValue(undefined),
};

const mockForecast = {
  forecast: vi.fn().mockResolvedValue({
    accounts: [],
    netWorthSeries: [{ date: '2026-07-20', projectedCents: 100_000 }],
    alerts: [],
  }),
};

const mockBills = {
  findUpcoming: vi.fn().mockResolvedValue([]),
};

const mockLoans = {
  findDueWithin: vi.fn().mockResolvedValue([]),
};

function makeService() {
  return new BriefService(
    mockDb as any,
    mockNotifications as any,
    mockForecast as any,
    mockBills as any,
    mockLoans as any,
  );
}

function setYesterdayAndBudgetResponses(
  yesterday = { total: 8400, count: 3, largest_amount: 5000, largest_merchant: 'Cafe' },
  budgets: Array<{ category_name: string; budget_cents: number; spent_cents: number }> = [],
) {
  mockDb.execute
    .mockResolvedValueOnce({ rows: [yesterday] }) // yesterday spend
    .mockResolvedValueOnce({ rows: budgets }); // budgets
}

describe('BriefService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValue([
      { timezone: 'America/New_York', dailyBriefEnabled: true, dailyBriefHour: 7 },
    ]);
    mockForecast.forecast.mockResolvedValue({
      accounts: [],
      netWorthSeries: [{ date: '2026-07-20', projectedCents: 100_000 }],
      alerts: [],
    });
    mockBills.findUpcoming.mockResolvedValue([]);
    mockLoans.findDueWithin.mockResolvedValue([]);
    mockNotifications.getUnbriefedInsights.mockResolvedValue([]);
    mockNotifications.findByMetadata.mockResolvedValue(false);
  });

  describe('buildBrief', () => {
    it('includes safe-to-spend and yesterday sections', async () => {
      setYesterdayAndBudgetResponses();
      const svc = makeService();
      const result = await svc.buildBrief('user-1', 'America/New_York');

      const sts = result.sections.find((s) => s.label.includes('Safe to spend'));
      expect(sts).toBeDefined();
      expect(sts!.value).toBe('$1000.00');

      const yesterday = result.sections.find((s) => s.label === 'Yesterday');
      expect(yesterday).toBeDefined();
      expect(yesterday!.value).toContain('$84.00');
      expect(yesterday!.value).toContain('3 txns');
      expect(yesterday!.value).toContain('Cafe');
    });

    it('includes budget pace section only when a budget is projected over 100%', async () => {
      // Pin "today" to early in the month so the day-of-month/days-in-month
      // pace projection is stable regardless of when this suite runs.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
      try {
        setYesterdayAndBudgetResponses(
          { total: 0, count: 0, largest_amount: 0, largest_merchant: null },
          [{ category_name: 'Dining', budget_cents: 10000, spent_cents: 9000 }],
        );
        const svc = makeService();
        const result = await svc.buildBrief('user-1', 'America/New_York');

        const pace = result.sections.find((s) => s.label.includes('Budget pace'));
        expect(pace).toBeDefined();
        expect(pace!.value).toContain('Dining');
      } finally {
        vi.useRealTimers();
      }
    });

    it('omits budget pace section when no budget is over pace', async () => {
      setYesterdayAndBudgetResponses(
        { total: 0, count: 0, largest_amount: 0, largest_merchant: null },
        [{ category_name: 'Dining', budget_cents: 100000, spent_cents: 100 }],
      );
      const svc = makeService();
      const result = await svc.buildBrief('user-1', 'America/New_York');

      expect(result.sections.find((s) => s.label.includes('Budget pace'))).toBeUndefined();
    });

    it('includes bills-due section merging bills and loan payments, sorted by date', async () => {
      setYesterdayAndBudgetResponses();
      mockBills.findUpcoming.mockResolvedValue([
        { normalizedName: 'Netflix', nextExpectedDate: new Date('2026-07-25'), expectedAmountCents: 1599 },
      ]);
      mockLoans.findDueWithin.mockResolvedValue([
        { id: 'loan-1', name: 'Car Loan', dueDate: '2026-07-21', amountCents: 42000 },
      ]);

      const svc = makeService();
      const result = await svc.buildBrief('user-1', 'America/New_York');

      const bills = result.sections.find((s) => s.label === 'Bills due this week');
      expect(bills).toBeDefined();
      // Car Loan (07-21) should come before Netflix (07-25)
      expect(bills!.value.indexOf('Car Loan')).toBeLessThan(bills!.value.indexOf('Netflix'));
    });

    it('includes batched insights and returns their ids for briefing', async () => {
      setYesterdayAndBudgetResponses();
      mockNotifications.getUnbriefedInsights.mockResolvedValue([
        { id: 'n1', title: 'Account stale' },
        { id: 'n2', title: 'Unusual spend' },
      ]);

      const svc = makeService();
      const result = await svc.buildBrief('user-1', 'America/New_York');

      const insightsSection = result.sections.find((s) => s.label === 'Also worth knowing');
      expect(insightsSection).toBeDefined();
      expect(insightsSection!.value).toContain('Account stale');
      expect(insightsSection!.value).toContain('Unusual spend');
      expect(result.insightIds).toEqual(['n1', 'n2']);
    });
  });

  describe('deliver', () => {
    it('returns false and skips dispatch when brief is disabled', async () => {
      mockDb.limit.mockResolvedValueOnce([{ timezone: 'America/New_York', dailyBriefEnabled: false }]);
      const svc = makeService();
      const delivered = await svc.deliver('user-1');

      expect(delivered).toBe(false);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });

    it('returns false when user settings not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      const svc = makeService();
      const delivered = await svc.deliver('user-999');

      expect(delivered).toBe(false);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });

    it('dispatches once with notificationType daily_brief and dedupeKey, and marks insights briefed', async () => {
      setYesterdayAndBudgetResponses();
      mockNotifications.getUnbriefedInsights.mockResolvedValue([{ id: 'n1', title: 'Account stale' }]);

      const svc = makeService();
      const delivered = await svc.deliver('user-1');

      expect(delivered).toBe(true);
      expect(mockNotifications.createAndDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'daily_brief',
          notificationType: 'daily_brief',
          dedupeKey: expect.stringContaining('brief_daily_user-1_'),
        }),
      );
      expect(mockNotifications.markBriefed).toHaveBeenCalledWith(['n1']);
    });

    it('is idempotent: skips dispatch when already delivered today', async () => {
      mockNotifications.findByMetadata.mockResolvedValue(true);
      const svc = makeService();
      const delivered = await svc.deliver('user-1');

      expect(delivered).toBe(false);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });
  });

  describe('deliverAllEnabled', () => {
    it('only delivers to users whose local hour matches their configured brief hour', async () => {
      const realHour = new Date().getUTCHours();
      // One user configured for the current UTC hour, one configured for a different hour.
      const otherHour = (realHour + 5) % 24;
      mockDb.limit
        .mockResolvedValueOnce([
          { userId: 'u1', timezone: 'UTC', dailyBriefHour: realHour },
          { userId: 'u2', timezone: 'UTC', dailyBriefHour: otherHour },
        ])
        .mockResolvedValue([{ timezone: 'UTC', dailyBriefEnabled: true, dailyBriefHour: realHour }]);

      setYesterdayAndBudgetResponses();

      const svc = makeService();
      await svc.deliverAllEnabled();

      expect(mockNotifications.createAndDispatch).toHaveBeenCalledTimes(1);
      const call = mockNotifications.createAndDispatch.mock.calls[0][0];
      expect(call.userId).toBe('u1');
    });

    it('continues after one user delivery fails', async () => {
      const realHour = new Date().getUTCHours();
      mockDb.limit
        .mockResolvedValueOnce([
          { userId: 'u1', timezone: 'UTC', dailyBriefHour: realHour },
          { userId: 'u2', timezone: 'UTC', dailyBriefHour: realHour },
        ])
        .mockResolvedValueOnce([]) // u1 getUserSettings -> not found, throws nothing but returns false
        .mockResolvedValueOnce([{ timezone: 'UTC', dailyBriefEnabled: true, dailyBriefHour: realHour }]); // u2

      setYesterdayAndBudgetResponses();

      const svc = makeService();
      await expect(svc.deliverAllEnabled()).resolves.not.toThrow();
      expect(mockNotifications.createAndDispatch).toHaveBeenCalledTimes(1);
    });
  });
});
