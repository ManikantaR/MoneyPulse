import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';

/** Import Pipeline Radar Phase 4 — "forgot to download" notification type. */
export const STATEMENT_OVERDUE_NOTIFICATION_TYPE = 'statement_overdue';

const MIN_IMPORTS_TO_LEARN = 3;
const DEFAULT_GRACE_DAYS = 5;

export type StatementCadence = 'monthly' | 'weekly' | 'biweekly' | 'custom';
export type StatementScheduleSource = 'learned' | 'manual';

export interface StatementScheduleRow {
  id: string;
  accountId: string;
  cadence: StatementCadence;
  expectedDayOfMonth: number | null;
  cadenceDays: number | null;
  graceDays: number;
  lastSatisfiedAt: Date | null;
  snoozedUntil: Date | null;
  source: StatementScheduleSource;
  enabled: boolean;
}

interface SatisfyingImport {
  createdAt: Date;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best = nums[0];
  let bestCount = 0;
  for (const [n, count] of counts) {
    if (count > bestCount) {
      best = n;
      bestCount = count;
    }
  }
  return best;
}

/** Advances `expectedDayOfMonth`'s next occurrence strictly after `from`. */
function nextMonthlyOccurrence(from: Date, expectedDayOfMonth: number): Date {
  const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), expectedDayOfMonth));
  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return candidate;
}

export interface OverdueAccount {
  accountId: string;
  nickname: string;
  daysOverdue: number;
}

export type CoverageCellStatus = 'received' | 'late' | 'empty' | 'missing' | 'due' | 'na';

export interface CoverageCell {
  /** First day of the month, e.g. "2026-03" */
  month: string;
  status: CoverageCellStatus;
  uploadId: string | null;
}

export interface AccountCoverage {
  accountId: string;
  nickname: string;
  lastFour: string;
  cells: CoverageCell[];
}

interface MonthUploadRow {
  id: string;
  status: string;
  rows_imported: number;
  created_at: string | Date;
}

@Injectable()
export class StatementScheduleService {
  private readonly logger = new Logger(StatementScheduleService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getSatisfyingImports(accountId: string): Promise<SatisfyingImport[]> {
    const rows = await this.db.execute(sql`
      SELECT created_at
      FROM file_uploads
      WHERE account_id = ${accountId}
        AND status = 'completed'
        AND rows_imported > 0
      ORDER BY created_at ASC
    `);
    return (rows.rows ?? rows).map((r: { created_at: string | Date }) => ({
      createdAt: new Date(r.created_at),
    }));
  }

  async getSchedule(accountId: string): Promise<StatementScheduleRow | null> {
    const rows = await this.db.execute(sql`
      SELECT * FROM statement_schedule WHERE account_id = ${accountId} LIMIT 1
    `);
    const row = (rows.rows ?? rows)[0];
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: any): StatementScheduleRow {
    return {
      id: row.id,
      accountId: row.account_id,
      cadence: row.cadence,
      expectedDayOfMonth: row.expected_day_of_month,
      cadenceDays: row.cadence_days,
      graceDays: row.grace_days,
      lastSatisfiedAt: row.last_satisfied_at ? new Date(row.last_satisfied_at) : null,
      snoozedUntil: row.snoozed_until ? new Date(row.snoozed_until) : null,
      source: row.source,
      enabled: row.enabled,
    };
  }

  /**
   * (Re)learns cadence for a single account from its history of satisfying imports.
   * Never overwrites a user's manual setting — a 'manual' schedule is left untouched
   * except that this method still won't be able to relearn it into 'learned'.
   */
  async learnAccount(accountId: string): Promise<void> {
    const existing = await this.getSchedule(accountId);
    if (existing?.source === 'manual') {
      return; // never overwrite a user's manual setting
    }

    const imports = await this.getSatisfyingImports(accountId);
    if (imports.length < MIN_IMPORTS_TO_LEARN) {
      // Not enough data to learn confidently — leave disabled rather than guess.
      if (existing) {
        await this.db.execute(sql`
          UPDATE statement_schedule SET enabled = false, updated_at = now()
          WHERE account_id = ${accountId} AND source = 'learned'
        `);
      }
      return;
    }

    const gaps: number[] = [];
    for (let i = 1; i < imports.length; i++) {
      gaps.push(daysBetween(imports[i - 1].createdAt, imports[i].createdAt));
    }
    const medianGap = median(gaps);

    let cadence: StatementCadence;
    let expectedDayOfMonth: number | null = null;
    let cadenceDays: number | null = null;

    if (medianGap >= 27 && medianGap <= 32) {
      cadence = 'monthly';
      expectedDayOfMonth = mode(imports.map((i) => i.createdAt.getUTCDate()));
    } else if (medianGap >= 6 && medianGap <= 8) {
      cadence = 'weekly';
      cadenceDays = 7;
    } else if (medianGap >= 13 && medianGap <= 15) {
      cadence = 'biweekly';
      cadenceDays = 14;
    } else {
      cadence = 'custom';
      cadenceDays = Math.max(1, Math.round(medianGap));
    }

    const lastSatisfiedAt = imports[imports.length - 1].createdAt;
    const graceDays = existing?.graceDays ?? DEFAULT_GRACE_DAYS;

    await this.db.execute(sql`
      INSERT INTO statement_schedule
        (account_id, cadence, expected_day_of_month, cadence_days, grace_days, last_satisfied_at, source, enabled, updated_at)
      VALUES
        (${accountId}, ${cadence}, ${expectedDayOfMonth}, ${cadenceDays}, ${graceDays}, ${lastSatisfiedAt}, 'learned', true, now())
      ON CONFLICT (account_id) DO UPDATE SET
        cadence = EXCLUDED.cadence,
        expected_day_of_month = EXCLUDED.expected_day_of_month,
        cadence_days = EXCLUDED.cadence_days,
        last_satisfied_at = EXCLUDED.last_satisfied_at,
        enabled = true,
        updated_at = now()
      WHERE statement_schedule.source != 'manual'
    `);
  }

  async learnAllAccounts(): Promise<void> {
    const rows = await this.db.execute(sql`SELECT DISTINCT account_id FROM file_uploads WHERE account_id IS NOT NULL`);
    const accountIds = (rows.rows ?? rows).map((r: { account_id: string }) => r.account_id);
    for (const accountId of accountIds) {
      try {
        await this.learnAccount(accountId);
      } catch (err) {
        this.logger.warn(`Failed to learn schedule for account ${accountId}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Auto-resolve hook: refreshes `lastSatisfiedAt` from the latest satisfying import,
   * regardless of source (manual or learned), without touching cadence/other manual
   * fields. Called before overdue evaluation so a newly-landed import silently clears
   * the account from the overdue set.
   */
  async refreshLastSatisfiedAt(accountId: string): Promise<void> {
    const imports = await this.getSatisfyingImports(accountId);
    if (imports.length === 0) return;
    const lastSatisfiedAt = imports[imports.length - 1].createdAt;
    await this.db.execute(sql`
      UPDATE statement_schedule SET last_satisfied_at = ${lastSatisfiedAt}, updated_at = now()
      WHERE account_id = ${accountId}
    `);
  }

  async upsertManual(
    accountId: string,
    input: {
      cadence: StatementCadence;
      expectedDayOfMonth?: number | null;
      cadenceDays?: number | null;
      graceDays?: number;
      enabled?: boolean;
    },
  ): Promise<StatementScheduleRow> {
    const graceDays = input.graceDays ?? DEFAULT_GRACE_DAYS;
    const enabled = input.enabled ?? true;
    await this.db.execute(sql`
      INSERT INTO statement_schedule
        (account_id, cadence, expected_day_of_month, cadence_days, grace_days, source, enabled, updated_at)
      VALUES
        (${accountId}, ${input.cadence}, ${input.expectedDayOfMonth ?? null}, ${input.cadenceDays ?? null}, ${graceDays}, 'manual', ${enabled}, now())
      ON CONFLICT (account_id) DO UPDATE SET
        cadence = EXCLUDED.cadence,
        expected_day_of_month = EXCLUDED.expected_day_of_month,
        cadence_days = EXCLUDED.cadence_days,
        grace_days = EXCLUDED.grace_days,
        source = 'manual',
        enabled = EXCLUDED.enabled,
        updated_at = now()
    `);
    const schedule = await this.getSchedule(accountId);
    return schedule!;
  }

  async snooze(accountId: string, days: number): Promise<StatementScheduleRow | null> {
    const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.db.execute(sql`
      UPDATE statement_schedule SET snoozed_until = ${snoozedUntil}, updated_at = now()
      WHERE account_id = ${accountId}
    `);
    return this.getSchedule(accountId);
  }

  private computeExpectedDate(schedule: StatementScheduleRow): Date | null {
    if (!schedule.lastSatisfiedAt) return null;
    if (schedule.cadence === 'monthly' && schedule.expectedDayOfMonth) {
      return nextMonthlyOccurrence(schedule.lastSatisfiedAt, schedule.expectedDayOfMonth);
    }
    if (schedule.cadenceDays) {
      return new Date(schedule.lastSatisfiedAt.getTime() + schedule.cadenceDays * 24 * 60 * 60 * 1000);
    }
    return null;
  }

  /** Returns overdue accounts (past expected + grace) for every enabled, non-snoozed schedule of a user. */
  async getOverdueAccountsForUser(userId: string): Promise<OverdueAccount[]> {
    const rows = await this.db.execute(sql`
      SELECT ss.*, a.nickname AS account_nickname
      FROM statement_schedule ss
      JOIN accounts a ON a.id = ss.account_id
      WHERE a.user_id = ${userId}
        AND a.deleted_at IS NULL
        AND ss.enabled = true
    `);

    const now = new Date();
    const overdue: OverdueAccount[] = [];

    for (const row of rows.rows ?? rows) {
      const schedule = this.mapRow(row);
      if (schedule.snoozedUntil && schedule.snoozedUntil > now) continue;

      const expected = this.computeExpectedDate(schedule);
      if (!expected) continue;

      const overdueSince = new Date(expected.getTime() + schedule.graceDays * 24 * 60 * 60 * 1000);
      if (now <= overdueSince) continue;

      overdue.push({
        accountId: schedule.accountId,
        nickname: row.account_nickname,
        daysOverdue: daysBetween(overdueSince, now),
      });
    }

    return overdue;
  }

  /** Daily sweep entry point — refreshes lastSatisfiedAt (auto-resolve) then alerts. */
  async checkAndAlertAllUsers(): Promise<void> {
    const scheduleRows = await this.db.execute(sql`SELECT account_id FROM statement_schedule`);
    for (const row of scheduleRows.rows ?? scheduleRows) {
      try {
        await this.refreshLastSatisfiedAt(row.account_id);
      } catch (err) {
        this.logger.warn(`Failed to refresh lastSatisfiedAt for account ${row.account_id}: ${(err as Error).message}`);
      }
    }

    const userRows = await this.db.execute(sql`SELECT DISTINCT user_id FROM accounts WHERE deleted_at IS NULL`);
    for (const userRow of userRows.rows ?? userRows) {
      try {
        await this.checkAndAlertUser(userRow.user_id);
      } catch (err) {
        this.logger.warn(`Statement-overdue sweep failed for user ${userRow.user_id}: ${(err as Error).message}`);
      }
    }
  }

  async checkAndAlertUser(userId: string): Promise<void> {
    const overdue = await this.getOverdueAccountsForUser(userId);
    if (overdue.length === 0) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    const dedupeKey = `statement_overdue_${userId}_${todayStr}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) {
      return; // already alerted today
    }

    const maxDaysOverdue = Math.max(...overdue.map((o) => o.daysOverdue));
    const severity: 'info' | 'warning' | 'critical' =
      maxDaysOverdue <= 3 ? 'info' : maxDaysOverdue <= 7 ? 'warning' : 'critical';

    const listPhrase = overdue
      .map((o) => `${o.nickname} (${o.daysOverdue} day${o.daysOverdue === 1 ? '' : 's'})`)
      .join(', ');
    const title = `${overdue.length} statement${overdue.length === 1 ? '' : 's'} overdue: ${listPhrase}`;
    const message = `We haven't seen an import for ${overdue.length === 1 ? 'this account' : 'these accounts'} on the expected schedule: ${listPhrase}. Check whether the statement is available and download/import it.`;
    const voiceSummary = `Heads up, ${overdue.length} statement${overdue.length === 1 ? ' is' : 's are'} overdue: ${listPhrase}.`;

    await this.notificationsService.createAndDispatch({
      userId,
      type: STATEMENT_OVERDUE_NOTIFICATION_TYPE,
      source: 'freshness',
      severity,
      title,
      message,
      voiceSummary,
      dedupeKey,
      metadata: {
        dedupeKey,
        maxDaysOverdue,
        escalation: maxDaysOverdue <= 3 ? 'soft' : maxDaysOverdue <= 7 ? 'firm' : 'urgent',
        accounts: overdue,
      },
    });
  }

  /**
   * Import Pipeline Radar Phase 3 — per-account, per-month coverage grid.
   * Reuses this service's `expected date` derivation (cadence/expectedDayOfMonth/
   * cadenceDays/graceDays) rather than re-deriving it, applied per calendar month
   * instead of only "next occurrence from lastSatisfiedAt".
   */
  async getCoverageForAccount(
    accountId: string,
    nickname: string,
    lastFour: string,
    months: number,
  ): Promise<AccountCoverage> {
    const schedule = await this.getSchedule(accountId);
    const now = new Date();

    // Oldest -> newest, `months` calendar months ending with the current month.
    const monthStarts: Date[] = [];
    for (let i = months - 1; i >= 0; i--) {
      monthStarts.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    }
    const earliest = monthStarts[0];

    const rows = await this.db.execute(sql`
      SELECT id, status, rows_imported, created_at
      FROM file_uploads
      WHERE account_id = ${accountId}
        AND created_at >= ${earliest}
      ORDER BY created_at ASC
    `);
    const uploads: MonthUploadRow[] = rows.rows ?? rows;

    const cells: CoverageCell[] = monthStarts.map((monthStart) => {
      const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
      const inMonth = uploads.filter((u) => {
        const t = new Date(u.created_at).getTime();
        return t >= monthStart.getTime() && t < monthEnd.getTime();
      });

      const received = inMonth.find((u) => u.status === 'completed' && u.rows_imported > 0);
      const emptyUpload = inMonth.find((u) => u.status === 'completed' && u.rows_imported === 0);

      let expectedDate: Date | null = null;
      let graceDeadline: Date | null = null;
      if (schedule?.enabled) {
        if (schedule.cadence === 'monthly' && schedule.expectedDayOfMonth) {
          expectedDate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), schedule.expectedDayOfMonth));
        } else if (schedule.cadenceDays) {
          // Approximate a due date within the month for non-monthly cadences.
          expectedDate = new Date(monthStart.getTime() + schedule.cadenceDays * 24 * 60 * 60 * 1000);
        }
        if (expectedDate) {
          graceDeadline = new Date(expectedDate.getTime() + schedule.graceDays * 24 * 60 * 60 * 1000);
        }
      }

      if (received) {
        const isLate = graceDeadline ? new Date(received.created_at).getTime() > graceDeadline.getTime() : false;
        return { month: monthKey, status: isLate ? 'late' : 'received', uploadId: received.id };
      }
      if (emptyUpload) {
        return { month: monthKey, status: 'empty', uploadId: emptyUpload.id };
      }
      if (!schedule?.enabled || !graceDeadline) {
        return { month: monthKey, status: 'na', uploadId: null };
      }
      if (now.getTime() > graceDeadline.getTime()) {
        return { month: monthKey, status: 'missing', uploadId: null };
      }
      if (now.getTime() >= expectedDate!.getTime()) {
        return { month: monthKey, status: 'due', uploadId: null };
      }
      return { month: monthKey, status: 'na', uploadId: null };
    });

    return { accountId, nickname, lastFour, cells };
  }
}
