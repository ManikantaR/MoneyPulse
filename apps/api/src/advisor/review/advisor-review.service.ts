import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../../db/db.module';
import * as schema from '../../db/schema';
import { NotificationsService } from '../../notifications/notifications.service';
import { AiLogsService } from '../../ai-logs/ai-logs.service';
import { AdvisorSettingsService } from '../advisor-settings.service';
import { McpClientService } from '../mcp-client.service';
import { LlmProviderFactory } from '../llm/provider-factory';
import { ADVISOR_DISCLAIMER } from '../advisor.service';
import type { LlmContentBlock, LlmMessage, LlmTool, LlmTurnResult } from '../llm/types';

const MAX_TOKENS = 4096;
/** Hard cap on tool-use round trips so a review run can't loop forever. */
const MAX_TOOL_ROUNDS = 8;

export type ReviewCadence = 'weekly' | 'monthly';

/** Sentinel the model must return verbatim (and only) when there's nothing worth surfacing. */
export const NOTHING_NOTEWORTHY = 'NOTHING_NOTEWORTHY';

const REVIEW_SYSTEM_PROMPT = `You are MoneyPulse's proactive financial reviewer. You run on a schedule with no user present — there is no question to answer, only aggregates to inspect via your tools.

Rules:
- Every number you state MUST come from a tool result. Never invent, estimate, or compute figures yourself.
- Cite the tool figures directly (e.g. "$412.50 in Dining this month vs $260 last month").
- Output ONLY a markdown bullet list, one line per item, each starting with "- ". No preamble, heading, or closing paragraph.
- If, after checking your tools, nothing is noteworthy, output exactly the single word ${NOTHING_NOTEWORTHY} and nothing else.
- Keep each item to one tight sentence. Neutral, informational tone — surface facts, not directives.`;

const WEEKLY_PROMPT = `Review this week's spending and account aggregates against prior weeks using your tools. Flag at most 3 noteworthy items: unusual category movement, goal/budget drift, or waste candidates (idle cash, price creep, new/unused subscriptions). ${NOTHING_NOTEWORTHY} if nothing stands out.`;

const MONTHLY_PROMPT = `Review this month's aggregates against the prior month and the same month last year (YoY) using your tools. Cover budgets, net-worth delta, and loan progress in addition to category movement. Flag at most 5 noteworthy items. ${NOTHING_NOTEWORTHY} if nothing stands out.`;

/** Extract every distinct "$1,234.56"-shaped substring from text, in order of first appearance. */
function extractDollarFigures(text: string): string[] {
  const matches = text.match(/\$[\d,]+(?:\.\d{1,2})?/g) ?? [];
  return Array.from(new Set(matches));
}

/**
 * AdvisorReviewService (11.9): the standing, scheduled counterpart to the interactive
 * advisor chat. Reuses the exact same provider + tool-use loop and aggregate tool
 * allowlist as `AdvisorService.streamChat`, but drives it with a fixed "review this
 * period" prompt instead of a user question, and delivers the result as one insight
 * feed row (source: advisor, severity: insight) instead of a chat reply.
 *
 * Numeric spot-check (cheap verifier): every "$..." figure narrated in an item must
 * appear verbatim in some tool result text produced during the same run, else that
 * item is dropped and a warning is logged. NOTHING_NOTEWORTHY (or an empty result
 * after filtering) delivers nothing — silence is a feature, not a failure.
 */
@Injectable()
export class AdvisorReviewService {
  private readonly logger = new Logger(AdvisorReviewService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly mcp: McpClientService,
    private readonly aiLogs: AiLogsService,
    private readonly settings: AdvisorSettingsService,
    private readonly factory: LlmProviderFactory,
    private readonly notifications: NotificationsService,
  ) {}

  /** Period key used for once-per-period dedupe, in the user's timezone. */
  private periodKey(cadence: ReviewCadence, timezone: string, now = new Date()): string {
    if (cadence === 'monthly') {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(now);
      const year = parts.find((p) => p.type === 'year')!.value;
      const month = parts.find((p) => p.type === 'month')!.value;
      return `${year}-${month}`;
    }
    // Weekly: ISO week in the user's timezone.
    const d = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    d.setHours(0, 0, 0, 0);
    const dayOfWeek = (d.getDay() + 6) % 7; // Mon=0
    const thursday = new Date(d);
    thursday.setDate(d.getDate() - dayOfWeek + 3);
    const firstThursday = new Date(thursday.getFullYear(), 0, 4);
    const weekNum =
      1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
    return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * Run one proactive review for a user: drive the tool-use loop with the standing
   * prompt, spot-check narrated dollar figures against tool output, and deliver a
   * single insight feed row + notification (dispatched per the user's preferences,
   * including Telegram). No-op (returns false) on a quiet period or if disabled.
   */
  async runReview(userId: string, cadence: ReviewCadence, timezone = 'America/New_York'): Promise<boolean> {
    const resolved = await this.settings.resolve();
    if (!resolved) {
      this.logger.log(`Advisor not configured — skipping ${cadence} proactive review for ${userId}.`);
      return false;
    }

    const key = this.periodKey(cadence, timezone);
    const dedupeKey = `advisor_review_${cadence}_${userId}_${key}`;
    if (await this.notifications.findByMetadata(userId, dedupeKey)) {
      this.logger.debug(`Proactive review already delivered: ${dedupeKey}`);
      return false;
    }

    const provider = this.factory.create(resolved.provider, resolved.apiKey);
    const toolDefs = await this.mcp.listAdvisorTools(userId);
    const tools: LlmTool[] = toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));

    const standingPrompt = cadence === 'monthly' ? MONTHLY_PROMPT : WEEKLY_PROMPT;
    const messages: LlmMessage[] = [{ role: 'user', content: standingPrompt }];

    const startMs = Date.now();
    let answer = '';
    let tokensIn = 0;
    let tokensOut = 0;
    const toolOutputs: string[] = [];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let final: LlmTurnResult | undefined;
        for await (const chunk of provider.streamTurn({
          model: resolved.model,
          maxTokens: MAX_TOKENS,
          system: REVIEW_SYSTEM_PROMPT,
          tools,
          messages,
        })) {
          if (chunk.type === 'text') answer += chunk.text;
          else final = chunk.result;
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
            const result = await this.mcp.callTool(userId, call.name, call.input);
            content = result.text;
            toolOutputs.push(content);
          } catch (err: any) {
            content = `Tool error: ${err.message}`;
          }
          toolResults.push({ type: 'tool_result', toolUseId: call.id, content });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } finally {
      this.logRun(userId, cadence, resolved.model, answer, startMs, tokensIn, tokensOut);
    }

    const items = this.verifyAndFilter(answer, toolOutputs.join('\n'));
    if (items.length === 0) {
      this.logger.log(`Proactive ${cadence} review for ${userId}: nothing noteworthy.`);
      return false;
    }

    const message = `${items.join('\n')}\n\n${ADVISOR_DISCLAIMER}`;
    const title = cadence === 'monthly' ? 'Monthly advisor review' : 'Weekly advisor review';

    await this.notifications.createAndDispatch({
      userId,
      type: 'advisor_review',
      source: 'advisor',
      severity: 'insight',
      title,
      message,
      dedupeKey,
      metadata: { dedupeKey, cadence, periodKey: key, itemCount: items.length },
    });

    this.logger.log(`Proactive ${cadence} review delivered: ${dedupeKey} (${items.length} item(s))`);
    return true;
  }

  /**
   * Numeric spot-check: parse the model's bullet items, drop any whose "$..." figures
   * don't all appear verbatim in the run's tool output, and log a warning for each drop.
   * Returns [] for NOTHING_NOTEWORTHY (or empty/unparsable output).
   */
  private verifyAndFilter(rawAnswer: string, toolOutputText: string): string[] {
    const trimmed = rawAnswer.trim();
    if (trimmed.length === 0 || trimmed === NOTHING_NOTEWORTHY) return [];

    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'));

    // Model ignored the sentinel/format contract and produced no bullet lines — treat
    // as nothing verifiable rather than risk shipping ungrounded text.
    if (lines.length === 0) return [];

    const verified: string[] = [];
    for (const line of lines) {
      const figures = extractDollarFigures(line);
      const missing = figures.filter((f) => !toolOutputText.includes(f));
      if (missing.length > 0) {
        this.logger.warn(
          `Proactive review: dropped item with unverified figure(s) [${missing.join(', ')}]: "${line}"`,
        );
        continue;
      }
      verified.push(line);
    }
    return verified;
  }

  /** Fire-and-forget audit log of the full review run. */
  private logRun(
    userId: string,
    cadence: ReviewCadence,
    model: string,
    answer: string,
    startMs: number,
    tokensIn: number,
    tokensOut: number,
  ): void {
    this.aiLogs
      .create({
        userId,
        promptType: 'advisor',
        model,
        inputText: `proactive-review-${cadence}`,
        outputText: answer || undefined,
        tokenCountIn: tokensIn || undefined,
        tokenCountOut: tokensOut || undefined,
        latencyMs: Date.now() - startMs,
        piiDetected: false,
        piiTypesFound: [],
      })
      .catch((err) => this.logger.warn(`Proactive review log failed: ${err.message}`));
  }

  /**
   * Scheduler entrypoint. Runs only when the advisor is configured, then reviews every
   * user who opted in (`proactive_advisor_enabled`, default OFF).
   */
  async deliverAllEnabled(cadence: ReviewCadence): Promise<void> {
    if (!(await this.settings.resolve())) {
      this.logger.log(`Advisor not configured — skipping ${cadence} proactive review sweep.`);
      return;
    }

    const rows = await this.db
      .select({
        userId: schema.userSettings.userId,
        timezone: schema.userSettings.timezone,
      })
      .from(schema.userSettings)
      .innerJoin(schema.users, eq(schema.users.id, schema.userSettings.userId))
      .where(
        and(
          eq(schema.userSettings.proactiveAdvisorEnabled, true),
          isNull(schema.users.deletedAt),
        ),
      )
      .limit(10000);

    this.logger.log(`Proactive ${cadence} review sweep: ${rows.length} user(s) opted in`);

    for (const { userId, timezone } of rows) {
      try {
        await this.runReview(userId, cadence, timezone ?? 'America/New_York');
      } catch (err) {
        this.logger.error(
          `Proactive ${cadence} review failed for user ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
