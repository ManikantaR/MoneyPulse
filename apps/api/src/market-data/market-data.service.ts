import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import { marketMetrics } from '../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { MARKET_SERIES, DEFAULT_HYSA_FRED_SERIES, type MarketSeriesDef } from '@moneypulse/shared';
import { EiaClient } from './eia.client';
import { FredClient } from './fred.client';

/** National-scope sentinel — never write NULL into `region`. Postgres unique
 * indexes treat NULL as distinct-from-everything, so onConflictDoUpdate would
 * silently stop matching existing rows and duplicate-insert on every refresh. */
const NATIONAL_REGION = 'US';

export interface MetricWithDeltas {
  metricKey: string;
  region: string;
  unit: string;
  latestValue: number | null;
  latestDate: string | null;
  fetchedAt: string | null;
  delta4Week: number | null;
  delta12Month: number | null;
}

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly gasState: string;
  private readonly electricityState: string;
  private readonly hysaFredSeries: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly config: ConfigService,
    private readonly eia: EiaClient,
    private readonly fred: FredClient,
  ) {
    // EIA `duoarea` code convention is `S` + 2-letter postal code (e.g. SCA); verify
    // against https://www.eia.gov/opendata/browser/ once a real key is available.
    this.gasState = this.config.get<string>('MARKET_GAS_STATE') || 'SCA';
    this.electricityState = this.gasState.replace(/^S/, '');
    this.hysaFredSeries =
      this.config.get<string>('MARKET_HYSA_FRED_SERIES') || DEFAULT_HYSA_FRED_SERIES;
  }

  /**
   * Refresh every configured series, respecting per-series cadence (a weekly series
   * already fetched this week is skipped — spec: "not refetched daily"). An outage on
   * one series must never block the others or throw — each series is isolated.
   */
  async refreshAll(): Promise<{ refreshed: string[]; skipped: string[]; failed: string[] }> {
    const refreshed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    for (const series of MARKET_SERIES) {
      const region = this.regionFor(series);
      try {
        if (!(await this.isDue(series, region))) {
          skipped.push(series.metricKey);
          continue;
        }
        const wrote = await this.refreshOne(series, region);
        if (wrote) refreshed.push(series.metricKey);
        else skipped.push(series.metricKey); // client returned no points (no key / outage)
      } catch (err: any) {
        // Never let one series' failure break the sweep — log and move on.
        this.logger.error(`refresh failed for ${series.metricKey}: ${err.message}`);
        failed.push(series.metricKey);
      }
    }
    return { refreshed, skipped, failed };
  }

  /** Configured EIA gas-price state code — used by the 11.7 gas-dip weekly note. */
  getGasState(): string {
    return this.gasState;
  }

  private regionFor(series: MarketSeriesDef): string {
    if (series.metricKey === 'gas_retail_regular') return this.gasState;
    if (series.metricKey === 'electricity_residential') return this.electricityState;
    return NATIONAL_REGION;
  }

  private async isDue(series: MarketSeriesDef, region: string): Promise<boolean> {
    const last = await this.db
      .select({ fetchedAt: marketMetrics.fetchedAt })
      .from(marketMetrics)
      .where(and(eq(marketMetrics.metricKey, series.metricKey), eq(marketMetrics.region, region)))
      .orderBy(desc(marketMetrics.fetchedAt))
      .limit(1);
    if (last.length === 0) return true; // never fetched — always due
    const ageMs = Date.now() - new Date(last[0].fetchedAt).getTime();
    const minGapMs =
      series.cadence === 'weekly'
        ? 6 * 24 * 3600_000
        : series.cadence === 'monthly'
          ? 27 * 24 * 3600_000
          : 0; // daily: always due
    return ageMs >= minGapMs;
  }

  private async refreshOne(series: MarketSeriesDef, region: string): Promise<boolean> {
    const points =
      series.source === 'eia'
        ? await this.fetchEia(series, region)
        : await this.fred.fetchSeries(this.fredSeriesId(series), 52);
    if (points.length === 0) return false;

    const rows = points.map((p) => ({
      metricKey: series.metricKey,
      region,
      periodDate: 'period' in p ? p.period : (p as { date: string }).date,
      value: String(p.value),
      unit: series.unit,
      source: series.source,
      fetchedAt: new Date(),
    }));

    for (const row of rows) {
      await this.db
        .insert(marketMetrics)
        .values(row)
        .onConflictDoUpdate({
          target: [marketMetrics.metricKey, marketMetrics.region, marketMetrics.periodDate],
          set: { value: row.value, unit: row.unit, source: row.source, fetchedAt: row.fetchedAt },
        });
    }
    return true;
  }

  private async fetchEia(series: MarketSeriesDef, region: string) {
    if (series.metricKey === 'gas_retail_regular') return this.eia.fetchGasPrice(region);
    if (series.metricKey === 'electricity_residential')
      return this.eia.fetchElectricityPrice(region);
    return [];
  }

  private fredSeriesId(series: MarketSeriesDef): string {
    if (series.metricKey === 'mortgage_30y') return 'MORTGAGE30US';
    if (series.metricKey === 'cpi_all_urban') return 'CPIAUCSL';
    if (series.metricKey === 'fed_funds_rate') return 'FEDFUNDS';
    return this.hysaFredSeries;
  }

  /**
   * Latest value plus 4-week and 12-month deltas for one series — the shape both the
   * read-only controller and the `get_market_context` MCP tool need.
   */
  async getLatestWithDeltas(metricKey: string, region?: string): Promise<MetricWithDeltas> {
    const resolvedRegion = region ?? this.defaultRegionFor(metricKey);
    const history = await this.db
      .select()
      .from(marketMetrics)
      .where(and(eq(marketMetrics.metricKey, metricKey), eq(marketMetrics.region, resolvedRegion)))
      .orderBy(desc(marketMetrics.periodDate))
      .limit(60); // ~14 months of weekly data — enough for a 12-month lookback

    if (history.length === 0) {
      return {
        metricKey,
        region: resolvedRegion,
        unit: '',
        latestValue: null,
        latestDate: null,
        fetchedAt: null,
        delta4Week: null,
        delta12Month: null,
      };
    }

    const latest = history[0];
    const latestValue = Number(latest.value);
    const latestDate = new Date(latest.periodDate);

    const find4WeekAgo = history.find(
      (r: any) => latestDate.getTime() - new Date(r.periodDate).getTime() >= 26 * 24 * 3600_000,
    );
    const find12MonthAgo = history.find(
      (r: any) => latestDate.getTime() - new Date(r.periodDate).getTime() >= 350 * 24 * 3600_000,
    );

    return {
      metricKey,
      region: resolvedRegion,
      unit: latest.unit,
      latestValue,
      latestDate: latest.periodDate,
      fetchedAt: latest.fetchedAt,
      delta4Week: find4WeekAgo ? latestValue - Number(find4WeekAgo.value) : null,
      delta12Month: find12MonthAgo ? latestValue - Number(find12MonthAgo.value) : null,
    };
  }

  private defaultRegionFor(metricKey: string): string {
    if (metricKey === 'gas_retail_regular') return this.gasState;
    if (metricKey === 'electricity_residential') return this.electricityState;
    return NATIONAL_REGION;
  }

  async getAllLatest(): Promise<MetricWithDeltas[]> {
    return Promise.all(MARKET_SERIES.map((s) => this.getLatestWithDeltas(s.metricKey)));
  }
}
