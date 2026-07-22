import { describe, it, expect, vi } from 'vitest';
import { MarketDataService } from '../market-data.service';

function makeConfig(overrides: Record<string, string> = {}) {
  return { get: (key: string) => overrides[key] } as any;
}

/** A drizzle-chain mock: select().from().where().orderBy().limit() resolves `rows`,
 *  and insert().values().onConflictDoUpdate() records the call in `upserts`. */
function makeDb(rows: any[] = []) {
  const upserts: Array<{ values: any; target: any; set: any }> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: (values: any) => ({
        onConflictDoUpdate: (opts: { target: any; set: any }) => {
          upserts.push({ values, target: opts.target, set: opts.set });
          return Promise.resolve();
        },
      }),
    })),
  };
  return { db, upserts };
}

function makeEia(overrides: Partial<Record<string, any>> = {}) {
  return {
    fetchGasPrice: vi.fn().mockResolvedValue(overrides.gas ?? []),
    fetchElectricityPrice: vi.fn().mockResolvedValue(overrides.electricity ?? []),
  } as any;
}

function makeFred(points: any[] = []) {
  return { fetchSeries: vi.fn().mockResolvedValue(points) } as any;
}

function makeTreasury(points: any[] = []) {
  return { fetchSeries: vi.fn().mockResolvedValue(points) } as any;
}

describe('MarketDataService.refreshAll', () => {
  it('no-fire: never-fetched series are due and get refreshed', async () => {
    const { db, upserts } = makeDb([]); // isDue's select returns [] -> never fetched -> due
    const eia = makeEia({ gas: [{ period: '2026-07-14', value: 3.4 }] });
    const fred = makeFred([{ date: '2026-07-14', value: 6.8 }]);
    const svc = new MarketDataService(db, makeConfig(), eia, fred, makeTreasury());

    const result = await svc.refreshAll();

    expect(result.failed).toEqual([]);
    expect(result.refreshed).toContain('gas_retail_regular');
    expect(result.refreshed).toContain('mortgage_30y');
    expect(upserts.length).toBeGreaterThan(0);
  });

  it('national-scope series upsert against the "US" sentinel, never NULL region', async () => {
    // A NULL region would make onConflictDoUpdate silently stop matching existing
    // rows in Postgres (NULL != NULL in a unique index) -> duplicate-insert every
    // refresh instead of updating. Assert the sentinel, not NULL, is always used.
    const { db, upserts } = makeDb([]);
    const eia = makeEia();
    const fred = makeFred([{ date: '2026-07-14', value: 6.8 }]);
    const svc = new MarketDataService(db, makeConfig(), eia, fred, makeTreasury());

    await svc.refreshAll();

    const fredUpserts = upserts.filter((u) => u.values.source === 'fred');
    expect(fredUpserts.length).toBeGreaterThan(0);
    for (const u of fredUpserts) {
      expect(u.values.region).toBe('US');
      expect(u.values.region).not.toBeNull();
    }
  });

  it('skips a series with no points returned (no key / outage) without failing', async () => {
    const { db } = makeDb([]);
    const eia = makeEia(); // fetchGasPrice/fetchElectricityPrice default to []
    const fred = makeFred([]); // no key configured -> []
    const svc = new MarketDataService(db, makeConfig(), eia, fred, makeTreasury());

    const result = await svc.refreshAll();

    expect(result.failed).toEqual([]);
    expect(result.refreshed).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('isolates one series failure — the rest still refresh', async () => {
    const { db } = makeDb([]);
    const eia = {
      fetchGasPrice: vi.fn().mockRejectedValue(new Error('boom')),
      fetchElectricityPrice: vi.fn().mockResolvedValue([{ period: '2026-07-01', value: 12 }]),
    } as any;
    const fred = makeFred([{ date: '2026-07-14', value: 6.8 }]);
    const svc = new MarketDataService(db, makeConfig(), eia, fred, makeTreasury());

    const result = await svc.refreshAll();

    expect(result.failed).toContain('gas_retail_regular');
    expect(result.refreshed).toContain('electricity_residential');
    expect(result.refreshed).toContain('mortgage_30y');
  });

  it('no-fire: a weekly series fetched 2 days ago is skipped, not refetched', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    const { db } = makeDb([{ fetchedAt: twoDaysAgo }]); // isDue sees a recent fetch
    const eia = makeEia({ gas: [{ period: '2026-07-14', value: 3.4 }] });
    const fred = makeFred([{ date: '2026-07-14', value: 6.8 }]);
    const svc = new MarketDataService(db, makeConfig(), eia, fred, makeTreasury());

    const result = await svc.refreshAll();

    // Every series in MARKET_SERIES has cadence weekly or monthly, all "due" checks
    // read the same mocked recent-fetch row, so nothing should be refreshed.
    expect(result.refreshed).toEqual([]);
    expect(eia.fetchGasPrice).not.toHaveBeenCalled();
  });
});

describe('MarketDataService.getLatestWithDeltas', () => {
  it('computes 4-week and 12-month deltas from history', async () => {
    const now = new Date('2026-07-14');
    const rows = [
      { periodDate: '2026-07-14', value: '3.50', unit: 'usd_per_gallon', fetchedAt: now.toISOString() },
      { periodDate: '2026-06-09', value: '3.30', unit: 'usd_per_gallon', fetchedAt: now.toISOString() }, // ~5wk back
      { periodDate: '2025-07-01', value: '3.10', unit: 'usd_per_gallon', fetchedAt: now.toISOString() }, // ~54wk back
    ];
    const { db } = makeDb(rows);
    const svc = new MarketDataService(db, makeConfig(), makeEia(), makeFred(), makeTreasury());

    const result = await svc.getLatestWithDeltas('gas_retail_regular', 'SCA');

    expect(result.latestValue).toBe(3.5);
    expect(result.delta4Week).toBeCloseTo(0.2, 5); // 3.50 - 3.30
    expect(result.delta12Month).toBeCloseTo(0.4, 5); // 3.50 - 3.10
  });

  it('no-fire: no history returns nulls, not a throw', async () => {
    const { db } = makeDb([]);
    const svc = new MarketDataService(db, makeConfig(), makeEia(), makeFred(), makeTreasury());

    const result = await svc.getLatestWithDeltas('gas_retail_regular', 'SCA');

    expect(result.latestValue).toBeNull();
    expect(result.delta4Week).toBeNull();
    expect(result.delta12Month).toBeNull();
  });
});
