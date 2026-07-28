'use client';

import { useState } from 'react';
import { formatCents } from '@/lib/format';
import { computeLoanState } from '@moneypulse/shared';
import type { Loan } from '@moneypulse/shared';
import {
  useLoansForVerification,
  useUpsertLoanBalanceSnapshot,
  useLoanBalanceSnapshots,
} from '@/lib/hooks/useMonthlyClose';

/** One loan: the verified (manual_statement) balance when one exists for the
 *  current month — or, failing that, the most recent manual_statement on file —
 *  shown as the primary figure, with the amortized estimate as a secondary
 *  comparison. Falls back to the amortized estimate alone when no manual
 *  statement has ever been recorded. */
function LoanRow({ loan, month }: { loan: Loan; month: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const upsert = useUpsertLoanBalanceSnapshot();
  const { data: snapshotsData, isLoading: snapshotsLoading } = useLoanBalanceSnapshots(loan.id);
  const snapshots = snapshotsData?.data ?? [];

  // `listBalanceSnapshots` is ordered by snapshotMonth desc, so the first match
  // for the current month (if any) is exact; otherwise the first row overall is
  // the most recent manual statement on file.
  const currentMonthSnapshot = snapshots.find((s) => s.snapshotMonth.slice(0, 7) === month.slice(0, 7));
  const latestSnapshot = currentMonthSnapshot ?? snapshots[0] ?? null;
  const verifiedThisMonth = !!currentMonthSnapshot;

  const amortized = computeLoanState(
    {
      originalBalanceCents: loan.originalBalanceCents,
      aprBps: loan.aprBps,
      scheduledPaymentCents: loan.scheduledPaymentCents,
      startDate: loan.startDate,
    },
    [],
  );

  const submit = async () => {
    const dollars = parseFloat(value);
    if (!Number.isFinite(dollars) || dollars < 0) return;
    await upsert.mutateAsync({
      loanId: loan.id,
      month,
      balanceCents: Math.round(dollars * 100),
      source: 'manual_statement',
    });
    setEditing(false);
    setValue('');
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-0">
      <div>
        <p className="text-sm font-medium">{loan.name}</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          {latestSnapshot ? (
            <>
              Verified: {formatCents(latestSnapshot.balanceCents)}
              <span className="ml-2 text-[10px] opacity-70">
                (amortized est. {formatCents(amortized.currentBalanceCents)})
              </span>
            </>
          ) : (
            <>Amortized: {formatCents(amortized.currentBalanceCents)}</>
          )}
          {!snapshotsLoading && !verifiedThisMonth && (
            <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
              Unverified
            </span>
          )}
          {verifiedThisMonth && (
            <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
              Verified
            </span>
          )}
        </p>
      </div>
      {editing ? (
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
      )}
    </div>
  );
}

/** Loan verification panel: verified (manual-statement) balance per loan when one
 *  exists, with the amortized estimate as a secondary comparison figure, and this
 *  month's principal paid. Each row fetches its own balance-snapshot history so a
 *  statement entered previously (e.g. via API/support tooling) is reflected
 *  immediately, not just ones entered through this exact session. */
export function LoanVerificationPanel({ month }: { month: string }) {
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
        {loans.map((loan) => (
          <LoanRow key={loan.id} loan={loan} month={month} />
        ))}
      </div>
    </div>
  );
}
