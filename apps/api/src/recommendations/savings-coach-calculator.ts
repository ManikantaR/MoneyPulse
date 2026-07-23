import { EvidenceItem, ExpectedImpact, ConfidenceBand } from './recommendation-evidence';

/**
 * 12.7 — Savings Coach's deterministic core. Pure, LLM-free, exhaustively unit-tested:
 * takes already-detected candidates from the 11.5 watchdog detectors (price-creep,
 * fee, over-pace budget — this module NEVER re-derives detection logic, only
 * aggregates and dollar-izes it) and produces zero or one aggregated recommendation.
 *
 * IMPORTANT (see recommendation-evidence.ts): every input here MUST already be
 * sanitized of account numbers/lastFour before it reaches this module. Merchant
 * names, category names, and dollar amounts are fine.
 */

export const SAVINGS_COACH_CALCULATION_VERSION = 'savings-coach-v1';

/** Recommend only when the aggregate best-case annual savings clears this bar — a
 * real gate, not a suggestion, mirroring 12.5's $100/yr threshold. */
export const SAVINGS_COACH_MIN_ANNUAL_IMPACT_CENTS = 6_000; // $60/yr

/** A price-creep candidate re-raises once its delta moves beyond this tolerance
 * relative to the last-rejected delta (used as the suppression tolerance). */
export const PRICE_CREEP_MATERIAL_CHANGE_CENTS = 200; // $2/mo

export type SavingsCandidateKind = 'subscription_price_creep' | 'fee_elimination' | 'budget_pace_trim';

export interface SubscriptionPriceCreepCandidate {
  kind: 'subscription_price_creep';
  /** Stable id used for suppression keying — never a raw account/transaction id
   * beyond what's already public via the merchant name. */
  id: string;
  merchant: string;
  previousAmountCents: number;
  newAmountCents: number;
  observedAt: string;
}

export interface FeeEliminationCandidate {
  kind: 'fee_elimination';
  id: string;
  /** Category or pattern label, e.g. "overdraft/maintenance fees" — never a raw description. */
  label: string;
  occurrences: number;
  totalCentsTrailingWindow: number;
  windowMonths: number;
  observedAt: string;
}

export interface BudgetPaceTrimCandidate {
  kind: 'budget_pace_trim';
  id: string;
  categoryLabel: string;
  budgetCents: number;
  projectedCents: number;
  periodKey: string;
  observedAt: string;
}

export type SavingsCandidate =
  | SubscriptionPriceCreepCandidate
  | FeeEliminationCandidate
  | BudgetPaceTrimCandidate;

export interface SavingsCoachInput {
  candidates: SavingsCandidate[];
}

export interface RankedSavingsItem {
  id: string;
  kind: SavingsCandidateKind;
  label: string;
  minCentsPerMonth: number;
  maxCentsPerMonth: number;
  evidence: EvidenceItem[];
  /** Numeric fingerprint used by the suppression tolerance check for THIS item. */
  inputsFingerprint: Record<string, number>;
}

export interface SavingsCoachResult {
  shouldRecommend: boolean;
  items: RankedSavingsItem[];
  impact: ExpectedImpact;
  evidence: EvidenceItem[];
  assumptions: string[];
  confidenceBand: ConfidenceBand;
  calculationVersion: string;
}

function centsToStr(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Per-candidate savings range, evidence rows, and a stable suppression fingerprint.
 * Exported so the service can compute the same fingerprint for suppression lookups
 * without duplicating this math. */
export function rankCandidate(candidate: SavingsCandidate): RankedSavingsItem {
  if (candidate.kind === 'subscription_price_creep') {
    const deltaCents = Math.max(0, candidate.newAmountCents - candidate.previousAmountCents);
    return {
      id: candidate.id,
      kind: candidate.kind,
      label: `${candidate.merchant} price increase`,
      // Downgrading/cancelling recovers at least the creep delta; at most the full
      // new charge (if cancelled outright) — stated as a range, never false precision.
      minCentsPerMonth: deltaCents,
      maxCentsPerMonth: candidate.newAmountCents,
      evidence: [
        {
          source: 'watchdog',
          ref: 'price_creep',
          value: `${centsToStr(candidate.previousAmountCents)} -> ${centsToStr(candidate.newAmountCents)}`,
          unit: 'usd',
          observedAt: candidate.observedAt,
        },
      ],
      inputsFingerprint: { deltaCents, newAmountCents: candidate.newAmountCents },
    };
  }

  if (candidate.kind === 'fee_elimination') {
    const avgMonthlyCents = Math.round(candidate.totalCentsTrailingWindow / candidate.windowMonths);
    return {
      id: candidate.id,
      kind: candidate.kind,
      label: `${candidate.label} fees`,
      minCentsPerMonth: Math.round(avgMonthlyCents * 0.5),
      maxCentsPerMonth: avgMonthlyCents,
      evidence: [
        {
          source: 'watchdog',
          ref: 'fee_detected',
          value: candidate.totalCentsTrailingWindow,
          unit: 'usd_cents',
          observedAt: candidate.observedAt,
        },
        {
          source: 'watchdog',
          ref: 'fee_detected_occurrences',
          value: candidate.occurrences,
          unit: 'count',
          observedAt: candidate.observedAt,
        },
      ],
      inputsFingerprint: { avgMonthlyCents },
    };
  }

  // budget_pace_trim
  const overageCents = Math.max(0, candidate.projectedCents - candidate.budgetCents);
  return {
    id: candidate.id,
    kind: candidate.kind,
    label: `${candidate.categoryLabel} over pace`,
    minCentsPerMonth: Math.round(overageCents * 0.5),
    maxCentsPerMonth: overageCents,
    evidence: [
      {
        source: 'watchdog',
        ref: 'budget_pace',
        value: `projected ${centsToStr(candidate.projectedCents)} vs budget ${centsToStr(candidate.budgetCents)}`,
        unit: 'usd',
        observedAt: candidate.observedAt,
      },
    ],
    inputsFingerprint: { overageCents },
  };
}

/**
 * Aggregate already-ranked, already-suppression-filtered items into one
 * recommendation result. Callers (the service) are responsible for running each
 * candidate through 12.1's suppression check BEFORE calling this — this function
 * only decides whether the surviving set clears the "worth notifying" bar.
 */
export function aggregateSavingsCoach(survivingItems: RankedSavingsItem[]): SavingsCoachResult {
  if (survivingItems.length === 0) {
    return {
      shouldRecommend: false,
      items: [],
      impact: { minCentsPerYear: 0, maxCentsPerYear: 0, basis: 'no material savings candidates this period' },
      evidence: [],
      assumptions: [],
      confidenceBand: 'low',
      calculationVersion: SAVINGS_COACH_CALCULATION_VERSION,
    };
  }

  const minCentsPerYear = survivingItems.reduce((sum, i) => sum + i.minCentsPerMonth * 12, 0);
  const maxCentsPerYear = survivingItems.reduce((sum, i) => sum + i.maxCentsPerMonth * 12, 0);
  const evidence = survivingItems.flatMap((i) => i.evidence);
  const assumptions = [
    'Ranges assume full cancellation/trim at the high end and a partial trim at the low end.',
    'Figures are computed from your own transaction and budget history, not third-party estimates.',
  ];

  const shouldRecommend = maxCentsPerYear >= SAVINGS_COACH_MIN_ANNUAL_IMPACT_CENTS;

  return {
    shouldRecommend,
    items: survivingItems,
    impact: {
      minCentsPerYear,
      maxCentsPerYear,
      basis: `${survivingItems.length} savings action${survivingItems.length === 1 ? '' : 's'} across subscriptions, fees, and budget pacing`,
    },
    evidence,
    assumptions,
    confidenceBand: 'medium',
    calculationVersion: SAVINGS_COACH_CALCULATION_VERSION,
  };
}
