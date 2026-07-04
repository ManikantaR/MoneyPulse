import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { McpClientService } from './mcp-client.service';
import { AiLogsService } from '../ai-logs/ai-logs.service';
import { detectPiiTypes } from '../categorization/pii-sanitizer';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 8192;
/** Hard cap on tool-use round trips so a loop can't run away. */
const MAX_TOOL_ROUNDS = 8;

/** Shown in the UI footer; the model is also instructed to frame output this way. */
export const ADVISOR_DISCLAIMER =
  'Informational insights based on your own data — not personalized financial, ' +
  'investment, or tax advice. Verify before acting.';

const SYSTEM_PROMPT = `You are MoneyPulse's financial insights assistant. You answer the user's questions about their own finances using ONLY the data returned by your tools.

Rules:
- Every number in your answer MUST come from a tool result. Never invent, estimate, or calculate figures yourself — if you need a number, call a tool. Quote the tool's figure as given.
- Attach provenance: say which data a number came from (e.g. "based on your spending summary for June").
- If no tool can answer the question, say so plainly ("I don't have a way to answer that from your data") rather than guessing. Do not fall back to general knowledge for figures about the user's finances.
- You receive aggregated data only (category totals, balances, budgets, recurring merchants). You cannot see individual raw transactions or account numbers — don't claim to.
- Keep answers concise and specific to the user's numbers. Lead with the answer.
- For any suggestion about products, rates, or big decisions, present options with trade-offs and note this is informational, not personalized financial advice. Do not give reckless or absolute directives.`;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AdvisorService {
  private readonly logger = new Logger(AdvisorService.name);
  private readonly anthropic: Anthropic | null;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    private readonly mcp: McpClientService,
    private readonly aiLogs: AiLogsService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = this.config.get<string>('ADVISOR_MODEL') || DEFAULT_MODEL;
    if (!this.anthropic) {
      this.logger.warn('ANTHROPIC_API_KEY not set — advisor chat is disabled.');
    }
  }

  get enabled(): boolean {
    return this.anthropic !== null;
  }

  /**
   * Stream a grounded answer to the user's message. Yields text deltas as they arrive.
   * Runs the Claude tool-use loop against the aggregate MCP tools; the model narrates
   * verified tool results and never computes numbers itself.
   */
  async *streamChat(
    userId: string,
    message: string,
    history: ChatTurn[] = [],
  ): AsyncGenerator<string> {
    if (!this.anthropic) {
      throw new Error(
        'Advisor is not configured (ANTHROPIC_API_KEY missing). Set it in the NAS .env.',
      );
    }

    const tools = await this.mcp.listAdvisorTools(userId);
    const messages: Anthropic.MessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: message },
    ];

    const startMs = Date.now();
    let answer = '';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = this.anthropic.messages.stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          tools: tools as Anthropic.Tool[],
          messages,
        });

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            answer += event.delta.text;
            yield event.delta.text;
          }
        }

        const msg = await stream.finalMessage();
        tokensIn += msg.usage.input_tokens;
        tokensOut += msg.usage.output_tokens;
        messages.push({ role: 'assistant', content: msg.content });

        if (msg.stop_reason !== 'tool_use') break;

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          let content: string;
          try {
            content = await this.mcp.callTool(
              userId,
              block.name,
              block.input as Record<string, any>,
            );
          } catch (err: any) {
            content = `Tool error: ${err.message}`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content,
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } finally {
      this.logTurn(userId, message, answer, startMs, tokensIn, tokensOut);
    }
  }

  /** Fire-and-forget audit log of the advisor turn. */
  private logTurn(
    userId: string,
    message: string,
    answer: string,
    startMs: number,
    tokensIn: number,
    tokensOut: number,
  ): void {
    const piiTypes = detectPiiTypes(message);
    this.aiLogs
      .create({
        userId,
        promptType: 'advisor',
        model: this.model,
        inputText: message,
        outputText: answer || undefined,
        tokenCountIn: tokensIn || undefined,
        tokenCountOut: tokensOut || undefined,
        latencyMs: Date.now() - startMs,
        piiDetected: piiTypes.length > 0,
        piiTypesFound: piiTypes,
      })
      .catch((err) => this.logger.warn(`Advisor log failed: ${err.message}`));
  }

  /** Non-streaming convenience: collect the full answer (used by the Telegram surface). */
  async chat(userId: string, message: string, history: ChatTurn[] = []): Promise<string> {
    let full = '';
    for await (const delta of this.streamChat(userId, message, history)) {
      full += delta;
    }
    return full;
  }
}
