import { describe, it, expect, vi } from 'vitest';
import { DigestSignalsService, localWeekWindows } from '../digest-signals.service';

/**
 * `gather` fires its five queries via Promise.all; each async method calls
 * `db.execute` synchronously up to its first await, so the calls resolve in
 * array order: categoryDeltas, topDrivers, upcomingBills, subscriptionChanges,
 * recentAnomalies. We queue results in that order.
 */
function buildDb(results: Array<{ rows: any[] }>) {
  const execute = vi.fn();
  for (const r of results) execute.mockResolvedValueOnce(r);
  return { execute };
}

describe('DigestSignalsService.gather', () => {
  it('ranks candidates by dollar magnitude, drops sub-threshold category moves, formats dollars', async () => {
    const db = buildDb([
      // categoryDeltas: one big move ($150 up), one tiny ($5) that must be filtered out
      {
        rows: [
          { category_name: 'Dining', recap_total: 40000, prior_total: 25000, delta: 15000 },
          { category_name: 'Coffee', recap_total: 1200, prior_total: 700, delta: 500 },
        ],
      },
      // topDrivers: biggest category
      { rows: [{ category_name: 'Rent', total: 50000 }] },
      // upcomingBills
      {
        rows: [
          {
            normalized_name: 'Electric',
            expected_amount_cents: 20000,
            next_expected_date: '2026-07-08T00:00:00Z',
          },
        ],
      },
      // subscriptionChanges
      {
        rows: [
          {
            normalized_name: 'Streaming+',
            expected_amount_cents: 1500,
            last_amount_cents: 4500,
            amount_tolerance_percent: 15,
          },
        ],
      },
      // recentAnomalies
      { rows: [{ message: 'Large purchase: $80.00 at Store.', metadata: { amountCents: 8000 } }] },
    ]);

    const service = new DigestSignalsService(db as any);
    const signals = await service.gather('u1', 'America/New_York');

    // Ranked strictly by amountCents desc: Rent 50000, Electric 20000, Dining 15000, anomaly 8000, sub 3000
    expect(signals.map((s) => s.amountCents)).toEqual([50000, 20000, 15000, 8000, 3000]);
    expect(signals[0].kind).toBe('top_driver');

    // Sub-threshold ($5) category move was filtered out
    expect(signals.some((s) => s.label.includes('Coffee'))).toBe(false);

    // Deltas carry both figures and direction, formatted as dollars
    const dining = signals.find((s) => s.kind === 'category_delta')!;
    expect(dining.detail).toContain('$400.00');
    expect(dining.detail).toContain('$250.00');
    expect(dining.detail).toContain('up $150.00');

    // Subscription change surfaces the increase
    const sub = signals.find((s) => s.kind === 'subscription_change')!;
    expect(sub.detail).toContain('$45.00');
    expect(sub.detail).toContain('$15.00');

    // Anomaly reuses the engine's message verbatim
    const anomaly = signals.find((s) => s.kind === 'anomaly')!;
    expect(anomaly.detail).toBe('Large purchase: $80.00 at Store.');
  });

  it('returns an empty list when there is nothing to report', async () => {
    const db = buildDb([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const service = new DigestSignalsService(db as any);
    expect(await service.gather('u1')).toEqual([]);
  });
});

describe('localWeekWindows', () => {
  it('yields the last completed Mon–Sun week and the week before it', () => {
    // Wed 2026-07-08 local → recap = Mon 06-29..Sun 07-05, prior = Mon 06-22..Sun 06-28
    const now = new Date('2026-07-08T12:00:00-04:00');
    const w = localWeekWindows('America/New_York', now);
    expect(w.recapStart).toBe('2026-06-29');
    expect(w.recapEnd).toBe('2026-07-06'); // exclusive (Mon of current week)
    expect(w.priorStart).toBe('2026-06-22');
    expect(w.priorEnd).toBe('2026-06-29'); // exclusive
  });
});
