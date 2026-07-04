import OpenAI from 'openai';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmStreamChunk,
  LlmToolCall,
  LlmTurnParams,
} from './types';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Adapter for the OpenAI Chat Completions API. Translates the normalized message
 * shape to OpenAI's (tool_use → assistant `tool_calls`, tool_result → separate
 * `tool` messages) and reassembles the streamed tool-call argument fragments.
 */
export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai' as const;
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  private toOpenAIMessages(system: string, messages: LlmMessage[]): ChatMessage[] {
    const out: ChatMessage[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (typeof m.content === 'string') {
        out.push({ role: m.role, content: m.content } as ChatMessage);
        continue;
      }
      if (m.role === 'assistant') {
        // Split into assistant text + tool_calls.
        const text = m.content
          .filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const toolCalls = m.content
          .filter(
            (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> =>
              b.type === 'tool_use',
          )
          .map((b) => ({
            id: b.id,
            type: 'function' as const,
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }));
        out.push({
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
      } else {
        // A user turn carrying tool results → one `tool` message per result.
        for (const b of m.content) {
          if (b.type === 'tool_result') {
            out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
          } else if (b.type === 'text') {
            out.push({ role: 'user', content: b.text });
          }
        }
      }
    }
    return out;
  }

  async *streamTurn(params: LlmTurnParams): AsyncIterable<LlmStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: this.toOpenAIMessages(params.system, params.messages),
      // Omit `tools` entirely when there are none — OpenAI rejects an empty array.
      ...(params.tools.length
        ? {
            tools: params.tools.map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
          }
        : {}),
    });

    let text = '';
    let finishReason: string | null = null;
    let usageIn = 0;
    let usageOut = 0;
    // Reassemble streamed tool-call fragments, keyed by their position index.
    const acc = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        text += choice.delta.content;
        yield { type: 'text', text: choice.delta.content };
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(tc.index, cur);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        usageIn = chunk.usage.prompt_tokens ?? 0;
        usageOut = chunk.usage.completion_tokens ?? 0;
      }
    }

    const content: LlmContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    const toolCalls: LlmToolCall[] = [];
    for (const { id, name, args } of acc.values()) {
      if (!name) continue;
      let input: Record<string, unknown> = {};
      try {
        input = args ? (JSON.parse(args) as Record<string, unknown>) : {};
      } catch {
        input = {};
      }
      content.push({ type: 'tool_use', id, name, input });
      toolCalls.push({ id, name, input });
    }

    yield {
      type: 'final',
      result: {
        text,
        content,
        toolCalls,
        stopReason: finishReason === 'tool_calls' ? 'tool_use' : 'end_turn',
        usage: { inputTokens: usageIn, outputTokens: usageOut },
      },
    };
  }

  async testConnection(model: string): Promise<void> {
    await this.client.chat.completions.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  }
}
