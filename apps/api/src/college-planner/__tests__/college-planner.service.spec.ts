import {
  CollegePlannerService,
  COLLEGE_PLANNER_CALCULATION_VERSION,
} from '../college-planner.service';

describe('CollegePlannerService', () => {
  const planner = new CollegePlannerService();

  // ── Hand-computed full scenario ──────────────────────────────
  // $30,000/year today's cost, student starts in 10 years, a 4-year program,
  // $20,000 already saved, 5% tuition inflation, 6% return, and $500/month of
  // stated income capacity during the school years.
  it('hand-computes future cost, required monthly contribution, and the one-third breakdown', () => {
    const result = planner.plan({
      currentAnnualCostCents: 3_000_000,
      yearsUntilStart: 10,
      programYears: 4,
      currentSavingsCents: 2_000_000,
      tuitionInflationRateBps: 500,
      investmentReturnRateBps: 600,
      monthlyIncomeCapacityDuringSchoolCents: 50_000,
    });

    expect(result.status).toBe('ok');
    expect(result.yearlyCosts).toEqual([
      { yearIndex: 0, yearsFromNow: 10, costCents: 4_886_684 },
      { yearIndex: 1, yearsFromNow: 11, costCents: 5_131_018 },
      { yearIndex: 2, yearsFromNow: 12, costCents: 5_387_569 },
      { yearIndex: 3, yearsFromNow: 13, costCents: 5_656_947 },
    ]);
    expect(result.firstYearAnnualCostCents).toBe(4_886_684);
    expect(result.totalProjectedCostCents).toBe(21_062_218);
    expect(result.monthsUntilStart).toBe(120);
    expect(result.requiredMonthlyContributionCents).toBe(106_319);
    expect(result.immediateLumpSumNeededCents).toBeNull();

    expect(result.oneThirdRule).toEqual({
      totalProjectedCostCents: 21_062_218,
      savingsThirdCents: 7_020_739,
      incomeThirdCents: 7_020_739,
      loansThirdCents: 7_020_740,
      projectedSavingsAtStartCents: 3_638_793,
      projectedIncomeCapacityCents: 2_400_000,
      twoThirdsTargetCents: 14_041_478,
      onTrackForTwoThirds: false,
      twoThirdsGapCents: 8_002_685,
      incomeCapacityProvided: true,
    });
    expect(result.calculationVersion).toBe(COLLEGE_PLANNER_CALCULATION_VERSION);
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  // ── Student starts this year — no time left to dollar-cost-average ───
  it('falls back to an immediate lump-sum figure when yearsUntilStart is 0', () => {
    const result = planner.plan({
      currentAnnualCostCents: 2_000_000,
      yearsUntilStart: 0,
      programYears: 1,
      currentSavingsCents: 500_000,
      tuitionInflationRateBps: 500,
      investmentReturnRateBps: 600,
    });

    expect(result.totalProjectedCostCents).toBe(2_000_000);
    expect(result.monthsUntilStart).toBe(0);
    expect(result.requiredMonthlyContributionCents).toBeNull();
    expect(result.immediateLumpSumNeededCents).toBe(1_500_000);

    // No income capacity provided — defaults to $0 and flags it in assumptions.
    expect(result.oneThirdRule.incomeCapacityProvided).toBe(false);
    expect(result.oneThirdRule.projectedIncomeCapacityCents).toBe(0);
    expect(result.oneThirdRule.onTrackForTwoThirds).toBe(false);
    expect(result.assumptions.some((a) => a.includes('assumed $0'))).toBe(true);
  });

  // ── Already fully funded — required contribution floors at 0, never negative ──
  it('returns a $0 required contribution when current savings already cover the projected cost', () => {
    const result = planner.plan({
      currentAnnualCostCents: 1_000_000,
      yearsUntilStart: 5,
      programYears: 1,
      currentSavingsCents: 2_000_000,
      tuitionInflationRateBps: 0,
      investmentReturnRateBps: 0,
    });

    expect(result.totalProjectedCostCents).toBe(1_000_000);
    expect(result.requiredMonthlyContributionCents).toBe(0);
    expect(result.immediateLumpSumNeededCents).toBeNull();
  });

  // ── 0% return rate uses simple linear division, not annuity math (avoids /0) ──
  it('divides evenly across months when the return rate is 0%', () => {
    const result = planner.plan({
      currentAnnualCostCents: 1_200_000,
      yearsUntilStart: 2,
      programYears: 1,
      currentSavingsCents: 0,
      tuitionInflationRateBps: 0,
      investmentReturnRateBps: 0,
    });

    expect(result.totalProjectedCostCents).toBe(1_200_000);
    expect(result.monthsUntilStart).toBe(24);
    expect(result.requiredMonthlyContributionCents).toBe(50_000);
  });

  // ── Defaults apply when inflation/return/programYears are omitted ────
  it('applies the documented defaults (5% inflation, 6% return, 4-year program) when omitted', () => {
    const withDefaults = planner.plan({
      currentAnnualCostCents: 3_000_000,
      yearsUntilStart: 10,
      currentSavingsCents: 2_000_000,
    });
    const explicit = planner.plan({
      currentAnnualCostCents: 3_000_000,
      yearsUntilStart: 10,
      programYears: 4,
      currentSavingsCents: 2_000_000,
      tuitionInflationRateBps: 500,
      investmentReturnRateBps: 600,
    });
    expect(withDefaults).toEqual(explicit);
  });

  // ── Input validation — fail closed on nonsensical inputs ─────
  it('rejects a non-positive current annual cost', () => {
    expect(() =>
      planner.plan({ currentAnnualCostCents: 0, yearsUntilStart: 5, currentSavingsCents: 0 }),
    ).toThrow(/currentAnnualCostCents/);
  });

  it('rejects a negative years-until-start', () => {
    expect(() =>
      planner.plan({ currentAnnualCostCents: 1_000_000, yearsUntilStart: -1, currentSavingsCents: 0 }),
    ).toThrow(/yearsUntilStart/);
  });

  it('rejects a non-positive program length', () => {
    expect(() =>
      planner.plan({
        currentAnnualCostCents: 1_000_000,
        yearsUntilStart: 5,
        programYears: 0,
        currentSavingsCents: 0,
      }),
    ).toThrow(/programYears/);
  });

  it('rejects negative current savings', () => {
    expect(() =>
      planner.plan({ currentAnnualCostCents: 1_000_000, yearsUntilStart: 5, currentSavingsCents: -1 }),
    ).toThrow(/currentSavingsCents/);
  });

  it('rejects negative inflation or return rates', () => {
    expect(() =>
      planner.plan({
        currentAnnualCostCents: 1_000_000,
        yearsUntilStart: 5,
        currentSavingsCents: 0,
        tuitionInflationRateBps: -100,
      }),
    ).toThrow(/must be >= 0/);
  });
});
