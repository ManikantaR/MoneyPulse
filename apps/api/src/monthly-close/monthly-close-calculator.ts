import {
  LIQUID_NET_WORTH_RATIO_TARGET_BPS,
  DEBT_ASSET_RATIO_TARGET_BPS,
  DEBT_PAYMENT_INCOME_RATIO_TARGET_BPS,
  EXPENSE_RATIO_TARGET_BPS,
  MONTHLY_CLOSE_CALCULATION_VERSION,
} from '@moneypulse/shared';
import type { TargetStatusLevel } from '@moneypulse/shared';

/**
 * 13.2 — Monthly Close's deterministic core. Pure, DB-free, LLM-free: given a
 * month's already-resolved figures (take-home income, transaction lines, account
 * balances, manual asset carry-forwards, resolved loan/employer-match settings —
 * all the DB reads/joins happen in the service layer per the epic), compute the
 * full income-statement/balance-sheet close, the Metric Contract ratios, target
 * bands, the Ramit Conscious Spending overlay, the Money Guy FOO next-dollar
 * priority, and the freshness flags.
 *
 * See specs/PHASE13-MONTHLY-CLOSE-SPEC.md "Metric Contracts" for the exact
 * formulas and epic #158's resolved-decisions table for the deviations from the
 * original spec body (take-home = paycheck-profile net, holdings-else-snapshot
 * investment pricing, carry-forward manual assets, derived Ramit Investments
 * bucket, no household scope).
 */

// ── Local FOO thresholds ──────────────────────────────────────
// The spec's V1 FOO output text fixes the *order* of priorities ("Build emergency
// reserves / Pay high-interest debt / Capture match / Invest / Debt acceleration")
// but does not pin exact numeric gates. These starter-buffer/investing-rate
// thresholds are this module's deterministic interpretation — bump
// MONTHLY_CLOSE_CALCULATION_VERSION if they change.
export const FOO_STARTER_EMERGENCY_FUND_MONTHS = 1;
export const FOO_MIN_INVESTING_RATE_BPS = 1500; // 15%

export type CategoryBucket = 'needs' | 'wants' | 'savings_debt' | null;

/** One month's already-classified transaction line, flattened for this pure
 *  calculator. Category joins (isTransfer, bucket) happen in the service. */
export interface MonthlyCloseTransactionLine {
  id: string;
  amountCents: number; // always a non-negative magnitude
  direction: 'debit' | 'credit';
  /** category.isTransfer — internal money movement (CC payment, account-to-account,
   *  investment contribution transfer, etc). */
  isTransfer: boolean;
  isSplitParent: boolean;
  isDeleted: boolean;
  /** True for a debit line that is principal paid toward a carried credit-card
   *  balance, a mortgage, an auto loan, or a personal loan. Excluded from expenses
   *  regardless of isTransfer; folded into debt paydown instead. */
  isDebtPrincipalTransfer: boolean;
  categoryBucket: CategoryBucket;
}

export interface EmployerMatchInput {
  /** Employer 401k match is configured (epic #158 decision #12). */
  available: boolean;
  /** Whether this month's contribution rate meets/exceeds the match threshold.
   *  Null when match is available but capture status is unknown (incomplete data). */
  captured: boolean | null;
}

export interface MonthlyCloseFreshnessInput {
  missingManualAssets: string[];
  staleAccounts: string[];
  unverifiedLoans: string[];
}

export interface MonthlyCloseCalculatorInput {
  month: string; // first day of month, YYYY-MM-DD
  /** Paycheck-profile net (decision #1) — NOT transaction-derived. */
  takeHomeIncomeCents: number;
  grossIncomeCents: number | null;

  transactions: MonthlyCloseTransactionLine[];

  /** Checking/savings/money-market growth + explicit categorized savings
   *  transfers for the month (balance-delta based; computed upstream). */
  cashSavingsCents: number;
  /** 401k/IRA/brokerage/HSA/529 invested contributions, market appreciation
   *  excluded (derived per decision #4; computed upstream). */
  investmentContributionCents: number;
  /** All principal paid this month: mortgage + auto + personal loan + carried
   *  credit-card payoff (manual-statement-wins else amortized; computed
   *  upstream from loan-balance deltas, not re-derived from raw transaction
   *  amounts, to avoid mismatches between a blended payment and its true
   *  principal/interest/escrow split). */
  debtPrincipalPaidCents: number;
  /** Subset of debtPrincipalPaidCents that is above the required minimum. */
  extraDebtPrincipalPaidCents: number;
  requiredMonthlyDebtPaymentCents: number;

  /** Checking + savings + cash_sweep. Never includes brokerage (decision #7). */
  liquidAssetCents: number;
  /** Holdings x EOD close when holdings exist, else the manual snapshot value —
   *  never both (decision #2). Includes brokerage/401k/IRA/HSA/529. */
  investmentAssetCents: number;
  /** Carry-forward home/car/gold/other values (decision #3). */
  manualAssetCents: number;
  creditCardLiabilityCents: number;
  loanLiabilityCents: number;

  emergencyFundMonths: number | null;
  hasHighInterestDebt: boolean;
  employerMatch: EmployerMatchInput;

  freshness: MonthlyCloseFreshnessInput;
}

export interface RamitBuckets {
  fixedCents: number;
  investmentsCents: number;
  savingsCents: number;
  guiltFreeCents: number;
}

export type FooPriority =
  | 'build_emergency_reserves'
  | 'pay_high_interest_debt'
  | 'capture_employer_match'
  | 'invest'
  | 'debt_acceleration';

export interface FooRecommendation {
  priority: FooPriority;
  label: string;
  citations: string[];
}

export interface MonthlyCloseResult {
  month: string;

  takeHomeIncomeCents: number;
  grossIncomeCents: number | null;
  expenseCents: number;

  cashSavingsCents: number;
  investmentContributionCents: number;
  debtPrincipalPaidCents: number;
  extraDebtPrincipalPaidCents: number;

  liquidAssetCents: number;
  investmentAssetCents: number;
  manualAssetCents: number;
  totalAssetCents: number;
  creditCardLiabilityCents: number;
  loanLiabilityCents: number;
  totalLiabilityCents: number;
  netWorthCents: number;

  savingsRateBps: number | null;
  investingRateBps: number | null;
  debtPaydownRateBps: number | null;
  wealthBuildingRateBps: number | null;
  expenseRatioBps: number | null;
  liquidNetWorthRatioBps: number | null;
  debtAssetRatioBps: number | null;
  debtPaymentIncomeRatioBps: number | null;

  targetStatus: Record<string, TargetStatusLevel>;
  ramitBuckets: RamitBuckets;
  fooRecommendation: FooRecommendation;
  freshness: MonthlyCloseFreshnessInput & { isComplete: boolean };
  calculationVersion: string;
}

function bpsOf(numeratorCents: number, denominatorCents: number): number | null {
  if (denominatorCents <= 0) return null;
  return Math.round((numeratorCents / denominatorCents) * 10_000);
}

/** Green/yellow/red over a single ascending green-max/yellow-max pair — "lower is
 *  better" metrics (expense ratio, debt/asset, debt-payment/income). */
function lowerIsBetterStatus(
  bps: number | null,
  greenMaxBps: number,
  yellowMaxBps: number,
): TargetStatusLevel {
  if (bps === null) return 'unknown';
  if (bps < greenMaxBps) return 'green';
  if (bps < yellowMaxBps) return 'yellow';
  return 'red';
}

/** Liquid-net-worth-ratio's centered band: green window, yellow shoulders either
 *  side, red below the floor, informational above the ceiling. */
function liquidRatioStatus(bps: number | null): TargetStatusLevel {
  if (bps === null) return 'unknown';
  const b = LIQUID_NET_WORTH_RATIO_TARGET_BPS;
  if (bps < b.RED_MAX_BPS) return 'red';
  if (bps < b.GREEN_MIN_BPS) return 'yellow';
  if (bps < b.GREEN_MAX_BPS) return 'green';
  if (bps < b.YELLOW_HIGH_MAX_BPS) return 'yellow';
  return 'info';
}

/** Expenses per the Metric Contract: debits excluding transfers, split parents,
 *  deleted rows, and debt-principal transfer lines. Credit-card purchases and
 *  interest/fees count; credit-card payments (transfers) and any principal
 *  payoff line do not. */
function computeExpenseCents(transactions: MonthlyCloseTransactionLine[]): number {
  return transactions
    .filter(
      (t) =>
        t.direction === 'debit' &&
        !t.isDeleted &&
        !t.isTransfer &&
        !t.isSplitParent &&
        !t.isDebtPrincipalTransfer,
    )
    .reduce((sum, t) => sum + t.amountCents, 0);
}

/** Ramit Conscious Spending Plan buckets. Fixed = "needs"-bucketed expenses plus
 *  all debt principal paid (minimums are a required fixed obligation; extra
 *  paydown still isn't guilt-free spending, so it stays in Fixed rather than
 *  being invented as a 5th bucket). Investments/Savings reuse the derived
 *  aggregates directly (decision #4 — do not recategorize). Guilt-free is
 *  everything else: "wants"/"savings_debt"/unclassified expense-counted debits.
 *  Reuses `category_bucket` per decision #4 rather than a competing taxonomy. */
function computeRamitBuckets(
  transactions: MonthlyCloseTransactionLine[],
  debtPrincipalPaidCents: number,
  investmentContributionCents: number,
  cashSavingsCents: number,
): RamitBuckets {
  const expenseLines = transactions.filter(
    (t) =>
      t.direction === 'debit' &&
      !t.isDeleted &&
      !t.isTransfer &&
      !t.isSplitParent &&
      !t.isDebtPrincipalTransfer,
  );
  const needsCents = expenseLines
    .filter((t) => t.categoryBucket === 'needs')
    .reduce((sum, t) => sum + t.amountCents, 0);
  const otherCents = expenseLines
    .filter((t) => t.categoryBucket !== 'needs')
    .reduce((sum, t) => sum + t.amountCents, 0);

  return {
    fixedCents: needsCents + debtPrincipalPaidCents,
    investmentsCents: investmentContributionCents,
    savingsCents: cashSavingsCents,
    guiltFreeCents: otherCents,
  };
}

function computeFooRecommendation(input: MonthlyCloseCalculatorInput, investingRateBps: number | null): FooRecommendation {
  const citations: string[] = [
    `Emergency fund: ${input.emergencyFundMonths === null ? 'unknown' : `${input.emergencyFundMonths} month(s)`}.`,
    `High-interest debt present: ${input.hasHighInterestDebt ? 'yes' : 'no'}.`,
    `Employer match: ${
      input.employerMatch.available
        ? input.employerMatch.captured === null
          ? 'available, capture status unknown'
          : input.employerMatch.captured
            ? 'available and captured'
            : 'available and NOT fully captured'
        : 'not configured'
    }.`,
    `Investing rate: ${investingRateBps === null ? 'unknown' : `${(investingRateBps / 100).toFixed(1)}%`}.`,
  ];

  if (
    input.emergencyFundMonths === null ||
    input.emergencyFundMonths < FOO_STARTER_EMERGENCY_FUND_MONTHS
  ) {
    return { priority: 'build_emergency_reserves', label: 'Build emergency reserves', citations };
  }
  if (input.hasHighInterestDebt) {
    return { priority: 'pay_high_interest_debt', label: 'Pay high-interest debt', citations };
  }
  if (input.employerMatch.available && input.employerMatch.captured === false) {
    return { priority: 'capture_employer_match', label: 'Capture employer match', citations };
  }
  if (investingRateBps === null || investingRateBps < FOO_MIN_INVESTING_RATE_BPS) {
    return { priority: 'invest', label: 'Invest', citations };
  }
  return { priority: 'debt_acceleration', label: 'Debt acceleration', citations };
}

/**
 * Compute one month's full close. Never mutates inputs; safe to call repeatedly
 * (e.g. once for a live run, once again inside a test) with identical inputs
 * producing identical output.
 */
export function calculateMonthlyClose(
  input: MonthlyCloseCalculatorInput,
): MonthlyCloseResult {
  const expenseCents = computeExpenseCents(input.transactions);

  const totalAssetCents =
    input.liquidAssetCents + input.investmentAssetCents + input.manualAssetCents;
  const totalLiabilityCents = input.creditCardLiabilityCents + input.loanLiabilityCents;
  const netWorthCents = totalAssetCents - totalLiabilityCents;

  const savingsRateBps = bpsOf(input.cashSavingsCents, input.takeHomeIncomeCents);
  const investingRateBps = bpsOf(input.investmentContributionCents, input.takeHomeIncomeCents);
  const debtPaydownRateBps = bpsOf(input.debtPrincipalPaidCents, input.takeHomeIncomeCents);
  const wealthBuildingRateBps = bpsOf(
    input.cashSavingsCents + input.investmentContributionCents + input.debtPrincipalPaidCents,
    input.takeHomeIncomeCents,
  );
  const expenseRatioBps = bpsOf(expenseCents, input.takeHomeIncomeCents);
  const liquidNetWorthRatioBps = bpsOf(input.liquidAssetCents, netWorthCents);
  const debtAssetRatioBps = bpsOf(totalLiabilityCents, totalAssetCents);
  const debtPaymentIncomeRatioBps = bpsOf(
    input.requiredMonthlyDebtPaymentCents,
    input.takeHomeIncomeCents,
  );

  const targetStatus: Record<string, TargetStatusLevel> = {
    // No fixed band defined for these (v1) — 'info' once computable, 'unknown'
    // when the take-home denominator is missing/zero.
    savings_rate: savingsRateBps === null ? 'unknown' : 'info',
    investing_rate: investingRateBps === null ? 'unknown' : 'info',
    debt_paydown_rate: debtPaydownRateBps === null ? 'unknown' : 'info',
    wealth_building_rate: wealthBuildingRateBps === null ? 'unknown' : 'info',
    expense_ratio: lowerIsBetterStatus(
      expenseRatioBps,
      EXPENSE_RATIO_TARGET_BPS.GREEN_MAX_BPS,
      EXPENSE_RATIO_TARGET_BPS.YELLOW_MAX_BPS,
    ),
    liquid_net_worth_ratio: liquidRatioStatus(liquidNetWorthRatioBps),
    debt_asset_ratio: lowerIsBetterStatus(
      debtAssetRatioBps,
      DEBT_ASSET_RATIO_TARGET_BPS.GREEN_MAX_BPS,
      DEBT_ASSET_RATIO_TARGET_BPS.YELLOW_MAX_BPS,
    ),
    debt_payment_income_ratio: lowerIsBetterStatus(
      debtPaymentIncomeRatioBps,
      DEBT_PAYMENT_INCOME_RATIO_TARGET_BPS.GREEN_MAX_BPS,
      DEBT_PAYMENT_INCOME_RATIO_TARGET_BPS.YELLOW_MAX_BPS,
    ),
  };

  const ramitBuckets = computeRamitBuckets(
    input.transactions,
    input.debtPrincipalPaidCents,
    input.investmentContributionCents,
    input.cashSavingsCents,
  );

  const fooRecommendation = computeFooRecommendation(input, investingRateBps);

  const isComplete =
    input.freshness.missingManualAssets.length === 0 &&
    input.freshness.staleAccounts.length === 0 &&
    input.freshness.unverifiedLoans.length === 0;

  return {
    month: input.month,
    takeHomeIncomeCents: input.takeHomeIncomeCents,
    grossIncomeCents: input.grossIncomeCents,
    expenseCents,

    cashSavingsCents: input.cashSavingsCents,
    investmentContributionCents: input.investmentContributionCents,
    debtPrincipalPaidCents: input.debtPrincipalPaidCents,
    extraDebtPrincipalPaidCents: input.extraDebtPrincipalPaidCents,

    liquidAssetCents: input.liquidAssetCents,
    investmentAssetCents: input.investmentAssetCents,
    manualAssetCents: input.manualAssetCents,
    totalAssetCents,
    creditCardLiabilityCents: input.creditCardLiabilityCents,
    loanLiabilityCents: input.loanLiabilityCents,
    totalLiabilityCents,
    netWorthCents,

    savingsRateBps,
    investingRateBps,
    debtPaydownRateBps,
    wealthBuildingRateBps,
    expenseRatioBps,
    liquidNetWorthRatioBps,
    debtAssetRatioBps,
    debtPaymentIncomeRatioBps,

    targetStatus,
    ramitBuckets,
    fooRecommendation,
    freshness: { ...input.freshness, isComplete },
    calculationVersion: MONTHLY_CLOSE_CALCULATION_VERSION,
  };
}
