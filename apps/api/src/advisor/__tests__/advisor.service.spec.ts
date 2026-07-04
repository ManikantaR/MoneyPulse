import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvisorService } from '../advisor.service';

// ── Fakes ──────────────────────────────────────────────────────────────────

/** A fake Anthropic stream: async-iterable of events + finalMessage(). */
function makeStream(deltas: string[], finalMsg: any) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of deltas) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
      }
    },
    finalMessage: async () => finalMsg,
  };
}

const AGGREGATE_TOOLS = [
  { name: 'get_spending_summary', description: '', input_schema: { type: 'object' } },
  { name: 'get_account_balances', description: '', input_schema: { type: 'object' } },
];

function build(overrides: { key?: string | undefined } = {}) {
  const config = {
    get: (k: string) =>
      k === 'ANTHROPIC_API_KEY' ? ('key' in overrides ? overrides.key : 'sk-test') : undefined,
  };
  const mcp = {
    listAdvisorTools: vi.fn().mockResolvedValue(AGGREGATE_TOOLS),
    callTool: vi.fn().mockResolvedValue('Dining: $420.00 (June)'),
  };
  const aiLogs = { create: vi.fn().mockResolvedValue(undefined) };
  const service = new AdvisorService(config as any, mcp as any, aiLogs as any);
  const streamCalls: any[] = [];
  const fakeAnthropic = { messages: { stream: vi.fn((p: any) => { streamCalls.push(p); return fakeAnthropic.__next.shift(); }), }, __next: [] as any[] };
  // Only inject the fake when the service actually constructed a client (key present),
  // so the "disabled" case keeps its null client.
  if (service.enabled) (service as any).anthropic = fakeAnthropic;
  return { service, mcp, aiLogs, fakeAnthropic, streamCalls };
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const d of gen) out += d;
  return out;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdvisorService', () => {
  it('is disabled when ANTHROPIC_API_KEY is missing', async () => {
    const { service } = build({ key: undefined });
    expect(service.enabled).toBe(false);
    await expect(collect(service.streamChat('u1', 'hi'))).rejects.toThrow(/not configured/);
  });

  describe('tool-use loop', () => {
    let ctx: ReturnType<typeof build>;

    beforeEach(() => {
      ctx = build();
    });

    it('calls the aggregate tool, then streams the grounded answer', async () => {
      ctx.fakeAnthropic.__next = [
        // round 1: model asks for a tool
        makeStream([], {
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 't1', name: 'get_spending_summary', input: { from: '2026-06-01', to: '2026-06-30' } },
          ],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
        // round 2: model narrates the tool result
        makeStream(['You spent ', '$420.00 on dining in June.'], {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'You spent $420.00 on dining in June.' }],
          usage: { input_tokens: 150, output_tokens: 30 },
        }),
      ];

      const answer = await collect(ctx.service.streamChat('u1', 'How much on dining in June?'));

      expect(answer).toBe('You spent $420.00 on dining in June.');
      expect(ctx.mcp.callTool).toHaveBeenCalledWith('u1', 'get_spending_summary', {
        from: '2026-06-01',
        to: '2026-06-30',
      });
      // number narrated matches the tool's number
      expect(answer).toContain('$420.00');
      // logged as an advisor turn with token usage
      expect(ctx.aiLogs.create).toHaveBeenCalledTimes(1);
      const log = ctx.aiLogs.create.mock.calls[0][0];
      expect(log.promptType).toBe('advisor');
      expect(log.tokenCountIn).toBe(250);
      expect(log.tokenCountOut).toBe(50);
    });

    it('only offers the aggregate tools to Claude (row-level tools never sent)', async () => {
      ctx.fakeAnthropic.__next = [
        makeStream(['ok'], { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      ];
      await collect(ctx.service.streamChat('u1', 'hi'));

      const toolsSent = ctx.streamCalls[0].tools.map((t: any) => t.name);
      expect(toolsSent).toEqual(['get_spending_summary', 'get_account_balances']);
      expect(toolsSent).not.toContain('get_transactions');
      expect(toolsSent).not.toContain('search_transactions');
      expect(ctx.streamCalls[0].model).toBe('claude-opus-4-8');
    });

    it('refuses without a tool call when nothing fits', async () => {
      ctx.fakeAnthropic.__next = [
        makeStream(["I don't have a way to answer that from your data."], {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: "I don't have a way to answer that from your data." }],
          usage: { input_tokens: 10, output_tokens: 12 },
        }),
      ];
      const answer = await collect(ctx.service.streamChat('u1', "what's the weather?"));
      expect(answer).toMatch(/don't have a way/);
      expect(ctx.mcp.callTool).not.toHaveBeenCalled();
    });
  });
});
