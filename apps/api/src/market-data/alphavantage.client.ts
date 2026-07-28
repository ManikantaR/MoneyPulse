import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SecurityPricePoint } from './stooq.client';

const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

/**
 * Client for Alpha Vantage's free-tier `TIME_SERIES_DAILY` endpoint
 * (https://www.alphavantage.co/documentation/). Secondary/fallback provider —
 * covers mutual-fund NAVs (e.g. VTSAX) that Stooq's free feed doesn't. Requires
 * `ALPHAVANTAGE_API_KEY`; free tier is rate-limited (5 req/min, 25/day as of
 * writing) so callers must only fetch tickers actually held.
 */
@Injectable()
export class AlphaVantageClient {
  private readonly logger = new Logger(AlphaVantageClient.name);
  private readonly apiKey: string | undefined;
  private readonly timeoutMs = 15_000;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ALPHAVANTAGE_API_KEY') || undefined;
    if (!this.apiKey) {
      // Loud at boot, not just per-ticker: without this key, every ticker Stooq
      // can't price (mutual-fund NAVs) — and, if Stooq itself is unreachable/blocked,
      // *every* ticker — silently never gets a security_prices row, with no single
      // log line ever calling out the missing config as the cause.
      this.logger.warn(
        'ALPHAVANTAGE_API_KEY is not configured — Alpha Vantage fallback is fully ' +
          'disabled, so any ticker Stooq fails to price (mutual-fund NAVs, or all ' +
          'tickers during a Stooq outage) will never get a security_prices row',
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Fetch the most recent daily close for a ticker. Never throws — an outage, bad
   * key, or rate-limit response must never break a caller; returns null on any
   * failure so the service falls back to the last stored price.
   */
  async fetchLatestClose(ticker: string): Promise<SecurityPricePoint | null> {
    if (!this.apiKey) {
      this.logger.warn(`ALPHAVANTAGE_API_KEY not set — skipping ${ticker}`);
      return null;
    }
    const url = new URL(ALPHA_VANTAGE_BASE_URL);
    url.searchParams.set('function', 'TIME_SERIES_DAILY');
    url.searchParams.set('symbol', ticker);
    url.searchParams.set('outputsize', 'compact');
    url.searchParams.set('apikey', this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        this.logger.error(`Alpha Vantage ${ticker} returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        'Time Series (Daily)'?: Record<string, { '4. close': string }>;
        Note?: string; // rate-limit message
        'Error Message'?: string;
      };
      if (body.Note || body['Error Message']) {
        this.logger.error(
          `Alpha Vantage ${ticker}: ${body.Note ?? body['Error Message']}`,
        );
        return null;
      }
      const series = body['Time Series (Daily)'];
      if (!series) return null;
      const dates = Object.keys(series).sort().reverse();
      const latestDate = dates[0];
      if (!latestDate) return null;
      const close = Number(series[latestDate]['4. close']);
      if (!Number.isFinite(close)) return null;
      return { date: latestDate, closeCents: Math.round(close * 100), currency: 'USD' };
    } catch (err: any) {
      this.logger.error(`Alpha Vantage ${ticker} fetch failed: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
