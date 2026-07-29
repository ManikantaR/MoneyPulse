/**
 * 40.3 — College/529 Planner's deterministic core. Pure, DB-free, LLM-free:
 * given a user-entered current annual college cost (per epic #36's rejection of
 * cost scraping — see PLANNER-SCOPE), years until the student starts, a current
 * 529/manual-savings balance, and two adjustable assumptions (tuition-inflation
 * rate `g` and investment-return rate `r`), computes:
 *
 *   1. The projected future annual cost (and total cost across the program)
 *      after compounding at `g`.
 *   2. The required level monthly contribution — on top of the current
 *      balance's own growth at `r` — to fully fund that total by the time the
 *      student starts (an ordinary, end-of-month annuity).
 *   3. The locked one-third-rule breakdown: total cost split into
 *      savings / current-income / loans thirds, and whether current savings
 *      (grown at `r`) plus the household's stated income capacity during the
 *      school years are on track to cover their combined two-thirds share.
 *
 * Mirrors 13.2's monthly-close-calculator.ts pattern: no NestJS decorators, no
 * DB reads — all resolved inputs are passed in by the caller (a controller/MCP
 * tool), and this module is exhaustively fixture-tested in isolation.
 */

export const COLLEGE_PLANNER_CALCULATION_VERSION = 'college-planner-v1';

/** 5% — the epic's stated tuition-inflation assumption. */
export const DEFAULT_TUITION_INFLATION_RATE_BPS = 500;
/** 6% — no existing household return assumption is modeled elsewhere in the
 *  app (grepped suitability-settings and monthly-close), so this is a
 *  reasonable, adjustable default for a 529/education-savings horizon. */
export const DEFAULT_INVESTMENT_RETURN_RATE_BPS = 600;
/** Standard 4-year undergraduate program, adjustable by the caller. */
export const DEFAULT_PROGRAM_YEARS = 4;

export interface CollegePlannerInput {
  /** User-entered current (today's-dollars) annual cost of attendance, in cents. */
  currentAnnualCostCents: number;
  /** Whole years from now until the student starts. 0 = starting this year. */
  yearsUntilStart: number;
  /** Number of years the student will be enrolled. Defaults to 4. */
  programYears?: number;
  /** Current 529 balance or manual-asset snapshot earmarked for this goal, in cents. */
  currentSavingsCents: number;
  /** Assumed annual tuition-inflation rate, in basis points. Defaults to 500 (5%). */
  tuitionInflationRateBps?: number;
  /** Assumed annual investment-return rate, in basis points. Defaults to 600 (6%). */
  investmentReturnRateBps?: number;
  /** Household's stated monthly income they could redirect toward tuition
   *  *during* the school years (the "current income" third). Optional —
   *  when omitted, the two-thirds on-track check assumes $0 and flags it. */
  monthlyIncomeCapacityDuringSchoolCents?: number;
}

export interface CollegePlannerYearCost {
  /** 0-indexed year of enrollment (0 = first year). */
  yearIndex: number;
  /** Calendar years from now this year of enrollment falls in. */
  yearsFromNow: number;
  costCents: number;
}

export interface OneThirdRuleBreakdown {
  totalProjectedCostCents: number;
  savingsThirdCents: number;
  incomeThirdCents: number;
  loansThirdCents: number;
  /** Current savings, grown at the assumed return rate to the start date (no
   *  further contributions assumed here — this isolates "what you already have"). */
  projectedSavingsAtStartCents: number;
  /** monthlyIncomeCapacityDuringSchoolCents * 12 * programYears (0 if not provided). */
  projectedIncomeCapacityCents: number;
  twoThirdsTargetCents: number;
  onTrackForTwoThirds: boolean;
  twoThirdsGapCents: number;
  incomeCapacityProvided: boolean;
}

export interface CollegePlanResult {
  status: 'ok';
  firstYearAnnualCostCents: number;
  yearlyCosts: CollegePlannerYearCost[];
  totalProjectedCostCents: number;
  monthsUntilStart: number;
  /** Required level monthly contribution to fully fund totalProjectedCostCents
   *  by the start date, given currentSavingsCents' own growth. Null when
   *  yearsUntilStart <= 0 (no time left to accumulate via monthly contributions). */
  requiredMonthlyContributionCents: number | null;
  /** Lump-sum still needed today (undiscounted) when there's no time left to
   *  accumulate monthly, or 0 when the current balance's projected growth
   *  already covers the total. Only meaningful when monthsUntilStart <= 0. */
  immediateLumpSumNeededCents: number | null;
  oneThirdRule: OneThirdRuleBreakdown;
  assumptions: string[];
  calculationVersion: string;
}

function round(n: number): number {
  return Math.round(n);
}

export class CollegePlannerService {
  plan(input: CollegePlannerInput): CollegePlanResult {
    if (input.currentAnnualCostCents <= 0) {
      throw new Error('currentAnnualCostCents must be > 0');
    }
    if (input.yearsUntilStart < 0) {
      throw new Error('yearsUntilStart must be >= 0');
    }
    const programYears = input.programYears ?? DEFAULT_PROGRAM_YEARS;
    if (programYears <= 0) {
      throw new Error('programYears must be > 0');
    }
    if (input.currentSavingsCents < 0) {
      throw new Error('currentSavingsCents must be >= 0');
    }

    const g = (input.tuitionInflationRateBps ?? DEFAULT_TUITION_INFLATION_RATE_BPS) / 10_000;
    const r = (input.investmentReturnRateBps ?? DEFAULT_INVESTMENT_RETURN_RATE_BPS) / 10_000;
    if (g < 0 || r < 0) {
      throw new Error('tuitionInflationRateBps and investmentReturnRateBps must be >= 0');
    }

    // ── 1. Future cost projection ──────────────────────────────
    const yearlyCosts: CollegePlannerYearCost[] = [];
    let totalProjectedCostCents = 0;
    for (let i = 0; i < programYears; i++) {
      const yearsFromNow = input.yearsUntilStart + i;
      const costCents = round(input.currentAnnualCostCents * Math.pow(1 + g, yearsFromNow));
      yearlyCosts.push({ yearIndex: i, yearsFromNow, costCents });
      totalProjectedCostCents += costCents;
    }
    const firstYearAnnualCostCents = yearlyCosts[0].costCents;

    // ── 2. Savings-to-goal annuity ─────────────────────────────
    const monthsUntilStart = input.yearsUntilStart * 12;
    const monthlyRate = r / 12;
    const futureValueOfCurrentSavingsCents =
      monthsUntilStart > 0
        ? input.currentSavingsCents * Math.pow(1 + monthlyRate, monthsUntilStart)
        : input.currentSavingsCents;
    const remainingGoalCents = Math.max(0, totalProjectedCostCents - futureValueOfCurrentSavingsCents);

    let requiredMonthlyContributionCents: number | null = null;
    let immediateLumpSumNeededCents: number | null = null;
    if (monthsUntilStart > 0) {
      if (remainingGoalCents === 0) {
        requiredMonthlyContributionCents = 0;
      } else if (monthlyRate === 0) {
        requiredMonthlyContributionCents = round(remainingGoalCents / monthsUntilStart);
      } else {
        // Ordinary (end-of-month) annuity: FV = PMT * ((1+i)^n - 1) / i
        const annuityFactor = (Math.pow(1 + monthlyRate, monthsUntilStart) - 1) / monthlyRate;
        requiredMonthlyContributionCents = round(remainingGoalCents / annuityFactor);
      }
    } else {
      // Student starts this year or already started — no time left to
      // dollar-cost-average via monthly contributions.
      immediateLumpSumNeededCents = round(remainingGoalCents);
    }

    // ── 3. One-third rule ───────────────────────────────────────
    const savingsThirdCents = round(totalProjectedCostCents / 3);
    const incomeThirdCents = round(totalProjectedCostCents / 3);
    const loansThirdCents = totalProjectedCostCents - savingsThirdCents - incomeThirdCents;

    const incomeCapacityProvided = input.monthlyIncomeCapacityDuringSchoolCents !== undefined;
    const projectedIncomeCapacityCents = incomeCapacityProvided
      ? round((input.monthlyIncomeCapacityDuringSchoolCents ?? 0) * 12 * programYears)
      : 0;
    const projectedSavingsAtStartCents = round(futureValueOfCurrentSavingsCents);
    const twoThirdsTargetCents = savingsThirdCents + incomeThirdCents;
    const combinedProjectedCents = projectedSavingsAtStartCents + projectedIncomeCapacityCents;
    const onTrackForTwoThirds = combinedProjectedCents >= twoThirdsTargetCents;
    const twoThirdsGapCents = Math.max(0, twoThirdsTargetCents - combinedProjectedCents);

    const oneThirdRule: OneThirdRuleBreakdown = {
      totalProjectedCostCents,
      savingsThirdCents,
      incomeThirdCents,
      loansThirdCents,
      projectedSavingsAtStartCents,
      projectedIncomeCapacityCents,
      twoThirdsTargetCents,
      onTrackForTwoThirds,
      twoThirdsGapCents,
      incomeCapacityProvided,
    };

    const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
    const assumptions: string[] = [
      `Tuition inflation assumed at ${(g * 100).toFixed(1)}%/year, compounded annually from today's cost of ${dollars(input.currentAnnualCostCents)}/year.`,
      `Investment return assumed at ${(r * 100).toFixed(1)}%/year, compounded monthly, applied to both the existing balance and future contributions.`,
      `Program length assumed at ${programYears} year(s); total projected cost sums each enrollment year's separately-inflated cost.`,
      'One-third rule (locked definition): 1/3 of total projected cost from savings, 1/3 from current income during school years, 1/3 from loans — not a net-of-aid framing.',
      incomeCapacityProvided
        ? `Income capacity during school = ${dollars(input.monthlyIncomeCapacityDuringSchoolCents ?? 0)}/month, projected over ${programYears} year(s).`
        : 'No monthly income capacity during school was provided — assumed $0 for the two-thirds on-track check.',
    ];

    return {
      status: 'ok',
      firstYearAnnualCostCents,
      yearlyCosts,
      totalProjectedCostCents,
      monthsUntilStart,
      requiredMonthlyContributionCents,
      immediateLumpSumNeededCents,
      oneThirdRule,
      assumptions,
      calculationVersion: COLLEGE_PLANNER_CALCULATION_VERSION,
    };
  }
}
