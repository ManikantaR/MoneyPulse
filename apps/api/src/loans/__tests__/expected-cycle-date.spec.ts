import { describe, it, expect } from 'vitest';
import { expectedCycleDate } from '../loans.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('expectedCycleDate', () => {
  it('returns this month once the due date has cleared the grace period', () => {
    // Due on the 20th; "now" is the 28th → 8 days past, beyond 5-day grace.
    const now = new Date('2026-07-28T12:00:00Z');
    expect(iso(expectedCycleDate('2022-07-20', now, 5))).toBe('2026-07-20');
  });

  it('falls back to last month when this month is still within grace', () => {
    // Due on the 20th; "now" is the 22nd → only 2 days past, inside 5-day grace.
    const now = new Date('2026-07-22T12:00:00Z');
    expect(iso(expectedCycleDate('2022-07-20', now, 5))).toBe('2026-06-20');
  });

  it('falls back to last month when this month is not yet due', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(iso(expectedCycleDate('2022-07-20', now, 5))).toBe('2026-06-20');
  });

  it('clamps the day-of-month to shorter months', () => {
    // Payment on the 31st; February has 28 days in 2026.
    const now = new Date('2026-03-05T12:00:00Z');
    expect(iso(expectedCycleDate('2020-01-31', now, 5))).toBe('2026-02-28');
  });

  it('rolls the year boundary back when falling to the previous month', () => {
    const now = new Date('2026-01-03T12:00:00Z');
    expect(iso(expectedCycleDate('2022-01-15', now, 5))).toBe('2025-12-15');
  });

  it('returns null before the loan has reached its first due-plus-grace date', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    // Loan starts this month; the first cycle is only 1 day past → grace pushes it to
    // last month, which is before the start date.
    expect(expectedCycleDate('2026-07-20', now, 5)).toBeNull();
  });
});
