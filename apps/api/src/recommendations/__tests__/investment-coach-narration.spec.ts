import { ContributionPlanResult } from '../contribution-planner';
import {
  buildInvestmentCoachNarration,
  buildTimingRefusalNarration,
  containsPredictiveClaim,
  looksLikeMarketTimingQuestion,
  INVESTMENT_COACH_DISCLAIMER,
  PREDICTIVE_CLAIM_PATTERNS,
} from '../investment-coach-narration';

const recommendResult: ContributionPlanResult = {
  status: 'recommend',
  destinationAssetClass: 'intl_equity',
  contributionCents: 150_000,
  driftPercentPoints: 10,
  currentPercent: 10,
  targetPercent: 20,
  dcaDayOfMonth: 15,
  dcaAmountCents: 0,
  impact: { minCentsPerYear: 1_800_000, maxCentsPerYear: 1_800_000, basis: 'annualized' },
  evidence: [{ source: 'tool', ref: 'get_allocation', value: '10.0', unit: 'percent', observedAt: '2026-07-01' }],
  assumptions: ['test assumption'],
  confidenceBand: 'medium',
  calculationVersion: 'contribution-planner-v1',
  policyVersion: 3,
};

describe('containsPredictiveClaim / looksLikeMarketTimingQuestion (word/phrase-based, not eyeballed)', () => {
  it('flags common predictive phrasing', () => {
    expect(containsPredictiveClaim('The market will rise next quarter.')).toBe(true);
    expect(containsPredictiveClaim('Stocks will fall soon.')).toBe(true);
    expect(containsPredictiveClaim('This is a good time to buy.')).toBe(true);
    expect(containsPredictiveClaim('We expect the market to recover.')).toBe(true);
    expect(containsPredictiveClaim('Now is the time to invest more.')).toBe(true);
  });

  it('does not flag neutral policy language', () => {
    expect(containsPredictiveClaim(buildTimingRefusalNarration(recommendResult))).toBe(false);
    expect(containsPredictiveClaim('Stick to your DCA schedule and current allocation drift.')).toBe(false);
  });

  it('detects timing-style questions', () => {
    expect(looksLikeMarketTimingQuestion('Is now a good time to buy?')).toBe(true);
    expect(looksLikeMarketTimingQuestion('Should I wait for a dip?')).toBe(true);
    expect(looksLikeMarketTimingQuestion('What is my current allocation?')).toBe(false);
  });
});

describe('12.6 timing-refusal contract (acceptance-critical)', () => {
  it('explicitly refuses/reframes AND contains zero predictive claims, for a "good time to buy" question', () => {
    const userQuestion = 'Is now a good time to buy, or should I wait for a dip?';
    expect(looksLikeMarketTimingQuestion(userQuestion)).toBe(true);

    const reply = buildTimingRefusalNarration(recommendResult);

    // (a) explicit refusal/reframing language present.
    expect(reply).toMatch(/can't predict/i);
    expect(reply).toMatch(/time-in-market/i);
    expect(reply).toMatch(/DCA schedule/i);
    expect(reply).toMatch(/allocation/i);

    // (b) no predictive market-direction claims anywhere in the reply — a real
    // phrase-based assertion against every pattern, not eyeballing the text.
    for (const pattern of PREDICTIVE_CLAIM_PATTERNS) {
      expect(reply).not.toMatch(pattern);
    }
    expect(containsPredictiveClaim(reply)).toBe(false);

    // Standing disclaimer present on this output too.
    expect(reply).toContain(INVESTMENT_COACH_DISCLAIMER);
  });

  it('still refuses even when no plan/recommendation is available (missing settings)', () => {
    const missing: ContributionPlanResult = {
      status: 'missing_setting',
      missing: ['risk_tolerance'],
      message: 'missing: risk_tolerance',
    };
    const reply = buildTimingRefusalNarration(missing);
    expect(reply).toMatch(/can't predict/i);
    expect(containsPredictiveClaim(reply)).toBe(false);
  });
});

describe('buildInvestmentCoachNarration', () => {
  it('always includes the standing disclaimer', () => {
    expect(buildInvestmentCoachNarration(recommendResult)).toContain(INVESTMENT_COACH_DISCLAIMER);
  });

  it('never contains lastFour/account-number style tokens', () => {
    const text = buildInvestmentCoachNarration(recommendResult);
    expect(text.toLowerCase()).not.toMatch(/last_?four/);
  });
});
