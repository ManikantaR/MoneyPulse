import { EvidenceItem, ExpectedImpact, ConfidenceBand } from './recommendation-evidence';

/**
 * 12.5 — Cash Manager's deterministic core. Pure, LLM-free, and exhaustively
 * unit-tested: given a snapshot of a user's movable cash, their current earned APY,
 * and a set of parking-spot candidates (rate-watchlist HYSA/CD rows + Treasury bill
 * rows), rank the candidates by net annual benefit and decide whether the best one
 * clears the "worth bothering the user" bar.
 *
 * IMPORTANT (see recommendation-evidence.ts): every input here MUST already be
 * sanitized of account numbers/lastFour before it reaches this module. Nicknames,
 * institution names, dollar amounts, and account TYPES are fine — those are the
 * actual content of the recommendation.
 */

/** Recommend only when the best candidate beats current placement by at least this
 * much per year — a real gate, not a suggestion (Phase 12 §12.5). */
export const CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS = 10_000; // $100/yr

export const CASH_MANAGER_CALCULATION_VERSION = 'cash-manager-v1';

export type CashCandidateProductType = 'hysa' | 'cd' | 'mmf' | 'treasury';

export interface CashCandidate {
  /** Internal id (rate_watchlist row id, or a synthetic id for a Treasury tenor) —
   * never rendered to the user; nicknames/institution names are used for display. */
  id: string;
  institution: string;
  productType: CashCandidateProductType;
  apyBps: number;
  termMonths: number | null;
  /** Date the rate was observed/entered — cited in evidence. */
  asOfDate: string;
  /** Treasury interest is state-tax-exempt (12.3); other products are not. Framing only —
   * we never fabricate a marginal-tax-adjusted APY without the user's actual bracket. */
  stateTaxExempt: boolean;
}

export interface CashPlacementInput {
  /** Sum of liquid (checking/savings) balances across the user's accounts, in cents. */
  liquidBalanceCents: number;
  /** As-of date for the balance figure above. */
  balanceAsOfDate: string;
  /** Trailing-3-month average monthly expenses, in cents — basis for both buffers. */
  avgMonthlyExpenseCents: number;
  /** 12.4 suitability settings: emergency-fund target, in months of expenses. */
  emergencyFundTargetMonths: number;
  /** 11.7 idle-cash detector's own buffer, in months of expenses — reused, not reinvented. */
  idleCashBufferMonths: number;
  /** Current blended effective APY the user is earning on their liquid cash today
   * (from get_earned_apy), in basis points. */
  currentEarnedApyBps: number;
  currentEarnedApyAsOfDate: string;
  candidates: CashCandidate[];
  taxState?: string | null;
}

export interface RankedCashOption {
  candidateId: string;
  institution: string;
  productType: CashCandidateProductType;
  apyBps: number;
  termMonths: number | null;
  netAnnualBenefitCents: number;
  tradeoffs: string[];
}

export interface CashPlacementResult {
  /** liquidBalanceCents minus the applicable buffer; the amount actually eligible to move. */
  movableCashCents: number;
  bufferCents: number;
  bufferBasis: 'emergency_fund' | 'idle_cash';
  bufferMonths: number;
  /** True only when the top-ranked option clears CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS. */
  shouldRecommend: boolean;
  options: RankedCashOption[];
  impact: ExpectedImpact;
  evidence: EvidenceItem[];
  assumptions: string[];
  confidenceBand: ConfidenceBand;
  calculationVersion: string;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compute movable cash, rank candidates, and assemble the full evidence/assumptions
 * bundle. Never mutates inputs; safe to call repeatedly (e.g. once for a live run,
 * once again inside a test) with identical inputs producing identical output.
 */
export class CashPlacementCalculator {
  compute(input: CashPlacementInput): CashPlacementResult {
    const emergencyBufferCents = Math.round(
      input.avgMonthlyExpenseCents * input.emergencyFundTargetMonths,
    );
    const idleBufferCents = Math.round(
      input.avgMonthlyExpenseCents * input.idleCashBufferMonths,
    );
    const bufferCents = Math.max(emergencyBufferCents, idleBufferCents);
    const bufferBasis: 'emergency_fund' | 'idle_cash' =
      emergencyBufferCents >= idleBufferCents ? 'emergency_fund' : 'idle_cash';
    const bufferMonths =
      bufferBasis === 'emergency_fund' ? input.emergencyFundTargetMonths : input.idleCashBufferMonths;

    const movableCashCents = Math.max(0, input.liquidBalanceCents - bufferCents);

    const options: RankedCashOption[] = input.candidates
      .map((c) => {
        const spreadBps = c.apyBps - input.currentEarnedApyBps;
        const netAnnualBenefitCents = Math.round((movableCashCents * spreadBps) / 10_000);

        const tradeoffs: string[] = [];
        if (c.termMonths) {
          tradeoffs.push(`Locks funds for ${c.termMonths} month${c.termMonths === 1 ? '' : 's'} (term-locked).`);
        } else {
          tradeoffs.push('Fully liquid — no term lock.');
        }
        if (c.stateTaxExempt) {
          tradeoffs.push(
            `Interest is exempt from state income tax${input.taxState ? ` (${input.taxState})` : ''} — actual after-tax benefit may be higher than the figure above, which is pre-tax.`,
          );
        }

        return {
          candidateId: c.id,
          institution: c.institution,
          productType: c.productType,
          apyBps: c.apyBps,
          termMonths: c.termMonths,
          netAnnualBenefitCents,
          tradeoffs,
        };
      })
      .sort((a, b) => b.netAnnualBenefitCents - a.netAnnualBenefitCents);

    const best = options[0];
    const shouldRecommend =
      movableCashCents > 0 &&
      !!best &&
      best.netAnnualBenefitCents >= CASH_MANAGER_MIN_ANNUAL_BENEFIT_CENTS;

    const benefitValues = options.map((o) => o.netAnnualBenefitCents).filter((v) => v > 0);
    const impact: ExpectedImpact = {
      minCentsPerYear: benefitValues.length ? Math.min(...benefitValues) : 0,
      maxCentsPerYear: benefitValues.length ? Math.max(...benefitValues) : 0,
      basis:
        'Net annual benefit = movable cash x (candidate APY - current earned APY), pre-tax; ' +
        'does not assume any specific reinvestment or rate change over the term.',
    };

    const evidence: EvidenceItem[] = [
      {
        source: 'tool',
        ref: 'get_account_balances',
        value: dollars(input.liquidBalanceCents),
        unit: 'usd',
        observedAt: input.balanceAsOfDate,
      },
      {
        source: 'tool',
        ref: 'get_earned_apy',
        value: (input.currentEarnedApyBps / 100).toFixed(2),
        unit: 'percent',
        observedAt: input.currentEarnedApyAsOfDate,
      },
      {
        source: 'calculator',
        ref: 'buffer',
        value: dollars(bufferCents),
        unit: 'usd',
        observedAt: input.balanceAsOfDate,
      },
      ...input.candidates.map((c) => ({
        source: c.productType === 'treasury' ? 'treasury' : 'rate_watchlist',
        ref: `${c.institution}:${c.productType}`,
        value: (c.apyBps / 100).toFixed(2),
        unit: 'percent',
        observedAt: c.asOfDate,
      })),
    ];

    const assumptions: string[] = [
      `Buffer = ${bufferMonths} month(s) of avg expenses (${bufferBasis === 'emergency_fund' ? 'emergency-fund target' : 'idle-cash buffer'}), ${dollars(bufferCents)}, kept out of any placement recommendation.`,
      `Balances fresh as of ${input.balanceAsOfDate}; candidate rates as of the dates cited above and subject to change.`,
      'Figures are pre-tax unless noted; state-tax exemption (Treasury) is a framing note, not a numeric adjustment, since marginal tax rate is not modeled.',
    ];

    const confidenceBand: ConfidenceBand = movableCashCents > 0 && options.length > 0 ? 'medium' : 'low';

    return {
      movableCashCents,
      bufferCents,
      bufferBasis,
      bufferMonths,
      shouldRecommend,
      options,
      impact,
      evidence,
      assumptions,
      confidenceBand,
      calculationVersion: CASH_MANAGER_CALCULATION_VERSION,
    };
  }
}
