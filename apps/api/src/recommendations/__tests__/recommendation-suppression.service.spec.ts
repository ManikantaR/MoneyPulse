import { describe, it, expect, vi } from 'vitest';
import { evaluateSuppression, RecommendationSuppressionService } from '../recommendation-suppression.service';

describe('evaluateSuppression (12.1 decision-aware suppression, pure logic)', () => {
  it('does not suppress when there is no prior decision', () => {
    const result = evaluateSuppression({
      priorDecision: null,
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 25 },
    });
    expect(result.suppressed).toBe(false);
  });

  it('suppresses a rejected decision with unchanged inputs and same calculation_version', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'rejected',
        decisionReason: 'not worth the hassle',
        calculationVersion: '1',
        decidedAt: '2026-07-01T00:00:00Z',
        inputsFingerprint: { spreadBps: 25 },
      },
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 25 },
    });
    expect(result.suppressed).toBe(true);
    expect(result.reason).toMatch(/rejected/);
    expect(result.reason).toContain('not worth the hassle');
  });

  it('suppresses a not_applicable decision the same way', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'not_applicable',
        calculationVersion: '1',
        inputsFingerprint: { spreadBps: 25 },
      },
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 25 },
    });
    expect(result.suppressed).toBe(true);
  });

  it('does not suppress (re-raises) when calculation_version changed', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'rejected',
        calculationVersion: '1',
        inputsFingerprint: { spreadBps: 25 },
      },
      currentCalculationVersion: '2',
      currentInputs: { spreadBps: 25 },
    });
    expect(result.suppressed).toBe(false);
  });

  it('does not suppress (re-raises) when an input changes materially beyond tolerance', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'rejected',
        calculationVersion: '1',
        inputsFingerprint: { spreadBps: 25 },
      },
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 80 }, // spread widened well beyond tolerance
      toleranceByKey: { spreadBps: 50 },
    });
    expect(result.suppressed).toBe(false);
  });

  it('stays suppressed when the input change is within tolerance', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'rejected',
        calculationVersion: '1',
        inputsFingerprint: { spreadBps: 25 },
      },
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 30 },
      toleranceByKey: { spreadBps: 50 },
    });
    expect(result.suppressed).toBe(true);
  });

  it('suppresses while snoozed_until is in the future, regardless of inputs', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'snoozed',
        snoozedUntil: '2099-01-01T00:00:00Z',
      },
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 999 },
      now: new Date('2026-07-21T00:00:00Z'),
    });
    expect(result.suppressed).toBe(true);
  });

  it('does not suppress once snoozed_until has passed', () => {
    const result = evaluateSuppression({
      priorDecision: {
        decision: 'snoozed',
        snoozedUntil: '2020-01-01T00:00:00Z',
      },
      currentCalculationVersion: '1',
      currentInputs: { spreadBps: 25 },
      now: new Date('2026-07-21T00:00:00Z'),
    });
    expect(result.suppressed).toBe(false);
  });

  it('does not suppress an accepted decision', () => {
    const result = evaluateSuppression({
      priorDecision: { decision: 'accepted', calculationVersion: '1', inputsFingerprint: {} },
      currentCalculationVersion: '1',
      currentInputs: {},
    });
    expect(result.suppressed).toBe(false);
  });
});

describe('RecommendationSuppressionService.checkAndSuppress', () => {
  it('persists the suppression reason on the prior row when suppressing', async () => {
    const priorRow = {
      id: 'notif-1',
      decision: 'rejected',
      decisionReason: 'declined',
      calculationVersion: '1',
      decidedAt: '2026-07-01T00:00:00Z',
      snoozedUntil: null,
      data: { inputsFingerprint: { spreadBps: 25 } },
    };

    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const updateMock = vi.fn().mockReturnValue({ set: setMock });

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([priorRow]),
    };
    const db = {
      select: vi.fn().mockReturnValue(selectChain),
      update: updateMock,
    };

    const service = new RecommendationSuppressionService(db);
    const result = await service.checkAndSuppress('user-1', 'cash_placement', '1', {
      spreadBps: 25,
    });

    expect(result.suppressed).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ suppressedReason: expect.stringContaining('rejected') }),
    );
  });

  it('does not touch the DB update when not suppressed', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const updateMock = vi.fn();
    const db = { select: vi.fn().mockReturnValue(selectChain), update: updateMock };

    const service = new RecommendationSuppressionService(db);
    const result = await service.checkAndSuppress('user-1', 'cash_placement', '1', {
      spreadBps: 25,
    });

    expect(result.suppressed).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
