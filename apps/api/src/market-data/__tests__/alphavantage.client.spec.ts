import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { AlphaVantageClient } from '../alphavantage.client';

function makeConfig(overrides: Record<string, string> = {}) {
  return { get: (key: string) => overrides[key] } as any;
}

// Recorded fixture — synthetic TIME_SERIES_DAILY response shape for a mutual-fund
// NAV ticker (e.g. VTSAX) that Stooq's free feed doesn't cover. No live calls (12.2).
const ALPHA_VANTAGE_FIXTURE = {
  'Meta Data': { '2. Symbol': 'VTSAX' },
  'Time Series (Daily)': {
    '2026-07-01': { '1. open': '120.00', '4. close': '121.50' },
    '2026-06-30': { '1. open': '119.50', '4. close': '120.10' },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AlphaVantageClient', () => {
  it('is unconfigured without an API key and never calls out', async () => {
    const client = new AlphaVantageClient(makeConfig());
    expect(client.isConfigured).toBe(false);
    global.fetch = vi.fn();
    const point = await client.fetchLatestClose('VTSAX');
    expect(point).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('warns loudly at construction time when unconfigured, not just per-call', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    new AlphaVantageClient(makeConfig());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ALPHAVANTAGE_API_KEY'));
  });

  it('parses the latest close from a recorded fixture', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ALPHA_VANTAGE_FIXTURE,
    }) as any;
    const client = new AlphaVantageClient(makeConfig({ ALPHAVANTAGE_API_KEY: 'test-key' }));
    const point = await client.fetchLatestClose('VTSAX');
    expect(point).toEqual({ date: '2026-07-01', closeCents: 12150, currency: 'USD' });
  });

  it('returns null (never throws) when the free-tier rate limit note is present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Note: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.' }),
    }) as any;
    const client = new AlphaVantageClient(makeConfig({ ALPHAVANTAGE_API_KEY: 'test-key' }));
    const point = await client.fetchLatestClose('VTSAX');
    expect(point).toBeNull();
  });

  it('returns null (never throws) on a provider outage', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    const client = new AlphaVantageClient(makeConfig({ ALPHAVANTAGE_API_KEY: 'test-key' }));
    const point = await client.fetchLatestClose('VTSAX');
    expect(point).toBeNull();
  });
});
