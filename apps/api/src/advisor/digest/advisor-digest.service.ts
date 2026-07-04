import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../../db/db.module';
import * as schema from '../../db/schema';
import { NotificationsService } from '../../notifications/notifications.service';
import { AiLogsService } from '../../ai-logs/ai-logs.service';
import { AdvisorSettingsService } from '../advisor-settings.service';
import { LlmProviderFactory } from '../llm/provider-factory';
import type { LlmTurnResult } from '../llm/types';
import { DigestSignalsService } from './digest-signals.service';
import type { AdvisorDigest, DigestSignal } from './types';

const MAX_TOKENS = 1024;
const DIGEST_TITLE = 'Weekly Money Recap';

/** ISO-week key (e.g. 2026-W27) in the user's timezone, for once-a-week dedupe. */
function isoWeekKey(timezone: string, now = new Date()): string {
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

const DIGEST_SYSTEM_PROMPT = `You are MoneyPulse's weekly money digest writer. You receive a JSON array of PRE-COMPUTED, verified signals about the user's finances over the past week. Each signal has a "detail" sentence that already contains the exact dollar figures.

Write a short weekly recap:
- Select only the 3–5 MOST important signals (biggest dollar impact / most actionable). Ignore the rest.
- Order them most-important first, as a markdown bullet list ("- " per line).
- For each, write ONE tight sentence, leading with what happened and the dollar figure.
- Use ONLY numbers that appear in the signals' "detail" text. Never invent, add, recompute, or total figures. If a number isn't in the signals, don't state it.
- Neutral, informational tone — surface facts and gentle observations, not directives or advice.
- No preamble, no heading, no closing paragraph. Just the bullet list.`;

/**
 * Builds and delivers the proactive weekly advisor digest.
 *
 * Pipeline: deterministic signals (the math engine) → cloud LLM ranks & narrates the
 * top 3–5 (never inventing numbers) → delivered through the notification + Home Assistant
 * pipeline, deduped once per ISO week. Only aggregate figures reach the model.
 */
@Injectable()
export class AdvisorDigestService {
  private readonly logger = new Logger(AdvisorDigestService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly signals: DigestSignalsService,
    private readonly settings: AdvisorSettingsService,
    private readonly factory: LlmProviderFactory,
    private readonly notifications: NotificationsService,
    private readonly aiLogs: AiLogsService,
  ) {}

  /**
   * Assemble the digest for a user. Gathers signals, then narrates the top few via the
   * configured provider. Returns `null` if there's nothing worth sending this week.
   */
  async buildDigest(
    userId: string,
    timezone = 'America/New_York',
  ): Promise<AdvisorDigest | null> {
    const signals = await this.signals.gather(userId, timezone);
    if (signals.length === 0) {
      this.logger.debug(`No digest signals for user ${userId} — skipping.`);
      return null;
    }

    const resolved = await this.settings.resolve();
    if (!resolved) {
      throw new Error('Advisor is not configured; cannot narrate the weekly digest.');
    }

    const message = await this.narrate(userId, resolved, signals);
    const top = signals[0];
    const voiceSummary = `Your weekly money recap is ready. ${top.detail}`;

    return { title: DIGEST_TITLE, message, voiceSummary, signals };
  }

  /** Single no-tools LLM turn that ranks and narrates the pre-computed signals. */
  private async narrate(
    userId: string,
    resolved: { provider: any; model: string; apiKey: string },
    signals: DigestSignal[],
  ): Promise<string> {
    const provider = this.factory.create(resolved.provider, resolved.apiKey);
    const payload = signals.map((s) => ({ detail: s.detail, provenance: s.provenance }));
    const userMessage = `Here are this week's signals as JSON. Write the recap.\n\n${JSON.stringify(
      payload,
      null,
      2,
    )}`;

    const startMs = Date.now();
    let text = '';
    let final: LlmTurnResult | undefined;
    for await (const chunk of provider.streamTurn({
      model: resolved.model,
      maxTokens: MAX_TOKENS,
      system: DIGEST_SYSTEM_PROMPT,
      tools: [],
      messages: [{ role: 'user', content: userMessage }],
    })) {
      if (chunk.type === 'text') text += chunk.text;
      else final = chunk.result;
    }

    this.aiLogs
      .create({
        userId,
        promptType: 'advisor',
        model: resolved.model,
        inputText: 'weekly-digest',
        outputText: text || undefined,
        tokenCountIn: final?.usage.inputTokens,
        tokenCountOut: final?.usage.outputTokens,
        latencyMs: Date.now() - startMs,
        piiDetected: false,
        piiTypesFound: [],
      })
      .catch((err) => this.logger.warn(`Digest log failed: ${err.message}`));

    const narrated = text.trim();
    // Deterministic fallback if the model returns nothing usable.
    return narrated.length > 0 ? narrated : this.templateBody(signals);
  }

  /** Plain top-5 bullet list, used when the LLM produces no text. */
  private templateBody(signals: DigestSignal[]): string {
    return signals
      .slice(0, 5)
      .map((s) => `- ${s.detail}`)
      .join('\n');
  }

  /**
   * Deliver the digest to one user. Idempotent — skips if this ISO week's digest already went out.
   * Returns true if a new digest was dispatched.
   */
  async deliver(userId: string, timezone: string): Promise<boolean> {
    const weekKey = isoWeekKey(timezone);
    const dedupeKey = `advisor_digest_weekly_${userId}_${weekKey}`;

    if (await this.notifications.findByMetadata(userId, dedupeKey)) {
      this.logger.debug(`Advisor digest already sent: ${dedupeKey}`);
      return false;
    }

    const digest = await this.buildDigest(userId, timezone);
    if (!digest) return false;

    await this.notifications.createAndDispatch({
      userId,
      type: 'advisor_digest',
      title: digest.title,
      message: digest.message,
      voiceSummary: digest.voiceSummary,
      dedupeKey,
      metadata: { weekKey, signals: digest.signals },
    });

    this.logger.log(`Advisor digest delivered: ${dedupeKey}`);
    return true;
  }

  /**
   * Scheduler entrypoint. Runs only when the advisor is configured, then delivers to every
   * user who opted in (`advisor_digest_enabled`).
   */
  async deliverAllEnabled(): Promise<void> {
    if (!(await this.settings.resolve())) {
      this.logger.log('Advisor not configured — skipping weekly digest sweep.');
      return;
    }

    const rows = await this.db
      .select({
        userId: schema.userSettings.userId,
        timezone: schema.userSettings.timezone,
      })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.advisorDigestEnabled, true))
      .limit(10000);

    this.logger.log(`Advisor digest sweep: ${rows.length} user(s) opted in`);

    for (const { userId, timezone } of rows) {
      try {
        await this.deliver(userId, timezone ?? 'America/New_York');
      } catch (err) {
        this.logger.error(
          `Advisor digest failed for user ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
