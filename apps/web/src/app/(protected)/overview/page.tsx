'use client';

import { Landmark, CreditCard, TrendingUp, LayoutGrid } from 'lucide-react';
import { useAccountBalances } from '@/lib/hooks/useAnalytics';
import { useInvestments } from '@/lib/hooks/useInvestments';
import { groupAccountsByCategory, type AccountGroupKey } from '@/lib/accountGrouping';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

const GROUP_ICONS: Record<AccountGroupKey, React.ComponentType<{ className?: string }>> = {
  cash: Landmark,
  credit: CreditCard,
  investments: TrendingUp,
};

const GROUP_DESCRIPTIONS: Record<AccountGroupKey, string> = {
  cash: 'Checking, savings, and cash sweep balances',
  credit: 'Amount owed across credit card accounts',
  investments: 'Brokerage, 529, and other investment account values',
};

/**
 * Overview page — a single consolidated screen showing every account
 * (regular bank accounts + investment accounts) grouped by category with a
 * subtotal per group and a combined grand total.
 */
export default function OverviewPage() {
  const { data: balancesData, isLoading: balancesLoading } = useAccountBalances();
  const { data: investmentAccounts, isLoading: investmentsLoading } = useInvestments();

  const isLoading = balancesLoading || investmentsLoading;
  const { groups, grandTotalCents } = groupAccountsByCategory(
    balancesData?.data ?? [],
    investmentAccounts ?? [],
  );
  const hasAnyAccounts = groups.some((g) => g.accounts.length > 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl font-extrabold tracking-tight">Overview</h1>
        <p className="text-[var(--muted-foreground)]">
          All your accounts, grouped by category, in one place
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : !hasAnyAccounts ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16">
          <LayoutGrid className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No accounts yet. Add a bank or investment account to see your overview.
          </p>
        </div>
      ) : (
        <>
          {/* Grand total */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
            <p className="text-sm font-semibold text-[var(--muted-foreground)]">
              Total (assets minus credit owed)
            </p>
            <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">
              {formatCents(grandTotalCents)}
            </p>
          </div>

          {/* Category groups */}
          <div className="space-y-6">
            {groups.map((group) => {
              const Icon = GROUP_ICONS[group.key];
              return (
                <div key={group.key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-[var(--muted-foreground)]" />
                      <div>
                        <h2 className="text-lg font-bold">{group.label}</h2>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {GROUP_DESCRIPTIONS[group.key]}
                        </p>
                      </div>
                    </div>
                    <p
                      className={cn(
                        'text-xl font-extrabold tabular-nums',
                        group.key === 'credit' && group.subtotalCents > 0
                          ? 'text-[var(--destructive)]'
                          : '',
                      )}
                    >
                      {group.key === 'credit'
                        ? `-${formatCents(group.subtotalCents)}`
                        : formatCents(group.subtotalCents)}
                    </p>
                  </div>

                  {group.accounts.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
                      No accounts in this category
                    </p>
                  ) : (
                    <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-container-low)]">
                      {group.accounts.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-semibold">{account.nickname}</p>
                            <p className="text-xs text-[var(--muted-foreground)]">
                              {account.institution} · {account.accountType.replace('_', ' ')}
                              {account.isInvestmentAccount ? ' · investment' : ''}
                            </p>
                          </div>
                          <p className="text-sm font-bold tabular-nums">
                            {group.key === 'credit'
                              ? `-${formatCents(account.balanceCents)}`
                              : formatCents(account.balanceCents)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
