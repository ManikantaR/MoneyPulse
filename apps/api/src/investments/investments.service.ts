import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { sqlArray } from '../db/sql-array';
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
        ia.interest_rate_bps,
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
      interestRateBps: r.interest_rate_bps != null ? Number(r.interest_rate_bps) : null,
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
        interestRateBps: input.interestRateBps ?? null,
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
   * All tickers with their latest declared share count/as-of date across a user's
   * accounts, as they stood on a given historical date (one row per ticker per
   * account) — the "as of" counterpart to getCurrentHoldings, using each holding
   * row's own as_of instead of "latest overall" so a month's close reflects the
   * shares actually held that month, not shares added/removed later.
   */
  async getHoldingsAsOf(userId: string, asOfDate: string) {
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (h.investment_account_id, h.ticker)
        h.id, h.investment_account_id, h.ticker, h.share_count, h.as_of, h.notes
      FROM ${schema.investmentHoldings} h
      JOIN ${schema.investmentAccounts} ia ON ia.id = h.investment_account_id
      WHERE ia.user_id = ${userId} AND ia.deleted_at IS NULL
        AND h.as_of <= ${asOfDate}
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
   * Portfolio market value as of a historical date: shares held on that date x the
   * most recent EOD close on or before that date, per holding, summed to a total.
   * Used by monthly-close backfill (#189) so a historical month's close reflects
   * that month's actual holdings/prices instead of today's. `getPortfolioValue`
   * (current-value, used elsewhere) is a separate method, not a delegation to
   * this one — left untouched to avoid behavior changes outside the backfill path.
   */
  async getPortfolioValueAsOf(
    userId: string,
    asOfDate: string,
    staleDays = DEFAULT_HOLDINGS_STALE_DAYS,
  ) {
    const holdings = await this.getHoldingsAsOf(userId, asOfDate);
    if (holdings.length === 0) {
      return { totalCents: 0, holdings: [], staleFound: false, missingPriceFound: false, staleDays };
    }

    const tickers = Array.from(new Set(holdings.map((h: any) => h.ticker))) as string[];
    const priceRows = await this.db.execute(sql`
      SELECT DISTINCT ON (ticker) ticker, price_date::text AS price_date, close_cents, source
      FROM ${schema.securityPrices}
      WHERE ticker = ANY(${sqlArray(tickers, 'text')})
        AND price_date <= ${asOfDate}
      ORDER BY ticker, price_date DESC
    `);
    const prices = (priceRows.rows ?? priceRows) as any[];
    const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));

    const asOfTime = new Date(asOfDate).getTime();
    let totalCents = 0;
    let staleFound = false;
    let missingPriceFound = false;

    const result = holdings.map((h: any) => {
      const isStale = asOfTime - new Date(h.asOf).getTime() > staleDays * 24 * 3600_000;
      if (isStale) staleFound = true;
      const price = priceByTicker.get(h.ticker);
      if (!price) {
        missingPriceFound = true;
        return {
          investmentAccountId: h.investmentAccountId,
          ticker: h.ticker,
          shareCount: h.shareCount,
          asOf: h.asOf,
          isStale,
          priceDate: null,
          closeCents: null,
          marketValueCents: null,
        };
      }
      const marketValueCents = Math.round(Number(h.shareCount) * Number(price.close_cents));
      totalCents += marketValueCents;
      return {
        investmentAccountId: h.investmentAccountId,
        ticker: h.ticker,
        shareCount: h.shareCount,
        asOf: h.asOf,
        isStale,
        priceDate: String(price.price_date).slice(0, 10),
        closeCents: Number(price.close_cents),
        marketValueCents,
      };
    });

    return { totalCents, holdings: result, staleFound, missingPriceFound, staleDays };
  }

  /**
   * Portfolio market value: shares x latest EOD close, per holding, summed to a
   * total. Mirrors the `get_portfolio_value` MCP tool's computation (same
   * "latest holding per ticker per account" + "latest price per ticker" joins),
   * but returns structured JSON instead of prose text so the web app can render
   * it without a REST->MCP hop (MCP tools aren't directly callable from the web
   * app in this codebase).
   */
  async getPortfolioValue(userId: string, staleDays = DEFAULT_HOLDINGS_STALE_DAYS) {
    const holdings = await this.getCurrentHoldings(userId);
    if (holdings.length === 0) {
      return { totalCents: 0, holdings: [], staleFound: false, missingPriceFound: false, staleDays };
    }

    const tickers = Array.from(new Set(holdings.map((h: any) => h.ticker))) as string[];
    const priceRows = await this.db.execute(sql`
      SELECT DISTINCT ON (ticker) ticker, price_date::text AS price_date, close_cents, source
      FROM ${schema.securityPrices}
      WHERE ticker = ANY(${sqlArray(tickers, 'text')})
      ORDER BY ticker, price_date DESC
    `);
    const prices = (priceRows.rows ?? priceRows) as any[];
    const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));

    const now = Date.now();
    let totalCents = 0;
    let staleFound = false;
    let missingPriceFound = false;

    const result = holdings.map((h: any) => {
      const isStale = now - new Date(h.asOf).getTime() > staleDays * 24 * 3600_000;
      if (isStale) staleFound = true;
      const price = priceByTicker.get(h.ticker);
      if (!price) {
        missingPriceFound = true;
        return {
          investmentAccountId: h.investmentAccountId,
          ticker: h.ticker,
          shareCount: h.shareCount,
          asOf: h.asOf,
          isStale,
          priceDate: null,
          closeCents: null,
          marketValueCents: null,
        };
      }
      const marketValueCents = Math.round(Number(h.shareCount) * Number(price.close_cents));
      totalCents += marketValueCents;
      return {
        investmentAccountId: h.investmentAccountId,
        ticker: h.ticker,
        shareCount: h.shareCount,
        asOf: h.asOf,
        isStale,
        priceDate: String(price.price_date).slice(0, 10),
        closeCents: Number(price.close_cents),
        marketValueCents,
      };
    });

    return { totalCents, holdings: result, staleFound, missingPriceFound, staleDays };
  }

  /**
   * Portfolio allocation: percent of total market value by ticker. Mirrors the
   * `get_allocation` MCP tool's computation — see getPortfolioValue for why this
   * is a structured-JSON REST wrapper rather than an MCP call from the web app.
   */
  async getAllocation(userId: string, staleDays = DEFAULT_HOLDINGS_STALE_DAYS) {
    const { totalCents, holdings, staleFound, missingPriceFound } = await this.getPortfolioValue(
      userId,
      staleDays,
    );

    const valueByTicker = new Map<string, number>();
    for (const h of holdings) {
      if (h.marketValueCents == null) continue;
      valueByTicker.set(h.ticker, (valueByTicker.get(h.ticker) ?? 0) + h.marketValueCents);
    }

    const allocations = Array.from(valueByTicker.entries())
      .map(([ticker, valueCents]) => ({
        ticker,
        valueCents,
        pct: totalCents > 0 ? (valueCents / totalCents) * 100 : 0,
      }))
      .sort((a, b) => b.valueCents - a.valueCents);

    return { totalCents, allocations, staleFound, missingPriceFound, staleDays };
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
