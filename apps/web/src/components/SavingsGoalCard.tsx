'use client';

import { formatCents } from '@/lib/format';

interface Props {
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  targetDate: string | null;
  onContribute?: () => void;
}

export function SavingsGoalCard({
  name,
  targetAmountCents,
  currentAmountCents,
  targetDate,
  onContribute,
}: Props) {
  const pct =
    targetAmountCents > 0 ? (currentAmountCents / targetAmountCents) * 100 : 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm">{name}</span>
        {targetDate && (
          <span className="text-xs text-muted-foreground">by {targetDate}</span>
        )}
      </div>

      <div className="flex justify-between text-sm mb-1">
        <span>{formatCents(currentAmountCents)}</span>
        <span className="text-muted-foreground">
          of {formatCents(targetAmountCents)}
        </span>
      </div>

      <div className="w-full bg-muted rounded-full h-2 mb-2">
        <div
          className="h-2 rounded-full bg-blue-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {pct.toFixed(0)}%
        </span>
        {onContribute && (
          <button
            onClick={onContribute}
            className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded"
          >
            + Contribute
          </button>
        )}
      </div>
    </div>
  );
}
