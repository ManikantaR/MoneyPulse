import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '../db/db.module';
import { rateWatchlist, marketMetrics, users } from '../db/schema';
import {
  DEFAULT_WATCHLIST_STALE_DAYS,
  TREASURY_WATCHLIST_SERIES,
} from '@moneypulse/shared';
import type { CreateRateWatchlistInput, UpdateRateWatchlistInput } from '@moneypulse/shared';

export interface WatchlistRow {
  id: string;
  institution: string;
  productType: string;
  apyBps: number;
  termMonths: number | null;
  notes: string | null;
  source: string;
  updatedAt: Date;
  isStale: boolean;
}

const TERM_MONTHS_BY_SERIES: Record<string, number> = {
  treasury_bill_4w: 1,
  treasury_bill_13w: 3,
  treasury_bill_26w: 6,
  treasury_bill_52w: 12,
};

@Injectable()
export class RateWatchlistService {
  private readonly logger = new Logger(RateWatchlistService.name);
  private readonly staleDays: number;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly config: ConfigService,
  ) {
    const configured = Number(this.config.get<string>('WATCHLIST_STALE_DAYS'));
    this.staleDays = Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_WATCHLIST_STALE_DAYS;
  }

  private toRow(r: any): WatchlistRow {
    const ageMs = Date.now() - new Date(r.updatedAt).getTime();
    return {
      id: r.id,
      institution: r.institution,
      productType: r.productType,
      apyBps: r.apyBps,
      termMonths: r.termMonths,
      notes: r.notes,
      source: r.source,
      updatedAt: r.updatedAt,
      isStale: ageMs >= this.staleDays * 24 * 3600_000,
    };
  }

  async findAll(userId: string): Promise<WatchlistRow[]> {
    const rows = await this.db
      .select()
      .from(rateWatchlist)
      .where(eq(rateWatchlist.userId, userId))
      .orderBy(desc(rateWatchlist.apyBps));
    return rows.map((r: any) => this.toRow(r));
  }

  async create(userId: string, input: CreateRateWatchlistInput): Promise<WatchlistRow> {
    const [row] = await this.db
      .insert(rateWatchlist)
      .values({
        userId,
        institution: input.institution,
        productType: input.productType,
        apyBps: input.apyBps,
        termMonths: input.termMonths ?? null,
        notes: input.notes ?? null,
        source: 'user',
      })
      .returning();
    return this.toRow(row);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateRateWatchlistInput,
  ): Promise<WatchlistRow> {
    const set: Record<string, any> = { updatedAt: new Date() };
    if (input.institution !== undefined) set.institution = input.institution;
    if (input.productType !== undefined) set.productType = input.productType;
    if (input.apyBps !== undefined) set.apyBps = input.apyBps;
    if (input.termMonths !== undefined) set.termMonths = input.termMonths;
    if (input.notes !== undefined) set.notes = input.notes;

    const [row] = await this.db
      .update(rateWatchlist)
      .set(set)
      .where(and(eq(rateWatchlist.id, id), eq(rateWatchlist.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException('Watchlist entry not found');
    return this.toRow(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(rateWatchlist)
      .where(and(eq(rateWatchlist.id, id), eq(rateWatchlist.userId, userId)))
      .returning({ id: rateWatchlist.id });
    if (deleted.length === 0) throw new NotFoundException('Watchlist entry not found');
  }

  /**
   * Auto-populate/refresh the current user's Treasury-sourced watchlist rows from the
   * latest `market_metrics` treasury_bill_* series (12.3: "Treasury/FRED-sourced rows
   * auto-populate into the watchlist"). Never touches source='user' rows. Idempotent —
   * matches existing auto rows by institution label and updates in place.
   */
  async syncTreasuryRows(userId: string): Promise<{ synced: number }> {
    let synced = 0;
    for (const metricKey of TREASURY_WATCHLIST_SERIES) {
      const [latest] = await this.db
        .select()
        .from(marketMetrics)
        .where(eq(marketMetrics.metricKey, metricKey))
        .orderBy(desc(marketMetrics.periodDate))
        .limit(1);
      if (!latest) continue;

      const institution = `US Treasury (${TERM_MONTHS_BY_SERIES[metricKey]}mo bill)`;
      const apyBps = Math.round(Number(latest.value) * 100);

      const existing = await this.db
        .select({ id: rateWatchlist.id })
        .from(rateWatchlist)
        .where(
          and(
            eq(rateWatchlist.userId, userId),
            eq(rateWatchlist.institution, institution),
            eq(rateWatchlist.source, 'treasury'),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await this.db
          .update(rateWatchlist)
          .set({ apyBps, updatedAt: new Date() })
          .where(eq(rateWatchlist.id, existing[0].id));
      } else {
        await this.db.insert(rateWatchlist).values({
          userId,
          institution,
          productType: 'treasury',
          apyBps,
          termMonths: TERM_MONTHS_BY_SERIES[metricKey],
          notes: latest.stateTaxExempt ? 'Exempt from state income tax.' : null,
          source: 'treasury',
        });
      }
      synced += 1;
    }
    return { synced };
  }

  getStaleDays(): number {
    return this.staleDays;
  }

  /**
   * Runs `syncTreasuryRows` for every active user — called automatically right after
   * `MarketDataService.refreshAll()` (daily market-data-refresh cron) so Treasury rows
   * in the watchlist stay current without anyone needing to hit `POST
   * /rate-watchlist/sync-treasury` by hand. One user's failure must never block the
   * others, mirroring the recommendation agents' per-user isolation.
   */
  async syncTreasuryRowsForAllUsers(): Promise<{ usersSynced: number }> {
    const activeUsers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.deletedAt));

    let usersSynced = 0;
    for (const user of activeUsers) {
      try {
        await this.syncTreasuryRows(user.id);
        usersSynced += 1;
      } catch (err: any) {
        this.logger.error(`Treasury watchlist sync failed for user ${user.id}: ${err.message}`, err.stack);
      }
    }
    return { usersSynced };
  }
}
