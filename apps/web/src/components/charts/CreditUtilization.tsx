'use client';

import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/format';

/** Credit card utilization row. */
interface CreditUtilizationData {
  accountId: string;
  nickname: string;
  balanceCents: number;
  limitCents: number;
  utilizationPercent: number;
}

/** Props for the credit utilization component. */
interface CreditUtilizationProps {
  data: CreditUtilizationData[];
}

/** Progress-bar style credit utilization display per card. */
export function CreditUtilization({ data }: CreditUtilizationProps) {
  /** Get color class based on utilization threshold. */
  function getBarColor(percent: number): string {
    if (percent >= 75) return 'bg-red-500';
    if (percent >= 50) return 'bg-amber-500';
    return 'bg-emerald-500';
  }

  return (
    <div className="rounded-2xl bg-[var(--surface-container-low)] p-6">
      <h3 className="mb-1 text-xl font-bold tracking-tight">
        Credit Utilization
      </h3>
      <p className="mb-6 text-sm text-[var(--muted-foreground)]">Balance vs limit per card</p>
      {data.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No credit cards found</p>
      ) : (
        <div className="space-y-5">
          {data.map((card) => (
            <div key={card.accountId} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{card.nickname}</span>
                <span className="text-[var(--muted-foreground)] tabular-nums">
                  {formatCents(card.balanceCents)} / {formatCents(card.limitCents)}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
                <div
                  className={cn('h-full rounded-full transition-all', getBarColor(card.utilizationPercent))}
                  style={{ width: `${Math.min(card.utilizationPercent, 100)}%` }}
                />
              </div>
              <p className="text-right text-xs font-semibold text-[var(--muted-foreground)]">
                {card.utilizationPercent.toFixed(1)}%
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
