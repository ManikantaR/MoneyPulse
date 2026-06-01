'use client';

import Link from 'next/link';
import { Repeat, TrendingUp, AlertTriangle } from 'lucide-react';
import { formatCents } from '@/lib/format';
import { useSubscriptions } from '@/lib/hooks/useSubscriptions';
import { useCategories } from '@/lib/hooks/useCategories';
import type { SubscriptionItem, BillFrequency } from '@moneypulse/shared';

// ── Helpers ──────────────────────────────────────────────────

const FREQ_LABELS: Record<BillFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
};

function totalAnnual(subs: SubscriptionItem[]): number {
  return subs.reduce((sum, s) => sum + s.annualCostCents, 0);
}

function groupByCategory(
  subs: SubscriptionItem[],
  catMap: Map<string, string>,
): Array<{ name: string; annual: number }> {
  const map = new Map<string, number>();
  for (const s of subs) {
    const key = s.categoryId ? (catMap.get(s.categoryId) ?? 'Uncategorized') : 'Uncategorized';
    map.set(key, (map.get(key) ?? 0) + s.annualCostCents);
  }
  return [...map.entries()]
    .map(([name, annual]) => ({ name, annual }))
    .sort((a, b) => b.annual - a.annual);
}

// ── Sub-components ────────────────────────────────────────────

function PriceIncreaseBadge({ sub }: { sub: SubscriptionItem }) {
  if (!sub.priceIncreased || sub.lastAmountCents === null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--destructive)]/10 px-2 py-0.5 text-xs font-medium text-[var(--destructive)]">
      <AlertTriangle className="h-3 w-3" />
      {formatCents(sub.amountCents)} → {formatCents(sub.lastAmountCents)}
    </span>
  );
}

function SubscriptionRow({ sub }: { sub: SubscriptionItem }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium truncate">{sub.name}</span>
          <PriceIncreaseBadge sub={sub} />
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">
          {FREQ_LABELS[sub.frequency]} · {formatCents(sub.amountCents)}/cycle
        </span>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className="text-sm font-semibold">{formatCents(sub.annualCostCents)}/yr</span>
        <span className="text-xs text-[var(--muted-foreground)]">
          {formatCents(Math.round(sub.annualCostCents / 12))}/mo avg
        </span>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const { data, isLoading } = useSubscriptions();
  const { data: categoriesData } = useCategories();

  const subs = data?.data ?? [];
  const catMap = new Map(
    (categoriesData?.data ?? []).map((c) => [c.id, c.name]),
  );

  const annualTotal = totalAnnual(subs);
  const monthlyAvg = Math.round(annualTotal / 12);
  const priceIncreases = subs.filter((s) => s.priceIncreased);
  const breakdown = groupByCategory(subs, catMap);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Repeat className="h-6 w-6 text-[var(--primary)]" />
          <h1 className="text-2xl font-bold">Subscriptions</h1>
        </div>
        <Link
          href="/bills"
          className="text-sm text-[var(--primary)] hover:underline"
        >
          Manage bills →
        </Link>
      </div>

      {/* Summary bar */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-[var(--surface-container-low)] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Annual Total
          </p>
          <p className="mt-1 text-2xl font-extrabold">{formatCents(annualTotal)}</p>
        </div>
        <div className="rounded-xl bg-[var(--surface-container-low)] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Monthly Average
          </p>
          <p className="mt-1 text-2xl font-extrabold">{formatCents(monthlyAvg)}</p>
        </div>
        <div className="rounded-xl bg-[var(--surface-container-low)] p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Active Subscriptions
          </p>
          <p className="mt-1 text-2xl font-extrabold">{subs.length}</p>
        </div>
      </div>

      {/* Price increases section */}
      {priceIncreases.length > 0 && (
        <div className="rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-[var(--destructive)]">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-semibold">
              Price increases detected ({priceIncreases.length})
            </span>
          </div>
          <div className="space-y-2">
            {priceIncreases.map((s) => (
              <SubscriptionRow key={s.id} sub={s} />
            ))}
          </div>
        </div>
      )}

      {/* All subscriptions list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-[var(--muted)]"
            />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <div className="rounded-xl bg-[var(--surface-container-low)] p-10 text-center">
          <Repeat className="mx-auto mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-40" />
          <p className="font-medium text-[var(--muted-foreground)]">No subscriptions detected yet.</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Run bill detection on the{' '}
            <Link href="/bills" className="text-[var(--primary)] hover:underline">
              Bills page
            </Link>{' '}
            to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
            All Subscriptions
          </h2>
          {subs.map((s) => (
            <SubscriptionRow key={s.id} sub={s} />
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {breakdown.length > 0 && (
        <div className="rounded-xl bg-[var(--surface-container-low)] p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[var(--primary)]" />
            <h2 className="text-sm font-semibold">Annual spend by category</h2>
          </div>
          <div className="space-y-2">
            {breakdown.map(({ name, annual }) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">{name}</span>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 w-20 rounded-full bg-[var(--muted)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--primary)]"
                      style={{ width: `${Math.round((annual / annualTotal) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-medium">{formatCents(annual)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
