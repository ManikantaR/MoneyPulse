import { describe, it, expect } from 'vitest';
import { hasCompleteEvidence, describeMissingEvidence } from '../recommendation-evidence';

describe('hasCompleteEvidence (12.1 fail-closed render contract)', () => {
  it('is always true for insight-kind rows regardless of evidence', () => {
    expect(hasCompleteEvidence({ kind: 'insight' })).toBe(true);
    expect(
      hasCompleteEvidence({ kind: 'insight', evidence: null, assumptions: null, confidenceBand: null }),
    ).toBe(true);
  });

  it('is false for a recommendation with no evidence at all', () => {
    expect(
      hasCompleteEvidence({
        kind: 'recommendation',
        evidence: null,
        assumptions: ['some assumption'],
        confidenceBand: 'high',
      }),
    ).toBe(false);
  });

  it('is false for a recommendation with an empty evidence array', () => {
    expect(
      hasCompleteEvidence({
        kind: 'recommendation',
        evidence: [],
        assumptions: ['some assumption'],
        confidenceBand: 'high',
      }),
    ).toBe(false);
  });

  it('is false for a recommendation missing assumptions', () => {
    expect(
      hasCompleteEvidence({
        kind: 'recommendation',
        evidence: [{ source: 'FRED', ref: 'MORTGAGE30US', value: 5.9, observedAt: '2026-07-10' }],
        assumptions: [],
        confidenceBand: 'high',
      }),
    ).toBe(false);
  });

  it('is false for a recommendation missing confidence_band', () => {
    expect(
      hasCompleteEvidence({
        kind: 'recommendation',
        evidence: [{ source: 'FRED', ref: 'MORTGAGE30US', value: 5.9, observedAt: '2026-07-10' }],
        assumptions: ['some assumption'],
        confidenceBand: null,
      }),
    ).toBe(false);
  });

  it('is false when an evidence item is malformed (missing source/ref/observedAt)', () => {
    expect(
      hasCompleteEvidence({
        kind: 'recommendation',
        evidence: [{ source: 'FRED', value: 5.9 }],
        assumptions: ['some assumption'],
        confidenceBand: 'high',
      }),
    ).toBe(false);
  });

  it('is true for a fully-evidenced recommendation', () => {
    expect(
      hasCompleteEvidence({
        kind: 'recommendation',
        evidence: [{ source: 'FRED', ref: 'MORTGAGE30US', value: 5.9, observedAt: '2026-07-10' }],
        assumptions: ['Balances fresh as of last sync.'],
        confidenceBand: 'medium',
      }),
    ).toBe(true);
  });

  it('describeMissingEvidence names every missing piece', () => {
    const reason = describeMissingEvidence({
      kind: 'recommendation',
      evidence: null,
      assumptions: null,
      confidenceBand: null,
    });
    expect(reason).toContain('missing evidence');
    expect(reason).toContain('missing assumptions');
    expect(reason).toContain('missing confidence_band');
  });

  it('describeMissingEvidence is empty for non-recommendation rows', () => {
    expect(describeMissingEvidence({ kind: 'insight' })).toBe('');
  });
});
