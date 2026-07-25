'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Repeat, TrendingUp, AlertTriangle, Pencil, Ban, Trash2, Merge, X, Check } from 'lucide-react';
import { formatCents } from '@/lib/format';
import { useSubscriptions } from '@/lib/hooks/useSubscriptions';
import { useCategories } from '@/lib/hooks/useCategories';
import {
  useBills,
  useUpdateBill,
  useDeactivateBill,
  useDeleteBill,
} from '@/lib/hooks/useBills';
import { useCreateMerchantAlias } from '@/lib/hooks/useMerchantAliases';
import type { SubscriptionItem, RecurringBill, BillFrequency } from '@moneypulse/shared';

// ── Helpers ──────────────────────────────────────────────────

const FREQ_LABELS: Record<BillFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
};

const FREQ_OPTIONS = Object.keys(FREQ_LABELS) as BillFrequency[];

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

function EditSubscriptionForm({
  sub,
  categories,
  onCancel,
}: {
  sub: SubscriptionItem;
  categories: Array<{ id: string; name: string }>;
  onCancel: () => void;
}) {
  const updateBill = useUpdateBill();
  const [name, setName] = useState(sub.name);
  const [amount, setAmount] = useState((sub.amountCents / 100).toFixed(2));
  const [frequency, setFrequency] = useState<BillFrequency>(sub.frequency);
  const [categoryId, setCategoryId] = useState<string>(sub.categoryId ?? '');

  const handleSave = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!name.trim() || !Number.isFinite(cents) || cents <= 0) return;
    await updateBill.mutateAsync({
      id: sub.id,
      normalizedName: name.trim(),
      expectedAmountCents: cents,
      frequency,
      categoryId: categoryId || null,
    });
    onCancel();
  };

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-[10rem] flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
        placeholder="Name"
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
        placeholder="Amount"
      />
      <select
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as BillFrequency)}
        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
      >
        {FREQ_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {FREQ_LABELS[f]}
          </option>
        ))}
      </select>
      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        onClick={handleSave}
        disabled={updateBill.isPending}
        title="Save"
        className="rounded p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        onClick={onCancel}
        title="Cancel"
        className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function SubscriptionRow({
  sub,
  categories,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  sub: SubscriptionItem;
  categories: Array<{ id: string; name: string }>;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const deactivate = useDeactivateBill();
  const remove = useDeleteBill();

  if (isEditing) {
    return (
      <div className="flex items-center gap-4 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
        <EditSubscriptionForm
          sub={sub}
          categories={categories}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(sub.id)}
            className="h-4 w-4 shrink-0"
            aria-label={`Select ${sub.name}`}
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{sub.name}</span>
            <PriceIncreaseBadge sub={sub} />
          </div>
          <span className="text-xs text-[var(--muted-foreground)]">
            {FREQ_LABELS[sub.frequency]} · {formatCents(sub.amountCents)}/cycle
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="flex flex-col items-end">
          <span className="text-sm font-semibold">{formatCents(sub.annualCostCents)}/yr</span>
          <span className="text-xs text-[var(--muted-foreground)]">
            {formatCents(Math.round(sub.annualCostCents / 12))}/mo avg
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(true)}
            title="Edit"
            className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => deactivate.mutate(sub.id)}
            disabled={deactivate.isPending}
            title="No longer using this"
            className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Ban className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete "${sub.name}" permanently?`)) remove.mutate(sub.id);
            }}
            disabled={remove.isPending}
            title="Delete"
            className="rounded p-1.5 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Merge bar ────────────────────────────────────────────────

function MergeBar({
  selectedIds,
  subs,
  billsById,
  billsLoaded,
  onDone,
  onCancel,
}: {
  selectedIds: Set<string>;
  subs: SubscriptionItem[];
  billsById: Map<string, RecurringBill>;
  billsLoaded: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const selectedSubs = useMemo(
    () => subs.filter((s) => selectedIds.has(s.id)),
    [subs, selectedIds],
  );

  const defaultSurvivorId = useMemo(() => {
    let best: string | null = null;
    let bestTime = -Infinity;
    for (const s of selectedSubs) {
      const bill = billsById.get(s.id);
      const t = bill?.lastSeenDate ? new Date(bill.lastSeenDate).getTime() : -Infinity;
      if (t > bestTime) {
        bestTime = t;
        best = s.id;
      }
    }
    return best ?? selectedSubs[0]?.id ?? null;
  }, [selectedSubs, billsById]);

  const [survivorId, setSurvivorId] = useState<string | null>(defaultSurvivorId);

  useEffect(() => {
    setSurvivorId((prev) => (prev && selectedIds.has(prev) ? prev : defaultSurvivorId));
  }, [defaultSurvivorId, selectedIds]);

  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAlias = useCreateMerchantAlias();
  const deactivate = useDeactivateBill();

  const handleMerge = async () => {
    if (!survivorId || !billsLoaded) return;
    setError(null);
    setIsMerging(true);
    try {
      const survivorBill = billsById.get(survivorId);
      const survivorSub = subs.find((s) => s.id === survivorId);
      const survivorName = survivorBill?.normalizedName ?? survivorSub?.name ?? '';

      const others = [...selectedIds].filter((id) => id !== survivorId);
      for (const id of others) {
        const bill = billsById.get(id);
        if (bill?.merchantPattern && survivorName) {
          await createAlias.mutateAsync({
            pattern: bill.merchantPattern,
            matchType: 'exact',
            displayName: survivorName,
          });
        }
        await deactivate.mutateAsync(id);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed. Please try again.');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Merge className="h-4 w-4 text-[var(--primary)]" />
        <span className="text-sm font-semibold">
          Merge {selectedIds.size} selected subscriptions
        </span>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        Pick the row to keep. The others will be deactivated and their merchant text will be
        remembered as aliases so future imports don&apos;t recreate the duplicate.
      </p>
      <div className="space-y-2">
        {selectedSubs.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-2 rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-sm"
          >
            <input
              type="radio"
              name="survivor"
              checked={survivorId === s.id}
              onChange={() => setSurvivorId(s.id)}
            />
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-[var(--muted-foreground)]">
              {formatCents(s.amountCents)}/{FREQ_LABELS[s.frequency].toLowerCase()}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={handleMerge}
          disabled={isMerging || !survivorId || !billsLoaded}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {isMerging ? 'Merging…' : billsLoaded ? 'Merge' : 'Loading…'}
        </button>
        <button
          onClick={onCancel}
          disabled={isMerging}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--muted)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const { data, isLoading } = useSubscriptions();
  const { data: categoriesData } = useCategories();
  const { data: billsData, isLoading: isBillsLoading } = useBills();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const subs = data?.data ?? [];
  const categories = categoriesData?.data ?? [];
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const billsById = useMemo(
    () => new Map((billsData?.data ?? []).map((b) => [b.id, b])),
    [billsData],
  );

  // Drop selections for subs that no longer exist (e.g. after merge/delete).
  const subIdsKey = subs.map((s) => s.id).join(',');
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(subIdsKey ? subIdsKey.split(',') : []);
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [subIdsKey]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
              <SubscriptionRow key={s.id} sub={s} categories={categories} />
            ))}
          </div>
        </div>
      )}

      {/* Merge bar */}
      {selectedIds.size >= 2 && (
        <MergeBar
          selectedIds={selectedIds}
          subs={subs}
          billsById={billsById}
          billsLoaded={!isBillsLoading}
          onDone={() => setSelectedIds(new Set())}
          onCancel={() => setSelectedIds(new Set())}
        />
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">
              All Subscriptions
            </h2>
            <span className="text-xs text-[var(--muted-foreground)]">
              Select 2+ rows that are really the same subscription to merge them.
            </span>
          </div>
          {subs.map((s) => (
            <SubscriptionRow
              key={s.id}
              sub={s}
              categories={categories}
              selectable
              selected={selectedIds.has(s.id)}
              onToggleSelect={toggleSelect}
            />
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
