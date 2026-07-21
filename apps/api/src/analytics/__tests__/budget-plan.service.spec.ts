import { BudgetPlanService } from '../budget-plan.service';

describe('BudgetPlanService', () => {
  const userId = 'user-1';

  // Synthetic placeholder figures only — no real paystub data.
  function makeProfile(overrides: Record<string, unknown> = {}) {
    return {
      id: 'profile-1',
      userId,
      effectiveDate: '2026-01-01',
      payFrequency: 'biweekly',
      grossPayCents: 300000,
      pretax401kCents: 20000,
      hsaCents: 5000,
      esppContributionCents: 5000,
      deletedAt: null,
      ...overrides,
    };
  }

  function makeDb(profileRows: unknown[], bucketRows: unknown[]) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => profileRows,
            }),
          }),
        }),
      }),
      execute: async () => bucketRows,
    };
  }

  it('computes smoothed monthly gross for biweekly (26 pay periods/yr)', async () => {
    const db = makeDb([makeProfile({ payFrequency: 'biweekly', grossPayCents: 300000 })], []);
    const service = new BudgetPlanService(db as any);
    const result = await service.budgetPlan(userId, '2026-03');
    expect(result.hasProfile).toBe(true);
    // 300000 * 26 / 12 = 650000
    expect(result.profile?.monthlyGrossCents).toBe(650000);
  });

  it('computes smoothed monthly gross for semi_monthly (24 pay periods/yr)', async () => {
    const db = makeDb([makeProfile({ payFrequency: 'semi_monthly', grossPayCents: 250000 })], []);
    const service = new BudgetPlanService(db as any);
    const result = await service.budgetPlan(userId, '2026-03');
    // 250000 * 24 / 12 = 500000
    expect(result.profile?.monthlyGrossCents).toBe(500000);
  });

  it('scales profile savings (401k+HSA+ESPP) by the same payPeriodsPerYear/12 factor as gross', async () => {
    const db = makeDb(
      [
        makeProfile({
          payFrequency: 'biweekly',
          grossPayCents: 300000,
          pretax401kCents: 20000,
          hsaCents: 5000,
          esppContributionCents: 5000,
        }),
      ],
      [],
    );
    const service = new BudgetPlanService(db as any);
    const result = await service.budgetPlan(userId, '2026-03');
    // Per-paycheck savings = 30000; scaled by 26/12 = 65000. No txn savings_debt spend.
    expect(result.savings?.actualCents).toBe(65000);
    // NOT the raw unscaled per-paycheck figure.
    expect(result.savings?.actualCents).not.toBe(30000);
  });

  it('returns hasProfile:false when queried month predates the earliest profile', async () => {
    // Only a later profile exists; forward-only lookup must not backfill it.
    const db = makeDb([], []);
    const service = new BudgetPlanService(db as any);
    const result = await service.budgetPlan(userId, '2025-06');
    expect(result.hasProfile).toBe(false);
    expect(result.needs).toBeNull();
    expect(result.wants).toBeNull();
    expect(result.savings).toBeNull();
  });

  it('computes needs/wants percentages against the smoothed monthly gross denominator', async () => {
    const db = makeDb(
      [makeProfile({ payFrequency: 'biweekly', grossPayCents: 300000 })],
      [
        { bucket: 'needs', total_cents: 195000 },
        { bucket: 'wants', total_cents: 130000 },
      ],
    );
    const service = new BudgetPlanService(db as any);
    const result = await service.budgetPlan(userId, '2026-03');
    // monthlyGrossCents = 650000
    expect(result.needs?.actualCents).toBe(195000);
    expect(result.needs?.actualPercent).toBeCloseTo(195000 / 650000, 5);
    expect(result.wants?.actualCents).toBe(130000);
    expect(result.wants?.actualPercent).toBeCloseTo(130000 / 650000, 5);
  });
});
