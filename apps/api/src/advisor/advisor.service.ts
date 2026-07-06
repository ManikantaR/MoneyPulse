import { Injectable, Logger } from '@nestjs/common';
import { McpClientService } from './mcp-client.service';
import { AiLogsService } from '../ai-logs/ai-logs.service';
import { detectPiiTypes } from '../categorization/pii-sanitizer';
import { AdvisorSettingsService } from './advisor-settings.service';
import { LlmProviderFactory } from './llm/provider-factory';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmTool,
  LlmTurnResult,
} from './llm/types';

const MAX_TOKENS = 8192;
/** Hard cap on tool-use round trips so a loop can't run away. */
const MAX_TOOL_ROUNDS = 8;

/** Shown in the UI footer; the model is also instructed to frame output this way. */
export const ADVISOR_DISCLAIMER =
  'Informational insights based on your own data — not personalized financial, ' +
  'investment, or tax advice. Verify before acting.';

/** Default timezone for resolving "today"/"this month" (matches the digest default). */
const ADVISOR_TIMEZONE = process.env.ADVISOR_TIMEZONE || 'America/New_York';

/** Today's date + weekday in the advisor timezone, e.g. "2026-07-06 (Monday)". */
function todayContext(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: ADVISOR_TIMEZONE }); // YYYY-MM-DD
  const weekday = now.toLocaleDateString('en-US', {
    timeZone: ADVISOR_TIMEZONE,
    weekday: 'long',
  });
  return `${date} (${weekday})`;
}

const SYSTEM_RULES = `You are MoneyPulse's financial insights assistant. You answer the user's questions about their own finances using ONLY the data returned by your tools.

Rules:
- Every number in your answer MUST come from a tool result. Never invent, estimate, or calculate figures yourself — if you need a number, call a tool. Quote the tool's figure as given.
- For a question about a specific category (dining, gas, groceries, etc.), call get_spending_summary or get_category_breakdown for the period, then read the matching category line. Category names in the data may differ from the user's wording (e.g. "Restaurants" ≈ dining, "Fuel"/"Gas" ≈ gas, "Groceries" ≈ food shopping) — match sensibly. Only say there's no data AFTER a tool actually returns none for that period.
- Attach provenance: say which data a number came from (e.g. "based on your spending summary for June 2026").
- If no tool can answer the question, say so plainly ("I don't have a way to answer that from your data") rather than guessing. Do not fall back to general knowledge for figures about the user's finances.
- When the user follows up with just a period or category ("how about June", "and gas?"), reuse the intent from the previous turn.
- You receive aggregated data only (category totals, balances, budgets, recurring merchants). You cannot see individual raw transactions or account numbers — don't claim to.
- Keep answers concise and specific to the user's numbers. Lead with the answer.
- For any suggestion about products, rates, or big decisions, present options with trade-offs and note this is informational, not personalized financial advice. Do not give reckless or absolute directives.`;

/** Build the system prompt with the current date so relative periods resolve correctly. */
function buildSystemPrompt(): string {
  return `${SYSTEM_RULES}

Today's date is ${todayContext()}. Resolve relative periods ("today", "this week", "this month", "last month", "year to date") against THIS date — never assume a different year or month. Spending tools take explicit from/to dates (YYYY-MM-DD); "this month" is the 1st of the current month through today, "last month" is the full previous calendar month.`;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AdvisorService {
  private readonly logger = new Logger(AdvisorService.name);

  constructor(
    private readonly mcp: McpClientService,
    private readonly aiLogs: AiLogsService,
    private readonly settings: AdvisorSettingsService,
    private readonly factory: LlmProviderFactory,
  ) {}

  /** Whether a provider + key are configured (env or DB). */
  async isEnabled(): Promise<boolean> {
    return (await this.settings.resolve()) !== null;
  }

  /**
   * Stream a grounded answer to the user's message. Yields text deltas as they arrive.
   * Runs the tool-use loop against the aggregate MCP tools through whichever provider
   * (Anthropic/OpenAI) is configured; the model narrates verified tool results and
   * never computes numbers itself.
   */
  async *streamChat(
    userId: string,
    message: string,
    history: ChatTurn[] = [],
  ): AsyncGenerator<string> {
    const resolved = await this.settings.resolve();
    if (!resolved) {
      throw new Error(
        'Advisor is not configured. Set a provider API key in Settings or the NAS .env.',
      );
    }
    const provider = this.factory.create(resolved.provider, resolved.apiKey);

    const toolDefs = await this.mcp.listAdvisorTools(userId);
    const tools: LlmTool[] = toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));

    const messages: LlmMessage[] = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: message },
    ];

    const system = buildSystemPrompt();

    const startMs = Date.now();
    let answer = '';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let final: LlmTurnResult | undefined;
        for await (const chunk of provider.streamTurn({
          model: resolved.model,
          maxTokens: MAX_TOKENS,
          system,
          tools,
          messages,
        })) {
          if (chunk.type === 'text') {
            answer += chunk.text;
            yield chunk.text;
          } else {
            final = chunk.result;
          }
        }
        if (!final) break;

        tokensIn += final.usage.inputTokens;
        tokensOut += final.usage.outputTokens;
        messages.push({ role: 'assistant', content: final.content });

        if (final.stopReason !== 'tool_use') break;

        const toolResults: LlmContentBlock[] = [];
        for (const call of final.toolCalls) {
          let content: string;
          try {
            content = await this.mcp.callTool(userId, call.name, call.input);
          } catch (err: any) {
            content = `Tool error: ${err.message}`;
          }
          toolResults.push({
            type: 'tool_result',
            toolUseId: call.id,
            content,
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } finally {
      this.logTurn(userId, resolved.model, message, answer, startMs, tokensIn, tokensOut);
    }
  }

  /** Fire-and-forget audit log of the advisor turn. */
  private logTurn(
    userId: string,
    model: string,
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
        model,
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
