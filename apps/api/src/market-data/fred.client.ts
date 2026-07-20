import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One observation as returned by FRED's `series/observations` endpoint. */
export interface FredPoint {
  date: string; // "YYYY-MM-DD"
  value: number;
}

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * Client for the St. Louis Fed's FRED API (https://fred.stlouisfed.org/docs/api/fred/).
 * Stable, well-documented, free-registration endpoint — series IDs used here
 * (MORTGAGE30US, CPIAUCSL, FEDFUNDS) are long-lived FRED identifiers.
 */
@Injectable()
export class FredClient {
  private readonly logger = new Logger(FredClient.name);
  private readonly apiKey: string | undefined;
  private readonly timeoutMs = 15_000;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('FRED_API_KEY') || undefined;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Fetch the most recent observations for a series. Never throws — an outage or
   * bad key must never break a caller; returns an empty array on any failure so the
   * service falls back to the last stored value.
   */
  async fetchSeries(seriesId: string, limit = 52): Promise<FredPoint[]> {
    if (!this.apiKey) {
      this.logger.warn(`FRED_API_KEY not set — skipping ${seriesId}`);
      return [];
    }
    const url = new URL(FRED_BASE_URL);
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit', String(limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        this.logger.error(`FRED ${seriesId} returned ${res.status}: ${await res.text()}`);
        return [];
      }
      const body = (await res.json()) as {
        observations?: Array<{ date: string; value: string }>;
      };
      const rows = body.observations ?? [];
      // FRED uses "." for a missing observation at that date — skip those.
      return rows
        .filter((r) => r.value !== '.')
        .map((r) => ({ date: r.date, value: Number(r.value) }))
        .filter((p) => Number.isFinite(p.value));
    } catch (err: any) {
      this.logger.error(`FRED ${seriesId} fetch failed: ${err.message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}
