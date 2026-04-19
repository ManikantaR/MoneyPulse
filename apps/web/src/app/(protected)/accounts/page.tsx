'use client';

import { useState } from 'react';
import { Plus, Landmark, Trash2 } from 'lucide-react';
import { useAccounts, useCreateAccount, useDeleteAccount } from '@/lib/hooks/useAccounts';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BankLogo } from '@/components/BankLogo';
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
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Accounts</h1>
          <p className="text-[var(--muted-foreground)]">
            Manage your bank and credit card accounts
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add Account
        </button>
      </div>

      {/* Create Account Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm"
        >
          <h2 className="text-lg font-bold">New Account</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Institution</label>
              <select
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value as Institution })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              >
                <option value="boa">Bank of America</option>
                <option value="chase">Chase</option>
                <option value="amex">American Express</option>
                <option value="citi">Citibank</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Account Type</label>
              <select
                value={form.accountType}
                onChange={(e) => setForm({ ...form, accountType: e.target.value as AccountType })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit Card</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Nickname</label>
              <input
                type="text"
                required
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                placeholder="e.g. Primary Checking"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Last 4 Digits</label>
              <input
                type="text"
                required
                maxLength={4}
                pattern="[0-9]{4}"
                value={form.lastFour}
                onChange={(e) => setForm({ ...form, lastFour: e.target.value })}
                placeholder="1234"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Starting Balance ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.startingBalanceCents}
                onChange={(e) => setForm({ ...form, startingBalanceCents: Number(e.target.value) })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
            </div>
            {form.accountType === 'credit_card' && (
              <div>
                <label className="mb-1.5 block text-sm font-semibold">Credit Limit ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.creditLimitCents ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, creditLimitCents: e.target.value ? Number(e.target.value) : null })
                  }
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
                />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createAccount.isPending}
              className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {createAccount.isPending ? 'Creating...' : 'Create Account'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16">
          <Landmark className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No accounts yet. Add your first account to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const inst = institutionLabels[account.institution] ?? institutionLabels.other;
            return (
              <div
                key={account.id}
                className="relative overflow-hidden rounded-2xl bg-[var(--surface-container-low)] p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <BankLogo institution={inst.label} size="md" />
                    <div>
                      <span
                        className={cn(
                          'inline-block rounded-full px-3 py-0.5 text-xs font-bold',
                          inst.color,
                        )}
                      >
                        {inst.label}
                      </span>
                      <h3 className="mt-2 text-base font-bold">{account.nickname}</h3>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        ••{account.lastFour} · {account.accountType.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Delete this account?')) {
                        deleteAccount.mutate(account.id);
                      }
                    }}
                    className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive)] transition-colors"
                    aria-label="Delete account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-4 text-3xl font-extrabold tracking-tight tabular-nums">
                  {formatCents(account.startingBalanceCents)}
                </p>
                {account.creditLimitCents && (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Limit: {formatCents(account.creditLimitCents)}
                  </p>
                )}
                {/* Bottom accent bar */}
                <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-[var(--primary)]/50 to-transparent" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
