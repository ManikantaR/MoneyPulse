import { describe, it, expect, vi } from 'vitest';
import { AdvisorDigestService } from '../advisor-digest.service';
import type { DigestSignal } from '../types';
import type { LlmStreamChunk, LlmTurnResult } from '../../llm/types';

function turn(text: string, final?: Partial<LlmTurnResult>): AsyncIterable<LlmStreamChunk> {
  const result: LlmTurnResult = {
    text,
    content: [{ type: 'text', text }],
    toolCalls: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 30, outputTokens: 10 },
    ...final,
  };
  return {
    async *[Symbol.asyncIterator]() {
      if (text) yield { type: 'text', text };
      yield { type: 'final', result };
    },
  };
}

const SIGNALS: DigestSignal[] = [
  {
    kind: 'top_driver',
    label: 'Top spend: Rent',
    amountCents: 50000,
    detail: 'Rent was your biggest category last week at $500.00.',
    provenance: 'category spending totals for last week',
  },
  {
    kind: 'category_delta',
    label: 'Dining up week-over-week',
    amountCents: 15000,
    detail: 'Dining spending was $400.00 last week vs $250.00 the week before — up $150.00.',
    provenance: 'category spending, last week vs the week before',
  },
];

function build(opts: { signals?: DigestSignal[]; resolved?: any; narration?: string } = {}) {
  const resolved =
    'resolved' in opts
      ? opts.resolved
      : { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-test' };

  const signals = { gather: vi.fn().mockResolvedValue(opts.signals ?? SIGNALS) };
  const settings = { resolve: vi.fn().mockResolvedValue(resolved) };

  const turnParams: any[] = [];
  const provider = {
    id: 'anthropic',
    streamTurn: vi.fn((p: any) => {
      turnParams.push(p);
      return turn(opts.narration ?? '- Rent was your biggest category last week at $500.00.');
    }),
    testConnection: vi.fn(),
  };
  const factory = { create: vi.fn().mockReturnValue(provider) };

  const notifications = {
    findByMetadata: vi.fn().mockResolvedValue(false),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
  const aiLogs = { create: vi.fn().mockResolvedValue(undefined) };

  // db is only used by deliverAllEnabled's select chain
  const rowsToReturn: any[] = [];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rowsToReturn),
        }),
      }),
    }),
    _rows: rowsToReturn,
  };

  const service = new AdvisorDigestService(
    db as any,
    signals as any,
    settings as any,
    factory as any,
    notifications as any,
    aiLogs as any,
  );
  return { service, signals, settings, provider, factory, notifications, aiLogs, db, turnParams };
}

describe('AdvisorDigestService.buildDigest', () => {
  it('returns null when there are no signals (no LLM call)', async () => {
    const c = build({ signals: [] });
    const digest = await c.service.buildDigest('u1');
    expect(digest).toBeNull();
    expect(c.provider.streamTurn).not.toHaveBeenCalled();
  });

  it('narrates with no tools and grounds the voice summary in the top signal', async () => {
    const c = build();
    const digest = await c.service.buildDigest('u1', 'America/New_York');

    expect(digest).not.toBeNull();
    expect(digest!.title).toBe('Weekly Money Recap');
    expect(digest!.message).toContain('$500.00');
    // Voice summary is deterministic from the highest-dollar signal
    expect(digest!.voiceSummary).toContain('Rent was your biggest category');

    // Batch narration must send NO tools (aggregates-only, single turn)
    expect(c.turnParams[0].tools).toEqual([]);
    // Only pre-computed detail/provenance reach the model — no raw fields
    const userMsg = c.turnParams[0].messages[0].content as string;
    expect(userMsg).toContain('Rent was your biggest category last week at $500.00.');
    expect(userMsg).not.toContain('amountCents');

    // Logged as an advisor turn
    expect(c.aiLogs.create).toHaveBeenCalledTimes(1);
    expect(c.aiLogs.create.mock.calls[0][0].promptType).toBe('advisor');
  });

  it('falls back to a deterministic bullet list if the model returns no text', async () => {
    const c = build({ narration: '' });
    const digest = await c.service.buildDigest('u1');
    expect(digest!.message).toBe(
      '- Rent was your biggest category last week at $500.00.\n' +
        '- Dining spending was $400.00 last week vs $250.00 the week before — up $150.00.',
    );
  });

  it('throws if signals exist but the advisor is unconfigured', async () => {
    const c = build({ resolved: null });
    await expect(c.service.buildDigest('u1')).rejects.toThrow(/not configured/);
  });
});

describe('AdvisorDigestService.deliver', () => {
  it('dispatches an advisor_digest notification with a weekly dedupe key', async () => {
    const c = build();
    const sent = await c.service.deliver('u1', 'America/New_York');

    expect(sent).toBe(true);
    expect(c.notifications.createAndDispatch).toHaveBeenCalledTimes(1);
    const arg = c.notifications.createAndDispatch.mock.calls[0][0];
    expect(arg.type).toBe('advisor_digest');
    expect(arg.dedupeKey).toMatch(/^advisor_digest_weekly_u1_\d{4}-W\d{2}$/);
    expect(arg.voiceSummary).toContain('weekly money recap');
    expect(arg.metadata.signals).toHaveLength(2);
  });

  it('is idempotent — skips when this week already went out', async () => {
    const c = build();
    c.notifications.findByMetadata.mockResolvedValue(true);
    const sent = await c.service.deliver('u1', 'America/New_York');
    expect(sent).toBe(false);
    expect(c.notifications.createAndDispatch).not.toHaveBeenCalled();
  });
});

describe('AdvisorDigestService.deliverAllEnabled', () => {
  it('skips the whole sweep when the advisor is not configured', async () => {
    const c = build({ resolved: null });
    await c.service.deliverAllEnabled();
    expect(c.db.select).not.toHaveBeenCalled();
  });

  it('delivers to each opted-in user', async () => {
    const c = build();
    c.db._rows.push(
      { userId: 'u1', timezone: 'America/New_York' },
      { userId: 'u2', timezone: 'Europe/London' },
    );
    const spy = vi.spyOn(c.service, 'deliver').mockResolvedValue(true);
    await c.service.deliverAllEnabled();
    expect(spy).toHaveBeenCalledWith('u1', 'America/New_York');
    expect(spy).toHaveBeenCalledWith('u2', 'Europe/London');
  });
});
