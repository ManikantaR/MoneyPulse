import { describe, it, expect, vi } from 'vitest';
import { GoogleProvider } from '../google.provider';
import type { LlmStreamChunk, LlmTurnParams } from '../types';

/** Build an async-iterable of Gemini streaming chunks. */
function fakeStream(chunks: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

/** A streaming chunk carrying the given candidate parts (+ optional usage). */
function chunk(parts: any[], usage?: { in: number; out: number }) {
  return {
    candidates: [{ content: { parts } }],
    ...(usage
      ? { usageMetadata: { promptTokenCount: usage.in, candidatesTokenCount: usage.out } }
      : {}),
  };
}

function withClient(chunks: any[]) {
  const provider = new GoogleProvider('g-test');
  const generateContentStream = vi.fn(async () => fakeStream(chunks));
  (provider as any).client = { models: { generateContentStream } };
  return { provider, generateContentStream };
}

async function run(provider: GoogleProvider, params: LlmTurnParams) {
  const out: LlmStreamChunk[] = [];
  for await (const c of provider.streamTurn(params)) out.push(c);
  return out;
}

const baseParams: LlmTurnParams = {
  model: 'gemini-2.5-flash',
  maxTokens: 100,
  system: 'be helpful',
  tools: [{ name: 'get_spending_summary', description: 'sum', inputSchema: { type: 'object' } }],
  messages: [{ role: 'user', content: 'hi' }],
};

describe('GoogleProvider', () => {
  it('streams text and captures a function call as a tool_use', async () => {
    const { provider } = withClient([
      chunk([{ text: 'Let me check.' }]),
      chunk([{ functionCall: { name: 'get_spending_summary', args: { from: '2026-06-01' } } }], {
        in: 42,
        out: 7,
      }),
    ]);

    const chunks = await run(provider, baseParams);
    const text = chunks.filter((c) => c.type === 'text').map((c: any) => c.text).join('');
    const final = chunks.find((c) => c.type === 'final') as any;

    expect(text).toBe('Let me check.');
    expect(final.result.stopReason).toBe('tool_use');
    expect(final.result.toolCalls).toHaveLength(1);
    expect(final.result.toolCalls[0]).toMatchObject({
      name: 'get_spending_summary',
      input: { from: '2026-06-01' },
    });
    expect(final.result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it('does not stream the model’s internal thought text', async () => {
    const { provider } = withClient([
      chunk([{ text: 'reasoning...', thought: true }, { text: 'The answer.' }]),
    ]);
    const chunks = await run(provider, baseParams);
    const text = chunks.filter((c) => c.type === 'text').map((c: any) => c.text).join('');
    expect(text).toBe('The answer.');
  });

  it('ends the turn (end_turn) for a plain text answer', async () => {
    const { provider } = withClient([chunk([{ text: 'You spent $10.' }], { in: 5, out: 4 })]);
    const chunks = await run(provider, baseParams);
    const final = chunks.find((c) => c.type === 'final') as any;
    expect(final.result.stopReason).toBe('end_turn');
    expect(final.result.text).toBe('You spent $10.');
    expect(final.result.toolCalls).toEqual([]);
  });

  it('translates history to Gemini contents (functionCall / functionResponse) + config', async () => {
    const { provider, generateContentStream } = withClient([chunk([{ text: 'ok' }])]);
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

    const arg = generateContentStream.mock.calls[0][0];
    expect(arg.config.systemInstruction).toBe('be helpful');
    expect(arg.config.maxOutputTokens).toBe(100);
    expect(arg.config.tools[0].functionDeclarations[0]).toEqual({
      name: 'get_spending_summary',
      description: 'sum',
      parameters: { type: 'object' },
    });

    const contents = arg.contents;
    const model = contents.find((c: any) => c.role === 'model');
    expect(model.parts[0]).toEqual({
      functionCall: { name: 'get_spending_summary', args: { from: 'x' } },
    });
    const fnResponse = contents
      .flatMap((c: any) => c.parts)
      .find((p: any) => p.functionResponse);
    expect(fnResponse.functionResponse).toEqual({
      name: 'get_spending_summary',
      response: { result: '$420' },
    });
  });

  it('captures a functionCall thoughtSignature and echoes it back on the next turn', async () => {
    const provider = new GoogleProvider('g');
    const streams = [
      fakeStream([
        chunk(
          [{ functionCall: { name: 'get_budget_status', args: {} }, thoughtSignature: 'sig-abc' }],
          { in: 1, out: 1 },
        ),
      ]),
      fakeStream([chunk([{ text: 'Budget is fine.' }])]),
    ];
    const gen = vi.fn(async () => streams.shift());
    (provider as any).client = { models: { generateContentStream: gen } };

    // Turn 1 → model asks for a tool; grab the synthesized call id
    const t1 = await run(provider, baseParams);
    const call = (t1.find((c) => c.type === 'final') as any).result.toolCalls[0];
    expect(call.name).toBe('get_budget_status');

    // Turn 2 → same provider instance, history carries the tool_use + tool_result
    await run(provider, {
      ...baseParams,
      messages: [
        { role: 'user', content: 'budget?' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }],
        },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: call.id, content: 'ok' }] },
      ],
    });

    const modelPart = gen.mock.calls[1][0].contents.find((c: any) => c.role === 'model').parts[0];
    expect(modelPart.functionCall).toEqual({ name: 'get_budget_status', args: {} });
    expect(modelPart.thoughtSignature).toBe('sig-abc');
  });

  it('omits tools from config when there are none (batch narration)', async () => {
    const { provider, generateContentStream } = withClient([chunk([{ text: 'hi' }])]);
    await run(provider, { ...baseParams, tools: [] });
    expect(generateContentStream.mock.calls[0][0].config.tools).toBeUndefined();
  });
});
