/**
 * 40.2 — Car affordability engine. Pure, DB-free, LLM-free: given user-entered
 * purchase/loan/insurance/maintenance/mileage figures plus the household's gross
 * monthly income (resolved upstream the same way `BudgetPlanService` resolves it —
 * most recent paycheck profile, smoothed to a monthly figure) and a current gas
 * price (resolved upstream from `EiaClient`, the only externally-sourced input),
 * computes:
 *
 *   1. The 20/4/10 rule pass/fail (down payment ≥20%, loan term ≤4yr, total
 *      monthly vehicle cost ≤10% of gross monthly income).
 *   2. A total-cost-of-ownership breakdown (financing + insurance + maintenance +
 *      fuel − resale) over a user-chosen holding period.
 *   3. A buy-vs-lease comparison over the lease term, when lease terms are given.
 *
 * All money fields are integer cents. Nothing here talks to the DB, an LLM, or an
 * external API — every dollar figure is user-entered or passed in by the caller.
 */

export const CAR_AFFORDABILITY_CALCULATION_VERSION = 1;

// ── Shared ─────────────────────────────────────────────────────────────

export type CostFrequency = 'annual' | 'monthly';

export interface RecurringCost {
  amountCents: number; // non-negative
  frequency: CostFrequency;
}

/** Normalize a user-entered annual-or-monthly cost to a monthly cents figure. */
export function toMonthlyCents(cost: RecurringCost): number {
  return cost.frequency === 'annual' ? Math.round(cost.amountCents / 12) : cost.amountCents;
}

/** Standard amortized loan payment (principal + interest), in cents. */
export function amortizedMonthlyPaymentCents(
  principalCents: number,
  aprBps: number,
  termMonths: number,
): number {
  if (principalCents <= 0 || termMonths <= 0) return 0;
  const monthlyRate = aprBps / 10000 / 12;
  if (monthlyRate === 0) return Math.round(principalCents / termMonths);
  const factor = Math.pow(1 + monthlyRate, termMonths);
  const payment = (principalCents * monthlyRate * factor) / (factor - 1);
  return Math.round(payment);
}

/** Total interest paid over the full amortization schedule, in cents. */
export function totalLoanInterestCents(
  principalCents: number,
  aprBps: number,
  termMonths: number,
): number {
  const monthly = amortizedMonthlyPaymentCents(principalCents, aprBps, termMonths);
  return Math.max(0, monthly * termMonths - principalCents);
}

/**
 * Remaining principal balance after `monthsElapsed` payments on a standard
 * amortizing loan, in cents. Zero once the loan term has fully elapsed.
 */
export function remainingLoanBalanceCents(
  principalCents: number,
  aprBps: number,
  termMonths: number,
  monthsElapsed: number,
): number {
  if (principalCents <= 0 || termMonths <= 0) return 0;
  const n = Math.max(0, Math.min(monthsElapsed, termMonths));
  if (n === 0) return principalCents;
  if (n >= termMonths) return 0;
  const monthlyRate = aprBps / 10000 / 12;
  const payment = amortizedMonthlyPaymentCents(principalCents, aprBps, termMonths);
  if (monthlyRate === 0) return Math.max(0, principalCents - payment * n);
  const balance = principalCents * Math.pow(1 + monthlyRate, n) -
    (payment * (Math.pow(1 + monthlyRate, n) - 1)) / monthlyRate;
  return Math.max(0, Math.round(balance));
}

// ── 1. The 20/4/10 rule ───────────────────────────────────────────────

export interface Rule204010Input {
  priceCents: number;
  downPaymentCents: number;
  loanTermMonths: number;
  /** Total of the recurring monthly vehicle costs: loan payment + insurance +
   *  maintenance + fuel (the same monthly figures used in the TCO breakdown). */
  totalMonthlyVehicleCostCents: number;
  grossMonthlyIncomeCents: number;
}

export interface Rule204010Result {
  downPaymentPassed: boolean;
  downPaymentPercent: number; // 0..1 (or >1 if overpaying down)
  downPaymentRequiredCents: number;
  loanTermPassed: boolean;
  loanTermMonths: number;
  maxLoanTermMonths: number;
  monthlyCostPassed: boolean;
  monthlyCostPercent: number | null; // null when income is unknown (<=0)
  maxMonthlyCostCents: number | null;
  passed: boolean;
}

const RULE_204010_DOWN_PAYMENT_MIN = 0.2;
const RULE_204010_MAX_LOAN_TERM_MONTHS = 48;
const RULE_204010_MAX_MONTHLY_COST_SHARE = 0.1;

export function evaluateRule204010(input: Rule204010Input): Rule204010Result {
  const downPaymentPercent =
    input.priceCents > 0 ? input.downPaymentCents / input.priceCents : 0;
  const downPaymentPassed = downPaymentPercent >= RULE_204010_DOWN_PAYMENT_MIN;
  const downPaymentRequiredCents = Math.round(input.priceCents * RULE_204010_DOWN_PAYMENT_MIN);

  const loanTermPassed = input.loanTermMonths <= RULE_204010_MAX_LOAN_TERM_MONTHS;

  const hasIncome = input.grossMonthlyIncomeCents > 0;
  const maxMonthlyCostCents = hasIncome
    ? Math.round(input.grossMonthlyIncomeCents * RULE_204010_MAX_MONTHLY_COST_SHARE)
    : null;
  const monthlyCostPercent = hasIncome
    ? input.totalMonthlyVehicleCostCents / input.grossMonthlyIncomeCents
    : null;
  // Without a known income we cannot claim the rule passed — fail closed.
  const monthlyCostPassed =
    hasIncome && input.totalMonthlyVehicleCostCents <= (maxMonthlyCostCents as number);

  return {
    downPaymentPassed,
    downPaymentPercent,
    downPaymentRequiredCents,
    loanTermPassed,
    loanTermMonths: input.loanTermMonths,
    maxLoanTermMonths: RULE_204010_MAX_LOAN_TERM_MONTHS,
    monthlyCostPassed,
    monthlyCostPercent,
    maxMonthlyCostCents,
    passed: downPaymentPassed && loanTermPassed && monthlyCostPassed,
  };
}

// ── 2. Total cost of ownership ────────────────────────────────────────

export interface TcoInput {
  priceCents: number;
  downPaymentCents: number;
  loanTermMonths: number;
  loanAprBps: number;
  insurance: RecurringCost;
  maintenance: RecurringCost;
  /** Expected miles driven per year. */
  annualMileage: number;
  /** Expected miles per gallon. */
  mpg: number;
  /** Current gas price, dollars per gallon, in cents (e.g. $3.50/gal → 350). */
  gasPriceCentsPerGallon: number;
  /** Holding period this TCO figure covers, in whole years. */
  ownershipYears: number;
  /** Estimated resale/trade-in value at the end of the ownership period. */
  estimatedResaleValueCents: number;
}

export interface TcoBreakdown {
  loanPrincipalCents: number;
  monthlyLoanPaymentCents: number;
  /** Loan interest actually incurred during the ownership window (not necessarily
   *  the full loan term, if the holding period is shorter than the loan). */
  ownershipLoanInterestCents: number;
  monthlyInsuranceCents: number;
  monthlyMaintenanceCents: number;
  monthlyFuelCents: number;
  totalInsuranceCents: number;
  totalMaintenanceCents: number;
  totalFuelCents: number;
  /** downPayment + all loan payments made during the ownership window. */
  totalFinancingCashOutCents: number;
  estimatedResaleValueCents: number;
  /** downPayment + financing + insurance + maintenance + fuel − resale, over the
   *  ownership window. */
  totalCostOfOwnershipCents: number;
  ownershipMonths: number;
}

export function calculateTco(input: TcoInput): TcoBreakdown {
  const principalCents = Math.max(0, input.priceCents - input.downPaymentCents);
  const monthlyLoanPaymentCents = amortizedMonthlyPaymentCents(
    principalCents,
    input.loanAprBps,
    input.loanTermMonths,
  );
  const ownershipMonths = Math.max(0, Math.round(input.ownershipYears * 12));
  const monthsFinanced = Math.min(ownershipMonths, input.loanTermMonths);

  // Interest actually paid during the financed portion of the ownership window,
  // computed from the amortization schedule (not a flat-rate approximation).
  let balance = principalCents;
  let ownershipLoanInterestCents = 0;
  const monthlyRate = input.loanAprBps / 10000 / 12;
  for (let m = 0; m < monthsFinanced && balance > 0; m++) {
    const interest = Math.round(balance * monthlyRate);
    let principal = monthlyLoanPaymentCents - interest;
    if (principal <= 0) principal = 0;
    principal = Math.min(principal, balance);
    balance -= principal;
    ownershipLoanInterestCents += interest;
  }

  const monthlyInsuranceCents = toMonthlyCents(input.insurance);
  const monthlyMaintenanceCents = toMonthlyCents(input.maintenance);
  const gallonsPerYear = input.mpg > 0 ? input.annualMileage / input.mpg : 0;
  const annualFuelCents = Math.round(gallonsPerYear * input.gasPriceCentsPerGallon);
  const monthlyFuelCents = Math.round(annualFuelCents / 12);

  const totalInsuranceCents = monthlyInsuranceCents * ownershipMonths;
  const totalMaintenanceCents = monthlyMaintenanceCents * ownershipMonths;
  const totalFuelCents = monthlyFuelCents * ownershipMonths;
  const totalFinancingCashOutCents =
    input.downPaymentCents + monthlyLoanPaymentCents * monthsFinanced;

  const totalCostOfOwnershipCents =
    totalFinancingCashOutCents +
    totalInsuranceCents +
    totalMaintenanceCents +
    totalFuelCents -
    input.estimatedResaleValueCents;

  return {
    loanPrincipalCents: principalCents,
    monthlyLoanPaymentCents,
    ownershipLoanInterestCents,
    monthlyInsuranceCents,
    monthlyMaintenanceCents,
    monthlyFuelCents,
    totalInsuranceCents,
    totalMaintenanceCents,
    totalFuelCents,
    totalFinancingCashOutCents,
    estimatedResaleValueCents: input.estimatedResaleValueCents,
    totalCostOfOwnershipCents,
    ownershipMonths,
  };
}

// ── 3. Buy vs lease ────────────────────────────────────────────────────

export interface LeaseInput {
  monthlyPaymentCents: number;
  /** Due-at-signing cash: first month, acquisition fee, cap-cost reduction, etc. */
  dueAtSigningCents: number;
  termMonths: number;
}

export interface BuyVsLeaseResult {
  comparisonMonths: number;
  buyTotalCostCents: number;
  leaseTotalCostCents: number;
  /** Positive when buying is cheaper, negative when leasing is cheaper. */
  costDifferenceCents: number;
  cheaperOption: 'buy' | 'lease' | 'tie';
}

/** Linearly prorate resale value at `atMonth` between full price (month 0) and the
 *  estimated resale value at the end of `ownershipMonths`. */
function proratedResaleValueCents(
  priceCents: number,
  estimatedResaleValueCents: number,
  ownershipMonths: number,
  atMonth: number,
): number {
  if (ownershipMonths <= 0) return priceCents;
  const depreciation = priceCents - estimatedResaleValueCents;
  const fraction = Math.min(1, Math.max(0, atMonth / ownershipMonths));
  return Math.round(priceCents - depreciation * fraction);
}

/**
 * Compares buying (via `tco`'s financing terms) against leasing over the lease
 * term. Insurance/maintenance/fuel are assumed equal for both options (the same
 * vehicle, the same driving) and are intentionally excluded from the comparison so
 * it isolates the financing + resale difference between the two paths.
 */
export function compareBuyVsLease(
  tcoInput: Pick<
    TcoInput,
    'priceCents' | 'downPaymentCents' | 'loanTermMonths' | 'loanAprBps' | 'estimatedResaleValueCents' | 'ownershipYears'
  >,
  lease: LeaseInput,
): BuyVsLeaseResult {
  const comparisonMonths = Math.max(0, lease.termMonths);
  const principalCents = Math.max(0, tcoInput.priceCents - tcoInput.downPaymentCents);
  const monthlyLoanPaymentCents = amortizedMonthlyPaymentCents(
    principalCents,
    tcoInput.loanAprBps,
    tcoInput.loanTermMonths,
  );
  const monthsFinanced = Math.min(comparisonMonths, tcoInput.loanTermMonths);
  const ownershipMonths = Math.max(0, Math.round(tcoInput.ownershipYears * 12));
  const resaleAtComparisonEnd = proratedResaleValueCents(
    tcoInput.priceCents,
    tcoInput.estimatedResaleValueCents,
    ownershipMonths,
    comparisonMonths,
  );
  // If the comparison term ends before the loan is paid off, the buyer's actual
  // equity is resale value MINUS what's still owed — crediting the full resale
  // value here would understate buy's true cost whenever a shorter lease term is
  // compared against a longer loan (a common real scenario, e.g. a 3yr lease vs.
  // a 5yr loan).
  const remainingBalanceAtComparisonEnd = remainingLoanBalanceCents(
    principalCents,
    tcoInput.loanAprBps,
    tcoInput.loanTermMonths,
    comparisonMonths,
  );
  const buyEquityAtComparisonEnd = Math.max(
    0,
    resaleAtComparisonEnd - remainingBalanceAtComparisonEnd,
  );

  const buyTotalCostCents =
    tcoInput.downPaymentCents +
    monthlyLoanPaymentCents * monthsFinanced -
    buyEquityAtComparisonEnd;

  const leaseTotalCostCents =
    lease.dueAtSigningCents + lease.monthlyPaymentCents * comparisonMonths;

  const costDifferenceCents = leaseTotalCostCents - buyTotalCostCents;
  const cheaperOption: BuyVsLeaseResult['cheaperOption'] =
    costDifferenceCents > 0 ? 'buy' : costDifferenceCents < 0 ? 'lease' : 'tie';

  return {
    comparisonMonths,
    buyTotalCostCents,
    leaseTotalCostCents,
    costDifferenceCents,
    cheaperOption,
  };
}

// ── Aggregate ──────────────────────────────────────────────────────────

export interface CarAffordabilityInput {
  priceCents: number;
  downPaymentCents: number;
  loanTermMonths: number;
  loanAprBps: number;
  grossMonthlyIncomeCents: number;
  insurance: RecurringCost;
  maintenance: RecurringCost;
  annualMileage: number;
  mpg: number;
  gasPriceCentsPerGallon: number;
  ownershipYears: number;
  estimatedResaleValueCents: number;
  lease?: LeaseInput;
}

export interface CarAffordabilityResult {
  version: number;
  rule204010: Rule204010Result;
  tco: TcoBreakdown;
  buyVsLease: BuyVsLeaseResult | null;
}

export function calculateCarAffordability(
  input: CarAffordabilityInput,
): CarAffordabilityResult {
  const tco = calculateTco(input);
  const totalMonthlyVehicleCostCents =
    tco.monthlyLoanPaymentCents +
    tco.monthlyInsuranceCents +
    tco.monthlyMaintenanceCents +
    tco.monthlyFuelCents;

  const rule204010 = evaluateRule204010({
    priceCents: input.priceCents,
    downPaymentCents: input.downPaymentCents,
    loanTermMonths: input.loanTermMonths,
    totalMonthlyVehicleCostCents,
    grossMonthlyIncomeCents: input.grossMonthlyIncomeCents,
  });

  const buyVsLease = input.lease
    ? compareBuyVsLease(
        {
          priceCents: input.priceCents,
          downPaymentCents: input.downPaymentCents,
          loanTermMonths: input.loanTermMonths,
          loanAprBps: input.loanAprBps,
          estimatedResaleValueCents: input.estimatedResaleValueCents,
          ownershipYears: input.ownershipYears,
        },
        input.lease,
      )
    : null;

  return { version: CAR_AFFORDABILITY_CALCULATION_VERSION, rule204010, tco, buyVsLease };
}
