import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EiaClient } from '../eia.client';

function makeConfig(apiKey?: string) {
  return { get: (key: string) => (key === 'EIA_API_KEY' ? apiKey : undefined) } as any;
}

// Recorded-shape fixture of EIA v2's /data response envelope (not a live call).
const EIA_FIXTURE = {
  response: {
    data: [
      { period: '2026-07-14', value: '3.412' },
      { period: '2026-07-07', value: '3.398' },
    ],
  },
};

describe('EiaClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no-fire: skips the call entirely with no EIA_API_KEY configured', async () => {
    const client = new EiaClient(makeConfig(undefined));
    const points = await client.fetchGasPrice('SCA');
    expect(points).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses a fixture response into typed points, newest first', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => EIA_FIXTURE });
    const client = new EiaClient(makeConfig('test-key'));

    const points = await client.fetchGasPrice('SCA');

    expect(points).toEqual([
      { period: '2026-07-14', value: 3.412 },
      { period: '2026-07-07', value: 3.398 },
    ]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('petroleum/pri/gnd/data');
    expect(url).toContain('facets%5Bduoarea%5D%5B%5D=SCA');
    expect(url).toContain('api_key=test-key');
  });

  it('electricity route uses stateid/sectorid facets, not duoarea', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => EIA_FIXTURE });
    const client = new EiaClient(makeConfig('test-key'));

    await client.fetchElectricityPrice('CA');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('electricity/retail-sales/data');
    expect(url).toContain('facets%5Bstateid%5D%5B%5D=CA');
    expect(url).toContain('facets%5Bsectorid%5D%5B%5D=RES');
  });

  it('no-fire: an HTTP error never throws — returns empty and logs', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' });
    const client = new EiaClient(makeConfig('test-key'));

    const points = await client.fetchGasPrice('SCA');
    expect(points).toEqual([]);
  });

  it('no-fire: a network exception never throws — returns empty', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new EiaClient(makeConfig('test-key'));

    const points = await client.fetchGasPrice('SCA');
    expect(points).toEqual([]);
  });

  it('drops non-numeric values instead of producing NaN points', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: { data: [{ period: '2026-07-14', value: 'NA' }] } }),
    });
    const client = new EiaClient(makeConfig('test-key'));

    const points = await client.fetchGasPrice('SCA');
    expect(points).toEqual([]);
  });
});
