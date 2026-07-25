import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, lt, gte, lte, or, asc } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  BillFrequency,
  UpdateBillInput,
  CreateBillInput,
  SubscriptionItem,
} from '@moneypulse/shared';

function annualCostCents(amountCents: number, frequency: BillFrequency): number {
  const multipliers: Record<BillFrequency, number> = {
    weekly: 52,
    biweekly: 26,
    monthly: 12,
    bimonthly: 6,
    quarterly: 4,
    semi_annual: 2,
    annual: 1,
  };
  return amountCents * multipliers[frequency];
}

// ── Helpers ──────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function classifyFrequency(medianDays: number): BillFrequency | null {
  if (medianDays >= 5 && medianDays <= 9) return 'weekly';
  if (medianDays >= 12 && medianDays <= 18) return 'biweekly';
  if (medianDays >= 25 && medianDays <= 35) return 'monthly';
  if (medianDays >= 50 && medianDays <= 70) return 'bimonthly';
  if (medianDays >= 80 && medianDays <= 100) return 'quarterly';
  if (medianDays >= 170 && medianDays <= 200) return 'semi_annual';
  if (medianDays >= 340 && medianDays <= 400) return 'annual';
  return null;
}

function addFrequency(date: Date, frequency: BillFrequency): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'bimonthly':
      d.setMonth(d.getMonth() + 2);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'semi_annual':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'annual':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

function windowDaysForFrequency(frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'bimonthly':
      return 20;
    case 'quarterly':
      return 30;
    case 'semi_annual':
      return 45;
    case 'annual':
      return 60;
    case 'monthly':
    default:
      return 15;
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Service ──────────────────────────────────────────────────

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Detection ────────────────────────────────────────────

  async detectRecurring(
    userId: string,
  ): Promise<{ detected: number; newBills: number; existingSkipped: number }> {
    // Fetch all expense, non-split, non-deleted transactions with a merchant name
    const txns = await this.db
      .select({
        date: schema.transactions.date,
        amountCents: schema.transactions.amountCents,
        normalizedMerchantName: schema.transactions.normalizedMerchantName,
        merchantName: schema.transactions.merchantName,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.deletedAt),
          eq(schema.transactions.isSplitParent, false),
          isNull(schema.transactions.parentTransactionId),
          eq(schema.transactions.isCredit, false),
        ),
      )
      .orderBy(asc(schema.transactions.date));

    // Group by canonical merchant key
    const groups = new Map<
      string,
      Array<{ date: Date; amountCents: number }>
    >();
    for (const txn of txns) {
      const key = txn.normalizedMerchantName ?? txn.merchantName;
      if (!key || key.trim() === '') continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ date: new Date(txn.date), amountCents: txn.amountCents });
    }

    let detected = 0;
    let newBills = 0;
    let existingUpdated = 0;

    for (const [merchantKey, occurrences] of groups) {
      occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Need at least 3 occurrences for reliable detection of short/medium
      // cadences, but for long cadences (semi-annual/annual) waiting for a
      // 3rd occurrence can mean waiting years. If we only have exactly 2
      // charges, still allow detection when the single gap between them
      // cleanly classifies as semi_annual or annual and the amounts
      // roughly match — otherwise require the usual 3+.
      let frequency: BillFrequency | null;
      if (occurrences.length === 2) {
        const [a, b] = occurrences;
        const days = Math.round((b.date.getTime() - a.date.getTime()) / 86_400_000);
        const freq = classifyFrequency(days);
        if (freq !== 'semi_annual' && freq !== 'annual') continue;
        const amountDelta =
          Math.abs(a.amountCents - b.amountCents) / Math.max(a.amountCents, b.amountCents);
        if (amountDelta > 0.2) continue;
        frequency = freq;
      } else if (occurrences.length < 3) {
        continue;
      } else {
        // Calculate day intervals
        const intervals: number[] = [];
        for (let i = 1; i < occurrences.length; i++) {
          const days = Math.round(
            (occurrences[i].date.getTime() - occurrences[i - 1].date.getTime()) /
              86_400_000,
          );
          intervals.push(days);
        }

        const med = median(intervals);
        if (med === 0) continue;

        // Require 80% of intervals within 20% of median
        const withinTolerance = intervals.filter(
          (d) => Math.abs(d - med) / med <= 0.2,
        );
        if (withinTolerance.length / intervals.length < 0.8) continue;

        frequency = classifyFrequency(med);
      }
      if (!frequency) continue;

      const last3 = occurrences.slice(-3);
      const expectedAmountCents = Math.round(
        last3.reduce((s, t) => s + t.amountCents, 0) / last3.length,
      );
      const lastOccurrence = occurrences[occurrences.length - 1];
      const nextExpectedDate = addFrequency(lastOccurrence.date, frequency);

      detected++;

      const existing = await this.db
        .select({
          id: schema.recurringBills.id,
          expectedAmountCents: schema.recurringBills.expectedAmountCents,
          amountTolerancePercent: schema.recurringBills.amountTolerancePercent,
        })
        .from(schema.recurringBills)
        .where(
          and(
            eq(schema.recurringBills.userId, userId),
            eq(schema.recurringBills.merchantPattern, merchantKey),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const prev = existing[0];
        const newLastAmount = lastOccurrence.amountCents;
        const upperBound = Math.ceil(
          prev.expectedAmountCents * (1 + prev.amountTolerancePercent / 100),
        );

        // Fire price-increase notification (deduped by bill id + new amount)
        if (newLastAmount > upperBound) {
          const dedupeKey = `subscription_price_increase_${prev.id}_${newLastAmount}`;
          const alreadySent = await this.notificationsService.findByMetadata(userId, dedupeKey);
          if (!alreadySent) {
            const oldFmt = `$${(prev.expectedAmountCents / 100).toFixed(2)}`;
            const newFmt = `$${(newLastAmount / 100).toFixed(2)}`;
            await this.notificationsService.createAndDispatch({
              userId,
              type: 'subscription_price_increase',
              title: `Price increase: ${merchantKey}`,
              message: `${merchantKey} charge rose from ${oldFmt} to ${newFmt}.`,
              dedupeKey,
              metadata: {
                billId: prev.id,
                oldAmountCents: prev.expectedAmountCents,
                newAmountCents: newLastAmount,
              },
            });
          }
        }

        await this.db
          .update(schema.recurringBills)
          .set({
            lastSeenDate: lastOccurrence.date,
            lastAmountCents: lastOccurrence.amountCents,
            expectedAmountCents,
            nextExpectedDate,
            normalizedName: merchantKey,
            frequency,
            updatedAt: new Date(),
          })
          .where(eq(schema.recurringBills.id, existing[0].id));
        existingUpdated++;
      } else {
        await this.db.insert(schema.recurringBills).values({
          userId,
          merchantPattern: merchantKey,
          normalizedName: merchantKey,
          expectedAmountCents,
          frequency,
          nextExpectedDate,
          lastSeenDate: lastOccurrence.date,
          lastAmountCents: lastOccurrence.amountCents,
        });
        newBills++;
      }
    }

    return { detected, newBills, existingSkipped: existingUpdated };
  }

  // ── Missed Bill Check ────────────────────────────────────

  async checkMissedBills(
    userId: string,
  ): Promise<{ missedCount: number; notified: number }> {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);

    const overdueBills = await this.db
      .select()
      .from(schema.recurringBills)
      .where(
        and(
          eq(schema.recurringBills.userId, userId),
          eq(schema.recurringBills.isActive, true),
          eq(schema.recurringBills.isConfirmed, true),
          lt(schema.recurringBills.nextExpectedDate, threeDaysAgo),
        ),
      );

    let missedCount = 0;
    let notified = 0;

    for (const bill of overdueBills) {
      if (!bill.nextExpectedDate) continue;

      const windowDays = windowDaysForFrequency(bill.frequency);
      const windowStart = new Date(
        new Date(bill.nextExpectedDate).getTime() - windowDays * 86_400_000,
      );

      const minAmount = Math.floor(
        bill.expectedAmountCents * (1 - bill.amountTolerancePercent / 100),
      );
      const maxAmount = Math.ceil(
        bill.expectedAmountCents * (1 + bill.amountTolerancePercent / 100),
      );

      const matchingTxns = await this.db
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, userId),
            isNull(schema.transactions.deletedAt),
            eq(schema.transactions.isCredit, false),
            gte(schema.transactions.date, windowStart),
            gte(schema.transactions.amountCents, minAmount),
            lte(schema.transactions.amountCents, maxAmount),
            or(
              eq(
                schema.transactions.normalizedMerchantName,
                bill.merchantPattern,
              ),
              eq(schema.transactions.merchantName, bill.merchantPattern),
            ),
          ),
        )
        .limit(1);

      if (matchingTxns.length > 0) continue;

      missedCount++;

      const dateKey = new Date(bill.nextExpectedDate)
        .toISOString()
        .slice(0, 10);
      const dedupeKey = `bill_overdue_${bill.id}_${dateKey}`;

      const alreadyNotified = await this.notificationsService.findByMetadata(
        userId,
        dedupeKey,
      );
      if (alreadyNotified) continue;

      const amountStr = formatCents(bill.expectedAmountCents);
      const dateStr = new Date(bill.nextExpectedDate).toLocaleDateString(
        'en-US',
        { month: 'short', day: 'numeric' },
      );

      await this.notificationsService.createAndDispatch({
        userId,
        type: 'bill_overdue',
        title: `Missed bill: ${bill.normalizedName}`,
        message: `Expected ${amountStr} around ${dateStr}. No matching transaction found.`,
        dedupeKey,
        metadata: { billId: bill.id },
      });

      notified++;
    }

    return { missedCount, notified };
  }

  // ── Roll forward overdue bills ───────────────────────────

  /**
   * Advance every active bill whose next_expected_date is in the past to its next
   * FUTURE occurrence (by frequency). Without this the date never moves once a period
   * passes, so "upcoming bills" and the cash-flow forecast go permanently empty (#84).
   * Global sweep (all users); idempotent — future-dated bills are untouched.
   */
  async rollForwardOverdueBills(): Promise<{ rolled: number }> {
    const now = new Date();
    const overdue = await this.db
      .select()
      .from(schema.recurringBills)
      .where(
        and(
          eq(schema.recurringBills.isActive, true),
          lt(schema.recurringBills.nextExpectedDate, now),
        ),
      );

    let rolled = 0;
    for (const bill of overdue) {
      if (!bill.nextExpectedDate) continue;
      const original = new Date(bill.nextExpectedDate).getTime();
      let next = new Date(bill.nextExpectedDate);
      // Advance until future; guard against a no-op/unknown frequency.
      for (let i = 0; i < 600 && next <= now; i++) {
        const advanced = addFrequency(next, bill.frequency as BillFrequency);
        if (advanced.getTime() === next.getTime()) break;
        next = advanced;
      }
      if (next.getTime() !== original && next > now) {
        await this.db
          .update(schema.recurringBills)
          .set({ nextExpectedDate: next, updatedAt: new Date() })
          .where(eq(schema.recurringBills.id, bill.id));
        rolled++;
      }
    }

    if (rolled > 0) this.logger.log(`Rolled ${rolled} overdue bill(s) forward`);
    return { rolled };
  }

  // ── CRUD ─────────────────────────────────────────────────

  /**
   * Manually declare a recurring bill/subscription. Lets a user register a
   * known subscription (e.g. an annual renewal) immediately instead of
   * waiting for it to accumulate enough transaction history to be
   * auto-detected. Behaves identically to a detected bill afterward
   * (edit/deactivate/delete/merge all operate on the same table/rows).
   */
  async create(userId: string, input: CreateBillInput) {
    const merchantPattern = input.normalizedName.trim();
    if (!merchantPattern) {
      throw new ConflictException('Bill name cannot be empty');
    }

    const existing = await this.db
      .select({ id: schema.recurringBills.id })
      .from(schema.recurringBills)
      .where(
        and(
          eq(schema.recurringBills.userId, userId),
          eq(schema.recurringBills.merchantPattern, merchantPattern),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException(
        `A bill named "${merchantPattern}" already exists`,
      );
    }

    const now = new Date();
    const nextExpectedDate = addFrequency(now, input.frequency);

    const [created] = await this.db
      .insert(schema.recurringBills)
      .values({
        userId,
        merchantPattern,
        normalizedName: merchantPattern,
        categoryId: input.categoryId ?? null,
        expectedAmountCents: input.expectedAmountCents,
        amountTolerancePercent: input.amountTolerancePercent ?? 15,
        frequency: input.frequency,
        nextExpectedDate,
        lastSeenDate: null,
        lastAmountCents: null,
        // A manually declared bill is, by definition, user-confirmed —
        // it should immediately participate in upcoming/missed-bill alerts.
        isConfirmed: true,
        isActive: true,
      })
      .returning();

    return created;
  }

  async findAll(userId: string) {
    return this.db
      .select()
      .from(schema.recurringBills)
      .where(eq(schema.recurringBills.userId, userId))
      .orderBy(asc(schema.recurringBills.nextExpectedDate));
  }

  async confirm(id: string, userId: string) {
    const bill = await this.findOwned(id, userId);
    const [updated] = await this.db
      .update(schema.recurringBills)
      .set({ isConfirmed: true, updatedAt: new Date() })
      .where(eq(schema.recurringBills.id, bill.id))
      .returning();
    return updated;
  }

  async deactivate(id: string, userId: string) {
    const bill = await this.findOwned(id, userId);
    const [updated] = await this.db
      .update(schema.recurringBills)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.recurringBills.id, bill.id))
      .returning();
    return updated;
  }

  async update(id: string, userId: string, input: UpdateBillInput) {
    const bill = await this.findOwned(id, userId);
    const [updated] = await this.db
      .update(schema.recurringBills)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.recurringBills.id, bill.id))
      .returning();
    return updated;
  }

  async delete(id: string, userId: string) {
    await this.findOwned(id, userId);
    await this.db
      .delete(schema.recurringBills)
      .where(eq(schema.recurringBills.id, id));
  }

  // ── Upcoming (for dashboard widget) ──────────────────────

  async findUpcoming(userId: string, withinDays = 7): Promise<typeof schema.recurringBills.$inferSelect[]> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + withinDays * 86_400_000);

    return this.db
      .select()
      .from(schema.recurringBills)
      .where(
        and(
          eq(schema.recurringBills.userId, userId),
          eq(schema.recurringBills.isActive, true),
          eq(schema.recurringBills.isConfirmed, true),
          lte(schema.recurringBills.nextExpectedDate, cutoff),
        ),
      )
      .orderBy(asc(schema.recurringBills.nextExpectedDate))
      .limit(5);
  }

  // ── Subscriptions (derived projection) ───────────────────

  /**
   * Returns active, confirmed recurring bills projected as subscriptions.
   * Computes annualized cost and flags price increases.
   * Read-only — no side effects.
   */
  async getSubscriptions(userId: string): Promise<SubscriptionItem[]> {
    const bills = await this.db
      .select()
      .from(schema.recurringBills)
      .where(
        and(
          eq(schema.recurringBills.userId, userId),
          eq(schema.recurringBills.isActive, true),
        ),
      )
      .orderBy(asc(schema.recurringBills.normalizedName));

    return (bills as any[]).map((bill) => {
      const upperBound = Math.ceil(
        bill.expectedAmountCents * (1 + bill.amountTolerancePercent / 100),
      );
      const priceIncreased =
        bill.lastAmountCents !== null && bill.lastAmountCents > upperBound;

      return {
        id: bill.id,
        name: bill.normalizedName ?? bill.merchantPattern,
        amountCents: bill.expectedAmountCents,
        frequency: bill.frequency as BillFrequency,
        annualCostCents: annualCostCents(bill.expectedAmountCents, bill.frequency as BillFrequency),
        lastAmountCents: bill.lastAmountCents,
        priceIncreased,
        categoryId: bill.categoryId,
        nextExpectedDate: bill.nextExpectedDate ? bill.nextExpectedDate.toISOString() : null,
      };
    });
  }

  // ── Deduplicate ───────────────────────────────────────────

  /**
   * Merge duplicate bills that share the same normalizedName (case-insensitive).
   * After re-normalization, previously distinct merchantPatterns may collapse to the same name.
   * Survivor selection: confirmed > active > latest updatedAt.
   * Merges lastSeenDate and lastAmountCents from the most recent duplicate into the survivor.
   * Idempotent — safe to run multiple times.
   */
  async deduplicateBills(userId: string): Promise<{ deduped: number; removed: number }> {
    const allBills = await this.db
      .select()
      .from(schema.recurringBills)
      .where(eq(schema.recurringBills.userId, userId));

    // Group by normalizedName (lowercased)
    type Bill = (typeof allBills)[number];
    const byName = new Map<string, Bill[]>();
    for (const bill of allBills) {
      const key = (bill.normalizedName ?? '').toLowerCase().trim();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(bill);
    }

    let deduped = 0;
    let removed = 0;

    for (const [, group] of byName) {
      if (group.length <= 1) continue;

      // Sort by survivor priority: confirmed first, then active, then latest updatedAt
      group.sort((a, b) => {
        if (a.isConfirmed !== b.isConfirmed) return a.isConfirmed ? -1 : 1;
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });

      const survivor = group[0];
      const duplicates = group.slice(1);

      // Find the most recent lastSeenDate and corresponding amount across all group members
      let mostRecentSeen = survivor.lastSeenDate ? new Date(survivor.lastSeenDate) : null;
      let mostRecentAmount = survivor.lastAmountCents;

      for (const dup of duplicates) {
        if (dup.lastSeenDate) {
          const dupDate = new Date(dup.lastSeenDate);
          if (!mostRecentSeen || dupDate > mostRecentSeen) {
            mostRecentSeen = dupDate;
            mostRecentAmount = dup.lastAmountCents;
          }
        }
      }

      // Merge freshest detection data into survivor
      await this.db
        .update(schema.recurringBills)
        .set({
          lastSeenDate: mostRecentSeen ?? survivor.lastSeenDate,
          lastAmountCents: mostRecentAmount ?? survivor.lastAmountCents,
          updatedAt: new Date(),
        })
        .where(eq(schema.recurringBills.id, survivor.id));

      // Deactivate duplicates (soft-disable, not hard-delete to preserve history)
      for (const dup of duplicates) {
        await this.db
          .update(schema.recurringBills)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.recurringBills.id, dup.id));
        removed++;
      }

      deduped++;
      this.logger.log(
        `Deduped bills for "${survivor.normalizedName}": kept ${survivor.id}, deactivated ${duplicates.length} duplicate(s)`,
      );
    }

    return { deduped, removed };
  }

  /**
   * Re-detect recurring bills and deduplicate any variants that collapsed under the
   * same normalizedName after merchant re-normalization.
   */
  async redetectAndDedupe(userId: string): Promise<{
    detected: number;
    newBills: number;
    existingSkipped: number;
    deduped: number;
    removed: number;
  }> {
    const detectResult = await this.detectRecurring(userId);
    const dedupeResult = await this.deduplicateBills(userId);
    return { ...detectResult, ...dedupeResult };
  }

  // ── Private ───────────────────────────────────────────────

  private async findOwned(id: string, userId: string) {
    const rows = await this.db
      .select()
      .from(schema.recurringBills)
      .where(
        and(
          eq(schema.recurringBills.id, id),
          eq(schema.recurringBills.userId, userId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Recurring bill ${id} not found`);
    }
    return rows[0];
  }
}
