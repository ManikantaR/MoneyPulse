import { describe, it, expect, vi } from 'vitest';
import { SecurityPricesService } from '../security-prices.service';

function makeDb({
  heldTickers = [] as string[],
  latestRows = [] as any[],
}: { heldTickers?: string[]; latestRows?: any[] } = {}) {
  const upserts: Array<{ values: any; target: any; set: any }> = [];
  const db = {
    selectDistinct: vi.fn(() => ({
      from: vi.fn().mockResolvedValue(heldTickers.map((ticker) => ({ ticker }))),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(latestRows),
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

function makeStooq(point: any) {
  return { fetchLatestClose: vi.fn().mockResolvedValue(point) } as any;
}
function makeAlphaVantage(point: any) {
  return { fetchLatestClose: vi.fn().mockResolvedValue(point) } as any;
}

describe('SecurityPricesService', () => {
  it('fetches only currently-held tickers, never the whole market', async () => {
    const { db } = makeDb({ heldTickers: ['VTI'] });
    const stooq = makeStooq({ date: '2026-07-01', closeCents: 25310, currency: 'USD' });
    const alphaVantage = makeAlphaVantage(null);
    const service = new SecurityPricesService(db, stooq, alphaVantage);

    const result = await service.refreshAll();

    expect(result.refreshed).toEqual(['VTI']);
    expect(stooq.fetchLatestClose).toHaveBeenCalledWith('VTI');
  });

  it('falls back to Alpha Vantage when Stooq has no data (e.g. mutual-fund NAV)', async () => {
    const { db, upserts } = makeDb({ heldTickers: ['VTSAX'] });
    const stooq = makeStooq(null);
    const alphaVantage = makeAlphaVantage({
      date: '2026-07-01',
      closeCents: 12150,
      currency: 'USD',
    });
    const service = new SecurityPricesService(db, stooq, alphaVantage);

    const result = await service.refreshAll();

    expect(result.refreshed).toEqual(['VTSAX']);
    expect(alphaVantage.fetchLatestClose).toHaveBeenCalledWith('VTSAX');
    expect(upserts[0].values.source).toBe('alphavantage');
    expect(upserts[0].values.closeCents).toBe(12150);
  });

  it('records a failure (no crash) when both providers are down — a provider outage', async () => {
    const { db } = makeDb({ heldTickers: ['VTI'] });
    const stooq = makeStooq(null);
    const alphaVantage = makeAlphaVantage(null);
    const service = new SecurityPricesService(db, stooq, alphaVantage);

    const result = await service.refreshAll();

    expect(result.refreshed).toEqual([]);
    expect(result.failed).toEqual(['VTI']);
  });

  it('serves the last known price with its real date when nothing fresh is available', async () => {
    const { db } = makeDb({
      latestRows: [
        {
          ticker: 'VTI',
          priceDate: '2026-06-15',
          closeCents: 24800,
          currency: 'USD',
          source: 'stooq',
          fetchedAt: new Date('2026-06-15T21:00:00Z'),
        },
      ],
    });
    const service = new SecurityPricesService(db, makeStooq(null), makeAlphaVantage(null));

    const latest = await service.getLatest('VTI');

    expect(latest.closeCents).toBe(24800);
    expect(latest.priceDate).toBe('2026-06-15'); // real (stale) date visibly attached
    expect(latest.source).toBe('stooq');
  });

  it('returns nulls (never a fabricated price) when no price has ever been recorded', async () => {
    const { db } = makeDb({ latestRows: [] });
    const service = new SecurityPricesService(db, makeStooq(null), makeAlphaVantage(null));

    const latest = await service.getLatest('BRAND_NEW_TICKER');

    expect(latest.closeCents).toBeNull();
    expect(latest.priceDate).toBeNull();
  });
});
