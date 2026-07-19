import { describe, it, expect } from 'vitest';
import { nextLoanDueDate } from '../loans.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('nextLoanDueDate', () => {
  it('returns this month when the due date has not yet passed', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(iso(nextLoanDueDate('2022-07-20', now))).toBe('2026-07-20');
  });

  it('returns today when the due date is today', () => {
    const now = new Date('2026-07-20T18:00:00Z');
    expect(iso(nextLoanDueDate('2022-07-20', now))).toBe('2026-07-20');
  });

  it('rolls forward to next month once this month due date has passed', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    expect(iso(nextLoanDueDate('2022-07-20', now))).toBe('2026-08-20');
  });

  it('clamps the day-of-month to shorter months', () => {
    const now = new Date('2026-02-01T12:00:00Z');
    // Payment on the 31st; February has 28 days in 2026.
    expect(iso(nextLoanDueDate('2020-01-31', now))).toBe('2026-02-28');
  });

  it('rolls the year boundary forward from December to January', () => {
    const now = new Date('2025-12-16T12:00:00Z');
    expect(iso(nextLoanDueDate('2022-12-15', now))).toBe('2026-01-15');
  });
});
