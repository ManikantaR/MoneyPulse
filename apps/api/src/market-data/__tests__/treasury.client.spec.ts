import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TreasuryClient } from '../treasury.client';

// Recorded-shape fixture of fiscaldata's avg_interest_rates response (not a live call).
const TREASURY_13W_FIXTURE = {
  data: [
    { record_date: '2026-07-17', bc_13week: '4.31' },
    { record_date: '2026-07-16', bc_13week: '4.30' },
    { record_date: '2026-07-15', bc_13week: '4.29' },
  ],
};

describe('TreasuryClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses fiscaldata rows for a known metric key', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => TREASURY_13W_FIXTURE });
    const client = new TreasuryClient();

    const points = await client.fetchSeries('treasury_bill_13w');

    expect(points).toEqual([
      { date: '2026-07-17', value: 4.31 },
      { date: '2026-07-16', value: 4.3 },
      { date: '2026-07-15', value: 4.29 },
    ]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('bc_13week');
  });

  it('no-fire: returns [] for an unmapped metric key without calling fetch', async () => {
    const client = new TreasuryClient();
    const points = await client.fetchSeries('not_a_real_series');
    expect(points).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws on a non-ok response — returns [] so callers fall back to stored values', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    const client = new TreasuryClient();
    const points = await client.fetchSeries('treasury_bill_4w');
    expect(points).toEqual([]);
  });

  it('never throws on a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const client = new TreasuryClient();
    const points = await client.fetchSeries('treasury_note_10y');
    expect(points).toEqual([]);
  });
});
