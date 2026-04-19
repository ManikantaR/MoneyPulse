'use client';

import { formatCents } from '@/lib/format';

interface Props {
  categoryName: string;
  categoryIcon: string;
  amountCents: number;
  spentCents: number;
  period: string;
  isHousehold: boolean;
  onDelete?: () => void;
}

export function BudgetCard({
  categoryName,
  categoryIcon,
  amountCents,
  spentCents,
  period,
  isHousehold,
  onDelete,
}: Props) {
  const pct = amountCents > 0 ? (spentCents / amountCents) * 100 : 0;
  const barColor =
    pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span>{categoryIcon}</span>
          <span className="font-medium text-sm">{categoryName}</span>
          {isHousehold && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
              Shared
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground capitalize">
          {period}
        </span>
      </div>

      <div className="flex justify-between text-sm mb-1">
        <span>{formatCents(spentCents)} spent</span>
        <span className="text-muted-foreground">
          of {formatCents(amountCents)}
        </span>
      </div>

      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={`h-2 rounded-full ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {pct > 80 && (
        <p
          className={`text-xs mt-1 ${pct > 100 ? 'text-red-600' : 'text-yellow-600'}`}
        >
          {pct > 100
            ? `Over budget by ${formatCents(spentCents - amountCents)}`
            : `${pct.toFixed(0)}% used`}
        </p>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          className="text-xs text-muted-foreground hover:text-red-600 mt-2"
        >
          Remove
        </button>
      )}
    </div>
  );
}
