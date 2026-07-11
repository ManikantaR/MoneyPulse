import { describe, it, expect } from 'vitest';
import { toBusinessDate, utcDayStart } from '../transactions.service';

describe('toBusinessDate (#55)', () => {
  it('reduces a UTC-midnight Date to its calendar day', () => {
    // A Jul-1 business date stored at UTC midnight must serialize as 2026-07-01,
    // never leaking a time component that a client could shift to Jun 30.
    expect(toBusinessDate(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-07-01');
  });

  it('keeps the UTC calendar day even when the instant has a time-of-day', () => {
    expect(toBusinessDate(new Date('2026-07-01T23:30:00.000Z'))).toBe('2026-07-01');
  });

  it('truncates an ISO string to its date part', () => {
    expect(toBusinessDate('2026-07-01T00:00:00.000Z')).toBe('2026-07-01');
  });

  it('passes a date-only string through unchanged', () => {
    expect(toBusinessDate('2026-07-01')).toBe('2026-07-01');
  });

  it('passes null/undefined through unchanged', () => {
    expect(toBusinessDate(null)).toBeNull();
    expect(toBusinessDate(undefined)).toBeUndefined();
  });
});

describe('utcDayStart (#55)', () => {
  it('parses a date-only bound to UTC midnight', () => {
    expect(utcDayStart('2026-07-01').toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('normalizes a full ISO bound to the calendar day at UTC midnight', () => {
    expect(utcDayStart('2026-07-05T18:00:00.000Z').toISOString()).toBe(
      '2026-07-05T00:00:00.000Z',
    );
  });

  it('yields a [from, to+1day) window that includes the whole `to` day', () => {
    // Range filter uses gte(from) + lt(to+1day); a transaction anywhere on the
    // last day (Jul 5) must fall inside the window.
    const from = utcDayStart('2026-07-01');
    const toExclusive = utcDayStart('2026-07-05');
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const lastDayTxn = new Date('2026-07-05T23:59:59.000Z');
    expect(lastDayTxn >= from).toBe(true);
    expect(lastDayTxn < toExclusive).toBe(true);

    const nextDayTxn = new Date('2026-07-06T00:00:00.000Z');
    expect(nextDayTxn < toExclusive).toBe(false);
  });
});
