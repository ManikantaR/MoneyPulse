import {
  rankCandidate,
  aggregateSavingsCoach,
  SAVINGS_COACH_MIN_ANNUAL_IMPACT_CENTS,
  SAVINGS_COACH_CALCULATION_VERSION,
  SubscriptionPriceCreepCandidate,
  FeeEliminationCandidate,
  BudgetPaceTrimCandidate,
} from '../savings-coach-calculator';
import { hasCompleteEvidence } from '../recommendation-evidence';
import { buildSavingsCoachNarration } from '../savings-coach-narration';

describe('rankCandidate', () => {
  it('ranks a subscription price-creep candidate as [delta, new amount]', () => {
    const candidate: SubscriptionPriceCreepCandidate = {
      kind: 'subscription_price_creep',
      id: 'price_creep:Streamflix',
      merchant: 'Streamflix',
      previousAmountCents: 1_599,
      newAmountCents: 1_999,
      observedAt: '2026-07-01',
    };
    const item = rankCandidate(candidate);
    // delta = 1999-1599 = 400; recovering the full new charge (cancel) = 1999
    expect(item.minCentsPerMonth).toBe(400);
    expect(item.maxCentsPerMonth).toBe(1_999);
    expect(item.label).toBe('Streamflix price increase');
    expect(item.evidence).toHaveLength(1);
    expect(item.evidence[0].value).toBe('$15.99 -> $19.99');
  });

  it('never reports a negative delta when the amount decreased', () => {
    const candidate: SubscriptionPriceCreepCandidate = {
      kind: 'subscription_price_creep',
      id: 'price_creep:Streamflix',
      merchant: 'Streamflix',
      previousAmountCents: 1_999,
      newAmountCents: 1_599,
      observedAt: '2026-07-01',
    };
    const item = rankCandidate(candidate);
    expect(item.minCentsPerMonth).toBe(0);
  });

  it('ranks a fee-elimination candidate as [half, full] of the trailing monthly average', () => {
    const candidate: FeeEliminationCandidate = {
      kind: 'fee_elimination',
      id: 'fee_elimination:recurring',
      label: 'Recurring bank/card',
      occurrences: 6,
      totalCentsTrailingWindow: 9_000, // 3 months window -> $30/mo avg
      windowMonths: 3,
      observedAt: '2026-07-01',
    };
    const item = rankCandidate(candidate);
    expect(item.minCentsPerMonth).toBe(1_500); // 3000 * 0.5
    expect(item.maxCentsPerMonth).toBe(3_000);
    expect(item.evidence).toHaveLength(2);
  });

  it('ranks a budget-pace-trim candidate as [half, full] of the projected overage', () => {
    const candidate: BudgetPaceTrimCandidate = {
      kind: 'budget_pace_trim',
      id: 'budget_pace:groceries',
      categoryLabel: 'Groceries',
      budgetCents: 400_00,
      projectedCents: 500_00,
      periodKey: '2026-07',
      observedAt: '2026-07-15',
    };
    const item = rankCandidate(candidate);
    // overage = 50000-40000 = 10000
    expect(item.minCentsPerMonth).toBe(5_000);
    expect(item.maxCentsPerMonth).toBe(10_000);
  });

  it('never reports a negative overage when projected spend is under budget', () => {
    const candidate: BudgetPaceTrimCandidate = {
      kind: 'budget_pace_trim',
      id: 'budget_pace:groceries',
      categoryLabel: 'Groceries',
      budgetCents: 500_00,
      projectedCents: 400_00,
      periodKey: '2026-07',
      observedAt: '2026-07-15',
    };
    const item = rankCandidate(candidate);
    expect(item.minCentsPerMonth).toBe(0);
    expect(item.maxCentsPerMonth).toBe(0);
  });
});

describe('aggregateSavingsCoach', () => {
  it('does not recommend when there are no surviving items', () => {
    const result = aggregateSavingsCoach([]);
    expect(result.shouldRecommend).toBe(false);
    expect(result.impact.minCentsPerYear).toBe(0);
    expect(result.impact.maxCentsPerYear).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it('recommends only when the aggregate best-case annual savings clears the named threshold', () => {
    expect(SAVINGS_COACH_MIN_ANNUAL_IMPACT_CENTS).toBe(6_000);
    const tiny = rankCandidate({
      kind: 'subscription_price_creep',
      id: 'price_creep:Tiny',
      merchant: 'Tiny',
      previousAmountCents: 100,
      newAmountCents: 110, // delta=10, max=110/mo -> max/yr = 1320 << 6000
      observedAt: '2026-07-01',
    });
    const below = aggregateSavingsCoach([tiny]);
    expect(below.shouldRecommend).toBe(false);

    const big = rankCandidate({
      kind: 'subscription_price_creep',
      id: 'price_creep:Big',
      merchant: 'Big',
      previousAmountCents: 1_000,
      newAmountCents: 2_000, // delta=1000/mo -> min/yr=12000, max/yr(2000*12)=24000
      observedAt: '2026-07-01',
    });
    const above = aggregateSavingsCoach([big]);
    expect(above.shouldRecommend).toBe(true);
  });

  it('sums min/max cents-per-year across all surviving items, every figure hand-verifiable', () => {
    const a = rankCandidate({
      kind: 'subscription_price_creep',
      id: 'a',
      merchant: 'A',
      previousAmountCents: 1_000,
      newAmountCents: 1_400, // delta=400 min, 1400 max
      observedAt: '2026-07-01',
    });
    const b = rankCandidate({
      kind: 'fee_elimination',
      id: 'b',
      label: 'Fees',
      occurrences: 2,
      totalCentsTrailingWindow: 6_000,
      windowMonths: 3, // avg=2000, min=1000, max=2000
      observedAt: '2026-07-01',
    });
    const result = aggregateSavingsCoach([a, b]);
    // min/yr = (400+1000)*12 = 16,800; max/yr = (1400+2000)*12 = 40,800
    expect(result.impact.minCentsPerYear).toBe(16_800);
    expect(result.impact.maxCentsPerYear).toBe(40_800);
    expect(result.evidence.length).toBe(a.evidence.length + b.evidence.length);
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it('satisfies the 12.1 fail-closed evidence contract when wrapped as a recommendation row', () => {
    const item = rankCandidate({
      kind: 'budget_pace_trim',
      id: 'budget_pace:dining',
      categoryLabel: 'Dining',
      budgetCents: 200_00,
      projectedCents: 300_00,
      periodKey: '2026-07',
      observedAt: '2026-07-15',
    });
    const result = aggregateSavingsCoach([item]);
    const row = {
      kind: 'recommendation',
      evidence: result.evidence,
      assumptions: result.assumptions,
      confidenceBand: result.confidenceBand,
    };
    expect(hasCompleteEvidence(row)).toBe(true);
    expect(result.calculationVersion).toBe(SAVINGS_COACH_CALCULATION_VERSION);
  });

  it('never fabricates a numeric figure in narration (numeric spot-check)', () => {
    const a = rankCandidate({
      kind: 'subscription_price_creep',
      id: 'a',
      merchant: 'Streamflix',
      previousAmountCents: 1_000,
      newAmountCents: 1_500,
      observedAt: '2026-07-01',
    });
    const result = aggregateSavingsCoach([a]);
    const narration = buildSavingsCoachNarration(result);
    // every "$x.xx" figure quoted in narration must be one of the known evidence values
    const dollarFigures = Array.from(narration.matchAll(/\$([0-9,]+\.\d{2})/g)).map((m) =>
      Math.round(parseFloat(m[1].replace(/,/g, '')) * 100),
    );
    const knownCents = new Set<number>([
      a.minCentsPerMonth,
      a.maxCentsPerMonth,
      result.impact.minCentsPerYear,
      result.impact.maxCentsPerYear,
    ]);
    expect(dollarFigures.length).toBeGreaterThan(0);
    for (const cents of dollarFigures) {
      expect(knownCents.has(cents)).toBe(true);
    }
  });
});
