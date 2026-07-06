import { GoogleGenAI, type Content, type Part } from '@google/genai';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmStreamChunk,
  LlmToolCall,
  LlmTurnParams,
} from './types';

/**
 * Adapter for Google Gemini via the `@google/genai` SDK. Translates the normalized
 * message shape to Gemini `Content[]` (assistant→`model`, tool_use→`functionCall`,
 * tool_result→`functionResponse`) and back. Gemini function calls carry no id of their
 * own, so we synthesize a stable one per call and resolve the name from history when
 * translating tool results back.
 *
 * Gemini 2.5 returns an opaque `thoughtSignature` on each functionCall part that MUST be
 * echoed back on the next turn (else a 400 "missing thought_signature"). We keep an
 * instance-scoped map (this provider lives for one chat request, spanning all tool rounds)
 * from synthesized call id → signature, and re-attach it when rebuilding the model turn.
 */
export class GoogleProvider implements LlmProvider {
  readonly id = 'google' as const;
  private readonly client: GoogleGenAI;
  /** Monotonic across all tool rounds of this request, so ids never collide. */
  private callSeq = 0;
  /** Synthesized call id → Gemini thoughtSignature, preserved across rounds. */
  private readonly signatures = new Map<string, string>();

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private toGoogleContents(messages: LlmMessage[]): Content[] {
    // Map a synthesized tool-call id → its function name, so tool_result blocks
    // (which only carry the id) can be emitted as functionResponse with a name.
    const idToName = new Map<string, string>();
    const contents: Content[] = [];

    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';

      if (typeof m.content === 'string') {
        contents.push({ role, parts: [{ text: m.content }] });
        continue;
      }

      const parts: Part[] = [];
      for (const b of m.content) {
        if (b.type === 'text') {
          parts.push({ text: b.text });
        } else if (b.type === 'tool_use') {
          idToName.set(b.id, b.name);
          const part: Part = { functionCall: { name: b.name, args: b.input } };
          // Echo the thought signature Gemini gave us for this call — required.
          const sig = this.signatures.get(b.id);
          if (sig) part.thoughtSignature = sig;
          parts.push(part);
        } else if (b.type === 'tool_result') {
          const name = idToName.get(b.toolUseId) ?? b.toolUseId;
          parts.push({
            functionResponse: { name, response: { result: b.content } },
          });
        }
      }
      if (parts.length) contents.push({ role, parts });
    }
    return contents;
  }

  async *streamTurn(params: LlmTurnParams): AsyncIterable<LlmStreamChunk> {
    const stream = await this.client.models.generateContentStream({
      model: params.model,
      contents: this.toGoogleContents(params.messages),
      config: {
        systemInstruction: params.system,
        maxOutputTokens: params.maxTokens,
        // Omit tools entirely when there are none (e.g. the batch digest narration).
        ...(params.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: params.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema as Record<string, unknown>,
                  })),
                },
              ],
            }
          : {}),
      },
    });

    let text = '';
    let usageIn = 0;
    let usageOut = 0;
    const toolCalls: LlmToolCall[] = [];

    for await (const chunk of stream) {
      // Read raw parts (not the `.text` / `.functionCalls` getters) so we can capture
      // the per-call thoughtSignature and skip the model's internal "thought" text.
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text && !part.thought) {
          text += part.text;
          yield { type: 'text', text: part.text };
        }
        if (part.functionCall) {
          const id = `call_${this.callSeq++}`;
          if (part.thoughtSignature) this.signatures.set(id, part.thoughtSignature);
          toolCalls.push({
            id,
            name: part.functionCall.name ?? '',
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
        }
      }
      if (chunk.usageMetadata) {
        usageIn = chunk.usageMetadata.promptTokenCount ?? usageIn;
        usageOut = chunk.usageMetadata.candidatesTokenCount ?? usageOut;
      }
    }

    const content: LlmContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    for (const call of toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
    }

    yield {
      type: 'final',
      result: {
        text,
        content,
        toolCalls,
        stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
        usage: { inputTokens: usageIn, outputTokens: usageOut },
      },
    };
  }

  async testConnection(model: string): Promise<void> {
    await this.client.models.generateContent({
      model,
      contents: 'ping',
      config: { maxOutputTokens: 1 },
    });
  }
}
