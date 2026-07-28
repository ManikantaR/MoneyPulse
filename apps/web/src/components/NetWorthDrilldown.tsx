'use client';

import { X, Wallet, CreditCard, LineChart, TrendingUp, ExternalLink, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatCents } from '@/lib/format';
import type { NetWorthBreakdown, NetWorthLineItem } from '@/lib/hooks/useAnalytics';

export type DrilldownType = 'assets' | 'liabilities' | 'investments';

interface NetWorthDrilldownProps {
  type: DrilldownType;
  breakdown: NetWorthBreakdown;
  onClose: () => void;
  from?: string;
  to?: string;
}

const THEME: Record<DrilldownType, { label: string; icon: typeof Wallet; color: string }> = {
  assets: { label: 'Total Assets', icon: Wallet, color: 'var(--secondary)' },
  liabilities: { label: 'Total Liabilities', icon: CreditCard, color: 'var(--destructive)' },
  investments: { label: 'Total Investments', icon: LineChart, color: 'var(--primary)' },
};

/** Returns the line items making up a given drill type, guaranteed (structurally, via the
 *  shared `netWorthBreakdown()` backend query) to sum to the same total shown on the hero card. */
function itemsFor(type: DrilldownType, breakdown: NetWorthBreakdown): NetWorthLineItem[] {
  if (type === 'assets') {
    return [
      ...breakdown.assets.liquid,
      ...breakdown.assets.investments,
      ...breakdown.assets.manualAssets,
    ];
  }
  if (type === 'liabilities') {
    return [...breakdown.liabilities.creditCards, ...breakdown.liabilities.loans];
  }
  return breakdown.assets.investments;
}

function typeLabel(accountType: string) {
  return accountType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Slide-over panel showing per-line-item breakdown for assets, liabilities, or investments. */
export function NetWorthDrilldown({ type, breakdown, onClose, from, to }: NetWorthDrilldownProps) {
  const router = useRouter();
  const items = itemsFor(type, breakdown);
  const total = items.reduce((s, i) => s + i.balanceCents, 0);
  const theme = THEME[type];
  const Icon = theme.icon;

  function viewDetails(item: NetWorthLineItem) {
    if (item.source === 'loan') {
      router.push('/loans');
      return;
    }
    if (item.source === 'manual_asset') {
      router.push('/health');
      return;
    }
    if (item.source === 'investment_account') {
      router.push('/investments');
      return;
    }
    const params = new URLSearchParams({ accountId: item.id, drill: `${item.nickname} transactions` });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    router.push(`/transactions?${params.toString()}`);
  }

  function detailLabel(item: NetWorthLineItem) {
    if (item.source === 'loan') return 'View loan';
    if (item.source === 'manual_asset') return 'View details';
    if (item.source === 'investment_account') return 'View investments';
    return 'View transactions';
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={theme.label}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-[var(--card)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border)] p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-2.5" style={{ backgroundColor: `color-mix(in srgb, ${theme.color} 10%, transparent)` }}>
              <Icon className="h-5 w-5" style={{ color: theme.color }} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                {theme.label}
              </p>
              <p className="text-2xl font-extrabold tabular-nums" style={{ color: theme.color }}>
                {formatCents(total)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-[var(--muted)] transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Line item list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <TrendingUp className="h-10 w-10 text-[var(--muted-foreground)] mb-3 opacity-40" />
              <p className="text-sm font-medium text-[var(--muted-foreground)]">
                No {type} found
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1 opacity-60">
                Add accounts on the Accounts page
              </p>
            </div>
          ) : (
            [...items]
              .sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents))
              .map((item) => (
                <div
                  key={`${item.source}-${item.id}`}
                  className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                        {item.nickname}
                        {item.stale ? (
                          <span
                            title="Value may be incomplete: one or more holdings had no current price and this total was backfilled from the latest manual snapshot."
                            className="inline-flex shrink-0 text-[var(--warning,#b45309)]"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] capitalize mt-0.5">
                        {item.institution ? `${item.institution} · ` : ''}
                        {typeLabel(item.accountType)}
                      </p>
                    </div>
                    <p
                      className="shrink-0 font-bold tabular-nums text-sm ml-4"
                      style={{ color: theme.color }}
                    >
                      {formatCents(item.balanceCents)}
                    </p>
                  </div>
                  <button
                    onClick={() => viewDetails(item)}
                    className="mt-2 flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
                  >
                    {detailLabel(item)} <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-6 py-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            Balances computed the same way as the Net Worth card above — this total always matches.
          </p>
        </div>
      </div>
    </>
  );
}
