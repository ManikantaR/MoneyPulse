import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { StooqClient, parseStooqCsv } from '../stooq.client';

// Recorded fixture — a trimmed real-shaped Stooq CSV response for a synthetic
// EOD close. No live network calls in tests (12.2 spec).
const STOOQ_VTI_FIXTURE = `Date,Open,High,Low,Close,Volume
2026-06-29,250.10,251.00,249.80,250.55,3200000
2026-06-30,250.60,252.20,250.10,251.90,3100000
2026-07-01,251.95,253.40,251.50,253.10,3050000
`;

const STOOQ_UNKNOWN_TICKER = 'N/D\n';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseStooqCsv', () => {
  it('parses the latest row as the close', () => {
    const point = parseStooqCsv(STOOQ_VTI_FIXTURE);
    expect(point).toEqual({ date: '2026-07-01', closeCents: 25310, currency: 'USD' });
  });

  it('returns null for an unknown ticker (Stooq "N/D" body)', () => {
    expect(parseStooqCsv(STOOQ_UNKNOWN_TICKER)).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseStooqCsv('')).toBeNull();
  });
});

describe('StooqClient', () => {
  it('fetches and parses the latest close using a recorded fixture', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => STOOQ_VTI_FIXTURE,
    }) as any;
    const client = new StooqClient();
    const point = await client.fetchLatestClose('VTI');
    expect(point).toEqual({ date: '2026-07-01', closeCents: 25310, currency: 'USD' });
  });

  it('returns null (never throws) on a provider outage', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    const client = new StooqClient();
    const point = await client.fetchLatestClose('VTI');
    expect(point).toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const client = new StooqClient();
    const point = await client.fetchLatestClose('VTI');
    expect(point).toBeNull();
  });

  it('returns null (and logs distinctly) on a 200 OK HTML anti-bot challenge page', async () => {
    // Reproduces Stooq's current behavior for this endpoint: HTTP 200 with an HTML
    // "verify your browser" proof-of-work interstitial instead of CSV, for every
    // ticker — must not be silently treated the same as a legitimate empty/N-D body.
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<!DOCTYPE html><html><head></head><body><noscript>This site requires JavaScript' +
        ' to verify your browser.</noscript><script>/* PoW challenge */</script></body></html>',
    }) as any;
    const client = new StooqClient();
    const point = await client.fetchLatestClose('VTI');
    expect(point).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('non-CSV'));
  });
});
