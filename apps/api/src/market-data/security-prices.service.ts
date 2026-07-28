import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import { securityPrices, investmentHoldings } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { StooqClient } from './stooq.client';
import { AlphaVantageClient } from './alphavantage.client';

export interface LatestSecurityPrice {
  ticker: string;
  closeCents: number | null;
  priceDate: string | null;
  currency: string;
  source: string | null;
  fetchedAt: string | null;
}

@Injectable()
export class SecurityPricesService {
  private readonly logger = new Logger(SecurityPricesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly stooq: StooqClient,
    private readonly alphaVantage: AlphaVantageClient,
  ) {}

  /** Distinct tickers currently held by any user — the only ones we ever fetch. */
  async heldTickers(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ ticker: investmentHoldings.ticker })
      .from(investmentHoldings);
    return rows.map((r: any) => r.ticker as string);
  }

  /**
   * Refresh EOD closes for every currently-held ticker: Stooq first, Alpha Vantage
   * as fallback (needed for mutual-fund NAVs Stooq doesn't cover). An outage on one
   * ticker/provider must never break the others, and never overwrites good history
   * with nothing — on total failure the last stored price simply stays latest.
   */
  async refreshAll(): Promise<{ refreshed: string[]; failed: string[] }> {
    const tickers = await this.heldTickers();
    const refreshed: string[] = [];
    const failed: string[] = [];

    this.logger.log(`Security price refresh starting for ${tickers.length} held ticker(s)`);
    for (const ticker of tickers) {
      try {
        const wrote = await this.refreshOne(ticker);
        if (wrote) {
          refreshed.push(ticker);
        } else {
          // Both providers came back empty (outage / unknown ticker / missing
          // Alpha Vantage config) — StooqClient/AlphaVantageClient already log the
          // specific reason per-provider; this line ties it back to the ticker so
          // "which tickers failed and why" is visible from the aggregate log alone.
          this.logger.warn(`security price refresh: no price obtained for ${ticker}`);
          failed.push(ticker);
        }
      } catch (err: any) {
        this.logger.error(`security price refresh failed for ${ticker}: ${err.message}`);
        failed.push(ticker);
      }
    }
    return { refreshed, failed };
  }

  private async refreshOne(ticker: string): Promise<boolean> {
    let point = await this.stooq.fetchLatestClose(ticker);
    let source = 'stooq';
    if (!point) {
      point = await this.alphaVantage.fetchLatestClose(ticker);
      source = 'alphavantage';
    }
    if (!point) return false;

    await this.db
      .insert(securityPrices)
      .values({
        ticker,
        priceDate: point.date,
        closeCents: point.closeCents,
        currency: point.currency,
        source,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [securityPrices.ticker, securityPrices.priceDate],
        set: { closeCents: point.closeCents, source, fetchedAt: new Date() },
      });
    return true;
  }

  /**
   * Latest known close for a ticker regardless of how stale it is — a provider
   * outage must serve the last known price with its real date attached, never a
   * silent/wrong "current" claim.
   */
  async getLatest(ticker: string): Promise<LatestSecurityPrice> {
    const rows = await this.db
      .select()
      .from(securityPrices)
      .where(eq(securityPrices.ticker, ticker))
      .orderBy(desc(securityPrices.priceDate))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        ticker,
        closeCents: null,
        priceDate: null,
        currency: 'USD',
        source: null,
        fetchedAt: null,
      };
    }
    return {
      ticker,
      closeCents: row.closeCents,
      priceDate: String(row.priceDate),
      currency: row.currency,
      source: row.source,
      fetchedAt: row.fetchedAt ? new Date(row.fetchedAt).toISOString() : null,
    };
  }

  async getLatestForTickers(tickers: string[]): Promise<Map<string, LatestSecurityPrice>> {
    const uniq = Array.from(new Set(tickers));
    const entries = await Promise.all(uniq.map(async (t) => [t, await this.getLatest(t)] as const));
    return new Map(entries);
  }
}
