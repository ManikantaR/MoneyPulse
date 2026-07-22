import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import type {
  CreateInvestmentAccountInput,
  UpdateInvestmentAccountInput,
  AddSnapshotInput,
  AddHoldingInput,
} from '@moneypulse/shared';

/** Holdings older than this trigger a freshness insight + dataCaveat on derived
 * facts (12.2 spec). Configurable via HOLDINGS_STALE_DAYS. */
export const DEFAULT_HOLDINGS_STALE_DAYS = 90;

@Injectable()
export class InvestmentsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * List all non-deleted investment accounts for a user, each with the latest
   * snapshot value (latest by date DESC, created_at DESC for tie-breaking).
   */
  async findAll(userId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        ia.id,
        ia.user_id,
        ia.institution,
        ia.account_type,
        ia.nickname,
        ia.created_at,
        ia.updated_at,
        ia.deleted_at,
        snap.balance_cents  AS latest_balance_cents,
        snap.date           AS latest_snapshot_date
      FROM ${schema.investmentAccounts} ia
      LEFT JOIN LATERAL (
        SELECT balance_cents, date
        FROM ${schema.investmentSnapshots}
        WHERE investment_account_id = ia.id
        ORDER BY date DESC, created_at DESC
        LIMIT 1
      ) snap ON true
      WHERE ia.user_id = ${userId}
        AND ia.deleted_at IS NULL
      ORDER BY ia.created_at ASC
    `);
    return (rows.rows ?? rows).map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      institution: r.institution,
      accountType: r.account_type,
      nickname: r.nickname,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? null,
      latestBalanceCents: r.latest_balance_cents != null ? Number(r.latest_balance_cents) : null,
      latestSnapshotDate: r.latest_snapshot_date ? String(r.latest_snapshot_date).slice(0, 10) : null,
    }));
  }

  /**
   * Create a new investment account for the user.
   */
  async create(userId: string, input: CreateInvestmentAccountInput) {
    const rows = await this.db
      .insert(schema.investmentAccounts)
      .values({
        userId,
        institution: input.institution,
        accountType: input.accountType,
        nickname: input.nickname,
      })
      .returning();
    const row = rows[0];
    return {
      ...row,
      latestBalanceCents: null,
      latestSnapshotDate: null,
    };
  }

  /**
   * Update nickname/institution/accountType of a user-owned account.
   */
  async update(userId: string, id: string, input: UpdateInvestmentAccountInput) {
    await this.assertOwnership(userId, id);
    const rows = await this.db
      .update(schema.investmentAccounts)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(schema.investmentAccounts.id, id),
          eq(schema.investmentAccounts.userId, userId),
          isNull(schema.investmentAccounts.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }

  /**
   * Soft-delete an investment account (sets deletedAt).
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwnership(userId, id);
    await this.db
      .update(schema.investmentAccounts)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.investmentAccounts.id, id),
          eq(schema.investmentAccounts.userId, userId),
        ),
      );
  }

  /**
   * Record a value snapshot for an investment account.
   * Date defaults to today (local-ish — UTC date string).
   */
  async addSnapshot(userId: string, accountId: string, input: AddSnapshotInput) {
    await this.assertOwnership(userId, accountId);
    const snapshotDate = input.date ? new Date(input.date) : new Date();
    const rows = await this.db
      .insert(schema.investmentSnapshots)
      .values({
        investmentAccountId: accountId,
        balanceCents: input.balanceCents,
        date: snapshotDate,
      })
      .returning();
    return rows[0];
  }

  /**
   * Get snapshot history for an account, ordered oldest → newest.
   */
  async getSnapshots(userId: string, accountId: string) {
    await this.assertOwnership(userId, accountId);
    const rows = await this.db
      .select()
      .from(schema.investmentSnapshots)
      .where(eq(schema.investmentSnapshots.investmentAccountId, accountId))
      .orderBy(
        desc(schema.investmentSnapshots.date),
        desc(schema.investmentSnapshots.createdAt),
      );
    return rows;
  }

  /**
   * Declare/update a holding for an account. Edits APPEND a new row (history kept)
   * rather than mutating an existing one — same pattern as addSnapshot above.
   */
  async addHolding(userId: string, accountId: string, input: AddHoldingInput) {
    await this.assertOwnership(userId, accountId);
    const rows = await this.db
      .insert(schema.investmentHoldings)
      .values({
        investmentAccountId: accountId,
        ticker: input.ticker,
        shareCount: String(input.shareCount),
        asOf: input.asOf,
        notes: input.notes ?? null,
      })
      .returning();
    return rows[0];
  }

  /**
   * Latest holding per ticker for an account (most recent as_of, then created_at
   * as tie-breaker), plus full history ordered newest-first.
   */
  async getHoldings(userId: string, accountId: string) {
    await this.assertOwnership(userId, accountId);
    const rows = await this.db
      .select()
      .from(schema.investmentHoldings)
      .where(eq(schema.investmentHoldings.investmentAccountId, accountId))
      .orderBy(desc(schema.investmentHoldings.asOf), desc(schema.investmentHoldings.createdAt));
    return rows;
  }

  /**
   * All currently-held tickers with their latest declared share count/as-of date
   * across a user's accounts (one row per ticker per account).
   */
  async getCurrentHoldings(userId: string) {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (h.investment_account_id, h.ticker)
        h.id, h.investment_account_id, h.ticker, h.share_count, h.as_of, h.notes
      FROM ${schema.investmentHoldings} h
      JOIN ${schema.investmentAccounts} ia ON ia.id = h.investment_account_id
      WHERE ia.user_id = ${userId} AND ia.deleted_at IS NULL
      ORDER BY h.investment_account_id, h.ticker, h.as_of DESC, h.created_at DESC
    `);
    return (rows.rows ?? rows).map((r: any) => ({
      id: r.id,
      investmentAccountId: r.investment_account_id,
      ticker: r.ticker,
      shareCount: r.share_count,
      asOf: String(r.as_of).slice(0, 10),
      notes: r.notes ?? null,
    }));
  }

  /**
   * Verify account exists, is not deleted, and belongs to userId.
   */
  private async assertOwnership(userId: string, accountId: string) {
    const rows = await this.db
      .select()
      .from(schema.investmentAccounts)
      .where(eq(schema.investmentAccounts.id, accountId))
      .limit(1);
    const account = rows[0];
    if (!account) throw new NotFoundException('Investment account not found');
    if (account.userId !== userId) throw new ForbiddenException('Access denied');
    if (account.deletedAt) throw new NotFoundException('Investment account not found');
  }
}
