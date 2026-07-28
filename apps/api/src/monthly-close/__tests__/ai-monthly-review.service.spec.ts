import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  AiMonthlyReviewService,
  findForbiddenViolations,
  parseBullets,
  isCaveatBullet,
  INCOMPLETE_CLOSE_CAVEAT_MARKER,
} from '../ai-monthly-review.service';
import type { LlmStreamChunk, LlmTurnResult } from '../../advisor/llm/types';

function turn(text: string): AsyncIterable<LlmStreamChunk> {
  const result: LlmTurnResult = {
    text,
    content: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 20, outputTokens: 10 },
  };
  return {
    async *[Symbol.asyncIterator]() {
      if (text) yield { type: 'text', text };
      yield { type: 'final', result };
    },
  };
}

const completeSnapshot = {
  id: 'snap-current',
  snapshotMonth: '2026-06-01',
  status: 'confirmed',
  notes: null,
  takeHomeIncomeCents: 500000,
  expenseCents: 300000,
  cashSavingsCents: 100000,
  investmentContributionCents: 50000,
  debtPrincipalPaidCents: 20000,
  netWorthCents: 10000000,
  savingsRateBps: 2000,
  expenseRatioBps: 6000,
  debtPaydownRateBps: 400,
  targetStatus: { emergencyFund: 'on_track' },
  freshness: { isComplete: true, missingManualAssets: [], staleAccounts: [], unverifiedLoans: [] },
};

const incompleteSnapshot = {
  ...completeSnapshot,
  freshness: {
    isComplete: false,
    missingManualAssets: ['Home'],
    staleAccounts: [],
    unverifiedLoans: [],
  },
};

function build(opts: { narration: string; snapshot?: any; resolved?: any }) {
  const snapshot = opts.snapshot ?? completeSnapshot;
  const monthlyCloseService: any = {
    findOne: vi.fn().mockResolvedValue(snapshot),
    findAll: vi.fn().mockResolvedValue([snapshot]),
    saveAiReview: vi.fn().mockResolvedValue(undefined),
  };
  const resolved =
    'resolved' in opts ? opts.resolved : { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-test' };
  const settings: any = { resolve: vi.fn().mockResolvedValue(resolved) };
  const provider = { id: 'anthropic', streamTurn: vi.fn(() => turn(opts.narration)), testConnection: vi.fn() };
  const factory: any = { create: vi.fn().mockReturnValue(provider) };
  const aiLogs: any = { create: vi.fn().mockResolvedValue(undefined) };

  const service = new AiMonthlyReviewService(monthlyCloseService, settings, factory, aiLogs);
  return { service, monthlyCloseService, settings, factory, provider };
}

describe('AiMonthlyReviewService', () => {
  it('returns 3-5 bullets from aggregate inputs when the close is complete', async () => {
    const narration = [
      '- Expenses were $3,000.00 against income of $5,000.00, in line with prior months.',
      '- Net worth grew to $100,000.00 with $200.00 of debt principal paid down.',
      '- With your emergency fund on track, direct the next dollar toward extra debt paydown.',
    ].join('\n');
    const { service, monthlyCloseService } = build({ narration });

    const result = await service.review('user-1', '2026-06');

    expect(result.bullets.length).toBeGreaterThanOrEqual(3);
    expect(result.bullets.length).toBeLessThanOrEqual(5);
    expect(result.isIncomplete).toBe(false);
    expect(monthlyCloseService.saveAiReview).toHaveBeenCalledWith('user-1', '2026-06', expect.any(String));
  });

  it('refuses to deliver an uncaveated summary when the close is incomplete', async () => {
    // Model ignores the incompleteness instruction and returns a "clean" summary.
    const narration = [
      '- Expenses were $3,000.00 against income of $5,000.00.',
      '- Net worth grew to $100,000.00.',
      '- Direct the next dollar toward extra debt paydown.',
    ].join('\n');
    const { service } = build({ narration, snapshot: incompleteSnapshot });

    const result = await service.review('user-1', '2026-06');

    expect(result.isIncomplete).toBe(true);
    expect(result.bullets[0]).toContain(INCOMPLETE_CLOSE_CAVEAT_MARKER);
    expect(isCaveatBullet(result.bullets[0])).toBe(true);
  });

  it('keeps the model-provided caveat when it already leads with one', async () => {
    const narration = [
      '- This close is incomplete: missing manual asset values (Home) — figures below are provisional.',
      '- Expenses were $3,000.00 against income of $5,000.00.',
      '- Direct the next dollar toward extra debt paydown.',
    ].join('\n');
    const { service } = build({ narration, snapshot: incompleteSnapshot });

    const result = await service.review('user-1', '2026-06');
    expect(isCaveatBullet(result.bullets[0])).toBe(true);
    // Should not have double-prepended a second caveat bullet.
    expect(result.bullets.filter((b) => isCaveatBullet(b)).length).toBe(1);
  });

  it('drops a bullet that narrates home-value appreciation as savings', async () => {
    const narration = [
      '- Your home value jumped this month, which saved you a lot on net worth.',
      '- Expenses were $3,000.00 against income of $5,000.00.',
      '- Net worth grew to $100,000.00.',
      '- Direct the next dollar toward extra debt paydown.',
    ].join('\n');
    const { service } = build({ narration });

    const result = await service.review('user-1', '2026-06');
    expect(result.bullets.some((b) => /saved/i.test(b) && /home value/i.test(b))).toBe(false);
  });

  it('drops a bullet that recommends trading a specific security', async () => {
    const narration = [
      '- You should buy more shares of that stock next month.',
      '- Expenses were $3,000.00 against income of $5,000.00.',
      '- Net worth grew to $100,000.00.',
      '- Direct the next dollar toward extra debt paydown.',
    ].join('\n');
    const { service } = build({ narration });

    const result = await service.review('user-1', '2026-06');
    expect(result.bullets.some((b) => /buy more shares/i.test(b))).toBe(false);
  });

  it('drops a bullet that double-counts a credit-card payment as an expense', async () => {
    const narration = [
      '- Your credit card payment of $500 was a big expense this month.',
      '- Expenses were $3,000.00 against income of $5,000.00.',
      '- Net worth grew to $100,000.00.',
      '- Direct the next dollar toward extra debt paydown.',
    ].join('\n');
    const { service } = build({ narration });

    const result = await service.review('user-1', '2026-06');
    expect(result.bullets.some((b) => /credit card payment/i.test(b) && /expense/i.test(b))).toBe(false);
  });

  it('falls back to a deterministic minimal review when the model output is unusable', async () => {
    const { service } = build({ narration: 'not a bullet list at all' });
    const result = await service.review('user-1', '2026-06');
    expect(result.bullets.length).toBeGreaterThanOrEqual(3);
  });

  it('throws when the advisor is not configured', async () => {
    const { service } = build({ narration: '- anything', resolved: null });
    await expect(service.review('user-1', '2026-06')).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('findForbiddenViolations', () => {
  it('flags trade recommendations', () => {
    expect(findForbiddenViolations('You should buy that stock now')).toContain('trade-recommendation');
  });
  it('flags market predictions', () => {
    expect(findForbiddenViolations('The market will rally next quarter')).toContain('market-prediction');
  });
  it('flags home-value-as-savings narration in either order', () => {
    expect(findForbiddenViolations('Your home value appreciation saved you money')).toContain(
      'revaluation-as-savings',
    );
    expect(findForbiddenViolations('You saved money thanks to your home value appreciation')).toContain(
      'revaluation-as-savings-reverse',
    );
  });
  it('flags credit-card payments narrated as expenses', () => {
    expect(findForbiddenViolations('Your credit card payment was an expense')).toContain(
      'credit-card-payment-as-expense',
    );
  });
  it('does not flag a clean bullet', () => {
    expect(findForbiddenViolations('Expenses were $3,000.00 against income of $5,000.00.')).toEqual([]);
  });
});

describe('parseBullets', () => {
  it('extracts only lines starting with "- "', () => {
    expect(parseBullets('preamble\n- one\n- two\ntrailing')).toEqual(['one', 'two']);
  });
  it('returns empty for unparsable text', () => {
    expect(parseBullets('just a sentence')).toEqual([]);
  });
});
