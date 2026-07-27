'use client';

import { useState } from 'react';
import { formatCents } from '@/lib/format';
import { computeLoanState } from '@moneypulse/shared';
import { useLoansForVerification, useUpsertLoanBalanceSnapshot } from '@/lib/hooks/useMonthlyClose';

/** One loan: amortized balance vs an optional manual-statement override, plus
 *  principal paid this month. */
function LoanRow({ loanId, month }: { loanId: string; month: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const upsert = useUpsertLoanBalanceSnapshot();

  const submit = async () => {
    const dollars = parseFloat(value);
    if (!Number.isFinite(dollars) || dollars < 0) return;
    await upsert.mutateAsync({
      loanId,
      month,
      balanceCents: Math.round(dollars * 100),
      source: 'manual_statement',
    });
    setEditing(false);
    setValue('');
  };

  return editing ? (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm tabular-nums"
        placeholder="0.00"
      />
      <button
        onClick={submit}
        disabled={upsert.isPending}
        className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
      >
        Save
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-[var(--muted-foreground)]">
        Cancel
      </button>
    </div>
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]"
    >
      Verify statement balance
    </button>
  );
}

/** Loan verification panel: amortized-vs-manual-statement balance per loan, with
 *  the source used and this month's principal paid. `unverifiedLoans` comes from
 *  the close's freshness map. */
export function LoanVerificationPanel({
  month,
  unverifiedLoans,
}: {
  month: string;
  unverifiedLoans: string[];
}) {
  const { data, isLoading } = useLoansForVerification();
  const loans = data?.data ?? [];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4" data-testid="loan-verification-panel">
      <h3 className="mb-2 font-bold">Loan Verification</h3>
      {isLoading && <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}
      {!isLoading && loans.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">No loans tracked.</p>
      )}
      <div className="space-y-3">
        {loans.map((loan) => {
          const state = computeLoanState(
            {
              originalBalanceCents: loan.originalBalanceCents,
              aprBps: loan.aprBps,
              scheduledPaymentCents: loan.scheduledPaymentCents,
              startDate: loan.startDate,
            },
            [],
          );
          const unverified = unverifiedLoans.includes(loan.id);
          return (
            <div key={loan.id} className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-0">
              <div>
                <p className="text-sm font-medium">{loan.name}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Amortized: {formatCents(state.currentBalanceCents)}
                  {unverified && (
                    <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                      Unverified
                    </span>
                  )}
                </p>
              </div>
              <LoanRow loanId={loan.id} month={month} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
