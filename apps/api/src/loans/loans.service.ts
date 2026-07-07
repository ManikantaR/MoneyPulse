import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, asc, gte, lte, or, ilike } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import type { CreateLoanInput, UpdateLoanInput } from '@moneypulse/shared';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Most recent monthly payment date that is at least `graceDays` in the past, with the
 * day-of-month clamped to the month length. Returns null if that date is before the loan
 * started (loan hasn't reached its first due-date-plus-grace yet). UTC throughout so it
 * matches how loan start dates are stored (plain calendar dates).
 */
export function expectedCycleDate(startDate: string, now: Date, graceDays: number): Date | null {
  const start = new Date(startDate + 'T00:00:00Z');
  const dom = start.getUTCDate();
  const clamp = (y: number, m: number): Date => {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(dom, lastDay)));
  };
  let cycle = clamp(now.getUTCFullYear(), now.getUTCMonth());
  // If this month's due date hasn't cleared the grace period yet, check last month's.
  if ((now.getTime() - cycle.getTime()) / 86_400_000 < graceDays) {
    cycle = clamp(now.getUTCFullYear(), now.getUTCMonth() - 1);
  }
  return cycle < start ? null : cycle;
}

/** CRUD for tracked loans. Payoff math lives in the advisor's MCP tool (get_loan_status). */
@Injectable()
export class LoansService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.userId, userId), isNull(schema.loans.deletedAt)))
      .orderBy(asc(schema.loans.name));
  }

  async create(userId: string, input: CreateLoanInput) {
    const rows = await this.db
      .insert(schema.loans)
      .values({
        userId,
        name: input.name,
        lenderPattern: input.lenderPattern,
        loanType: input.loanType,
        originalBalanceCents: input.originalBalanceCents,
        aprBps: input.aprBps,
        termMonths: input.termMonths ?? null,
        startDate: input.startDate,
        scheduledPaymentCents: input.scheduledPaymentCents,
        extraPrincipalPattern: input.extraPrincipalPattern ?? null,
      })
      .returning();
    return rows[0];
  }

  async update(id: string, userId: string, input: UpdateLoanInput) {
    const existing = await this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.id, id), eq(schema.loans.userId, userId)))
      .limit(1);
    if (!existing[0] || existing[0].deletedAt) {
      throw new NotFoundException('Loan not found');
    }
    const rows = await this.db
      .update(schema.loans)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.loans.id, id))
      .returning();
    return rows[0];
  }

  async remove(id: string, userId: string) {
    const existing = await this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.id, id), eq(schema.loans.userId, userId)))
      .limit(1);
    if (!existing[0] || existing[0].deletedAt) {
      throw new NotFoundException('Loan not found');
    }
    await this.db
      .update(schema.loans)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(schema.loans.id, id));
    return { deleted: true };
  }

  /**
   * Detect loan payments that never showed up. For each active loan, find the most recent
   * monthly due date (past its grace period) and look for ANY matching debit for the lender
   * within a look-back window — amount is deliberately ignored because a loan may post as two
   * transactions (P+I and a separate principal), and the tracked payment may fold in extra
   * principal. If nothing matches, fire a deduped `loan_payment_missed` notification.
   *
   * Global sweep when `userId` is omitted (cron); scoped when provided (manual "Check now").
   */
  async checkMissedLoanPayments(
    userId?: string,
  ): Promise<{ checked: number; missed: number; notified: number }> {
    const GRACE_DAYS = 5; // mortgages/autos usually allow a few days
    const WINDOW_DAYS = 25; // look-back for a matching payment before the due date
    const now = new Date();

    const conditions = [
      eq(schema.loans.isActive, true),
      isNull(schema.loans.deletedAt),
    ];
    if (userId) conditions.push(eq(schema.loans.userId, userId));

    const loans = await this.db
      .select()
      .from(schema.loans)
      .where(and(...conditions));

    let missed = 0;
    let notified = 0;

    for (const loan of loans) {
      const cycle = expectedCycleDate(loan.startDate, now, GRACE_DAYS);
      if (!cycle) continue;

      const windowStart = new Date(cycle.getTime() - WINDOW_DAYS * 86_400_000);
      const pattern = `%${loan.lenderPattern}%`;

      const match = await this.db
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, loan.userId),
            isNull(schema.transactions.deletedAt),
            eq(schema.transactions.isCredit, false),
            gte(schema.transactions.date, windowStart),
            lte(schema.transactions.date, now),
            or(
              ilike(schema.transactions.normalizedMerchantName, pattern),
              ilike(schema.transactions.merchantName, pattern),
            ),
          ),
        )
        .limit(1);

      if (match.length > 0) continue;

      missed++;

      const cycleKey = cycle.toISOString().slice(0, 7); // YYYY-MM
      const dedupeKey = `loan_missed_${loan.id}_${cycleKey}`;
      if (await this.notificationsService.findByMetadata(loan.userId, dedupeKey)) {
        continue;
      }

      const monthLabel = cycle.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      const dueStr = cycle.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });

      await this.notificationsService.createAndDispatch({
        userId: loan.userId,
        type: 'loan_payment_missed',
        title: `Possible missed payment: ${loan.name}`,
        message: `No "${loan.lenderPattern}" payment found for ${monthLabel} (expected around ${dueStr}). If you already paid, it may just not have imported yet.`,
        dedupeKey,
        metadata: { loanId: loan.id },
      });
      notified++;
    }

    return { checked: loans.length, missed, notified };
  }
}
