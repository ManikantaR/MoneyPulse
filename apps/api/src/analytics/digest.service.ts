import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { OllamaHealthService } from '../categorization/ollama-health.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { DigestPeriod } from '@moneypulse/shared';

interface DigestSection {
  label: string;
  value: string;
}

interface DigestResult {
  title: string;
  message: string;
  voiceSummary: string;
  sections: DigestSection[];
}

function formatDollars(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Returns the user-local period key for deduplification. */
function getLocalPeriodKey(timezone: string, period: DigestPeriod): string {
  const localStr = new Date().toLocaleString('en-US', { timeZone: timezone });
  const d = new Date(localStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  if (period === 'daily') return `${year}-${month}-${day}`;
  if (period === 'monthly') return `${year}-${month}`;
  // ISO week: Sun=0 → shift to Mon-based week
  const dayOfWeek = (d.getDay() + 6) % 7;
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - dayOfWeek + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly config: ConfigService,
    private readonly ollamaHealth: OllamaHealthService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.ollamaUrl = this.config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.ollamaModel = this.config.get<string>('OLLAMA_MODEL', 'llama3.2');
  }

  /** Builds the digest data + narrative for a single user. */
  async buildDigest(
    userId: string,
    period: DigestPeriod,
    timezone = 'America/New_York',
  ): Promise<DigestResult> {
    const sections = period === 'daily'
      ? await this.buildDailySections(userId, timezone)
      : await this.buildWeeklyMonthlySections(userId, period, timezone);

    const title = this.buildTitle(period);

    const ollamaAvailable = await this.ollamaHealth.isAvailable();
    if (ollamaAvailable) {
      try {
        return { title, sections, ...await this.generateNarrative(title, sections) };
      } catch (err) {
        this.logger.warn(`Ollama narrative failed, using template: ${(err as Error).message}`);
      }
    }

    return { title, sections, ...this.templateNarrative(period, sections) };
  }

  /** Delivers a digest to a user. Idempotent — skips if already delivered this period. */
  async deliver(userId: string, period: DigestPeriod): Promise<boolean> {
    const settings = await this.getUserSettings(userId);
    if (!settings) return false;

    const timezone = settings.timezone ?? 'America/New_York';
    const periodKey = getLocalPeriodKey(timezone, period);
    const dedupeKey = `digest_${period}_${userId}_${periodKey}`;

    const alreadySent = await this.notificationsService.findByMetadata(userId, dedupeKey);
    if (alreadySent) {
      this.logger.debug(`Digest already sent: ${dedupeKey}`);
      return false;
    }

    const { title, message, voiceSummary, sections } = await this.buildDigest(userId, period, timezone);

    await this.notificationsService.createAndDispatch({
      userId,
      type: 'digest',
      title,
      message,
      voiceSummary,
      dedupeKey,
      metadata: { period, sections },
    });

    this.logger.log(`Digest delivered: ${dedupeKey}`);
    return true;
  }

  /** Called by the scheduler. Queries all users with the given cadence enabled and delivers. */
  async deliverAllEnabled(period: DigestPeriod): Promise<void> {
    const enabledColumn =
      period === 'daily'
        ? schema.userSettings.dailyDigestEnabled
        : period === 'weekly'
        ? schema.userSettings.weeklyDigestEnabled
        : schema.userSettings.monthlyDigestEnabled;

    const rows = await this.db
      .select({ userId: schema.userSettings.userId })
      .from(schema.userSettings)
      .where(eq(enabledColumn, true))
      .limit(10000);

    this.logger.log(`Digest sweep (${period}): ${rows.length} user(s) enabled`);

    for (const { userId } of rows) {
      try {
        await this.deliver(userId, period);
      } catch (err) {
        this.logger.error(`Digest delivery failed for user ${userId}: ${(err as Error).message}`);
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────

  private async getUserSettings(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  private buildTitle(period: DigestPeriod): string {
    const labels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
    return `${labels[period]} Money Digest`;
  }

  private async buildDailySections(userId: string, timezone: string): Promise<DigestSection[]> {
    const localStr = new Date().toLocaleString('en-US', { timeZone: timezone });
    const d = new Date(localStr);
    const yesterday = new Date(d);
    yesterday.setDate(d.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const spendResult = await this.db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total
      FROM ${schema.transactions}
      WHERE user_id = ${userId}
        AND is_credit = false
        AND is_split_parent = false
        AND deleted_at IS NULL
        AND date = ${yStr}::date
    `);
    const spendCents = Number((spendResult.rows ?? spendResult)[0]?.total ?? 0);

    const accountRows = await this.db.execute(sql`
      SELECT a.nickname,
             a.starting_balance_cents
               + COALESCE(SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END), 0) AS balance_cents
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t
        ON t.account_id = a.id
        AND t.deleted_at IS NULL
        AND t.is_split_parent = false
      WHERE a.user_id = ${userId} AND a.deleted_at IS NULL
      GROUP BY a.id, a.nickname, a.starting_balance_cents
      ORDER BY balance_cents DESC
      LIMIT 3
    `);
    const accounts = (accountRows.rows ?? accountRows) as { nickname: string; balance_cents: number }[];

    const budgetResult = await this.db.execute(sql`
      SELECT c.name AS category_name,
             b.amount_cents AS budget_cents,
             COALESCE(SUM(t.amount_cents), 0) AS spent_cents
      FROM ${schema.budgets} b
      JOIN ${schema.categories} c ON b.category_id = c.id
      LEFT JOIN ${schema.transactions} t
        ON t.category_id = b.category_id
        AND t.user_id = b.user_id
        AND t.is_credit = false
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND date_trunc('month', t.date) = date_trunc('month', NOW())
      WHERE b.user_id = ${userId}
        AND b.deleted_at IS NULL
        AND b.period = 'monthly'
      GROUP BY b.id, c.name, b.amount_cents
      ORDER BY (COALESCE(SUM(t.amount_cents), 0)::float / NULLIF(b.amount_cents, 0)) DESC
      LIMIT 1
    `);
    const tightestBudget = (budgetResult.rows ?? budgetResult)[0] as
      | { category_name: string; budget_cents: number; spent_cents: number }
      | undefined;

    const sections: DigestSection[] = [
      { label: 'Yesterday\'s spending', value: formatDollars(spendCents) },
    ];

    if (accounts.length > 0) {
      sections.push({
        label: 'Account balances',
        value: accounts.map((a) => `${a.nickname}: ${formatDollars(a.balance_cents)}`).join(', '),
      });
    }

    if (tightestBudget) {
      const pct = tightestBudget.budget_cents > 0
        ? Math.round((tightestBudget.spent_cents / tightestBudget.budget_cents) * 100)
        : 0;
      sections.push({
        label: 'Tightest budget',
        value: `${tightestBudget.category_name}: ${pct}% of ${formatDollars(tightestBudget.budget_cents)}`,
      });
    }

    return sections;
  }

  private async buildWeeklyMonthlySections(
    userId: string,
    period: 'weekly' | 'monthly',
    timezone: string,
  ): Promise<DigestSection[]> {
    const localStr = new Date().toLocaleString('en-US', { timeZone: timezone });
    const d = new Date(localStr);
    const truncUnit = period === 'weekly' ? 'week' : 'month';

    const spendResult = await this.db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_expense,
             COALESCE(SUM(CASE WHEN is_credit = true THEN amount_cents ELSE 0 END), 0) AS total_income
      FROM ${schema.transactions}
      WHERE user_id = ${userId}
        AND is_split_parent = false
        AND deleted_at IS NULL
        AND date_trunc(${truncUnit}, date) = date_trunc(${truncUnit}, ${d.toISOString()}::timestamptz AT TIME ZONE ${timezone})
        AND is_credit = false
    `);
    const spendRow = (spendResult.rows ?? spendResult)[0] as { total_expense: number; total_income: number } | undefined;
    const totalExpense = Number(spendRow?.total_expense ?? 0);

    const catResult = await this.db.execute(sql`
      SELECT c.name AS category_name, SUM(t.amount_cents) AS total
      FROM ${schema.transactions} t
      JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.user_id = ${userId}
        AND t.is_credit = false
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND COALESCE(c.is_transfer, false) = false
        AND date_trunc(${truncUnit}, t.date) = date_trunc(${truncUnit}, ${d.toISOString()}::timestamptz AT TIME ZONE ${timezone})
      GROUP BY c.name
      ORDER BY total DESC
      LIMIT 3
    `);
    const topCats = (catResult.rows ?? catResult) as { category_name: string; total: number }[];

    const budgetResult = await this.db.execute(sql`
      SELECT c.name AS category_name,
             b.amount_cents AS budget_cents,
             COALESCE(SUM(t.amount_cents), 0) AS spent_cents
      FROM ${schema.budgets} b
      JOIN ${schema.categories} c ON b.category_id = c.id
      LEFT JOIN ${schema.transactions} t
        ON t.category_id = b.category_id
        AND t.user_id = b.user_id
        AND t.is_credit = false
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND date_trunc('month', t.date) = date_trunc('month', NOW())
      WHERE b.user_id = ${userId}
        AND b.deleted_at IS NULL
        AND b.period = 'monthly'
      GROUP BY b.id, c.name, b.amount_cents
      ORDER BY (COALESCE(SUM(t.amount_cents), 0)::float / NULLIF(b.amount_cents, 0)) DESC
      LIMIT 3
    `);
    const budgets = (budgetResult.rows ?? budgetResult) as {
      category_name: string;
      budget_cents: number;
      spent_cents: number;
    }[];

    const sections: DigestSection[] = [
      { label: `${period === 'weekly' ? 'This week\'s' : 'This month\'s'} spending`, value: formatDollars(totalExpense) },
    ];

    if (topCats.length > 0) {
      sections.push({
        label: 'Top categories',
        value: topCats.map((c) => `${c.category_name}: ${formatDollars(c.total)}`).join(', '),
      });
    }

    if (budgets.length > 0) {
      const budgetLines = budgets.map((b) => {
        const pct = b.budget_cents > 0 ? Math.round((b.spent_cents / b.budget_cents) * 100) : 0;
        return `${b.category_name} ${pct}%`;
      });
      sections.push({ label: 'Budget progress', value: budgetLines.join(', ') });
    }

    return sections;
  }

  private templateNarrative(
    period: DigestPeriod,
    sections: DigestSection[],
  ): { message: string; voiceSummary: string } {
    const lines = sections.map((s) => `${s.label}: ${s.value}`);
    const message = lines.join('. ') + '.';
    const first = sections[0];
    const voiceSummary = first
      ? `${first.label} is ${first.value}.${sections[1] ? ` ${sections[1].label}: ${sections[1].value}.` : ''}`
      : `Your ${period} digest is ready.`;
    return { message, voiceSummary };
  }

  private async generateNarrative(
    title: string,
    sections: DigestSection[],
  ): Promise<{ message: string; voiceSummary: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const prompt = `You are a concise personal finance assistant. Write a friendly financial digest.
Title: ${title}
Data:
${sections.map((s) => `- ${s.label}: ${s.value}`).join('\n')}

Return ONLY valid JSON with two fields:
{
  "message": "2-4 sentence friendly summary of the financial data for an in-app notification",
  "voiceSummary": "one concise sentence (under 20 words) for a voice assistant announcement"
}`;

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: { temperature: 0.2, num_predict: 300 },
        }),
      });

      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

      const data = (await response.json()) as { response: string };
      const raw = data.response ?? '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in Ollama response');

      const parsed = JSON.parse(match[0]) as { message?: string; voiceSummary?: string };
      if (!parsed.message || !parsed.voiceSummary) throw new Error('Missing fields in Ollama JSON');

      return { message: parsed.message, voiceSummary: parsed.voiceSummary };
    } finally {
      clearTimeout(timeout);
    }
  }
}
