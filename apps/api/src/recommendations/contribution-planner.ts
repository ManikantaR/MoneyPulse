import { EvidenceItem, ExpectedImpact, ConfidenceBand } from './recommendation-evidence';
import { requireSuitability, SuitabilitySettingsLike, SuitabilityField } from '../suitability-settings/suitability-gate';

/**
 * 12.6 — Investment Coach's deterministic core. Pure, LLM-free, and exhaustively
 * unit-tested: given a snapshot of a user's emergency-fund status, trailing savings
 * surplus, and allocation drift vs their target allocation (12.4), decide either
 * "fund the buffer first" or "contribute $X to <most-underweight asset class>".
 *
 * This module NEVER produces a sell/rebalance-by-selling recommendation and NEVER
 * invents its own timing logic (that's the user's existing DCA policy, 12.4) or its
 * own market-direction opinion (see investment-coach-narration.ts's timing-refusal
 * contract). It also never endorses a specific fund/ticker beyond what the caller
 * passes in as already-held or explicitly ticker-mapped by the user.
 *
 * IMPORTANT (see recommendation-evidence.ts): every input here MUST already be
 * sanitized of account numbers/lastFour before it reaches this module.
 */

export const CONTRIBUTION_PLANNER_CALCULATION_VERSION = 'contribution-planner-v1';

export interface AssetClassAllocation {
  assetClass: string;
  valueCents: number;
}

export interface TargetAllocationEntry {
  assetClass: string;
  targetPercent: number;
}

export interface ContributionPlannerContext {
  asOfDate: string;
  /** Trailing-3mo avg monthly expenses, in cents — same basis as the emergency-fund
   * target and the 12.5 Cash Manager buffer math (not reinvented here). */
  avgMonthlyExpenseCents: number;
  /** Sum of liquid (checking/savings) balances counted toward the emergency fund. */
  currentEmergencyFundCents: number;
  /** get_savings_rate's most recent month: incomeCents - expenseCents. May be negative. */
  trailingMonthlySurplusCents: number;
  /** Sum of any recurring goal contributions already committed out of the surplus.
   * Defaults to 0 — goals are not yet a shipped feature in this codebase. */
  monthlyGoalContributionCents?: number;
  totalPortfolioValueCents: number;
  currentAllocationByAssetClass: AssetClassAllocation[];
}

export type ContributionPlanResult =
  | {
      status: 'missing_setting';
      missing: SuitabilityField[];
      message: string;
    }
  | {
      status: 'fund_buffer_first';
      emergencyFundTargetCents: number;
      currentEmergencyFundCents: number;
      gapCents: number;
      evidence: EvidenceItem[];
      assumptions: string[];
      confidenceBand: ConfidenceBand;
      calculationVersion: string;
      policyVersion: number;
    }
  | {
      status: 'no_surplus';
      investableSurplusCents: number;
      evidence: EvidenceItem[];
      assumptions: string[];
      confidenceBand: ConfidenceBand;
      calculationVersion: string;
      policyVersion: number;
    }
  | {
      status: 'recommend';
      destinationAssetClass: string;
      contributionCents: number;
      driftPercentPoints: number;
      currentPercent: number;
      targetPercent: number;
      dcaDayOfMonth: number | null;
      dcaAmountCents: number | null;
      impact: ExpectedImpact;
      evidence: EvidenceItem[];
      assumptions: string[];
      confidenceBand: ConfidenceBand;
      calculationVersion: string;
      policyVersion: number;
    };

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** `SuitabilitySettingsLike` (12.4) doesn't carry `dcaAmountCents` since the gate
 * itself only checks *presence* of `dcaDayOfMonth`; this agent also needs the
 * scheduled DCA amount to compute investable surplus, so it extends the shape
 * locally rather than widening the shared gate's contract. */
export interface InvestmentCoachSettingsLike extends SuitabilitySettingsLike {
  dcaAmountCents?: number | null;
  /** {TICKER: assetClass, ...} — 12.4's ticker→asset-class mapping, needed here to
   * attribute held tickers' market value to a target-allocation asset class. */
  tickerAssetClassMap?: Record<string, string> | null;
}

const REQUIRED_FIELDS: SuitabilityField[] = [
  'emergency_fund_target_months',
  'risk_tolerance',
  'target_allocation',
  'dca_day_of_month',
];

/**
 * Single entry point: reuses 12.4's `requireSuitability` gate directly (never
 * reimplements it), then runs the deterministic contribution plan.
 */
export class ContributionPlanner {
  plan(settings: InvestmentCoachSettingsLike | null | undefined, context: ContributionPlannerContext): ContributionPlanResult {
    const gate = requireSuitability(settings, REQUIRED_FIELDS);
    if (!gate.ok) {
      return { status: 'missing_setting', missing: gate.missing, message: gate.message };
    }

    const emergencyFundTargetMonths = settings!.emergencyFundTargetMonths ?? 0;
    const emergencyFundTargetCents = Math.round(context.avgMonthlyExpenseCents * emergencyFundTargetMonths);
    const gapCents = Math.max(0, emergencyFundTargetCents - context.currentEmergencyFundCents);

    const baseEvidence: EvidenceItem[] = [
      {
        source: 'tool',
        ref: 'get_account_balances',
        value: dollars(context.currentEmergencyFundCents),
        unit: 'usd',
        observedAt: context.asOfDate,
      },
      {
        source: 'calculator',
        ref: 'emergency_fund_target',
        value: dollars(emergencyFundTargetCents),
        unit: 'usd',
        observedAt: context.asOfDate,
      },
    ];

    if (gapCents > 0) {
      return {
        status: 'fund_buffer_first',
        emergencyFundTargetCents,
        currentEmergencyFundCents: context.currentEmergencyFundCents,
        gapCents,
        evidence: baseEvidence,
        assumptions: [
          `Emergency-fund target = ${emergencyFundTargetMonths} month(s) of avg expenses (suitability policy v${gate.policyVersion}).`,
          'No investment recommendation is made until the emergency buffer is fully funded.',
        ],
        confidenceBand: 'high',
        calculationVersion: CONTRIBUTION_PLANNER_CALCULATION_VERSION,
        policyVersion: gate.policyVersion,
      };
    }

    const monthlyGoalContributionCents = context.monthlyGoalContributionCents ?? 0;
    const dcaAmountCents = settings!.dcaAmountCents ?? 0;
    const investableSurplusCents =
      context.trailingMonthlySurplusCents - monthlyGoalContributionCents - dcaAmountCents;

    const surplusEvidence: EvidenceItem[] = [
      ...baseEvidence,
      {
        source: 'tool',
        ref: 'get_savings_rate',
        value: dollars(context.trailingMonthlySurplusCents),
        unit: 'usd',
        observedAt: context.asOfDate,
      },
    ];

    if (investableSurplusCents <= 0) {
      return {
        status: 'no_surplus',
        investableSurplusCents,
        evidence: surplusEvidence,
        assumptions: [
          `Investable surplus = trailing monthly surplus (${dollars(context.trailingMonthlySurplusCents)}) - goal contributions (${dollars(monthlyGoalContributionCents)}) - scheduled DCA (${dollars(dcaAmountCents)}).`,
          'Nothing left over this month — no new-contribution recommendation.',
        ],
        confidenceBand: 'medium',
        calculationVersion: CONTRIBUTION_PLANNER_CALCULATION_VERSION,
        policyVersion: gate.policyVersion,
      };
    }

    const target = (settings!.targetAllocation ?? []) as TargetAllocationEntry[];
    const totalCents = context.totalPortfolioValueCents;
    const currentByClass = new Map(context.currentAllocationByAssetClass.map((a) => [a.assetClass, a.valueCents]));

    let best: { assetClass: string; drift: number; currentPercent: number; targetPercent: number } | null = null;
    for (const t of target) {
      const currentPercent = totalCents > 0 ? ((currentByClass.get(t.assetClass) ?? 0) / totalCents) * 100 : 0;
      const drift = t.targetPercent - currentPercent; // positive = underweight
      if (!best || drift > best.drift) {
        best = { assetClass: t.assetClass, drift, currentPercent, targetPercent: t.targetPercent };
      }
    }

    if (!best) {
      // No target allocation entries at all — shouldn't happen (gate requires
      // target_allocation to be non-empty), but fail closed rather than guess.
      return {
        status: 'no_surplus',
        investableSurplusCents,
        evidence: surplusEvidence,
        assumptions: ['No target allocation classes found — cannot pick a contribution destination.'],
        confidenceBand: 'low',
        calculationVersion: CONTRIBUTION_PLANNER_CALCULATION_VERSION,
        policyVersion: gate.policyVersion,
      };
    }

    const allocationEvidence: EvidenceItem[] = [
      ...surplusEvidence,
      {
        source: 'tool',
        ref: 'get_portfolio_value',
        value: dollars(totalCents),
        unit: 'usd',
        observedAt: context.asOfDate,
      },
      {
        source: 'tool',
        ref: 'get_allocation',
        value: best.currentPercent.toFixed(1),
        unit: 'percent',
        observedAt: context.asOfDate,
      },
    ];

    const impact: ExpectedImpact = {
      minCentsPerYear: investableSurplusCents * 12,
      maxCentsPerYear: investableSurplusCents * 12,
      basis:
        'Annualized at the current monthly contribution rate; not a return projection — no market performance is assumed.',
    };

    return {
      status: 'recommend',
      destinationAssetClass: best.assetClass,
      contributionCents: investableSurplusCents,
      driftPercentPoints: Math.round(best.drift * 10) / 10,
      currentPercent: Math.round(best.currentPercent * 10) / 10,
      targetPercent: best.targetPercent,
      dcaDayOfMonth: settings!.dcaDayOfMonth ?? null,
      dcaAmountCents: settings!.dcaAmountCents ?? null,
      impact,
      evidence: allocationEvidence,
      assumptions: [
        `Investable surplus = trailing monthly surplus (${dollars(context.trailingMonthlySurplusCents)}) - goal contributions (${dollars(monthlyGoalContributionCents)}) - scheduled DCA (${dollars(dcaAmountCents)}).`,
        `Destination = most-underweight asset class vs target allocation (suitability policy v${gate.policyVersion}) — directs NEW contributions only, never a sale of existing holdings.`,
        'Timing follows your existing DCA schedule; this agent does not predict market direction (see timing-refusal contract).',
        'No specific new fund/ticker is endorsed — only asset classes; use a fund you already hold or have mapped to this class.',
      ],
      confidenceBand: 'medium',
      calculationVersion: CONTRIBUTION_PLANNER_CALCULATION_VERSION,
      policyVersion: gate.policyVersion,
    };
  }
}
