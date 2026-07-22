import { Injectable, Logger } from '@nestjs/common';

/** One day's par-yield-curve rate for a single maturity. */
export interface TreasuryPoint {
  date: string; // "YYYY-MM-DD"
  value: number; // percent, e.g. 4.31
}

const TREASURY_BASE_URL =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/avg_interest_rates';

// fiscaldata's Daily Treasury Par Yield Curve Rates dataset field names for each
// maturity we track. Field names per https://fiscaldata.treasury.gov/datasets/
// average-interest-rates-treasury-securities/average-interest-rates-on-u-s-
// treasury-securities — verify against the live schema once a real pull is run.
const FIELD_BY_METRIC_KEY: Record<string, string> = {
  treasury_bill_4w: 'bc_4week',
  treasury_bill_13w: 'bc_13week',
  treasury_bill_26w: 'bc_26week',
  treasury_bill_52w: 'bc_52week',
  treasury_note_2y: 'bc_2year',
  treasury_note_10y: 'bc_10year',
};

/**
 * Client for the US Treasury fiscaldata API (api.fiscaldata.treasury.gov) — free,
 * keyless, no rate-limit account to manage, same "no key required" shape as Stooq.
 * Daily Treasury Par Yield Curve Rates dataset.
 */
@Injectable()
export class TreasuryClient {
  private readonly logger = new Logger(TreasuryClient.name);
  private readonly timeoutMs = 15_000;

  /**
   * Fetch the most recent yield curve rows for a given metric key (e.g.
   * `treasury_bill_13w`). Never throws — an outage or schema drift must never break
   * a caller; returns an empty array on any failure so the service falls back to the
   * last stored value.
   */
  async fetchSeries(metricKey: string, limit = 30): Promise<TreasuryPoint[]> {
    const field = FIELD_BY_METRIC_KEY[metricKey];
    if (!field) {
      this.logger.warn(`No fiscaldata field mapping for ${metricKey}`);
      return [];
    }
    const url = new URL(TREASURY_BASE_URL);
    url.searchParams.set('fields', `record_date,${field}`);
    url.searchParams.set('sort', '-record_date');
    url.searchParams.set('page[size]', String(limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        this.logger.error(`Treasury ${metricKey} returned ${res.status}: ${await res.text()}`);
        return [];
      }
      const body = (await res.json()) as { data?: Array<Record<string, string>> };
      const rows = body.data ?? [];
      return rows
        .map((r) => ({ date: r.record_date, value: Number(r[field]) }))
        .filter((p) => Boolean(p.date) && Number.isFinite(p.value));
    } catch (err: any) {
      this.logger.error(`Treasury ${metricKey} fetch failed: ${err.message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}
