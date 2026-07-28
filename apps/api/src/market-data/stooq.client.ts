import { Injectable, Logger } from '@nestjs/common';

/** One EOD close for a ticker. */
export interface SecurityPricePoint {
  date: string; // "YYYY-MM-DD"
  closeCents: number;
  currency: string;
}

const STOOQ_BASE_URL = 'https://stooq.com/q/d/l/';

/**
 * Client for Stooq's free, keyless EOD CSV endpoint (https://stooq.com/db/h/).
 * Primary provider for stocks/ETFs — no API key, no rate-limit account to manage.
 * Does NOT cover mutual-fund NAVs (e.g. VTSAX) — see AlphaVantageClient for those.
 */
@Injectable()
export class StooqClient {
  private readonly logger = new Logger(StooqClient.name);
  private readonly timeoutMs = 15_000;

  /**
   * Fetch the most recent EOD close for a ticker. Never throws — an outage or
   * unknown ticker must never break a caller; returns null on any failure so the
   * service falls back to the last stored price.
   */
  async fetchLatestClose(ticker: string): Promise<SecurityPricePoint | null> {
    const url = new URL(STOOQ_BASE_URL);
    // Stooq expects lower-case US tickers suffixed ".us" for US-listed equities/ETFs.
    url.searchParams.set('s', `${ticker.toLowerCase()}.us`);
    url.searchParams.set('i', 'd');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        this.logger.error(`Stooq ${ticker} returned ${res.status}`);
        return null;
      }
      const text = await res.text();
      // Stooq's endpoint can 200 with an HTML anti-bot/JS-challenge page instead of
      // real CSV (e.g. a proof-of-work "verify your browser" interstitial) — that
      // response is neither valid CSV nor Stooq's own "N/D" unknown-ticker body, and
      // parseStooqCsv would otherwise swallow it as an indistinguishable silent null,
      // hiding a total-outage condition behind the same code path as a routine
      // unknown-ticker miss. Surface it loudly so an outage is visible in logs.
      const trimmed = text.trimStart();
      if (trimmed.startsWith('<') || /^\s*<!doctype/i.test(trimmed)) {
        this.logger.error(
          `Stooq ${ticker}: got a non-CSV (HTML) response — likely a bot-check/` +
            `anti-scraping wall on Stooq's side rather than an unknown ticker`,
        );
        return null;
      }
      const point = parseStooqCsv(text);
      if (!point) {
        this.logger.warn(`Stooq ${ticker}: no price data (unknown ticker or empty feed)`);
      }
      return point;
    } catch (err: any) {
      this.logger.error(`Stooq ${ticker} fetch failed: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Parse Stooq's CSV response (`Date,Open,High,Low,Close,Volume`, header row first,
 * ascending date order). Returns the latest row's close, or null for an unknown
 * ticker (Stooq responds with the literal body `N/D`).
 */
export function parseStooqCsv(csv: string): SecurityPricePoint | null {
  const lines = csv.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return null; // header only, or "N/D"
  const last = lines[lines.length - 1].split(',');
  if (last.length < 5) return null;
  const [date, , , , closeStr] = last;
  const close = Number(closeStr);
  if (!date || !Number.isFinite(close)) return null;
  return {
    date,
    closeCents: Math.round(close * 100),
    currency: 'USD',
  };
}
