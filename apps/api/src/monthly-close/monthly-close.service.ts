import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import {
  calculateMonthlyClose,
  MonthlyCloseCalculatorInput,
  MonthlyCloseTransactionLine,
} from './monthly-close-calculator';
import { ManualAssetsService } from './manual-assets.service';
import { InvestmentsService } from '../investments/investments.service';
import { LoansService } from '../loans/loans.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { PatchMonthlyCloseInput } from '@moneypulse/shared';

const PAY_PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semi_monthly: 24,
  monthly: 12,
};

/** Nudge rate-limit (epic #158 decision #3): at most one freshness nudge per user
 *  every 2 calendar months. */
export const FRESHNESS_NUDGE_COOLDOWN_MONTHS = 2;
const FRESHNESS_NUDGE_NOTIFICATION_TYPE = 'monthly_close_freshness_nudge';

/** How many months of history to attempt to backfill on first run (decision #11).
 *  Bounded so a very old account doesn't trigger an unbounded loop of empty closes. */
const MAX_BACKFILL_MONTHS = 24;

function toMonthStart(month: string): string {
  // Accept either 'YYYY-MM' or 'YYYY-MM-01' and normalize to the first-of-month date
  // the schema/unique index expects.
  const [y, m] = month.split('-');
  return `${y}-${m}-01`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = toMonthStart(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function endOfMonth(month: string): string {
  const [y, m] = toMonthStart(month).split('-').map(Number);
  // Day 0 of next month == last day of this month.
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = toMonthStart(a).split('-').map(Number);
  const [by, bm] = toMonthStart(b).split('-').map(Number);
  return (ay - by) * 12 + (am - bm);
}

export interface DraftResult {
  snapshot: any;
  freshnessNudgeSent: boolean;
}

/**
 * 13.5 — wires the 13.2 pure calculator to real data and owns the monthly-close
 * lifecycle (draft/recalculate/confirm/reopen/edit/list). User-scoped only, no
 * household plumbing (epic #158 decision #5).
 */
@Injectable()
export class MonthlyCloseService {
  private readonly logger = new Logger(MonthlyCloseService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly manualAssetsService: ManualAssetsService,
    private readonly investmentsService: InvestmentsService,
    private readonly loansService: LoansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────

  async findAll(userId: string, months: number) {
    const rows = await this.db
      .select()
      .from(schema.monthlyFinancialSnapshots)
      .where(eq(schema.monthlyFinancialSnapshots.userId, userId))
      .orderBy(desc(schema.monthlyFinancialSnapshots.snapshotMonth))
      .limit(Math.max(1, Math.min(months, 60)));
    return rows;
  }

  async findOne(userId: string, month: string) {
    const snapshotMonth = toMonthStart(month);
    const rows = await this.db
      .select()
      .from(schema.monthlyFinancialSnapshots)
      .where(
        and(
          eq(schema.monthlyFinancialSnapshots.userId, userId),
          eq(schema.monthlyFinancialSnapshots.snapshotMonth, snapshotMonth),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Monthly close not found');
    return rows[0];
  }

  private async findRow(userId: string, snapshotMonth: string) {
    const rows = await this.db
      .select()
      .from(schema.monthlyFinancialSnapshots)
      .where(
        and(
          eq(schema.monthlyFinancialSnapshots.userId, userId),
          eq(schema.monthlyFinancialSnapshots.snapshotMonth, snapshotMonth),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // ── Input gathering ────────────────────────────────────────

  /**
   * Assembles one month's calculator input from real data: paycheck-profile net
   * (decision #1), month transactions (joined to category bucket/isTransfer, and
   * flagged for debt-principal exclusion via each active loan's lender/extra-principal
   * merchant patterns), month-end account balances, holdings-else-snapshot investment
   * pricing (decision #2), manual-asset carry-forward (decision #3), and
   * statement-wins loan balances.
   */
  async gatherInputs(userId: string, month: string): Promise<MonthlyCloseCalculatorInput> {
    const snapshotMonth = toMonthStart(month);
    const firstDay = snapshotMonth;
    const lastDay = endOfMonth(snapshotMonth);
    const nextMonthFirstDay = addMonths(snapshotMonth, 1);
    const prevMonth = addMonths(snapshotMonth, -1);

    // ── Paycheck profile: most recent effective as of month-end, monthly-scaled. ──
    const profileRows = await this.db
      .select()
      .from(schema.paycheckProfiles)
      .where(
        and(
          eq(schema.paycheckProfiles.userId, userId),
          isNull(schema.paycheckProfiles.deletedAt),
          lte(schema.paycheckProfiles.effectiveDate, lastDay),
        ),
      )
      .orderBy(desc(schema.paycheckProfiles.effectiveDate))
      .limit(1);
    const profile = profileRows[0];
    const payPeriodsPerYear = profile ? (PAY_PERIODS_PER_YEAR[profile.payFrequency] ?? 12) : 12;
    const scale = payPeriodsPerYear / 12;
    const monthlyGrossCents = profile ? Math.round(profile.grossPayCents * scale) : 0;
    const monthlyDeductionsCents = profile
      ? Math.round(
          (profile.federalTaxCents +
            profile.stateTaxCents +
            profile.socialSecurityCents +
            profile.medicareCents +
            profile.pretax401kCents +
            profile.hsaCents +
            profile.medicalPremiumCents +
            profile.dentalPremiumCents +
            profile.visionPremiumCents +
            profile.commuterCents +
            profile.parkingCents +
            profile.otherPretaxCents +
            profile.supplementalLifeCents +
            profile.legalCents +
            profile.accidentInsuranceCents +
            profile.otherPosttaxCents +
            profile.esppContributionCents) *
            scale,
        )
      : 0;
    const takeHomeIncomeCents = profile ? Math.max(0, monthlyGrossCents - monthlyDeductionsCents) : 0;
    const monthly401kHsaCents = profile
      ? Math.round((profile.pretax401kCents + profile.hsaCents) * scale)
      : 0;

    // ── Active loans: statement-wins balance + lender/extra-principal patterns for
    // classifying transaction lines as debt-principal (excluded from expenses). ──
    const loanRows = await this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.userId, userId), isNull(schema.loans.deletedAt), eq(schema.loans.isActive, true)));

    const debtPatterns: string[] = [];
    let loanLiabilityCents = 0;
    let requiredMonthlyDebtPaymentCents = 0;
    let debtPrincipalPaidCents = 0;
    const unverifiedLoans: string[] = [];
    for (const loan of loanRows) {
      debtPatterns.push(loan.lenderPattern.toLowerCase());
      if (loan.extraPrincipalPattern) debtPatterns.push(loan.extraPrincipalPattern.toLowerCase());
      requiredMonthlyDebtPaymentCents += loan.scheduledPaymentCents;

      const current = await this.loansService.getBalanceForMonth(loan.id, userId, snapshotMonth);
      const prior = await this.loansService.getBalanceForMonth(loan.id, userId, prevMonth);
      loanLiabilityCents += current.balanceCents;
      debtPrincipalPaidCents += Math.max(0, prior.balanceCents - current.balanceCents);
      if (current.source === 'amortized') unverifiedLoans.push(loan.name);
    }
    const extraDebtPrincipalPaidCents = Math.max(
      0,
      debtPrincipalPaidCents - requiredMonthlyDebtPaymentCents,
    );

    // ── Month transactions, joined to category bucket/isTransfer. ──
    const txnResult = await this.db.execute(sql`
      SELECT
        t.id, t.amount_cents, t.is_credit, t.is_split_parent, t.deleted_at,
        t.merchant_name, t.normalized_merchant_name, t.description,
        c.is_transfer AS category_is_transfer, c.bucket AS category_bucket
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.user_id = ${userId}
        AND t.date >= ${firstDay}
        AND t.date <= ${lastDay}
    `);
    const txnRows = (txnResult.rows ?? txnResult) as any[];

    const transactions: MonthlyCloseTransactionLine[] = txnRows.map((r) => {
      const haystack = `${r.merchant_name ?? ''} ${r.normalized_merchant_name ?? ''} ${r.description ?? ''}`.toLowerCase();
      const isDebtPrincipalTransfer =
        !r.is_credit && debtPatterns.some((p) => p && haystack.includes(p));
      return {
        id: r.id,
        amountCents: Math.abs(Number(r.amount_cents)),
        direction: r.is_credit ? 'credit' : 'debit',
        isTransfer: !!r.category_is_transfer,
        isSplitParent: !!r.is_split_parent,
        isDeleted: !!r.deleted_at,
        isDebtPrincipalTransfer,
        categoryBucket: r.category_bucket ?? null,
      };
    });

    // ── Investment-contribution transfers this month: transfer-flagged debits into
    // an investment account, on top of the paycheck's own 401k/HSA deductions
    // (decision #4). ──
    const investmentTransferResult = await this.db.execute(sql`
      SELECT COALESCE(SUM(t.amount_cents), 0) AS total_cents
      FROM ${schema.transactions} t
      JOIN ${schema.accounts} a ON a.id = t.account_id
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.user_id = ${userId}
        AND t.date >= ${firstDay} AND t.date <= ${lastDay}
        AND t.deleted_at IS NULL
        AND t.is_split_parent = false
        AND t.is_credit = false
        AND c.is_transfer = true
        AND a.account_type IN ('brokerage', 'edu_529')
    `);
    const investmentTransferRows = (investmentTransferResult.rows ?? investmentTransferResult) as any[];
    const investmentContributionCents =
      monthly401kHsaCents + (Number(investmentTransferRows[0]?.total_cents) || 0);

    // ── Month-end account balances (checking/savings/cash_sweep = liquid;
    // brokerage/edu_529 = regular-account investment; credit_card = liability). ──
    const accountRows = await this.db
      .select({
        id: schema.accounts.id,
        accountType: schema.accounts.accountType,
        startingBalanceCents: schema.accounts.startingBalanceCents,
      })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), isNull(schema.accounts.deletedAt)));

    let liquidAssetCents = 0;
    let regularInvestmentAssetCents = 0;
    let creditCardLiabilityCents = 0;
    const staleAccounts: string[] = [];
    for (const acct of accountRows) {
      const snapRows = await this.db
        .select()
        .from(schema.accountBalanceSnapshots)
        .where(
          and(
            eq(schema.accountBalanceSnapshots.accountId, acct.id),
            lte(schema.accountBalanceSnapshots.snapshotDate, lastDay),
          ),
        )
        .orderBy(desc(schema.accountBalanceSnapshots.snapshotDate))
        .limit(1);
      const snap = snapRows[0];
      const balanceCents = snap ? snap.balanceCents : acct.startingBalanceCents;
      if (!snap || snap.snapshotDate < firstDay) staleAccounts.push(acct.id);

      if (acct.accountType === 'checking' || acct.accountType === 'savings' || acct.accountType === 'cash_sweep') {
        liquidAssetCents += balanceCents;
      } else if (acct.accountType === 'brokerage' || acct.accountType === 'edu_529') {
        regularInvestmentAssetCents += balanceCents;
      } else if (acct.accountType === 'credit_card') {
        creditCardLiabilityCents += Math.abs(balanceCents);
      }
    }

    // ── Investments: holdings x latest EOD close when holdings exist, else the
    // manual investment_snapshots value for the month — never both (decision #2). ──
    const portfolio = await this.investmentsService.getPortfolioValue(userId);
    let investmentAssetCents = regularInvestmentAssetCents;
    if (portfolio.holdings.length > 0) {
      investmentAssetCents += portfolio.totalCents;
    } else {
      const snapshotResult = await this.db.execute(sql`
        SELECT COALESCE(SUM(s.balance_cents), 0) AS total_cents
        FROM ${schema.investmentSnapshots} s
        JOIN ${schema.investmentAccounts} ia ON ia.id = s.investment_account_id
        WHERE ia.user_id = ${userId} AND ia.deleted_at IS NULL
          AND s.date <= ${lastDay}
          AND s.date = (
            SELECT MAX(s2.date) FROM ${schema.investmentSnapshots} s2
            WHERE s2.investment_account_id = s.investment_account_id AND s2.date <= ${lastDay}
          )
      `);
      const snapshotRows = (snapshotResult.rows ?? snapshotResult) as any[];
      investmentAssetCents += Number(snapshotRows[0]?.total_cents) || 0;
    }

    // ── Manual assets: carry-forward per-asset, summed (decision #3). ──
    const manualAssets = await this.manualAssetsService.findAll(userId);
    let manualAssetCents = 0;
    const missingManualAssets: string[] = [];
    for (const asset of manualAssets) {
      const snap = await this.manualAssetsService.getSnapshotForMonth(asset.id, userId, snapshotMonth);
      if (!snap) {
        missingManualAssets.push(asset.name);
        continue;
      }
      manualAssetCents += snap.valueCents;
    }

    // ── Cash savings: liquid-balance growth this month, floored at zero. ──
    const priorLiquidResult = await this.gatherLiquidBalance(userId, prevMonth);
    const cashSavingsCents = Math.max(0, liquidAssetCents - priorLiquidResult);

    const cashSavingsAccounts = accountRows.filter(
      (a: any) => a.accountType === 'checking' || a.accountType === 'savings',
    );
    const emergencyFundMonths =
      cashSavingsAccounts.length > 0 && takeHomeIncomeCents > 0
        ? Number((liquidAssetCents / takeHomeIncomeCents).toFixed(2))
        : null;

    return {
      month: snapshotMonth,
      takeHomeIncomeCents,
      grossIncomeCents: profile ? monthlyGrossCents : null,
      transactions,
      cashSavingsCents,
      investmentContributionCents,
      debtPrincipalPaidCents,
      extraDebtPrincipalPaidCents,
      requiredMonthlyDebtPaymentCents,
      liquidAssetCents,
      investmentAssetCents,
      manualAssetCents,
      creditCardLiabilityCents,
      loanLiabilityCents,
      emergencyFundMonths,
      hasHighInterestDebt: false,
      employerMatch: { available: false, captured: null },
      freshness: { missingManualAssets, staleAccounts, unverifiedLoans },
    };
  }

  /** Liquid balance (checking/savings/cash_sweep) as of a given month's end — used
   *  only to derive this month's savings delta, so it doesn't need the full
   *  staleness bookkeeping `gatherInputs` does for the current month. */
  private async gatherLiquidBalance(userId: string, month: string): Promise<number> {
    const lastDay = endOfMonth(toMonthStart(month));
    const accountRows = await this.db
      .select({ id: schema.accounts.id, accountType: schema.accounts.accountType, startingBalanceCents: schema.accounts.startingBalanceCents })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
          sql`${schema.accounts.accountType} IN ('checking', 'savings', 'cash_sweep')`,
        ),
      );
    let total = 0;
    for (const acct of accountRows) {
      const snapRows = await this.db
        .select()
        .from(schema.accountBalanceSnapshots)
        .where(
          and(
            eq(schema.accountBalanceSnapshots.accountId, acct.id),
            lte(schema.accountBalanceSnapshots.snapshotDate, lastDay),
          ),
        )
        .orderBy(desc(schema.accountBalanceSnapshots.snapshotDate))
        .limit(1);
      total += snapRows[0] ? snapRows[0].balanceCents : acct.startingBalanceCents;
    }
    return total;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  private toFreeze(result: ReturnType<typeof calculateMonthlyClose>) {
    return {
      takeHomeIncomeCents: result.takeHomeIncomeCents,
      grossIncomeCents: result.grossIncomeCents,
      expenseCents: result.expenseCents,
      cashSavingsCents: result.cashSavingsCents,
      investmentContributionCents: result.investmentContributionCents,
      debtPrincipalPaidCents: result.debtPrincipalPaidCents,
      extraDebtPrincipalPaidCents: result.extraDebtPrincipalPaidCents,
      liquidAssetCents: result.liquidAssetCents,
      investmentAssetCents: result.investmentAssetCents,
      manualAssetCents: result.manualAssetCents,
      totalAssetCents: result.totalAssetCents,
      creditCardLiabilityCents: result.creditCardLiabilityCents,
      loanLiabilityCents: result.loanLiabilityCents,
      totalLiabilityCents: result.totalLiabilityCents,
      netWorthCents: result.netWorthCents,
      savingsRateBps: result.savingsRateBps,
      investingRateBps: result.investingRateBps,
      debtPaydownRateBps: result.debtPaydownRateBps,
      wealthBuildingRateBps: result.wealthBuildingRateBps,
      expenseRatioBps: result.expenseRatioBps,
      liquidNetWorthRatioBps: result.liquidNetWorthRatioBps,
      debtAssetRatioBps: result.debtAssetRatioBps,
      debtPaymentIncomeRatioBps: result.debtPaymentIncomeRatioBps,
      targetStatus: result.targetStatus,
      freshness: result.freshness,
      calculationVersion: result.calculationVersion,
      updatedAt: new Date(),
    };
  }

  /** Compute + persist a draft snapshot. Creates the row if missing; if it already
   *  exists (draft OR confirmed), overwrites the frozen aggregates but preserves
   *  status/notes/edit-audit fields — same computation path `recalculate` uses. */
  async draft(userId: string, month: string) {
    const snapshotMonth = toMonthStart(month);
    const input = await this.gatherInputs(userId, snapshotMonth);
    const result = calculateMonthlyClose(input);
    const existing = await this.findRow(userId, snapshotMonth);

    if (!existing) {
      const rows = await this.db
        .insert(schema.monthlyFinancialSnapshots)
        .values({ userId, snapshotMonth, status: 'draft', ...this.toFreeze(result) })
        .returning();
      return rows[0];
    }

    const rows = await this.db
      .update(schema.monthlyFinancialSnapshots)
      .set(this.toFreeze(result))
      .where(eq(schema.monthlyFinancialSnapshots.id, existing.id))
      .returning();
    return rows[0];
  }

  /** Recompute against current data. Identical mechanics to `draft` — kept as a
   *  separate endpoint per the spec since callers use it to mean "re-run, I know
   *  it already exists" (e.g. after entering a missing manual-asset value). */
  async recalculate(userId: string, month: string) {
    const snapshotMonth = toMonthStart(month);
    const existing = await this.findRow(userId, snapshotMonth);
    if (!existing) throw new NotFoundException('Monthly close not found');
    return this.draft(userId, snapshotMonth);
  }

  async patch(userId: string, month: string, input: PatchMonthlyCloseInput) {
    const snapshotMonth = toMonthStart(month);
    const existing = await this.findRow(userId, snapshotMonth);
    if (!existing) throw new NotFoundException('Monthly close not found');

    const patch: Record<string, unknown> = { ...input, updatedAt: new Date() };
    // Lightweight audit trail (decision #6): editing a confirmed close stamps
    // edited_at + is_edited rather than mutating history silently.
    if (existing.status === 'confirmed') {
      patch.editedAt = new Date();
      patch.isEdited = true;
    }

    const rows = await this.db
      .update(schema.monthlyFinancialSnapshots)
      .set(patch)
      .where(eq(schema.monthlyFinancialSnapshots.id, existing.id))
      .returning();
    return rows[0];
  }

  async confirm(userId: string, month: string) {
    const snapshotMonth = toMonthStart(month);
    const existing = await this.findRow(userId, snapshotMonth);
    if (!existing) throw new NotFoundException('Monthly close not found');
    const rows = await this.db
      .update(schema.monthlyFinancialSnapshots)
      .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.monthlyFinancialSnapshots.id, existing.id))
      .returning();
    return rows[0];
  }

  async reopen(userId: string, month: string) {
    const snapshotMonth = toMonthStart(month);
    const existing = await this.findRow(userId, snapshotMonth);
    if (!existing) throw new NotFoundException('Monthly close not found');
    const rows = await this.db
      .update(schema.monthlyFinancialSnapshots)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(schema.monthlyFinancialSnapshots.id, existing.id))
      .returning();
    return rows[0];
  }

  // ── Cron (13.5 decision #8/#11) ────────────────────────────

  private async activeUsers(): Promise<Array<{ id: string }>> {
    return this.db.select({ id: schema.users.id }).from(schema.users).where(isNull(schema.users.deletedAt));
  }

  /** Earliest month this user has any transaction, or null if none. Bounds how far
   *  back backfill reaches (decision #11 — "as many prior months as data allows"). */
  private async earliestActivityMonth(userId: string): Promise<string | null> {
    const result = await this.db.execute(sql`
      SELECT MIN(date)::text AS min_date FROM ${schema.transactions} WHERE user_id = ${userId}
    `);
    const rows = (result.rows ?? result) as any[];
    const minDate = rows[0]?.min_date;
    return minDate ? toMonthStart(String(minDate).slice(0, 7)) : null;
  }

  /**
   * On the 1st of each month, drafts/refreshes the previous month's close for every
   * active user, and — on first run (no prior closes exist for that user) — backfills
   * as many earlier months as transaction history allows (decision #11), bounded by
   * MAX_BACKFILL_MONTHS. After each draft, sends a freshness nudge if required facts
   * are stale and the user hasn't been nudged in the last 2 months (decision #3).
   */
  async runAutoDraftForAllUsers(referenceMonth?: string): Promise<{ usersProcessed: number; closesCreated: number }> {
    const targetMonth = addMonths(referenceMonth ?? new Date().toISOString().slice(0, 7), -1);
    const users = await this.activeUsers();
    let closesCreated = 0;

    for (const user of users) {
      try {
        const created = await this.runAutoDraftForUser(user.id, targetMonth);
        closesCreated += created;
      } catch (err: any) {
        this.logger.error(`Monthly-close auto-draft failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
    return { usersProcessed: users.length, closesCreated };
  }

  /** Draft/refresh `month` for one user unless it's already confirmed — a confirmed
   *  close is user-signed-off history; the auto-draft cron must never silently
   *  clobber it (only the explicit recalculate/patch endpoints may touch it, and
   *  patch applies the isEdited/editedAt audit stamp `draft()` does not). */
  private async draftUnlessConfirmed(userId: string, month: string): Promise<boolean> {
    const existing = await this.findRow(userId, month);
    if (existing?.status === 'confirmed') return false;
    await this.draft(userId, month);
    return true;
  }

  private async runAutoDraftForUser(userId: string, targetMonth: string): Promise<number> {
    const hasAnyClose = (await this.findAll(userId, 1)).length > 0;
    let created = 0;

    if (!hasAnyClose) {
      const earliest = await this.earliestActivityMonth(userId);
      const backfillStart = earliest
        ? addMonths(targetMonth, -Math.min(MAX_BACKFILL_MONTHS, Math.max(0, monthDiff(targetMonth, earliest))))
        : targetMonth;
      let month = backfillStart;
      while (monthDiff(targetMonth, month) >= 0) {
        const wasMissing = !(await this.findRow(userId, month));
        const drafted = await this.draftUnlessConfirmed(userId, month);
        if (drafted && wasMissing) created += 1;
        await this.maybeNudgeFreshness(userId, month);
        month = addMonths(month, 1);
      }
      return created;
    }

    const existing = await this.findRow(userId, targetMonth);
    const drafted = await this.draftUnlessConfirmed(userId, targetMonth);
    if (drafted && !existing) created += 1;
    await this.maybeNudgeFreshness(userId, targetMonth);
    return created;
  }

  /** Freshness nudge, capped to once every 2 months per user (decision #3). Uses the
   *  existing notifications path with a dedupe key scoped to the cooldown window so
   *  re-running the cron mid-window is a no-op, not a duplicate send. */
  private async maybeNudgeFreshness(userId: string, month: string): Promise<boolean> {
    const row = await this.findRow(userId, month);
    if (!row) return false;
    const freshness = row.freshness as { isComplete?: boolean; missingManualAssets?: string[]; staleAccounts?: string[]; unverifiedLoans?: string[] } | null;
    if (!freshness || freshness.isComplete) return false;

    const lastNudgeResult = await this.db.execute(sql`
      SELECT MAX(created_at)::text AS last_at FROM ${schema.notifications}
      WHERE user_id = ${userId} AND type = ${FRESHNESS_NUDGE_NOTIFICATION_TYPE}
    `);
    const lastRows = (lastNudgeResult.rows ?? lastNudgeResult) as any[];
    const lastAt = lastRows[0]?.last_at ? new Date(lastRows[0].last_at) : null;
    if (lastAt) {
      const monthsSince =
        (Date.now() - lastAt.getTime()) / (30.44 * 24 * 3600_000);
      if (monthsSince < FRESHNESS_NUDGE_COOLDOWN_MONTHS) return false;
    }

    const staleItems = [
      ...(freshness.missingManualAssets ?? []),
      ...(freshness.staleAccounts ?? []),
      ...(freshness.unverifiedLoans ?? []),
    ];
    await this.notificationsService.createAndDispatch({
      userId,
      type: FRESHNESS_NUDGE_NOTIFICATION_TYPE,
      title: `Your ${month.slice(0, 7)} close needs a few updates`,
      message: `${staleItems.length} item(s) are missing or stale (manual assets, account balances, or loan statements) — update them for an accurate close.`,
      severity: 'info',
      source: 'freshness',
      data: { month, ...freshness },
      dedupeKey: `monthly-close-freshness-${userId}-${month}`,
    });
    return true;
  }
}
