import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One data point as returned by EIA's v2 `/data` route. */
export interface EiaPoint {
  period: string; // e.g. "2026-07-14" (weekly) or "2026-06" (monthly)
  value: number;
}

const EIA_BASE_URL = 'https://api.eia.gov/v2';

/**
 * Client for EIA's v2 open-data API (https://www.eia.gov/opendata/).
 *
 * Route/facet shapes are verified against EIA's own v2 documentation (the
 * `duoarea`/`product` facets on `petroleum/pri/gnd`, and `stateid`/`sectorid` on
 * `electricity/retail-sales`) but the exact `duoarea` state code (conventionally
 * `S` + 2-letter postal code, e.g. `SCA` for California) could not be live-verified
 * without an API key — confirm it at https://www.eia.gov/opendata/browser/ once you
 * have one, and correct `MARKET_GAS_STATE` in `.env` if needed. No live calls happen
 * without `EIA_API_KEY` set — see `fetchGasPrice`/`fetchElectricityPrice`.
 */
@Injectable()
export class EiaClient {
  private readonly logger = new Logger(EiaClient.name);
  private readonly apiKey: string | undefined;
  private readonly timeoutMs = 15_000;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('EIA_API_KEY') || undefined;
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Weekly regular-gasoline retail price ($/gal) for a state (EIA `duoarea` code). */
  async fetchGasPrice(duoarea: string): Promise<EiaPoint[]> {
    return this.fetchSeries('petroleum/pri/gnd', {
      'facets[duoarea][]': duoarea,
      'facets[product][]': 'EPMR',
      frequency: 'weekly',
    });
  }

  /** Monthly residential electricity price (¢/kWh) for a state (2-letter postal code). */
  async fetchElectricityPrice(stateId: string): Promise<EiaPoint[]> {
    // electricity/retail-sales does NOT accept 'value' as a data field (unlike
    // petroleum/pri/gnd) — confirmed live: EIA 400s with "The only valid data are
    // 'revenue', 'sales', 'price', and 'customers'." 'price' is the ¢/kWh series.
    return this.fetchSeries(
      'electricity/retail-sales',
      { 'facets[stateid][]': stateId, 'facets[sectorid][]': 'RES', frequency: 'monthly' },
      'price',
    );
  }

  /**
   * Never throws — an outage or bad key must never break a caller (the spec's
   * "on API failure log + serve last stored values" rule). Empty array on any failure.
   */
  private async fetchSeries(
    route: string,
    facets: Record<string, string>,
    dataField: string = 'value',
  ): Promise<EiaPoint[]> {
    if (!this.apiKey) {
      this.logger.warn(`EIA_API_KEY not set — skipping ${route}`);
      return [];
    }
    const url = new URL(`${EIA_BASE_URL}/${route}/data/`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('data[0]', dataField);
    url.searchParams.set('sort[0][column]', 'period');
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('length', '52'); // ~1yr weekly / ~4yr monthly, plenty for deltas
    for (const [k, v] of Object.entries(facets)) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        this.logger.error(`EIA ${route} returned ${res.status}: ${await res.text()}`);
        return [];
      }
      const body = (await res.json()) as {
        response?: { data?: Array<Record<string, unknown>> };
      };
      const rows = body.response?.data ?? [];
      return rows
        .map((r) => ({ period: r.period as string, value: Number(r[dataField]) }))
        .filter((p) => Number.isFinite(p.value));
    } catch (err: any) {
      this.logger.error(`EIA ${route} fetch failed: ${err.message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}
