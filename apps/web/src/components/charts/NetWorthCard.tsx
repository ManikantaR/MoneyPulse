import { formatCents } from '@/lib/format';
import { TrendingUp, TrendingDown, Wallet, CreditCard, LineChart, ChevronRight } from 'lucide-react';

/** Props for the net worth summary card. */
interface NetWorthCardProps {
  assets: number;
  liabilities: number;
  investments: number;
  netWorth: number;
  onClickAssets?: () => void;
  onClickLiabilities?: () => void;
}

/** Large summary card showing net worth breakdown with trend indicator. */
export function NetWorthCard({
  assets,
  liabilities,
  investments,
  netWorth,
  onClickAssets,
  onClickLiabilities,
}: NetWorthCardProps) {
  const isPositive = netWorth >= 0;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-[var(--surface-container-low)] p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
          Net Worth
        </h3>
        {isPositive ? (
          <TrendingUp className="h-5 w-5 text-[var(--secondary)]" />
        ) : (
          <TrendingDown className="h-5 w-5 text-[var(--destructive)]" />
        )}
      </div>
      <div className="mt-2">
        <span className="text-4xl font-extrabold tracking-tight">
          {formatCents(Math.abs(netWorth))}
        </span>
        {!isPositive && (
          <p className="mt-1 text-xs text-[var(--destructive)]">Negative net worth</p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 border-t border-[var(--border)] pt-6">
        {/* Assets — clickable */}
        <button
          onClick={onClickAssets}
          disabled={!onClickAssets}
          className="group flex flex-col gap-1 rounded-xl p-2 -mx-2 text-left transition-colors enabled:hover:bg-[var(--muted)] disabled:cursor-default"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              <Wallet className="h-3.5 w-3.5" />
              Assets
            </div>
            {onClickAssets && (
              <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
          <p className="text-lg font-bold text-[var(--secondary)] tabular-nums">
            {formatCents(assets)}
          </p>
        </button>

        {/* Liabilities — clickable */}
        <button
          onClick={onClickLiabilities}
          disabled={!onClickLiabilities}
          className="group flex flex-col gap-1 rounded-xl p-2 -mx-2 text-left transition-colors enabled:hover:bg-[var(--muted)] disabled:cursor-default"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              <CreditCard className="h-3.5 w-3.5" />
              Liabilities
            </div>
            {onClickLiabilities && (
              <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
          <p className="text-lg font-bold text-[var(--destructive)] tabular-nums">
            {formatCents(liabilities)}
          </p>
        </button>

        {/* Investments — static */}
        <div className="flex flex-col gap-1 rounded-xl p-2 -mx-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            <LineChart className="h-3.5 w-3.5" />
            Investments
          </div>
          <p className="text-lg font-bold text-[var(--primary)] tabular-nums">
            {formatCents(investments)}
          </p>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-[var(--primary)]/50 to-transparent" />
    </div>
  );
}
