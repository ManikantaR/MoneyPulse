import { describe, it, expect, vi } from 'vitest';
import { AdvisorReviewService, NOTHING_NOTEWORTHY } from '../advisor-review.service';
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

function build(opts: {
  resolved?: any;
  narration?: string;
  toolText?: string;
  findByMetadata?: boolean;
} = {}) {
  const resolved =
    'resolved' in opts
      ? opts.resolved
      : { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-test' };

  const settings = { resolve: vi.fn().mockResolvedValue(resolved) };

  const narration = opts.narration ?? '- Dining was $150.00 this week vs $80.00 last week.';
  let call = 0;
  const provider = {
    id: 'anthropic',
    streamTurn: vi.fn(() => {
      call += 1;
      if (call === 1 && opts.toolText !== undefined) {
        // First round: request a tool call so its result feeds the verifier.
        return turn('', {
          content: [{ type: 'tool_use', id: 't1', name: 'get_category_breakdown', input: {} }],
          toolCalls: [{ id: 't1', name: 'get_category_breakdown', input: {} }],
          stopReason: 'tool_use',
        });
      }
      return turn(narration);
    }),
    testConnection: vi.fn(),
  };
  const factory = { create: vi.fn().mockReturnValue(provider) };

  const mcp = {
    listAdvisorTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ text: opts.toolText ?? '' }),
  };

  const notifications = {
    findByMetadata: vi.fn().mockResolvedValue(opts.findByMetadata ?? false),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
  const aiLogs = { create: vi.fn().mockResolvedValue(undefined) };

  const rowsToReturn: any[] = [];
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rowsToReturn),
          }),
        }),
      }),
    }),
    _rows: rowsToReturn,
  };

  const service = new AdvisorReviewService(
    db as any,
    mcp as any,
    aiLogs as any,
    settings as any,
    factory as any,
    notifications as any,
  );

  return { service, db, notifications, aiLogs, provider, mcp, settings };
}

describe('AdvisorReviewService', () => {
  it('delivers a verified item that matches a tool figure', async () => {
    const { service, notifications } = build({
      narration: '- Dining was $150.00 this week vs $80.00 last week.',
      toolText: 'Dining: $150.00 (prior week $80.00)',
    });

    const delivered = await service.runReview('u1', 'weekly');

    expect(delivered).toBe(true);
    expect(notifications.createAndDispatch).toHaveBeenCalledTimes(1);
    const call = notifications.createAndDispatch.mock.calls[0][0];
    expect(call.source).toBe('advisor');
    expect(call.severity).toBe('insight');
    expect(call.message).toContain('$150.00');
  });

  it('delivers nothing on a quiet week (NOTHING_NOTEWORTHY)', async () => {
    const { service, notifications } = build({ narration: NOTHING_NOTEWORTHY });

    const delivered = await service.runReview('u1', 'weekly');

    expect(delivered).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });

  it('drops an item whose narrated figure is absent from tool output', async () => {
    const { service, notifications } = build({
      narration: '- Dining was $999.00 this week, way up.',
      toolText: 'Dining: $150.00 (prior week $80.00)',
    });
    const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    const delivered = await service.runReview('u1', 'weekly');

    expect(delivered).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not run when the advisor is not configured', async () => {
    const { service, notifications } = build({ resolved: null });

    const delivered = await service.runReview('u1', 'weekly');

    expect(delivered).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });

  it('does not re-deliver within the same period (dedupe)', async () => {
    const { service, notifications } = build({ findByMetadata: true });

    const delivered = await service.runReview('u1', 'weekly');

    expect(delivered).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });

  it('deliverAllEnabled skips the whole sweep when the advisor is not configured', async () => {
    const { service, db, settings } = build({ resolved: null });
    const runReviewSpy = vi.spyOn(service, 'runReview');

    await service.deliverAllEnabled('weekly');

    expect(settings.resolve).toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(runReviewSpy).not.toHaveBeenCalled();
  });
});
