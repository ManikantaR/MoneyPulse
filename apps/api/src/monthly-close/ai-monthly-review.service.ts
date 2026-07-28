import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MonthlyCloseService } from './monthly-close.service';
import { AdvisorSettingsService } from '../advisor/advisor-settings.service';
import { LlmProviderFactory } from '../advisor/llm/provider-factory';
import { AiLogsService } from '../ai-logs/ai-logs.service';
import { ADVISOR_DISCLAIMER } from '../advisor/advisor.service';
import type { LlmStreamChunk, LlmTurnResult } from '../advisor/llm/types';

const MAX_TOKENS = 2048;
const MIN_BULLETS = 3;
const MAX_BULLETS = 5;

/** Prefix stamped on the deterministic caveat we prepend when the close is incomplete
 *  and the model's own output doesn't already lead with a caveat (belt-and-suspenders —
 *  epic #158/13.7 acceptance criterion #10: never emit an uncaveated summary). */
export const INCOMPLETE_CLOSE_CAVEAT_MARKER = 'INCOMPLETE CLOSE';

/** Keywords that indicate a bullet is already caveating an incomplete close. */
const CAVEAT_KEYWORDS = ['incomplete', 'missing', 'stale', 'unverified', 'caveat'];

/**
 * Deterministic forbidden-pattern checks (13.7 spec): the model must never invent
 * numbers (handled by prompt + tool-free, aggregate-only input), recommend trades,
 * predict markets, treat home/car/gold revaluation as savings behavior, or double-count
 * credit-card payments as expenses on top of the purchases that already flow through
 * expenseCents. These are best-effort textual guards on top of the system prompt —
 * any bullet that trips one is dropped rather than delivered.
 */
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'trade-recommendation',
    pattern: /\b(buy|sell|short|invest(?:ing)? in)\b[^.]{0,40}\b(stock|shares?|crypto|bitcoin|etf|bond|fund|ticker)\b/i,
  },
  {
    name: 'market-prediction',
    pattern: /\b(market|s&p|nasdaq|dow)\b[^.]{0,40}\b(will|is going to|expected to|predict(?:ed|ion)?)\b/i,
  },
  {
    name: 'revaluation-as-savings',
    pattern: /\b(home|house|car|vehicle|gold)\b[^.]{0,60}\b(value|appreciat\w*|worth)\b[^.]{0,60}\b(sav(?:ed|ings|e))\b/i,
  },
  {
    name: 'revaluation-as-savings-reverse',
    pattern: /\bsav(?:ed|ings|e)\b[^.]{0,60}\b(home|house|car|vehicle|gold)\b[^.]{0,60}\b(value|appreciat\w*|worth)\b/i,
  },
  {
    name: 'credit-card-payment-as-expense',
    pattern: /\bcredit[- ]card payment\b[^.]{0,60}\bexpense\b/i,
  },
  {
    name: 'credit-card-payment-as-expense-reverse',
    pattern: /\bexpense\b[^.]{0,60}\bcredit[- ]card payment\b/i,
  },
];

/** Returns the names of forbidden patterns a bullet trips, if any. */
export function findForbiddenViolations(bullet: string): string[] {
  return FORBIDDEN_PATTERNS.filter((p) => p.pattern.test(bullet)).map((p) => p.name);
}

/** True if the bullet reads as caveating incomplete/stale data. */
export function isCaveatBullet(bullet: string): boolean {
  const lower = bullet.toLowerCase();
  return CAVEAT_KEYWORDS.some((k) => lower.includes(k));
}

/** Split the model's raw answer into "- " bullet lines, trimmed. */
export function parseBullets(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'))
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter((l) => l.length > 0);
}

function pct(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? 'n/a' : `${(bps / 100).toFixed(1)}%`;
}
function dollars(cents: number | null | undefined): string {
  return `$${(Number(cents ?? 0) / 100).toFixed(2)}`;
}

/** Render one snapshot row as a compact aggregate line for the prompt. */
function summarizeSnapshot(row: any): string {
  const month = String(row.snapshotMonth).slice(0, 7);
  const freshness = row.freshness ?? {};
  const caveat = freshness.isComplete ? '' : ' [INCOMPLETE]';
  return (
    `${month}${caveat}: income ${dollars(row.takeHomeIncomeCents)}, expenses ${dollars(row.expenseCents)}, ` +
    `cash savings ${dollars(row.cashSavingsCents)}, investing ${dollars(row.investmentContributionCents)}, ` +
    `debt principal paid ${dollars(row.debtPrincipalPaidCents)}, net worth ${dollars(row.netWorthCents)}, ` +
    `savings rate ${pct(row.savingsRateBps)}, expense ratio ${pct(row.expenseRatioBps)}, ` +
    `target status ${JSON.stringify(row.targetStatus ?? {})}`
  );
}

export interface AiMonthlyReviewResult {
  bullets: string[];
  disclaimer: string;
  isIncomplete: boolean;
}

const SYSTEM_PROMPT = `You are MoneyPulse's monthly-close reviewer. You receive ONLY pre-computed aggregate figures for one user's monthly close (income/expense/savings/investment/debt/net-worth totals, ratio percentages, target status, and freshness flags) plus prior-month trend summaries. You never see raw transactions, merchant names, account numbers, or addresses.

Output contract:
- Output ONLY a markdown bullet list, one line per item, each starting with "- ". No preamble or closing paragraph.
- Produce 3 to 5 bullets total, covering:
  1. One expense-accountability observation (spending vs. income or vs. prior months).
  2. One net-worth or debt-paydown observation.
  3. One "next dollar" (pay-yourself-first / FOO) recommendation — where the next marginal dollar should go given targets and current rates.
  4. If the close is flagged incomplete (freshness.isComplete = false), a bullet that clearly states the close is incomplete/provisional and names what's missing — this bullet is MANDATORY and must be the FIRST bullet whenever the close is incomplete.

Hard rules:
- Every number you state MUST come from the aggregate data you were given. Never invent, estimate, or extrapolate a figure.
- Never recommend buying, selling, or timing any specific stock, crypto, bond, or fund. Never predict market direction.
- Home, car, or gold value changes are asset revaluation, NOT savings behavior — never describe them as "saved" or as part of the savings rate.
- Credit-card PAYMENTS are debt settlement, not a new expense — the underlying purchases are already counted in expenses for the month they were made. Never describe a credit-card payment itself as an expense.
- If the close is incomplete, you MUST NOT produce a clean, uncaveated summary — lead with the caveat bullet and hedge the other bullets accordingly (e.g. "based on partial data").`;

/**
 * 13.7 — AI monthly review. Reuses the Phase-12 advisor LLM provider infra but, unlike
 * the interactive chat/proactive-review services, takes NO tools: the monthly-close
 * aggregates are already fully assembled server-side (current month + prior trend),
 * so there is nothing for the model to fetch and therefore nothing row-level it could
 * ever request. This keeps the aggregates-only privacy posture structurally guaranteed
 * rather than allowlist-enforced alone.
 */
@Injectable()
export class AiMonthlyReviewService {
  private readonly logger = new Logger(AiMonthlyReviewService.name);

  constructor(
    private readonly monthlyCloseService: MonthlyCloseService,
    private readonly settings: AdvisorSettingsService,
    private readonly factory: LlmProviderFactory,
    private readonly aiLogs: AiLogsService,
  ) {}

  /** Build the user-turn prompt text from the current close + trailing trend rows. */
  buildPrompt(current: any, trendRows: any[], userNotes?: string | null): string {
    const trendLines = trendRows
      .filter((r) => r.id !== current.id)
      .slice(0, 12)
      .map(summarizeSnapshot);

    return [
      'Current month close:',
      summarizeSnapshot(current),
      '',
      trendLines.length > 0 ? 'Prior months (most recent first):' : 'No prior months on record.',
      ...(trendLines.length > 0 ? [trendLines.join('\n')] : []),
      ...(userNotes ? ['', `User notes for this month: ${userNotes}`] : []),
    ].join('\n');
  }

  /** Deterministic fallback used when the model can't be reached or produces nothing
   *  usable — still satisfies the "never emit a clean uncaveated summary" rule. */
  private fallbackBullets(current: any, isIncomplete: boolean): string[] {
    const bullets: string[] = [];
    if (isIncomplete) {
      const freshness = current.freshness ?? {};
      const gaps = [
        ...(freshness.missingManualAssets ?? []),
        ...(freshness.staleAccounts ?? []),
        ...(freshness.unverifiedLoans ?? []),
      ];
      bullets.push(
        `[${INCOMPLETE_CLOSE_CAVEAT_MARKER}] This close is missing or has stale data (${gaps.length} item(s)) — the figures below are provisional until it's completed.`,
      );
    }
    bullets.push(
      `Expenses were ${dollars(current.expenseCents)} against take-home income of ${dollars(current.takeHomeIncomeCents)} (expense ratio ${pct(current.expenseRatioBps)}).`,
    );
    bullets.push(`Net worth stands at ${dollars(current.netWorthCents)}, with debt-paydown rate ${pct(current.debtPaydownRateBps)}.`);
    bullets.push(
      `Based on your current savings rate (${pct(current.savingsRateBps)}) and target status, review your Foundation Order of Operations to decide where the next dollar should go.`,
    );
    return bullets.slice(0, MAX_BULLETS);
  }

  /**
   * Run the AI monthly review for `userId`/`month`. Persists the result text onto the
   * snapshot's `aiReview` column and returns the structured bullets.
   */
  async review(userId: string, month: string): Promise<AiMonthlyReviewResult> {
    const current = await this.monthlyCloseService.findOne(userId, month);
    if (!current) throw new NotFoundException('Monthly close not found');

    const freshness = current.freshness as { isComplete?: boolean } | null;
    const isIncomplete = !(freshness?.isComplete ?? false);

    const resolved = await this.settings.resolve();
    if (!resolved) {
      throw new ServiceUnavailableException('AI advisor is not configured');
    }

    const trendRows = await this.monthlyCloseService.findAll(userId, 13);
    const prompt = this.buildPrompt(current, trendRows, current.notes);

    const provider = this.factory.create(resolved.provider, resolved.apiKey);
    const startMs = Date.now();
    let answer = '';
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      for await (const chunk of provider.streamTurn({
        model: resolved.model,
        maxTokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [],
        messages: [{ role: 'user', content: prompt }],
      }) as AsyncIterable<LlmStreamChunk>) {
        if (chunk.type === 'text') answer += chunk.text;
        else {
          const final: LlmTurnResult = chunk.result;
          tokensIn += final.usage.inputTokens;
          tokensOut += final.usage.outputTokens;
        }
      }
    } catch (err: any) {
      this.logger.error(`AI monthly review LLM call failed: ${err.message}`);
      answer = '';
    } finally {
      this.aiLogs
        .create({
          userId,
          promptType: 'advisor',
          model: resolved.model,
          inputText: `ai-monthly-review-${month}`,
          outputText: answer || undefined,
          tokenCountIn: tokensIn || undefined,
          tokenCountOut: tokensOut || undefined,
          latencyMs: Date.now() - startMs,
          piiDetected: false,
          piiTypesFound: [],
        })
        .catch((err) => this.logger.warn(`AI monthly review log failed: ${err.message}`));
    }

    let bullets = this.sanitizeBullets(parseBullets(answer), isIncomplete);
    if (bullets.length < MIN_BULLETS) {
      bullets = this.fallbackBullets(current, isIncomplete);
    }

    const text = bullets.map((b) => `- ${b}`).join('\n');
    try {
      await this.monthlyCloseService.saveAiReview(userId, month, text);
    } catch (err: any) {
      this.logger.warn(`Failed to persist AI monthly review: ${err.message}`);
    }

    return { bullets, disclaimer: ADVISOR_DISCLAIMER, isIncomplete };
  }

  /**
   * Drop any bullet that trips a forbidden pattern, cap to MAX_BULLETS, and — for an
   * incomplete close — force a caveat bullet to the front if the model didn't already
   * lead with one (acceptance criterion #10: never a clean uncaveated summary).
   */
  private sanitizeBullets(rawBullets: string[], isIncomplete: boolean): string[] {
    const clean: string[] = [];
    for (const bullet of rawBullets) {
      const violations = findForbiddenViolations(bullet);
      if (violations.length > 0) {
        this.logger.warn(`AI monthly review: dropped bullet for [${violations.join(', ')}]: "${bullet}"`);
        continue;
      }
      clean.push(bullet);
    }

    if (isIncomplete) {
      const hasCaveat = clean.some((b) => isCaveatBullet(b));
      if (!hasCaveat || !isCaveatBullet(clean[0] ?? '')) {
        const caveat = `[${INCOMPLETE_CLOSE_CAVEAT_MARKER}] This close is flagged incomplete — treat the figures below as provisional until missing/stale data is filled in.`;
        clean.unshift(caveat);
      }
    }

    return clean.slice(0, MAX_BULLETS);
  }
}
