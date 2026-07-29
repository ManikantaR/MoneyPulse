import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * 40.3 — College/529 planner. Pure computation from the caller's own
 * user-entered inputs (per epic #36, this app never scrapes tuition costs) —
 * no DB reads, so it's safe under the aggregates-only advisor allowlist and
 * needs no per-user scoping.
 *
 * Mirrors apps/api/src/college-planner/college-planner.service.ts's formulas
 * exactly (future-cost compounding, ordinary end-of-month savings annuity, and
 * the locked one-third-rule definition: 1/3 savings, 1/3 current income during
 * school years, 1/3 loans — not a net-of-aid framing). Kept as a
 * self-contained duplicate here because apps/mcp-server intentionally has no
 * dependency on apps/api (see its package.json) — if the formulas above ever
 * change, update both and bump both calculation-version strings together.
 */

export const COLLEGE_PLAN_MCP_CALCULATION_VERSION = 'college-planner-v1';

const DEFAULT_TUITION_INFLATION_RATE_BPS = 500; // 5%/year
const DEFAULT_INVESTMENT_RETURN_RATE_BPS = 600; // 6%/year
const DEFAULT_PROGRAM_YEARS = 4;

function round(n: number): number {
  return Math.round(n);
}

export function registerGetCollegePlan(server: McpServer) {
  server.tool(
    'get_college_plan',
    'College/529 savings plan: given a current (today\'s-dollars) annual college cost, years until the student starts, an optional program length, a current 529/savings balance, and adjustable tuition-inflation and investment-return assumptions, projects the future annual and total cost, the required level monthly savings contribution to fully fund it, and the locked one-third-rule breakdown (1/3 savings, 1/3 current income during school, 1/3 loans) with an on-track check against a stated monthly income capacity during the school years. Answers "how much do I need to save monthly for college" and "am I on track for the one-third rule".',
    {
      currentAnnualCostCents: z
        .number()
        .int()
        .positive()
        .describe("Today's annual cost of attendance (tuition + room/board etc), in cents, as entered by the user."),
      yearsUntilStart: z
        .number()
        .int()
        .min(0)
        .describe('Whole years from now until the student starts college. 0 = starting this year.'),
      programYears: z
        .number()
        .int()
        .positive()
        .max(10)
        .optional()
        .describe('Years the student will be enrolled. Defaults to 4.'),
      currentSavingsCents: z
        .number()
        .int()
        .min(0)
        .describe('Current 529 balance or earmarked manual-asset/savings snapshot for this goal, in cents.'),
      tuitionInflationRateBps: z
        .number()
        .min(0)
        .max(2000)
        .optional()
        .describe('Assumed annual tuition-inflation rate, in basis points. Defaults to 500 (5%), the epic-stated assumption. Adjustable.'),
      investmentReturnRateBps: z
        .number()
        .min(0)
        .max(3000)
        .optional()
        .describe('Assumed annual investment-return rate, in basis points. Defaults to 600 (6%). Adjustable.'),
      monthlyIncomeCapacityDuringSchoolCents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Household\'s stated monthly income they could redirect toward tuition during the school years, in cents. Omit if unknown — the two-thirds on-track check will assume $0 and flag it.'),
    },
    async (params) => {
      const g = (params.tuitionInflationRateBps ?? DEFAULT_TUITION_INFLATION_RATE_BPS) / 10_000;
      const r = (params.investmentReturnRateBps ?? DEFAULT_INVESTMENT_RETURN_RATE_BPS) / 10_000;
      const programYears = params.programYears ?? DEFAULT_PROGRAM_YEARS;

      let totalProjectedCostCents = 0;
      const yearlyCosts: { yearIndex: number; yearsFromNow: number; costCents: number }[] = [];
      for (let i = 0; i < programYears; i++) {
        const yearsFromNow = params.yearsUntilStart + i;
        const costCents = round(params.currentAnnualCostCents * Math.pow(1 + g, yearsFromNow));
        yearlyCosts.push({ yearIndex: i, yearsFromNow, costCents });
        totalProjectedCostCents += costCents;
      }
      const firstYearAnnualCostCents = yearlyCosts[0].costCents;

      const monthsUntilStart = params.yearsUntilStart * 12;
      const monthlyRate = r / 12;
      const futureValueOfCurrentSavingsCents =
        monthsUntilStart > 0
          ? params.currentSavingsCents * Math.pow(1 + monthlyRate, monthsUntilStart)
          : params.currentSavingsCents;
      const remainingGoalCents = Math.max(0, totalProjectedCostCents - futureValueOfCurrentSavingsCents);

      let requiredMonthlyContributionCents: number | null = null;
      let immediateLumpSumNeededCents: number | null = null;
      if (monthsUntilStart > 0) {
        if (remainingGoalCents === 0) {
          requiredMonthlyContributionCents = 0;
        } else if (monthlyRate === 0) {
          requiredMonthlyContributionCents = round(remainingGoalCents / monthsUntilStart);
        } else {
          const annuityFactor = (Math.pow(1 + monthlyRate, monthsUntilStart) - 1) / monthlyRate;
          requiredMonthlyContributionCents = round(remainingGoalCents / annuityFactor);
        }
      } else {
        immediateLumpSumNeededCents = round(remainingGoalCents);
      }

      const savingsThirdCents = round(totalProjectedCostCents / 3);
      const incomeThirdCents = round(totalProjectedCostCents / 3);
      const loansThirdCents = totalProjectedCostCents - savingsThirdCents - incomeThirdCents;

      const incomeCapacityProvided = params.monthlyIncomeCapacityDuringSchoolCents !== undefined;
      const projectedIncomeCapacityCents = incomeCapacityProvided
        ? round((params.monthlyIncomeCapacityDuringSchoolCents ?? 0) * 12 * programYears)
        : 0;
      const projectedSavingsAtStartCents = round(futureValueOfCurrentSavingsCents);
      const twoThirdsTargetCents = savingsThirdCents + incomeThirdCents;
      const combinedProjectedCents = projectedSavingsAtStartCents + projectedIncomeCapacityCents;
      const onTrackForTwoThirds = combinedProjectedCents >= twoThirdsTargetCents;
      const twoThirdsGapCents = Math.max(0, twoThirdsTargetCents - combinedProjectedCents);

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

      const lines = [
        `College plan (calculation ${COLLEGE_PLAN_MCP_CALCULATION_VERSION}):`,
        `  Today's annual cost: ${dollars(params.currentAnnualCostCents)}, ${params.yearsUntilStart} year(s) until start, ${programYears}-year program.`,
        `  Assumptions (adjustable): tuition inflation ${(g * 100).toFixed(1)}%/year, investment return ${(r * 100).toFixed(1)}%/year.`,
        `  Projected annual cost in year 1: ${dollars(firstYearAnnualCostCents)}`,
        `  Projected total cost across ${programYears} year(s): ${dollars(totalProjectedCostCents)}`,
        monthsUntilStart > 0
          ? `  Required monthly savings contribution: ${dollars(requiredMonthlyContributionCents ?? 0)} (current balance ${dollars(params.currentSavingsCents)} projected to grow to ${dollars(projectedSavingsAtStartCents)} by start date).`
          : `  Student starts this year — no time left to save monthly. Lump sum still needed today: ${dollars(immediateLumpSumNeededCents ?? 0)}.`,
        '  One-third rule (1/3 savings, 1/3 current income during school, 1/3 loans — not net-of-aid):',
        `    Savings third: ${dollars(savingsThirdCents)}, Income third: ${dollars(incomeThirdCents)}, Loans third: ${dollars(loansThirdCents)}`,
        incomeCapacityProvided
          ? `    Income capacity during school: ${dollars(params.monthlyIncomeCapacityDuringSchoolCents ?? 0)}/month → ${dollars(projectedIncomeCapacityCents)} projected.`
          : '    No income capacity during school provided — assumed $0 for the on-track check.',
        `    Projected savings + income capacity (${dollars(combinedProjectedCents)}) vs the two-thirds target (${dollars(twoThirdsTargetCents)}): ${
          onTrackForTwoThirds ? 'ON TRACK' : `NOT on track (gap ${dollars(twoThirdsGapCents)})`
        }`,
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
