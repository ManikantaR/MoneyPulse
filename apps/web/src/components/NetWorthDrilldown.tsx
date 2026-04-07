'use client';

import { X, Wallet, CreditCard, TrendingUp } from 'lucide-react';
import { formatCents } from '@/lib/format';
import type { AccountBalanceItem } from '@/lib/hooks/useAnalytics';

const ASSET_TYPES = ['checking', 'savings', 'investment'];
const LIABILITY_TYPES = ['credit_card'];

interface NetWorthDrilldownProps {
  type: 'assets' | 'liabilities';
  accounts: AccountBalanceItem[];
  onClose: () => void;
}

/** Slide-over panel showing per-account breakdown for assets or liabilities. */
export function NetWorthDrilldown({ type, accounts, onClose }: NetWorthDrilldownProps) {
  const isAssets = type === 'assets';
  const filtered = accounts.filter((a) =>
    isAssets ? ASSET_TYPES.includes(a.accountType) : LIABILITY_TYPES.includes(a.accountType),
  );
  const total = filtered.reduce((s, a) => s + a.balanceCents, 0);

  function typeLabel(accountType: string) {
    return accountType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
        aria-label={isAssets ? 'Assets Breakdown' : 'Liabilities Breakdown'}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-[var(--card)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border)] p-6">
          <div className="flex items-center gap-3">
            <div
              className={`rounded-xl p-2.5 ${
                isAssets ? 'bg-[var(--secondary)]/10' : 'bg-[var(--destructive)]/10'
              }`}
            >
              {isAssets ? (
                <Wallet className="h-5 w-5 text-[var(--secondary)]" />
              ) : (
                <CreditCard className="h-5 w-5 text-[var(--destructive)]" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                {isAssets ? 'Total Assets' : 'Total Liabilities'}
              </p>
              <p
                className={`text-2xl font-extrabold tabular-nums ${
                  isAssets ? 'text-[var(--secondary)]' : 'text-[var(--destructive)]'
                }`}
              >
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

        {/* Account list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <TrendingUp className="h-10 w-10 text-[var(--muted-foreground)] mb-3 opacity-40" />
              <p className="text-sm font-medium text-[var(--muted-foreground)]">
                No {isAssets ? 'asset' : 'liability'} accounts found
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1 opacity-60">
                Add accounts on the Accounts page
              </p>
            </div>
          ) : (
            filtered
              .sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents))
              .map((acc) => (
                <div
                  key={acc.accountId}
                  className="flex items-center justify-between rounded-xl bg-[var(--surface-container-low)] px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{acc.nickname}</p>
                    <p className="text-xs text-[var(--muted-foreground)] capitalize mt-0.5">
                      {acc.institution} · {typeLabel(acc.accountType)}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 font-bold tabular-nums text-sm ml-4 ${
                      isAssets ? 'text-[var(--secondary)]' : 'text-[var(--destructive)]'
                    }`}
                  >
                    {formatCents(acc.balanceCents)}
                  </p>
                </div>
              ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-6 py-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            Balances computed from imported transactions + starting balance.
          </p>
        </div>
      </div>
    </>
  );
}
