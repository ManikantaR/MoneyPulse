import { formatCents } from '@/lib/format';
import type { Transaction } from '@moneypulse/shared';
import { format } from 'date-fns';
import { Flame } from 'lucide-react';

interface TopTransactionsCardProps {
  transactions: Transaction[];
}

/** Ranked list of the 5 highest-value expense transactions in the period. */
export function TopTransactionsCard({ transactions }: TopTransactionsCardProps) {
  const expenses = transactions
    .filter((t) => !t.isCredit)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 5);

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6 flex flex-col h-full">
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Flame className="h-4 w-4 text-[var(--destructive)]" />
          <h3 className="text-xl font-bold tracking-tight">Big Spends</h3>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">Top 5 transactions by amount</p>
      </div>

      <div className="space-y-3 flex-1">
        {expenses.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No expense transactions found</p>
        ) : (
          expenses.map((tx, i) => (
            <div
              key={tx.id}
              className="flex items-center gap-3 rounded-xl bg-[var(--surface-container-high)] px-4 py-3"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--destructive)]/10 text-xs font-extrabold text-[var(--destructive)]">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {tx.merchantName || tx.description}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {format(new Date(tx.date), 'MMM d, yyyy')}
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--destructive)]">
                {formatCents(Math.abs(tx.amountCents))}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
