/**
 * 12.1 — the recommendation evidence contract.
 *
 * A `recommendation`-kind notification row is only allowed to render in the feed or
 * be dispatched through a delivery channel when it carries complete evidence: at
 * least one evidence row, at least one stated assumption, and a confidence band.
 * `insight`-kind rows (observations, not actions) are unaffected — this contract is
 * scoped to `kind === 'recommendation'` per the Phase 12 spec (fail-closed render).
 */

export interface EvidenceItem {
  source: string;
  ref: string;
  value: number | string;
  unit?: string;
  observedAt: string;
}

export interface ExpectedImpact {
  minCentsPerYear: number;
  maxCentsPerYear: number;
  basis: string;
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** Minimal shape this module needs from a notification row — deliberately loose so
 * it works against both the Drizzle row shape and plain test fixtures. */
export interface RecommendationEvidenceFields {
  kind?: string | null;
  evidence?: unknown;
  assumptions?: unknown;
  confidenceBand?: string | null;
}

/**
 * True when `row` is NOT a recommendation (no contract applies) or IS a recommendation
 * with complete evidence. False means the row must be neither rendered nor delivered.
 */
export function hasCompleteEvidence(row: RecommendationEvidenceFields): boolean {
  if (row.kind !== 'recommendation') return true;

  const evidence = row.evidence;
  const assumptions = row.assumptions;

  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  if (!Array.isArray(assumptions) || assumptions.length === 0) return false;
  if (!row.confidenceBand) return false;

  return evidence.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.source === 'string' &&
      item.source.length > 0 &&
      typeof item.ref === 'string' &&
      item.ref.length > 0 &&
      item.value !== undefined &&
      item.value !== null &&
      typeof item.observedAt === 'string' &&
      item.observedAt.length > 0,
  );
}

/** Human-readable reason a recommendation failed the evidence contract (for logging). */
export function describeMissingEvidence(row: RecommendationEvidenceFields): string {
  if (row.kind !== 'recommendation') return '';
  const reasons: string[] = [];
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
    reasons.push('missing evidence');
  }
  if (!Array.isArray(row.assumptions) || row.assumptions.length === 0) {
    reasons.push('missing assumptions');
  }
  if (!row.confidenceBand) reasons.push('missing confidence_band');
  return reasons.join(', ') || 'malformed evidence item';
}
