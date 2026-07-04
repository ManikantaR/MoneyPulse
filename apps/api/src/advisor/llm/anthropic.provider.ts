import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmStreamChunk,
  LlmToolCall,
  LlmTurnParams,
} from './types';

/** Adapter for the Anthropic Messages API (adaptive thinking, streaming tool use). */
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  private toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      const blocks = m.content.map((b): Anthropic.ContentBlockParam => {
        switch (b.type) {
          case 'text':
            return { type: 'text', text: b.text };
          case 'tool_use':
            return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
          case 'tool_result':
            return {
              type: 'tool_result',
              tool_use_id: b.toolUseId,
              content: b.content,
            };
        }
      });
      return { role: m.role, content: blocks };
    });
  }

  async *streamTurn(params: LlmTurnParams): AsyncIterable<LlmStreamChunk> {
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      thinking: { type: 'adaptive' },
      system: params.system,
      // Omit `tools` entirely when there are none (e.g. the batch digest narration).
      ...(params.tools.length
        ? {
            tools: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
      messages: this.toAnthropicMessages(params.messages),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const msg = await stream.finalMessage();
    let text = '';
    const content: LlmContentBlock[] = [];
    const toolCalls: LlmToolCall[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        text += block.text;
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        content.push({ type: 'tool_use', id: block.id, name: block.name, input });
        toolCalls.push({ id: block.id, name: block.name, input });
      }
    }

    yield {
      type: 'final',
      result: {
        text,
        content,
        toolCalls,
        stopReason: msg.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
        usage: {
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
        },
      },
    };
  }

  async testConnection(model: string): Promise<void> {
    await this.client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  }
}
