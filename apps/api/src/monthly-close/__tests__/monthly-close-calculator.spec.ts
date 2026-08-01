import {
  calculateMonthlyClose,
  FOO_MIN_INVESTING_RATE_BPS,
  FOO_STARTER_EMERGENCY_FUND_MONTHS,
  MonthlyCloseCalculatorInput,
  MonthlyCloseTransactionLine,
} from '../monthly-close-calculator';
import { MONTHLY_CLOSE_CALCULATION_VERSION } from '@moneypulse/shared';

function line(
  overrides: Partial<MonthlyCloseTransactionLine> & { id: string; amountCents: number },
): MonthlyCloseTransactionLine {
  return {
    direction: 'debit',
    isTransfer: false,
    isSplitParent: false,
    isDeleted: false,
    isDebtPrincipalTransfer: false,
    categoryBucket: null,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<MonthlyCloseCalculatorInput> = {},
): MonthlyCloseCalculatorInput {
  return {
    month: '2026-06-01',
    takeHomeIncomeCents: 600_000,
    grossIncomeCents: null,
    transactions: [],
    cashSavingsCents: 0,
    investmentContributionCents: 0,
    debtPrincipalPaidCents: 0,
    extraDebtPrincipalPaidCents: 0,
    requiredMonthlyDebtPaymentCents: 0,
    liquidAssetCents: 0,
    investmentAssetCents: 0,
    manualAssetCents: 0,
    creditCardLiabilityCents: 0,
    loanLiabilityCents: 0,
    emergencyFundMonths: 3,
    hasHighInterestDebt: false,
    employerMatch: { available: false, captured: null },
    freshness: { missingManualAssets: [], staleAccounts: [], unverifiedLoans: [], missingInvestmentPrices: [] },
    ...overrides,
  };
}

describe('calculateMonthlyClose', () => {
  // ── Full hand-computed household month-end close ────────────
  // Take-home $6,000.00. Home ($400,000) + car ($20,000) + gold ($5,000) manual
  // assets; a $300,000 mortgage carried at its manual-statement balance
  // (overriding the amortized estimate); a credit card with a payment transfer
  // (excluded), a purchase and interest (both counted as expenses), and a
  // carried-balance principal payoff (debt paydown, not an expense).
  it('hand-computes one full household month-end close', () => {
    const transactions: MonthlyCloseTransactionLine[] = [
      // Paycheck deposit — a credit, never touches the (debit-only) expense sum.
      line({ id: 'paycheck', amountCents: 600_000, direction: 'credit' }),
      // Ordinary "needs" spend.
      line({ id: 'groceries', amountCents: 80_000, categoryBucket: 'needs' }),
      // Ordinary "wants" spend.
      line({ id: 'restaurants', amountCents: 30_000, categoryBucket: 'wants' }),
      // Credit-card PAYMENT: a transfer, excluded from expenses.
      line({ id: 'cc-payment', amountCents: 120_000, isTransfer: true }),
      // Credit-card PURCHASE: not a transfer, counted as an expense.
      line({ id: 'cc-purchase-dining', amountCents: 15_000, categoryBucket: 'wants' }),
      // Credit-card interest: not a transfer, counted as an expense.
      line({ id: 'cc-interest', amountCents: 2_500, categoryBucket: 'needs' }),
      // Carried-balance principal payoff: excluded from expenses (debt paydown).
      line({
        id: 'cc-principal-payoff',
        amountCents: 30_000,
        isTransfer: true,
        isDebtPrincipalTransfer: true,
      }),
      // Investment contribution transfer: excluded from expenses (fed separately
      // via investmentContributionCents so it is never double-counted).
      line({ id: 'brokerage-transfer', amountCents: 60_000, isTransfer: true }),
      // Explicit savings transfer: excluded from expenses (fed via cashSavingsCents).
      line({ id: 'savings-transfer', amountCents: 40_000, isTransfer: true }),
      // Split parent: excluded regardless of amount/bucket.
      line({ id: 'split-parent', amountCents: 50_000, isSplitParent: true, categoryBucket: 'wants' }),
      // Deleted row: excluded regardless of amount/bucket.
      line({ id: 'deleted-row', amountCents: 999_900, isDeleted: true, categoryBucket: 'wants' }),
    ];

    const input = baseInput({
      transactions,
      grossIncomeCents: 800_000,
      cashSavingsCents: 40_000,
      investmentContributionCents: 60_000,
      // Mortgage principal ($500) + carried-CC principal payoff ($300).
      debtPrincipalPaidCents: 80_000,
      extraDebtPrincipalPaidCents: 20_000,
      // Mortgage minimum ($1,800) — CC has no separate minimum modeled here.
      requiredMonthlyDebtPaymentCents: 180_000,
      liquidAssetCents: 1_500_000, // $15,000 checking/savings/cash_sweep
      investmentAssetCents: 5_000_000, // $50,000 brokerage/401k
      manualAssetCents: 42_500_000, // $400k home + $20k car + $5k gold
      creditCardLiabilityCents: 200_000, // $2,000 statement balance
      loanLiabilityCents: 30_000_000, // $300,000 mortgage, manual-statement wins
      emergencyFundMonths: 3,
      hasHighInterestDebt: false,
      employerMatch: { available: true, captured: false },
      freshness: {
        missingManualAssets: [],
        staleAccounts: ['acct-checking'],
        unverifiedLoans: [],
        missingInvestmentPrices: [],
      },
    });

    const result = calculateMonthlyClose(input);

    // Expenses: groceries + restaurants + cc-purchase + cc-interest only.
    expect(result.expenseCents).toBe(80_000 + 30_000 + 15_000 + 2_500);
    expect(result.expenseCents).toBe(127_500);

    // Balance sheet.
    expect(result.totalAssetCents).toBe(1_500_000 + 5_000_000 + 42_500_000);
    expect(result.totalAssetCents).toBe(49_000_000);
    expect(result.totalLiabilityCents).toBe(200_000 + 30_000_000);
    expect(result.totalLiabilityCents).toBe(30_200_000);
    expect(result.netWorthCents).toBe(49_000_000 - 30_200_000);
    expect(result.netWorthCents).toBe(18_800_000);

    // Rates over take-home ($600,000 cents = $6,000.00).
    expect(result.savingsRateBps).toBe(667); // 40,000 / 600,000 = 6.667%
    expect(result.investingRateBps).toBe(1_000); // 60,000 / 600,000 = 10%
    expect(result.debtPaydownRateBps).toBe(1_333); // 80,000 / 600,000 = 13.333%
    expect(result.wealthBuildingRateBps).toBe(3_000); // 180,000 / 600,000 = 30%
    expect(result.expenseRatioBps).toBe(2_125); // 127,500 / 600,000 = 21.25%

    // Ratios.
    expect(result.liquidNetWorthRatioBps).toBe(798); // 1,500,000 / 18,800,000
    expect(result.debtAssetRatioBps).toBe(6_163); // 30,200,000 / 49,000,000
    expect(result.debtPaymentIncomeRatioBps).toBe(3_000); // 180,000 / 600,000

    // Target statuses against the constant bands.
    expect(result.targetStatus.expense_ratio).toBe('green'); // 21.25% < 60%
    expect(result.targetStatus.liquid_net_worth_ratio).toBe('red'); // 7.98% < 15%
    expect(result.targetStatus.debt_asset_ratio).toBe('red'); // 61.63% > 40%
    expect(result.targetStatus.debt_payment_income_ratio).toBe('yellow'); // 30% in [25%,35%)
    expect(result.targetStatus.savings_rate).toBe('info');
    expect(result.targetStatus.investing_rate).toBe('info');
    expect(result.targetStatus.debt_paydown_rate).toBe('info');
    expect(result.targetStatus.wealth_building_rate).toBe('info');

    // Ramit buckets: Fixed = needs-expenses (80,000 + 2,500) + all debt principal (80,000).
    expect(result.ramitBuckets.fixedCents).toBe(80_000 + 2_500 + 80_000);
    expect(result.ramitBuckets.fixedCents).toBe(162_500);
    expect(result.ramitBuckets.investmentsCents).toBe(60_000);
    expect(result.ramitBuckets.savingsCents).toBe(40_000);
    // Guilt-free = wants-expenses: restaurants (30,000) + cc-purchase (15,000).
    expect(result.ramitBuckets.guiltFreeCents).toBe(45_000);

    // FOO: starter emergency fund OK, no high-interest debt, employer match
    // available but not captured -> capture the match next.
    expect(result.fooRecommendation.priority).toBe('capture_employer_match');
    expect(result.fooRecommendation.citations.length).toBeGreaterThan(0);

    // Freshness: one stale account -> incomplete.
    expect(result.freshness.isComplete).toBe(false);
    expect(result.freshness.staleAccounts).toEqual(['acct-checking']);

    expect(result.calculationVersion).toBe(MONTHLY_CLOSE_CALCULATION_VERSION);
  });

  // ── Critical invariants ──────────────────────────────────────

  it('excludes credit-card payments from expenses but counts purchases, interest, and fees', () => {
    const input = baseInput({
      transactions: [
        line({ id: 'cc-payment', amountCents: 50_000, isTransfer: true }),
        line({ id: 'cc-purchase', amountCents: 12_000 }),
        line({ id: 'cc-interest', amountCents: 1_500 }),
        line({ id: 'cc-late-fee', amountCents: 3_500 }),
      ],
    });

    const result = calculateMonthlyClose(input);

    expect(result.expenseCents).toBe(12_000 + 1_500 + 3_500);
  });

  it('treats carried-balance principal payoff as debt paydown, not an expense', () => {
    const withPrincipal = baseInput({
      transactions: [
        line({
          id: 'cc-principal',
          amountCents: 25_000,
          isTransfer: true,
          isDebtPrincipalTransfer: true,
        }),
      ],
      debtPrincipalPaidCents: 25_000,
    });

    const result = calculateMonthlyClose(withPrincipal);

    expect(result.expenseCents).toBe(0);
    expect(result.debtPrincipalPaidCents).toBe(25_000);
  });

  it('counts mortgage principal in debt paydown and wealth-building rate but not savings rate', () => {
    const input = baseInput({
      takeHomeIncomeCents: 500_000,
      cashSavingsCents: 20_000,
      debtPrincipalPaidCents: 100_000, // mortgage principal
    });

    const result = calculateMonthlyClose(input);

    expect(result.savingsRateBps).toBe(400); // 20,000 / 500,000 — unaffected by principal
    expect(result.debtPaydownRateBps).toBe(2_000); // 100,000 / 500,000
    expect(result.wealthBuildingRateBps).toBe(2_400); // (20,000 + 100,000) / 500,000
  });

  it('includes home/car/gold in net worth but excludes them from liquid assets', () => {
    const input = baseInput({
      liquidAssetCents: 100_000,
      manualAssetCents: 50_000_000, // home + car + gold
    });

    const result = calculateMonthlyClose(input);

    expect(result.totalAssetCents).toBe(50_100_000);
    expect(result.netWorthCents).toBe(50_100_000);
    // Liquid ratio uses liquidAssetCents alone, not the manual assets.
    expect(result.liquidNetWorthRatioBps).toBe(Math.round((100_000 / 50_100_000) * 10_000));
    expect(result.liquidAssetCents).toBe(100_000);
  });

  it('never double-counts investments: the resolved investmentAssetCents figure is a single input', () => {
    // The service resolves holdings-x-EOD-close vs the manual snapshot upstream
    // (decision #2) into one number; this calculator has no second investment
    // field to accidentally sum against it.
    const input = baseInput({ investmentAssetCents: 10_000_000 });

    const result = calculateMonthlyClose(input);

    expect(result.investmentAssetCents).toBe(10_000_000);
    expect(result.totalAssetCents).toBe(10_000_000);
  });

  // ── Null/zero edge cases ──────────────────────────────────────

  it('returns null rates and unknown target status when take-home income is zero', () => {
    const input = baseInput({ takeHomeIncomeCents: 0, cashSavingsCents: 10_000 });

    const result = calculateMonthlyClose(input);

    expect(result.savingsRateBps).toBeNull();
    expect(result.investingRateBps).toBeNull();
    expect(result.debtPaydownRateBps).toBeNull();
    expect(result.wealthBuildingRateBps).toBeNull();
    expect(result.expenseRatioBps).toBeNull();
    expect(result.debtPaymentIncomeRatioBps).toBeNull();
    expect(result.targetStatus.savings_rate).toBe('unknown');
    expect(result.targetStatus.expense_ratio).toBe('unknown');
  });

  it('returns a null liquid ratio and unknown status when net worth is zero or negative', () => {
    const input = baseInput({
      liquidAssetCents: 10_000,
      loanLiabilityCents: 10_000, // equals total assets -> net worth 0
    });

    const result = calculateMonthlyClose(input);

    expect(result.netWorthCents).toBe(0);
    expect(result.liquidNetWorthRatioBps).toBeNull();
    expect(result.targetStatus.liquid_net_worth_ratio).toBe('unknown');
  });

  it('marks freshness complete only when nothing is missing/stale/unverified', () => {
    const complete = calculateMonthlyClose(baseInput());
    expect(complete.freshness.isComplete).toBe(true);

    const incomplete = calculateMonthlyClose(
      baseInput({
        freshness: {
          missingManualAssets: ['home'],
          staleAccounts: [],
          unverifiedLoans: [],
          missingInvestmentPrices: [],
        },
      }),
    );
    expect(incomplete.freshness.isComplete).toBe(false);
  });

  it('marks freshness incomplete when holdings exist but a price is missing for the month (#213)', () => {
    const incomplete = calculateMonthlyClose(
      baseInput({
        freshness: {
          missingManualAssets: [],
          staleAccounts: [],
          unverifiedLoans: [],
          missingInvestmentPrices: ['VTI'],
        },
      }),
    );
    expect(incomplete.freshness.isComplete).toBe(false);
    expect(incomplete.freshness.missingInvestmentPrices).toEqual(['VTI']);
  });

  // ── FOO next-dollar priority ordering ────────────────────────

  it('prioritizes emergency reserves when below the starter buffer', () => {
    const result = calculateMonthlyClose(
      baseInput({ emergencyFundMonths: FOO_STARTER_EMERGENCY_FUND_MONTHS - 0.5 }),
    );
    expect(result.fooRecommendation.priority).toBe('build_emergency_reserves');
  });

  it('prioritizes emergency reserves when the emergency fund is unknown', () => {
    const result = calculateMonthlyClose(baseInput({ emergencyFundMonths: null }));
    expect(result.fooRecommendation.priority).toBe('build_emergency_reserves');
  });

  it('prioritizes high-interest debt payoff once the starter buffer is met', () => {
    const result = calculateMonthlyClose(
      baseInput({ emergencyFundMonths: FOO_STARTER_EMERGENCY_FUND_MONTHS, hasHighInterestDebt: true }),
    );
    expect(result.fooRecommendation.priority).toBe('pay_high_interest_debt');
  });

  it('prioritizes capturing the employer match once reserves are OK and no high-interest debt', () => {
    const result = calculateMonthlyClose(
      baseInput({
        emergencyFundMonths: 3,
        hasHighInterestDebt: false,
        employerMatch: { available: true, captured: false },
      }),
    );
    expect(result.fooRecommendation.priority).toBe('capture_employer_match');
  });

  it('prioritizes investing more when the match is captured (or unavailable) and investing rate is low', () => {
    const result = calculateMonthlyClose(
      baseInput({
        emergencyFundMonths: 3,
        hasHighInterestDebt: false,
        employerMatch: { available: true, captured: true },
        takeHomeIncomeCents: 600_000,
        investmentContributionCents: 30_000, // 5% < 15% threshold
      }),
    );
    expect(result.fooRecommendation.priority).toBe('invest');
  });

  it('falls through to debt acceleration once everything else clears', () => {
    const result = calculateMonthlyClose(
      baseInput({
        emergencyFundMonths: 3,
        hasHighInterestDebt: false,
        employerMatch: { available: false, captured: null },
        takeHomeIncomeCents: 600_000,
        investmentContributionCents: 100_000, // 16.67% >= 15% threshold
      }),
    );
    expect(result.fooRecommendation.priority).toBe('debt_acceleration');
    expect(result.investingRateBps).toBeGreaterThanOrEqual(FOO_MIN_INVESTING_RATE_BPS);
  });
});
