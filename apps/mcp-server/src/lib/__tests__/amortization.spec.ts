import { describe, it, expect } from 'vitest';
import { computeLoanState, projectPayoff } from '../amortization.js';

// $100,000 loan, 6% APR (600 bps), $600/mo. Monthly rate 0.005.
const LOAN = {
  originalBalanceCents: 10_000_000,
  aprBps: 600,
  scheduledPaymentCents: 60_000,
  startDate: '2026-06-01',
};

describe('computeLoanState', () => {
  it('splits the first payment into interest + principal', () => {
    const s = computeLoanState(LOAN, [], new Date('2026-07-01T00:00:00Z'));
    expect(s.monthsElapsed).toBe(1);
    expect(s.interestPaidCents).toBe(50_000); // 10,000,000 * 0.005
    expect(s.principalPaidCents).toBe(10_000); // 60,000 - 50,000
    expect(s.currentBalanceCents).toBe(9_990_000);
    expect(s.amortizes).toBe(true);
  });

  it('applies detected extra-principal payments', () => {
    const s = computeLoanState(
      LOAN,
      [{ date: '2026-06-15', amountCents: 1_000_000 }],
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(s.extraPrincipalPaidCents).toBe(1_000_000);
    expect(s.currentBalanceCents).toBe(8_990_000); // 9,990,000 - 1,000,000
  });

  it('flags a payment that does not cover interest (negative amortization)', () => {
    const s = computeLoanState(
      { ...LOAN, scheduledPaymentCents: 40_000 }, // < 50,000 interest
      [],
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(s.amortizes).toBe(false);
    expect(s.currentBalanceCents).toBe(10_000_000); // never decreases
  });

  it('is zero-progress for a brand-new loan', () => {
    const s = computeLoanState(LOAN, [], new Date('2026-06-01T00:00:00Z'));
    expect(s.monthsElapsed).toBe(0);
    expect(s.currentBalanceCents).toBe(10_000_000);
    expect(s.principalPaidCents).toBe(0);
  });
});

describe('projectPayoff', () => {
  it('projects a finite payoff and extra payments shorten it', () => {
    const base = projectPayoff(9_990_000, 600, 60_000, new Date('2026-07-01T00:00:00Z'));
    expect(base.amortizes).toBe(true);
    expect(base.monthsRemaining).toBeGreaterThan(0);
    expect(base.remainingInterestCents).toBeGreaterThan(0);

    const accel = projectPayoff(9_990_000, 600, 120_000, new Date('2026-07-01T00:00:00Z'));
    expect(accel.monthsRemaining).toBeLessThan(base.monthsRemaining);
    expect(accel.remainingInterestCents).toBeLessThan(base.remainingInterestCents);
  });

  it('reports non-amortizing when the payment never covers interest', () => {
    const p = projectPayoff(10_000_000, 600, 40_000);
    expect(p.amortizes).toBe(false);
    expect(p.monthsRemaining).toBe(Infinity);
  });
});
