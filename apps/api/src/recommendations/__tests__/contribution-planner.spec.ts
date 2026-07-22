import {
  ContributionPlanner,
  ContributionPlannerContext,
  InvestmentCoachSettingsLike,
} from '../contribution-planner';

const ASOF = '2026-07-01';

function baseContext(overrides: Partial<ContributionPlannerContext> = {}): ContributionPlannerContext {
  return {
    asOfDate: ASOF,
    avgMonthlyExpenseCents: 400_000, // $4,000/mo
    currentEmergencyFundCents: 2_400_000, // $24,000 (6mo of $4,000)
    trailingMonthlySurplusCents: 150_000, // $1,500/mo surplus
    monthlyGoalContributionCents: 0,
    totalPortfolioValueCents: 10_000_00 * 100, // $1,000,000 in cents scaled below by fixture
    currentAllocationByAssetClass: [],
    ...overrides,
  };
}

function baseSettings(overrides: Partial<InvestmentCoachSettingsLike> = {}): InvestmentCoachSettingsLike {
  return {
    version: 3,
    emergencyFundTargetMonths: 6,
    riskTolerance: 'moderate',
    targetAllocation: [
      { assetClass: 'us_equity', targetPercent: 60 },
      { assetClass: 'intl_equity', targetPercent: 20 },
      { assetClass: 'bonds', targetPercent: 20 },
    ],
    dcaDayOfMonth: 15,
    dcaAmountCents: 0,
    ...overrides,
  };
}

describe('ContributionPlanner', () => {
  it('gates on missing suitability settings (reuses requireSuitability directly) — zero recommendations', () => {
    const planner = new ContributionPlanner();
    const settings = baseSettings({ riskTolerance: null });
    const result = planner.plan(settings, baseContext());

    expect(result.status).toBe('missing_setting');
    if (result.status === 'missing_setting') {
      expect(result.missing).toContain('risk_tolerance');
      expect(result.message).toMatch(/missing/i);
    }
  });

  it('gates on completely absent settings row too', () => {
    const planner = new ContributionPlanner();
    const result = planner.plan(null, baseContext());
    expect(result.status).toBe('missing_setting');
  });

  it('outputs "fund the buffer first" with the exact dollar gap when emergency fund is underfunded, no investment recommendation', () => {
    const planner = new ContributionPlanner();
    const settings = baseSettings();
    // Only $10,000 saved against a $24,000 (6mo x $4,000) target.
    const context = baseContext({ currentEmergencyFundCents: 1_000_000 });
    const result = planner.plan(settings, context);

    expect(result.status).toBe('fund_buffer_first');
    if (result.status === 'fund_buffer_first') {
      expect(result.emergencyFundTargetCents).toBe(2_400_000);
      expect(result.gapCents).toBe(2_400_000 - 1_000_000);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.assumptions.length).toBeGreaterThan(0);
    }
  });

  it('reports no_surplus when investable surplus is <= 0 after goals + DCA, even with a funded buffer', () => {
    const planner = new ContributionPlanner();
    const settings = baseSettings({ dcaAmountCents: 200_000 });
    const context = baseContext({ trailingMonthlySurplusCents: 150_000, monthlyGoalContributionCents: 0 });
    const result = planner.plan(settings, context);

    expect(result.status).toBe('no_surplus');
    if (result.status === 'no_surplus') {
      expect(result.investableSurplusCents).toBe(150_000 - 200_000);
    }
  });

  it('picks the most-underweight asset class and the correct dollar amount (hand-verifiable)', () => {
    const planner = new ContributionPlanner();
    const settings = baseSettings();
    const totalPortfolioValueCents = 100_000_00; // $100,000
    const context = baseContext({
      totalPortfolioValueCents,
      // us_equity 70% (overweight vs 60% target), intl_equity 10% (underweight vs 20%),
      // bonds 20% (on target) -> intl_equity is most underweight by 10pp.
      currentAllocationByAssetClass: [
        { assetClass: 'us_equity', valueCents: 70_000_00 },
        { assetClass: 'intl_equity', valueCents: 10_000_00 },
        { assetClass: 'bonds', valueCents: 20_000_00 },
      ],
      trailingMonthlySurplusCents: 150_000,
      monthlyGoalContributionCents: 0,
    });
    const result = planner.plan(settings, context);

    expect(result.status).toBe('recommend');
    if (result.status === 'recommend') {
      expect(result.destinationAssetClass).toBe('intl_equity');
      expect(result.contributionCents).toBe(150_000); // full investable surplus, hand-verified
      expect(result.driftPercentPoints).toBeCloseTo(10, 5);
      expect(result.currentPercent).toBeCloseTo(10, 5);
      expect(result.targetPercent).toBe(20);
      expect(result.dcaDayOfMonth).toBe(15);
      // Never suggests selling: no such field/verb exists on the 'recommend' result at all.
      expect((result as any).sell).toBeUndefined();
    }
  });

  it('never endorses a fund/ticker name — destination is an asset class only', () => {
    const planner = new ContributionPlanner();
    const settings = baseSettings();
    const context = baseContext({
      totalPortfolioValueCents: 100_000_00,
      currentAllocationByAssetClass: [
        { assetClass: 'us_equity', valueCents: 60_000_00 },
        { assetClass: 'intl_equity', valueCents: 20_000_00 },
        { assetClass: 'bonds', valueCents: 10_000_00 },
      ],
    });
    const result = planner.plan(settings, context);
    expect(result.status).toBe('recommend');
    if (result.status === 'recommend') {
      expect(result.destinationAssetClass).toBe('bonds');
      expect(typeof result.destinationAssetClass).toBe('string');
      expect(result.destinationAssetClass).not.toMatch(/[A-Z]{2,5}$/); // not a ticker-like symbol
    }
  });
});
