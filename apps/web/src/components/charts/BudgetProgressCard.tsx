'use client';

import Link from 'next/link';
import { formatCents } from '@/lib/format';
import type { BudgetProgressItem } from '@/lib/hooks/useAnalytics';

interface BudgetProgressCardProps {
  data: BudgetProgressItem[];
  /** When true, shows a "View all →" link to /budgets. Default: false. */
  showViewAll?: boolean;
}

function statusColor(status: BudgetProgressItem['status']): string {
  if (status === 'over_budget') return '#ef4444';
  if (status === 'warning') return '#eab308';
  return '#22c55e';
}

function ProgressRow({ item }: { item: BudgetProgressItem }) {
  const barWidth = Math.min(item.percentUsed, 100);
  const color = statusColor(item.status);
  const overBy = -item.remainingCents; // positive when over

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium truncate">
          <span>{item.categoryIcon}</span>
          <span className="truncate">{item.categoryName}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
          {formatCents(item.spentCents)} / {formatCents(item.budgetCents)}
          <span className="ml-1.5 font-semibold" style={{ color }}>
            {item.percentUsed}%
          </span>
        </span>
      </div>

      {/* Progress bar track */}
      <div className="h-2 w-full rounded-full bg-[var(--muted)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${barWidth}%`, backgroundColor: color }}
        />
      </div>

      {item.status === 'over_budget' && (
        <p className="text-xs font-medium" style={{ color: '#ef4444' }}>
          Over by {formatCents(overBy)}
        </p>
      )}
    </div>
  );
}

export function BudgetProgressCard({ data, showViewAll = false }: BudgetProgressCardProps) {
  if (!data || data.length === 0) return null;

  return (
    <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Budget Progress</h2>
        {showViewAll && (
          <Link
            href="/budgets"
            className="text-sm text-[var(--primary)] hover:underline"
          >
            View all →
          </Link>
        )}
      </div>

      <div className="space-y-4">
        {data.map((item) => (
          <ProgressRow key={item.budgetId} item={item} />
        ))}
      </div>
    </div>
  );
}
