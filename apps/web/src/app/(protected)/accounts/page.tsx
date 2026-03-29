'use client';

import { useState } from 'react';
import { Plus, Landmark, Pencil, Trash2 } from 'lucide-react';
import { useAccounts, useCreateAccount, useDeleteAccount } from '@/lib/hooks/useAccounts';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Institution, AccountType } from '@moneypulse/shared';

/** Accounts page — view, create, and manage bank accounts. */
export default function AccountsPage() {
  const { data: accountsData, isLoading } = useAccounts();
  const createAccount = useCreateAccount();
  const deleteAccount = useDeleteAccount();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    institution: 'boa' as Institution,
    accountType: 'checking' as AccountType,
    nickname: '',
    lastFour: '',
    startingBalanceCents: 0,
    creditLimitCents: null as number | null,
  });

  const accounts = accountsData?.data ?? [];

  /** Institution display info. */
  const institutionLabels: Record<string, { label: string; color: string }> = {
    boa: { label: 'Bank of America', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    chase: { label: 'Chase', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    amex: { label: 'American Express', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
    citi: { label: 'Citibank', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
    other: { label: 'Other', color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
  };

  /** Handle form submission to create a new account. */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createAccount.mutateAsync({
      ...form,
      startingBalanceCents: Math.round(form.startingBalanceCents * 100),
      creditLimitCents:
        form.accountType === 'credit_card' && form.creditLimitCents !== null
          ? Math.round(form.creditLimitCents * 100)
          : null,
    });
    setShowForm(false);
    setForm({
      institution: 'boa',
      accountType: 'checking',
      nickname: '',
      lastFour: '',
      startingBalanceCents: 0,
      creditLimitCents: null,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Manage your bank and credit card accounts
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Account
        </button>
      </div>

      {/* Create Account Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Institution</label>
              <select
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value as Institution })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                <option value="boa">Bank of America</option>
                <option value="chase">Chase</option>
                <option value="amex">American Express</option>
                <option value="citi">Citibank</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Account Type</label>
              <select
                value={form.accountType}
                onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit Card</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Nickname</label>
              <input
                type="text"
                required
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                placeholder="e.g. Primary Checking"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Last 4 Digits</label>
              <input
                type="text"
                required
                maxLength={4}
                pattern="[0-9]{4}"
                value={form.lastFour}
                onChange={(e) => setForm({ ...form, lastFour: e.target.value })}
                placeholder="1234"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Starting Balance ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.startingBalanceCents}
                onChange={(e) => setForm({ ...form, startingBalanceCents: Number(e.target.value) })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            {form.accountType === 'credit_card' && (
              <div>
                <label className="mb-1 block text-sm font-medium">Credit Limit ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.creditLimitCents ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, creditLimitCents: e.target.value ? Number(e.target.value) : null })
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createAccount.isPending}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createAccount.isPending ? 'Creating...' : 'Create Account'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Account Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16">
          <Landmark className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No accounts yet. Add your first account to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const inst = institutionLabels[account.institution] ?? institutionLabels.other;
            return (
              <div
                key={account.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className={cn(
                        'inline-block rounded-md px-2 py-0.5 text-xs font-medium',
                        inst.color,
                      )}
                    >
                      {inst.label}
                    </span>
                    <h3 className="mt-2 font-semibold">{account.nickname}</h3>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      ••{account.lastFour} · {account.accountType.replace('_', ' ')}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Delete this account?')) {
                        deleteAccount.mutate(account.id);
                      }
                    }}
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-red-500 transition-colors"
                    aria-label="Delete account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-3 text-xl font-bold tabular-nums">
                  {formatCents(account.startingBalanceCents)}
                </p>
                {account.creditLimitCents && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Limit: {formatCents(account.creditLimitCents)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
