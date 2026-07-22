import {
  CashPlacementCalculator,
  CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS,
  CASH_MANAGER_CALCULATION_VERSION,
} from '../cash-placement-calculator';
import { hasCompleteEvidence } from '../recommendation-evidence';
import { buildCashManagerNarration, extractDollarFigures } from '../cash-manager-narration';

describe('CashPlacementCalculator', () => {
  const calculator = new CashPlacementCalculator();

  // Synthetic fixture per the 12.5 acceptance criteria: idle $20,000, a 4.0% HYSA on
  // the watchlist, a 4.1% 13-week T-bill. Current earned APY: 0.50% (50bps).
  const fixture = {
    liquidBalanceCents: 22_000_00, // $22,000 liquid balance
    balanceAsOfDate: '2026-07-15',
    avgMonthlyExpenseCents: 200_000, // $2,000/mo
    emergencyFundTargetMonths: 6, // -> $12,000 emergency buffer
    idleCashBufferMonths: 1, // -> $2,000 idle buffer; emergency wins
    currentEarnedApyBps: 50, // 0.50%
    currentEarnedApyAsOfDate: '2026-07-01',
    candidates: [
      {
        id: 'hysa-1',
        institution: 'Synthetic Bank',
        productType: 'hysa' as const,
        apyBps: 400, // 4.00%
        termMonths: null,
        asOfDate: '2026-07-10',
        stateTaxExempt: false,
      },
      {
        id: 'tbill-13w',
        institution: 'US Treasury',
        productType: 'treasury' as const,
        apyBps: 410, // 4.10%
        termMonths: 3,
        asOfDate: '2026-07-12',
        stateTaxExempt: true,
      },
    ],
    taxState: 'CA',
  };

  it('computes movable cash as liquid balance minus the LARGER of the two buffers', () => {
    const result = calculator.compute(fixture);
    // emergency buffer = 200_000 * 6 = 1,200,000; idle buffer = 200_000 * 1 = 200,000
    // -> buffer = 1,200,000 cents ($12,000); movable = 2,200,000 - 1,200,000 = 1,000,000 ($10,000)
    expect(result.bufferCents).toBe(1_200_000);
    expect(result.bufferBasis).toBe('emergency_fund');
    expect(result.movableCashCents).toBe(1_000_000);
  });

  it('ranks candidates by net annual benefit, every figure hand-verifiable', () => {
    const result = calculator.compute(fixture);
    // movable = $10,000. HYSA spread = 400-50=350bps -> 1,000,000 * 350/10000 = 35,000 cents = $350/yr
    // Treasury spread = 410-50=360bps -> 1,000,000 * 360/10000 = 36,000 cents = $360/yr
    expect(result.options).toHaveLength(2);
    expect(result.options[0].candidateId).toBe('tbill-13w');
    expect(result.options[0].netAnnualBenefitCents).toBe(36_000);
    expect(result.options[1].candidateId).toBe('hysa-1');
    expect(result.options[1].netAnnualBenefitCents).toBe(35_000);
    expect(result.impact.minCentsPerYear).toBe(35_000);
    expect(result.impact.maxCentsPerYear).toBe(36_000);
  });

  it('recommends only when the best option clears the named $/yr threshold', () => {
    const result = calculator.compute(fixture);
    expect(CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS).toBe(10_000);
    expect(result.options[0].netAnnualBenefitCents).toBeGreaterThanOrEqual(
      CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS,
    );
    expect(result.shouldRecommend).toBe(true);
  });

  it('does NOT recommend when the best option is below the $/yr threshold', () => {
    const tiny = {
      ...fixture,
      liquidBalanceCents: 1_210_000, // movable = 10,000 cents ($100) after $1,200,000 buffer
    };
    const result = calculator.compute(tiny);
    // movable = 10,000 cents; best spread 360bps -> 10,000*360/10000=360 cents ($3.60) << $100
    expect(result.shouldRecommend).toBe(false);
  });

  it('cites term-lock and state-tax-exemption tradeoffs distinctly per candidate', () => {
    const result = calculator.compute(fixture);
    const tbill = result.options.find((o) => o.candidateId === 'tbill-13w')!;
    const hysa = result.options.find((o) => o.candidateId === 'hysa-1')!;
    expect(tbill.tradeoffs.some((t) => t.includes('3 months'))).toBe(true);
    expect(tbill.tradeoffs.some((t) => t.toLowerCase().includes('state'))).toBe(true);
    expect(hysa.tradeoffs.some((t) => t.toLowerCase().includes('liquid'))).toBe(true);
  });

  it('produces every dollar figure evidence-backed with a citation and observedAt', () => {
    const result = calculator.compute(fixture);
    expect(result.evidence.length).toBeGreaterThanOrEqual(3 + fixture.candidates.length);
    for (const item of result.evidence) {
      expect(item.source).toBeTruthy();
      expect(item.ref).toBeTruthy();
      expect(item.observedAt).toBeTruthy();
      expect(item.value).not.toBeUndefined();
    }
  });

  it('satisfies the 12.1 fail-closed evidence contract when wrapped as a recommendation row', () => {
    const result = calculator.compute(fixture);
    const row = {
      kind: 'recommendation',
      evidence: result.evidence,
      assumptions: result.assumptions,
      confidenceBand: result.confidenceBand,
    };
    expect(hasCompleteEvidence(row)).toBe(true);
    expect(result.calculationVersion).toBe(CASH_MANAGER_CALCULATION_VERSION);
  });

  it('never fabricates a numeric figure in narration (numeric spot-check)', () => {
    const result = calculator.compute(fixture);
    const narration = buildCashManagerNarration(result);
    const narratedFigures = extractDollarFigures(narration);
    const evidenceValuesCents = new Set<number>([
      result.movableCashCents,
      result.bufferCents,
      result.impact.minCentsPerYear,
      result.impact.maxCentsPerYear,
      ...result.options.map((o) => o.netAnnualBenefitCents),
    ]);
    expect(narratedFigures.length).toBeGreaterThan(0);
    for (const cents of narratedFigures) {
      expect(evidenceValuesCents.has(cents)).toBe(true);
    }
  });
});
