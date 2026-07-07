/** Pure loan amortization math — no DB, no deps. Cents in, cents out.
 *
 * Mirrors apps/mcp-server/src/lib/amortization.ts (the advisor's copy). The MCP server
 * is a standalone bundle without a @moneypulse/shared dependency, so the two are kept in
 * sync by hand. Keep any formula change in both places. */

export interface LoanInputs {
  originalBalanceCents: number;
  aprBps: number; // APR basis points (3.25% → 325)
  scheduledPaymentCents: number; // regular P+I payment
  startDate: string; // YYYY-MM-DD
}

export interface ExtraPayment {
  date: string; // YYYY-MM-DD
  amountCents: number;
}

export interface LoanState {
  monthsElapsed: number;
  currentBalanceCents: number;
  principalPaidCents: number;
  interestPaidCents: number;
  extraPrincipalPaidCents: number;
  /** False if the scheduled payment never covers interest (negative amortization). */
  amortizes: boolean;
}

export interface PayoffProjection {
  monthsRemaining: number;
  remainingInterestCents: number;
  payoffDate: string; // YYYY-MM-DD
  amortizes: boolean;
}

const MAX_MONTHS = 1200; // 100-year guard

function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  );
}

/** Replay the loan from start to `asOf`, applying scheduled payments + detected extra principal. */
export function computeLoanState(
  loan: LoanInputs,
  extras: ExtraPayment[],
  asOf = new Date(),
): LoanState {
  const rate = loan.aprBps / 10000 / 12;
  const start = new Date(loan.startDate + 'T00:00:00Z');
  const elapsed = Math.max(0, monthsBetween(start, asOf));

  const extrasByMonth = new Map<number, number>();
  for (const e of extras) {
    const idx = monthsBetween(start, new Date(e.date + 'T00:00:00Z'));
    if (idx >= 0) extrasByMonth.set(idx, (extrasByMonth.get(idx) ?? 0) + e.amountCents);
  }

  let balance = loan.originalBalanceCents;
  let principalPaid = 0;
  let interestPaid = 0;
  let extraPaid = 0;
  let amortizes = true;

  for (let m = 0; m < elapsed && balance > 0; m++) {
    const interest = Math.round(balance * rate);
    let principal = loan.scheduledPaymentCents - interest;
    if (principal <= 0) {
      amortizes = false;
      principal = 0;
    }
    principal = Math.min(principal, balance);
    balance -= principal;
    principalPaid += principal;
    interestPaid += interest;

    const extra = Math.min(extrasByMonth.get(m) ?? 0, balance);
    if (extra > 0) {
      balance -= extra;
      extraPaid += extra;
    }
  }

  return {
    monthsElapsed: elapsed,
    currentBalanceCents: Math.max(0, balance),
    principalPaidCents: principalPaid,
    interestPaidCents: interestPaid,
    extraPrincipalPaidCents: extraPaid,
    amortizes,
  };
}

/** Project remaining months + interest to pay off `balance` at `monthlyPayment`. */
export function projectPayoff(
  balanceCents: number,
  aprBps: number,
  monthlyPaymentCents: number,
  asOf = new Date(),
): PayoffProjection {
  const rate = aprBps / 10000 / 12;
  let balance = balanceCents;
  let interest = 0;
  let months = 0;

  while (balance > 0 && months < MAX_MONTHS) {
    const i = Math.round(balance * rate);
    let p = monthlyPaymentCents - i;
    if (p <= 0) {
      return { monthsRemaining: Infinity, remainingInterestCents: 0, payoffDate: '', amortizes: false };
    }
    p = Math.min(p, balance);
    balance -= p;
    interest += i;
    months++;
  }

  const d = new Date(asOf);
  d.setMonth(d.getMonth() + months);
  return {
    monthsRemaining: months,
    remainingInterestCents: interest,
    payoffDate: d.toISOString().slice(0, 10),
    amortizes: true,
  };
}
