'use client';

import { useState } from 'react';
import { TrendingUp, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useInvestments,
  useCreateInvestment,
  useDeleteInvestment,
  useAddSnapshot,
} from '@/lib/hooks/useInvestments';
import { formatCents } from '@/lib/format';
import type { InvestmentAccount } from '@moneypulse/shared';

const ACCOUNT_TYPES = [
  { value: '401k', label: '401(k)' },
  { value: 'ira', label: 'IRA / Roth IRA' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: '529', label: '529 (Education)' },
  { value: 'hsa', label: 'HSA' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'other', label: 'Other' },
];

// ── Add Account Modal ────────────────────────────────────────

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const create = useCreateInvestment();
  const [form, setForm] = useState({
    nickname: '',
    institution: '',
    accountType: '401k',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.nickname.trim()) e.nickname = 'Nickname is required';
    if (!form.institution.trim()) e.institution = 'Institution is required';
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    create.mutate(
      { nickname: form.nickname.trim(), institution: form.institution.trim(), accountType: form.accountType },
      {
        onSuccess: () => {
          toast.success('Account added');
          onClose();
        },
        onError: () => toast.error('Failed to add account'),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">Add Investment Account</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--muted)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">Nickname *</label>
            <input
              type="text"
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              placeholder="e.g. Fidelity 401k"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
            {errors.nickname && <p className="mt-1 text-xs text-red-500">{errors.nickname}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold">Institution *</label>
            <input
              type="text"
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              placeholder="e.g. Fidelity, Robinhood, Vanguard"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
            {errors.institution && <p className="mt-1 text-xs text-red-500">{errors.institution}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold">Account type</label>
            <select
              value={form.accountType}
              onChange={(e) => setForm({ ...form, accountType: e.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={create.isPending}
              className="flex-1 rounded-full bg-[var(--primary)] py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {create.isPending ? 'Adding…' : 'Add Account'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Update Value Modal ───────────────────────────────────────

function UpdateValueModal({
  account,
  onClose,
}: {
  account: InvestmentAccount;
  onClose: () => void;
}) {
  const addSnapshot = useAddSnapshot(account.id);
  const [amountStr, setAmountStr] = useState(
    account.latestBalanceCents != null
      ? (account.latestBalanceCents / 100).toFixed(2)
      : '',
  );
  const [dateStr, setDateStr] = useState(
    new Date().toLocaleDateString('en-CA'),
  );
  const [error, setError] = useState('');

  function parseCents(s: string) {
    return Math.round(parseFloat(s) * 100);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseCents(amountStr);
    if (!amountStr || isNaN(cents) || cents < 0) {
      setError('Enter a valid balance (0 or more)');
      return;
    }
    setError('');
    addSnapshot.mutate(
      { balanceCents: cents, date: dateStr },
      {
        onSuccess: () => {
          toast.success('Value updated');
          onClose();
        },
        onError: () => toast.error('Failed to update value'),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold">Update Value</h2>
            <p className="text-xs text-[var(--muted-foreground)]">{account.nickname}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--muted)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">Current balance ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold">Date</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={addSnapshot.isPending}
              className="flex-1 rounded-full bg-[var(--primary)] py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {addSnapshot.isPending ? 'Saving…' : 'Save Value'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Account Card ─────────────────────────────────────────────

function AccountCard({
  account,
  onUpdateValue,
  onDelete,
}: {
  account: InvestmentAccount;
  onUpdateValue: () => void;
  onDelete: () => void;
}) {
  const typeLabel = ACCOUNT_TYPES.find((t) => t.value === account.accountType)?.label ?? account.accountType;

  return (
    <div className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{account.nickname}</p>
          <p className="text-xs text-[var(--muted-foreground)]">{account.institution} · {typeLabel}</p>
        </div>
        <button
          onClick={onDelete}
          aria-label="Delete account"
          className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex-1">
        {account.latestBalanceCents != null ? (
          <>
            <p className="text-2xl font-extrabold tabular-nums tracking-tight">
              {formatCents(account.latestBalanceCents)}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              as of {account.latestSnapshotDate}
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)] italic">No value recorded yet</p>
        )}
      </div>

      <button
        onClick={onUpdateValue}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Update value
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function InvestmentsPage() {
  const { data: accounts = [], isLoading } = useInvestments();
  const deleteAccount = useDeleteInvestment();
  const [showAddModal, setShowAddModal] = useState(false);
  const [updatingAccount, setUpdatingAccount] = useState<InvestmentAccount | null>(null);

  const totalCents = accounts.reduce(
    (sum, a) => sum + (a.latestBalanceCents ?? 0),
    0,
  );

  function handleDelete(account: InvestmentAccount) {
    if (!confirm(`Delete "${account.nickname}"? This cannot be undone.`)) return;
    deleteAccount.mutate(account.id, {
      onSuccess: () => toast.success('Account deleted'),
      onError: () => toast.error('Failed to delete account'),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Investments</h1>
          <p className="text-[var(--muted-foreground)]">
            Track your investment portfolios by recording periodic balance snapshots.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add Account
        </button>
      </div>

      {/* Total card */}
      {accounts.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Total investments
          </p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight">
            {formatCents(totalCents)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Included in net worth · {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Modeling help */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
        <p className="font-semibold mb-1">How to track investment accounts</p>
        <ul className="space-y-1 list-disc list-inside text-[11px]">
          <li><strong>401k / IRA:</strong> Value-only — just update the balance here. No bank transaction needed.</li>
          <li><strong>Robinhood / 529 / Betterment:</strong> When a contribution leaves your bank, categorize it as <em>Investment Contribution</em> (a transfer category) so it isn&apos;t counted as an expense — then update this account&apos;s value separately.</li>
        </ul>
      </div>

      {/* Account list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16">
          <TrendingUp className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No investment accounts yet. Add your first account.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onUpdateValue={() => setUpdatingAccount(account)}
              onDelete={() => handleDelete(account)}
            />
          ))}
        </div>
      )}

      {showAddModal && <AddAccountModal onClose={() => setShowAddModal(false)} />}
      {updatingAccount && (
        <UpdateValueModal
          account={updatingAccount}
          onClose={() => setUpdatingAccount(null)}
        />
      )}
    </div>
  );
}
