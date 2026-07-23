import { buildSavingsCoachNarration } from '../savings-coach-narration';
import { aggregateSavingsCoach, rankCandidate } from '../savings-coach-calculator';

describe('buildSavingsCoachNarration', () => {
  it('states no material savings actions when there is nothing to recommend', () => {
    const result = aggregateSavingsCoach([]);
    expect(buildSavingsCoachNarration(result)).toBe('No material savings actions found this month.');
  });

  it('lists every surviving item with its own min-max range, and the aggregate impact line', () => {
    const item = rankCandidate({
      kind: 'fee_elimination',
      id: 'fee_elimination:recurring',
      label: 'Recurring bank/card',
      occurrences: 4,
      totalCentsTrailingWindow: 12_000,
      windowMonths: 3, // avg=4000, min=2000, max=4000
      observedAt: '2026-07-01',
    });
    const result = aggregateSavingsCoach([item]);
    const narration = buildSavingsCoachNarration(result);
    expect(narration).toContain('Found 1 savings action this month:');
    expect(narration).toContain('Recurring bank/card fees — an estimated $20.00-$40.00/mo.');
    expect(narration).toContain(
      `Estimated impact: $${(result.impact.minCentsPerYear / 100).toFixed(2)}-$${(
        result.impact.maxCentsPerYear / 100
      ).toFixed(2)}/yr`,
    );
  });

  it('pluralizes correctly across multiple items', () => {
    const a = rankCandidate({
      kind: 'subscription_price_creep',
      id: 'a',
      merchant: 'Streamflix',
      previousAmountCents: 1_000,
      newAmountCents: 1_500,
      observedAt: '2026-07-01',
    });
    const b = rankCandidate({
      kind: 'budget_pace_trim',
      id: 'b',
      categoryLabel: 'Dining',
      budgetCents: 200_00,
      projectedCents: 300_00,
      periodKey: '2026-07',
      observedAt: '2026-07-15',
    });
    const result = aggregateSavingsCoach([a, b]);
    const narration = buildSavingsCoachNarration(result);
    expect(narration).toContain('Found 2 savings actions this month:');
    expect(narration).toContain('1. Streamflix price increase');
    expect(narration).toContain('2. Dining over pace');
  });

  it('never includes an account number, lastFour, or routing number in the output', () => {
    const item = rankCandidate({
      kind: 'subscription_price_creep',
      id: 'price_creep:Streamflix',
      merchant: 'Streamflix',
      previousAmountCents: 1_599,
      newAmountCents: 1_999,
      observedAt: '2026-07-01',
    });
    const result = aggregateSavingsCoach([item]);
    const narration = buildSavingsCoachNarration(result);
    expect(narration).not.toMatch(/\b\d{9,17}\b/); // no long digit runs (acct/routing numbers)
  });
});
