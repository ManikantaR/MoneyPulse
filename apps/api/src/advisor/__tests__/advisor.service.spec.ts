import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvisorService } from '../advisor.service';
import type { LlmStreamChunk, LlmTurnResult } from '../llm/types';

// ── Fakes ──────────────────────────────────────────────────────────────────

/** A fake provider turn: streams text deltas, then a single `final` chunk. */
function makeTurn(deltas: string[], final: LlmTurnResult): AsyncIterable<LlmStreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of deltas) yield { type: 'text', text };
      yield { type: 'final', result: final };
    },
  };
}

const AGGREGATE_TOOLS = [
  { name: 'get_spending_summary', description: '', input_schema: { type: 'object' } },
  { name: 'get_account_balances', description: '', input_schema: { type: 'object' } },
];

function build(overrides: { resolved?: any } = {}) {
  const resolved =
    'resolved' in overrides
      ? overrides.resolved
      : { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-test', keySource: 'env' };

  const mcp = {
    listAdvisorTools: vi.fn().mockResolvedValue(AGGREGATE_TOOLS),
    callTool: vi.fn().mockResolvedValue('Dining: $420.00 (June)'),
  };
  const aiLogs = { create: vi.fn().mockResolvedValue(undefined) };
  const settings = {
    resolve: vi.fn().mockResolvedValue(resolved),
  };

  const turns: AsyncIterable<LlmStreamChunk>[] = [];
  const turnParams: any[] = [];
  const fakeProvider = {
    id: resolved?.provider ?? 'anthropic',
    streamTurn: vi.fn((p: any) => {
      turnParams.push(p);
      return turns.shift()!;
    }),
    testConnection: vi.fn(),
  };
  const factory = { create: vi.fn().mockReturnValue(fakeProvider) };

  const service = new AdvisorService(
    mcp as any,
    aiLogs as any,
    settings as any,
    factory as any,
  );
  return { service, mcp, aiLogs, settings, factory, fakeProvider, turns, turnParams };
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const d of gen) out += d;
  return out;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdvisorService', () => {
  it('throws when no provider/key is configured', async () => {
    const { service } = build({ resolved: null });
    expect(await service.isEnabled()).toBe(false);
    await expect(collect(service.streamChat('u1', 'hi'))).rejects.toThrow(/not configured/);
  });

  describe('tool-use loop', () => {
    let ctx: ReturnType<typeof build>;

    beforeEach(() => {
      ctx = build();
    });

    it('calls the aggregate tool, then streams the grounded answer', async () => {
      ctx.turns.push(
        // round 1: model asks for a tool
        makeTurn([], {
          text: '',
          content: [
            { type: 'tool_use', id: 't1', name: 'get_spending_summary', input: { from: '2026-06-01', to: '2026-06-30' } },
          ],
          toolCalls: [
            { id: 't1', name: 'get_spending_summary', input: { from: '2026-06-01', to: '2026-06-30' } },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 100, outputTokens: 20 },
        }),
        // round 2: model narrates the tool result
        makeTurn(['You spent ', '$420.00 on dining in June.'], {
          text: 'You spent $420.00 on dining in June.',
          content: [{ type: 'text', text: 'You spent $420.00 on dining in June.' }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 150, outputTokens: 30 },
        }),
      );

      const answer = await collect(ctx.service.streamChat('u1', 'How much on dining in June?'));

      expect(answer).toBe('You spent $420.00 on dining in June.');
      expect(ctx.mcp.callTool).toHaveBeenCalledWith('u1', 'get_spending_summary', {
        from: '2026-06-01',
        to: '2026-06-30',
      });
      expect(answer).toContain('$420.00');
      // logged as an advisor turn with summed token usage
      expect(ctx.aiLogs.create).toHaveBeenCalledTimes(1);
      const log = ctx.aiLogs.create.mock.calls[0][0];
      expect(log.promptType).toBe('advisor');
      expect(log.model).toBe('claude-opus-4-8');
      expect(log.tokenCountIn).toBe(250);
      expect(log.tokenCountOut).toBe(50);
    });

    it('only offers the aggregate tools to the model (row-level tools never sent)', async () => {
      ctx.turns.push(
        makeTurn(['ok'], {
          text: 'ok',
          content: [{ type: 'text', text: 'ok' }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      );
      await collect(ctx.service.streamChat('u1', 'hi'));

      const toolsSent = ctx.turnParams[0].tools.map((t: any) => t.name);
      expect(toolsSent).toEqual(['get_spending_summary', 'get_account_balances']);
      expect(toolsSent).not.toContain('get_transactions');
      expect(toolsSent).not.toContain('search_transactions');
      expect(ctx.turnParams[0].model).toBe('claude-opus-4-8');
      expect(ctx.factory.create).toHaveBeenCalledWith('anthropic', 'sk-test');
    });

    it('routes through whichever provider settings resolve to (OpenAI)', async () => {
      const c = build({
        resolved: { provider: 'openai', model: 'gpt-4o', apiKey: 'oa-key', keySource: 'db' },
      });
      c.turns.push(
        makeTurn(['hello'], {
          text: 'hello',
          content: [{ type: 'text', text: 'hello' }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 2, outputTokens: 2 },
        }),
      );
      const answer = await collect(c.service.streamChat('u1', 'hi'));
      expect(answer).toBe('hello');
      expect(c.factory.create).toHaveBeenCalledWith('openai', 'oa-key');
      expect(c.turnParams[0].model).toBe('gpt-4o');
    });

    it('redacts PII from the message before it reaches the cloud provider', async () => {
      ctx.turns.push(
        makeTurn(['ok'], {
          text: 'ok',
          content: [{ type: 'text', text: 'ok' }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      );
      const rawMessage = 'My SSN is 123-45-6789, email me at jane@example.com';
      await collect(ctx.service.streamChat('u1', rawMessage));

      // What the provider actually received must not contain the raw PII.
      const sentMessages = ctx.turnParams[0].messages;
      const sentUserContent = sentMessages[0].content;
      expect(sentUserContent).not.toContain('123-45-6789');
      expect(sentUserContent).not.toContain('jane@example.com');
      expect(sentUserContent).toContain('[SSN]');
      expect(sentUserContent).toContain('[EMAIL]');

      // The audit log still records what PII types were caught.
      const log = ctx.aiLogs.create.mock.calls[0][0];
      expect(log.piiDetected).toBe(true);
      expect(log.piiTypesFound).toEqual(expect.arrayContaining(['SSN', 'EMAIL']));
    });

    it('redacts PII from client-supplied conversation history, not just the new message', async () => {
      ctx.turns.push(
        makeTurn(['ok'], {
          text: 'ok',
          content: [{ type: 'text', text: 'ok' }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      );
      const priorTurn = { role: 'user' as const, content: 'Call me at 555-123-4567 please' };
      await collect(ctx.service.streamChat('u1', 'and one more thing', [priorTurn]));

      const sentMessages = ctx.turnParams[0].messages;
      // History entries precede the new user turn.
      expect(sentMessages[0].content).not.toContain('555-123-4567');
      expect(sentMessages[0].content).toContain('[PHONE]');
    });

    it('does not redact for a local (non-cloud) provider', async () => {
      const c = build({
        resolved: { provider: 'ollama', model: 'llama3.2', apiKey: '', keySource: 'env' },
      });
      c.turns.push(
        makeTurn(['ok'], {
          text: 'ok',
          content: [{ type: 'text', text: 'ok' }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      );
      const rawMessage = 'My SSN is 123-45-6789';
      const priorTurn = { role: 'user' as const, content: 'Call me at 555-123-4567 please' };
      await collect(c.service.streamChat('u1', rawMessage, [priorTurn]));

      const sentMessages = c.turnParams[0].messages;
      expect(sentMessages[0].content).toBe(priorTurn.content);
      expect(sentMessages[1].content).toBe(rawMessage);
    });

    it('refuses without a tool call when nothing fits', async () => {
      ctx.turns.push(
        makeTurn(["I don't have a way to answer that from your data."], {
          text: "I don't have a way to answer that from your data.",
          content: [{ type: 'text', text: "I don't have a way to answer that from your data." }],
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 12 },
        }),
      );
      const answer = await collect(ctx.service.streamChat('u1', "what's the weather?"));
      expect(answer).toMatch(/don't have a way/);
      expect(ctx.mcp.callTool).not.toHaveBeenCalled();
    });
  });
});
