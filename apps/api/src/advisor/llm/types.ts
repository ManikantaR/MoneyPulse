/**
 * Provider-agnostic LLM types. Every supported provider (Anthropic, OpenAI) is
 * driven through this one shape so the advisor tool-use loop never has to know
 * which vendor is behind it. Adapters translate these to/from the vendor wire
 * format and emit the same stream chunks (`text` then a single `final`).
 */

/** A tool the model may call. `inputSchema` is JSON Schema (both vendors accept it). */
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Normalized content blocks that make up a message in the running history. */
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string };

export interface LlmMessage {
  role: 'user' | 'assistant';
  /** A plain string (simple turn) or a list of normalized blocks (tool turns). */
  content: string | LlmContentBlock[];
}

/** A tool the model decided to call this turn. */
export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmTurnResult {
  /** Assistant text emitted this turn (already streamed via `text` chunks). */
  text: string;
  /**
   * The assistant message content to append to history before the next round —
   * normalized text + tool_use blocks, so the loop is vendor-independent.
   */
  content: LlmContentBlock[];
  toolCalls: LlmToolCall[];
  /** Normalized: 'tool_use' when the model wants tools, else 'end_turn'. */
  stopReason: 'tool_use' | 'end_turn';
  usage: { inputTokens: number; outputTokens: number };
}

/** Streamed either as incremental text or a single terminal `final` result. */
export type LlmStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'final'; result: LlmTurnResult };

export interface LlmTurnParams {
  model: string;
  maxTokens: number;
  system: string;
  tools: LlmTool[];
  messages: LlmMessage[];
}

export type LlmProviderId = 'anthropic' | 'openai' | 'google';

export interface LlmProvider {
  readonly id: LlmProviderId;
  /** Run one model turn, streaming text then a single `final` chunk. */
  streamTurn(params: LlmTurnParams): AsyncIterable<LlmStreamChunk>;
  /** Cheap credential/model probe. Resolves on success, throws on failure. */
  testConnection(model: string): Promise<void>;
}

/** Default model per provider when the user hasn't picked one. */
export const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
};
