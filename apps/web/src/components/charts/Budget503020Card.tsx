'use client';

import Link from 'next/link';
import { PiggyBank } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BudgetPlanBucket, BudgetPlanData } from '@/lib/hooks/useAnalytics';

/** One row (Needs/Wants/Savings) of the 50/30/20 card: label, actual bar, target band. */
function BucketRow({
  label,
  bucket,
}: {
  label: string;
  bucket: BudgetPlanBucket;
}) {
  const actualPct = (bucket.actualPercent ?? 0) * 100;
  const min = bucket.target.min * 100;
  const max = bucket.target.max !== null ? bucket.target.max * 100 : null;
  const inRange = max !== null ? actualPct >= min && actualPct <= max : actualPct >= min;
  const barColor = inRange
    ? 'bg-green-500'
    : actualPct > (max ?? min)
      ? 'bg-red-500'
      : 'bg-amber-500';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-[var(--muted-foreground)]">
          {actualPct.toFixed(1)}%{' '}
          <span className="text-xs">
            (target {max !== null ? `${min}-${max}%` : `${min}%+`})
          </span>
        </span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        {/* Target band */}
        <div
          className="absolute top-0 h-full bg-[var(--muted-foreground)]/15"
          style={{
            left: `${Math.min(min, 100)}%`,
            width: `${Math.max((max ?? 100) - min, 0)}%`,
          }}
        />
        {/* Actual */}
        <div
          className={cn('absolute top-0 h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${Math.min(actualPct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/** 50/30/20 (Needs/Wants/Savings) dashboard card. Shows an empty state prompting the
 *  user to add a paycheck profile when none exists yet for the selected month. */
export function Budget503020Card({ data }: { data: BudgetPlanData }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <PiggyBank className="h-5 w-5 text-[var(--primary)]" />
        <h2 className="text-lg font-bold">50/30/20 Plan</h2>
      </div>

      {!data.hasProfile || !data.needs || !data.wants || !data.savings ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-10 text-center">
          <p className="mb-3 text-sm text-[var(--muted-foreground)]">
            Add a paycheck profile to see your Needs / Wants / Savings breakdown for{' '}
            {data.month}.
          </p>
          <Link
            href="/settings/paycheck-profiles"
            className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90"
          >
            Add Paycheck Profile
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <BucketRow label="Needs" bucket={data.needs} />
          <BucketRow label="Wants" bucket={data.wants} />
          <BucketRow label="Savings/Debt" bucket={data.savings} />
        </div>
      )}
    </div>
  );
}
