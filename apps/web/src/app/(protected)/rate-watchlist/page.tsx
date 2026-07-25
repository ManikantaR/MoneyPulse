'use client';

import { useState } from 'react';
import { Percent, Plus, Pencil, Trash2, X, Landmark, Clock } from 'lucide-react';
import { MobileCard } from '@/components/MobileCard';
import type { CreateRateWatchlistInput } from '@moneypulse/shared';
import {
  useRateWatchlist,
  useCreateRateWatchlistEntry,
  useUpdateRateWatchlistEntry,
  useDeleteRateWatchlistEntry,
  type RateWatchlistEntry,
} from '@/lib/hooks/useRateWatchlist';

// ── Helpers ──────────────────────────────────────────────────

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  hysa: 'HYSA',
  cd: 'CD',
  mmf: 'Money Market',
  treasury: 'Treasury',
};

function formatApy(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function formatUpdatedAt(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Form ──────────────────────────────────────────────────────

interface FormState {
  institution: string;
  productType: 'hysa' | 'cd' | 'mmf' | 'treasury';
  apy: string; // percent, e.g. "4.5"
  termMonths: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  institution: '',
  productType: 'hysa',
  apy: '',
  termMonths: '',
  notes: '',
};

function entryToForm(entry: RateWatchlistEntry): FormState {
  return {
    institution: entry.institution,
    productType: (entry.productType as FormState['productType']) ?? 'hysa',
    apy: (entry.apyBps / 100).toString(),
    termMonths: entry.termMonths?.toString() ?? '',
    notes: entry.notes ?? '',
  };
}

function formToPayload(f: FormState): CreateRateWatchlistInput {
  return {
    institution: f.institution.trim(),
    productType: f.productType,
    apyBps: Math.round(parseFloat(f.apy) * 100),
    termMonths: f.termMonths ? parseInt(f.termMonths, 10) : null,
    notes: f.notes.trim() || null,
  };
}

function WatchlistForm({
  initial,
  onDone,
}: {
  initial?: RateWatchlistEntry;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial ? entryToForm(initial) : EMPTY_FORM);
  const create = useCreateRateWatchlistEntry();
  const update = useUpdateRateWatchlistEntry();
  const pending = create.isPending || update.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const payload = formToPayload(form);
    if (initial) {
      await update.mutateAsync({ id: initial.id, ...payload });
    } else {
      await create.mutateAsync(payload);
    }
    onDone();
  };

  const valid = form.institution.trim() && Number.isFinite(parseFloat(form.apy)) && parseFloat(form.apy) >= 0;

  const field = 'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm';
  const label = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1';

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{initial ? 'Edit rate' : 'Add a rate'}</h3>
        <button onClick={onDone} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Institution</label>
          <input className={field} value={form.institution} placeholder="Ally Bank"
            onChange={(e) => set('institution', e.target.value)} />
        </div>
        <div>
          <label className={label}>Product type</label>
          <select className={field} value={form.productType}
            onChange={(e) => set('productType', e.target.value as FormState['productType'])}>
            <option value="hysa">HYSA</option>
            <option value="cd">CD</option>
            <option value="mmf">Money Market</option>
            <option value="treasury">Treasury</option>
          </select>
        </div>
        <div>
          <label className={label}>APY (%)</label>
          <input className={field} type="number" inputMode="decimal" step="0.01" value={form.apy}
            placeholder="4.50" onChange={(e) => set('apy', e.target.value)} />
        </div>
        <div>
          <label className={label}>Term (months, optional)</label>
          <input className={field} type="number" inputMode="numeric" value={form.termMonths}
            placeholder="12" onChange={(e) => set('termMonths', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Notes (optional)</label>
          <input className={field} value={form.notes} placeholder="Promo rate through year-end"
            onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!valid || pending}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50">
          {pending ? 'Saving…' : initial ? 'Save changes' : 'Add rate'}
        </button>
        <button onClick={onDone}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--muted)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Badges ───────────────────────────────────────────────────

function SourceBadge({ entry }: { entry: RateWatchlistEntry }) {
  if (entry.source === 'treasury') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
        <Landmark className="h-3 w-3" /> Auto-synced from Treasury
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
      Manual entry
    </span>
  );
}

function StaleBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      <Clock className="h-3 w-3" /> Stale
    </span>
  );
}

// ── Row / Card ───────────────────────────────────────────────

function WatchlistRow({ entry, onEdit }: { entry: RateWatchlistEntry; onEdit: () => void }) {
  const remove = useDeleteRateWatchlistEntry();
  const editable = entry.source !== 'treasury';
  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--muted)]/30 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium text-sm">{entry.institution}</p>
        {entry.notes && <p className="text-xs text-[var(--muted-foreground)]">{entry.notes}</p>}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
          {PRODUCT_TYPE_LABELS[entry.productType] ?? entry.productType}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-semibold tabular-nums">{formatApy(entry.apyBps)}</td>
      <td className="px-4 py-3 text-sm tabular-nums text-[var(--muted-foreground)]">
        {entry.termMonths ? `${entry.termMonths} mo` : '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <SourceBadge entry={entry} />
          {entry.isStale && <StaleBadge />}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">{formatUpdatedAt(entry.updatedAt)}</td>
      <td className="px-4 py-3">
        {editable && (
          <div className="flex items-center gap-1">
            <button onClick={onEdit} title="Edit"
              className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => remove.mutate(entry.id)} disabled={remove.isPending} title="Delete"
              className="rounded p-1.5 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function WatchlistCard({ entry, onEdit }: { entry: RateWatchlistEntry; onEdit: () => void }) {
  const remove = useDeleteRateWatchlistEntry();
  const editable = entry.source !== 'treasury';
  return (
    <MobileCard
      fields={[
        { primary: true, value: entry.institution },
        { amount: true, value: formatApy(entry.apyBps) },
        { label: 'Type', value: PRODUCT_TYPE_LABELS[entry.productType] ?? entry.productType },
        { label: 'Term', value: entry.termMonths ? `${entry.termMonths} mo` : '—' },
        {
          label: 'Status',
          value: (
            <div className="flex flex-wrap items-center gap-1">
              <SourceBadge entry={entry} />
              {entry.isStale && <StaleBadge />}
            </div>
          ),
        },
        { label: 'Updated', value: formatUpdatedAt(entry.updatedAt) },
        { label: 'Notes', value: entry.notes ?? undefined },
      ]}
      actions={
        editable ? (
          <div className="flex items-center gap-2">
            <button onClick={onEdit} title="Edit"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-[var(--muted)] text-[var(--muted-foreground)]">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => remove.mutate(entry.id)} disabled={remove.isPending} title="Delete"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-[var(--destructive)]/10 text-[var(--destructive)]">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : undefined
      }
    />
  );
}

// ── Page ──────────────────────────────────────────────────────

/** Rate watchlist — compare HYSA/CD/Treasury APYs to spot better parking spots for cash. */
export default function RateWatchlistPage() {
  const { data, isLoading } = useRateWatchlist();
  const [editing, setEditing] = useState<RateWatchlistEntry | null>(null);
  const [adding, setAdding] = useState(false);

  const entries: RateWatchlistEntry[] = data?.data ?? [];
  const staleDays = data?.staleDays;
  const showForm = adding || editing !== null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Percent className="h-6 w-6 text-[var(--primary)]" />
            <h1 className="text-3xl font-extrabold tracking-tight">Rate Watchlist</h1>
          </div>
          <p className="text-[var(--muted-foreground)] text-sm">
            Track HYSA, CD, and Treasury APYs sorted by rate. Treasury rows auto-sync and are
            read-only{staleDays ? ` — manual entries flagged after ${staleDays} days without an update` : ''}.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" /> Add rate
          </button>
        )}
      </div>

      {showForm && (
        <WatchlistForm
          initial={editing ?? undefined}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      {isLoading && (
        <p className="text-sm text-[var(--muted-foreground)] animate-pulse">Loading rate watchlist…</p>
      )}

      {!isLoading && entries.length === 0 && !showForm && (
        <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
          No rates tracked yet. Click &ldquo;Add rate&rdquo; to add a HYSA offer, CD, or other bank
          product so the Cash Manager has something to compare against.
        </p>
      )}

      {entries.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3">Institution</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">APY</th>
                  <th className="px-4 py-3">Term</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <WatchlistRow key={entry.id} entry={entry} onEdit={() => setEditing(entry)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {entries.map((entry) => (
              <WatchlistCard key={entry.id} entry={entry} onEdit={() => setEditing(entry)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
