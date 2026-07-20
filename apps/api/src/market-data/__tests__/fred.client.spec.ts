import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FredClient } from '../fred.client';

function makeConfig(apiKey?: string) {
  return { get: (key: string) => (key === 'FRED_API_KEY' ? apiKey : undefined) } as any;
}

// Recorded-shape fixture of FRED's series/observations response (not a live call).
const FRED_FIXTURE = {
  observations: [
    { date: '2026-07-17', value: '6.81' },
    { date: '2026-07-10', value: '.' }, // FRED's "missing observation" marker
    { date: '2026-07-03', value: '6.79' },
  ],
};

describe('FredClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no-fire: skips the call entirely with no FRED_API_KEY configured', async () => {
    const client = new FredClient(makeConfig(undefined));
    const points = await client.fetchSeries('MORTGAGE30US');
    expect(points).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses observations and drops the "." missing-value marker', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => FRED_FIXTURE });
    const client = new FredClient(makeConfig('test-key'));

    const points = await client.fetchSeries('MORTGAGE30US');

    expect(points).toEqual([
      { date: '2026-07-17', value: 6.81 },
      { date: '2026-07-03', value: 6.79 },
    ]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('series_id=MORTGAGE30US');
    expect(url).toContain('api_key=test-key');
  });

  it('no-fire: an HTTP error never throws — returns empty and logs', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' });
    const client = new FredClient(makeConfig('test-key'));

    const points = await client.fetchSeries('CPIAUCSL');
    expect(points).toEqual([]);
  });

  it('no-fire: a network exception never throws — returns empty', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    const client = new FredClient(makeConfig('test-key'));

    const points = await client.fetchSeries('FEDFUNDS');
    expect(points).toEqual([]);
  });
});
