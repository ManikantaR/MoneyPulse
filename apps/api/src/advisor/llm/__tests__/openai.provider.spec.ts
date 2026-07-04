import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../openai.provider';
import type { LlmStreamChunk, LlmTurnParams } from '../types';

/** Build an async-iterable of OpenAI streaming chunks. */
function fakeStream(chunks: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function withClient(chunks: any[]) {
  const provider = new OpenAIProvider('sk-test');
  const create = vi.fn(async () => fakeStream(chunks));
  (provider as any).client = { chat: { completions: { create } } };
  return { provider, create };
}

async function run(provider: OpenAIProvider, params: LlmTurnParams) {
  const out: LlmStreamChunk[] = [];
  for await (const chunk of provider.streamTurn(params)) out.push(chunk);
  return out;
}

const baseParams: LlmTurnParams = {
  model: 'gpt-4o',
  maxTokens: 100,
  system: 'be helpful',
  tools: [{ name: 'get_spending_summary', description: 'sum', inputSchema: { type: 'object' } }],
  messages: [{ role: 'user', content: 'hi' }],
};

describe('OpenAIProvider', () => {
  it('streams text and reassembles fragmented tool-call arguments', async () => {
    const { provider } = withClient([
      { choices: [{ delta: { content: 'Let me check.' }, finish_reason: null }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'c1', function: { name: 'get_spending_summary', arguments: '{"from":' } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '"2026-06-01"}' } }] }, finish_reason: 'tool_calls' },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      },
    ]);

    const chunks = await run(provider, baseParams);
    const text = chunks.filter((c) => c.type === 'text').map((c: any) => c.text).join('');
    const final = chunks.find((c) => c.type === 'final') as any;

    expect(text).toBe('Let me check.');
    expect(final.result.stopReason).toBe('tool_use');
    expect(final.result.toolCalls).toEqual([
      { id: 'c1', name: 'get_spending_summary', input: { from: '2026-06-01' } },
    ]);
    expect(final.result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it('ends the turn (end_turn) for a plain text answer', async () => {
    const { provider } = withClient([
      { choices: [{ delta: { content: 'You spent $10.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 4 } },
    ]);
    const chunks = await run(provider, baseParams);
    const final = chunks.find((c) => c.type === 'final') as any;
    expect(final.result.stopReason).toBe('end_turn');
    expect(final.result.text).toBe('You spent $10.');
    expect(final.result.toolCalls).toEqual([]);
  });

  it('translates tool_use → assistant tool_calls and tool_result → tool messages', async () => {
    const { provider, create } = withClient([
      { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
    ]);
    await run(provider, {
      ...baseParams,
      messages: [
        { role: 'user', content: 'how much dining?' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'c1', name: 'get_spending_summary', input: { from: 'x' } }],
        },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: '$420' }] },
      ],
    });

    const sent = create.mock.calls[0][0].messages;
    expect(sent[0]).toEqual({ role: 'system', content: 'be helpful' });
    // assistant tool_use → tool_calls with JSON-stringified args
    const assistant = sent.find((m: any) => m.role === 'assistant');
    expect(assistant.tool_calls[0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'get_spending_summary', arguments: JSON.stringify({ from: 'x' }) },
    });
    // tool_result → separate `tool` message keyed by tool_call_id
    const toolMsg = sent.find((m: any) => m.role === 'tool');
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'c1', content: '$420' });
    // tools mapped to OpenAI function shape
    expect(create.mock.calls[0][0].tools[0]).toEqual({
      type: 'function',
      function: { name: 'get_spending_summary', description: 'sum', parameters: { type: 'object' } },
    });
  });
});
