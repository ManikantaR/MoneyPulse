import { formatCents } from '@/lib/format';
import { TrendingUp, TrendingDown, Wallet, CreditCard, LineChart } from 'lucide-react';

/** Props for the net worth summary card. */
interface NetWorthCardProps {
  assets: number;
  liabilities: number;
  investments: number;
  netWorth: number;
}

/** Large summary card showing net worth breakdown with trend indicator. */
export function NetWorthCard({
  assets,
  liabilities,
  investments,
  netWorth,
}: NetWorthCardProps) {
  const isPositive = netWorth >= 0;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">
        Net Worth
      </h3>
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold tracking-tight">
          {formatCents(Math.abs(netWorth))}
        </span>
        {isPositive ? (
          <TrendingUp className="h-5 w-5 text-emerald-500" />
        ) : (
          <TrendingDown className="h-5 w-5 text-red-500" />
        )}
      </div>
      {!isPositive && (
        <p className="mt-0.5 text-xs text-red-500">Negative net worth</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-4">
        {/* Assets */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <Wallet className="h-3.5 w-3.5" />
            Assets
          </div>
          <p className="text-sm font-semibold text-emerald-500 tabular-nums">
            {formatCents(assets)}
          </p>
        </div>

        {/* Liabilities */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <CreditCard className="h-3.5 w-3.5" />
            Liabilities
          </div>
          <p className="text-sm font-semibold text-red-500 tabular-nums">
            {formatCents(liabilities)}
          </p>
        </div>

        {/* Investments */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <LineChart className="h-3.5 w-3.5" />
            Investments
          </div>
          <p className="text-sm font-semibold text-[var(--primary)] tabular-nums">
            {formatCents(investments)}
          </p>
        </div>
      </div>
    </div>
  );
}
