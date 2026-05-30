'use client';

import { useState } from 'react';
import { Plus, Store, Trash2, Pencil, Lock, RefreshCw } from 'lucide-react';
import {
  useMerchantAliases,
  useCreateMerchantAlias,
  useUpdateMerchantAlias,
  useDeleteMerchantAlias,
  type MerchantAlias,
} from '@/lib/hooks/useMerchantAliases';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: 'Contains',
  startsWith: 'Starts With',
  exact: 'Exact',
  regex: 'Regex',
};

const MATCH_TYPE_COLORS: Record<string, string> = {
  contains: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  startsWith: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  exact: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  regex: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

const emptyForm = { pattern: '', matchType: 'contains', displayName: '' };

export default function MerchantsPage() {
  const { data: aliasData, isLoading } = useMerchantAliases();
  const createAlias = useCreateMerchantAlias();
  const updateAlias = useUpdateMerchantAlias();
  const deleteAlias = useDeleteMerchantAlias();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editTarget, setEditTarget] = useState<MerchantAlias | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [showNormalizePrompt, setShowNormalizePrompt] = useState(false);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [normalizeMsg, setNormalizeMsg] = useState('');

  const aliases = aliasData?.data ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createAlias.mutateAsync(form);
    setShowForm(false);
    setForm(emptyForm);
    setShowNormalizePrompt(true);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    await updateAlias.mutateAsync({ id: editTarget.id, ...editForm });
    setEditTarget(null);
    setShowNormalizePrompt(true);
  }

  async function handleNormalize() {
    setIsNormalizing(true);
    setNormalizeMsg('');
    try {
      const res = await api.post<{ data: { updated: number; total: number } }>(
        '/transactions/normalize-merchants',
        { force: true },
      );
      setNormalizeMsg(`Done — ${res.data.updated} of ${res.data.total} transactions updated.`);
    } catch {
      setNormalizeMsg('Normalization failed. Check API logs.');
    } finally {
      setIsNormalizing(false);
      setShowNormalizePrompt(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Merchant Aliases</h1>
          <p className="text-[var(--muted-foreground)]">
            Map raw bank merchant strings to clean display names
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Add Alias
        </button>
      </div>

      {/* Re-normalize prompt */}
      {showNormalizePrompt && (
        <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-sm">
          <RefreshCw className="h-5 w-5 shrink-0 text-[var(--primary)]" />
          <p className="flex-1 text-sm font-medium">
            Re-normalize all transactions with the updated alias?
          </p>
          <button
            onClick={handleNormalize}
            disabled={isNormalizing}
            className="rounded-full bg-[var(--primary)] px-4 py-2 text-xs font-bold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {isNormalizing ? 'Normalizing…' : 'Yes, normalize'}
          </button>
          <button
            onClick={() => setShowNormalizePrompt(false)}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold hover:bg-[var(--muted)]"
          >
            No thanks
          </button>
        </div>
      )}

      {normalizeMsg && (
        <p className="text-sm text-green-600 dark:text-green-400">{normalizeMsg}</p>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm"
        >
          <h2 className="text-lg font-bold">New Alias</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Pattern</label>
              <input
                type="text"
                required
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                placeholder="e.g. costar"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Match Type</label>
              <select
                value={form.matchType}
                onChange={(e) => setForm({ ...form, matchType: e.target.value })}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              >
                <option value="contains">Contains</option>
                <option value="startsWith">Starts With</option>
                <option value="exact">Exact</option>
                <option value="regex">Regex</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold">Display Name</label>
              <input
                type="text"
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="e.g. CoStar Group"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createAlias.isPending}
              className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {createAlias.isPending ? 'Creating…' : 'Create Alias'}
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

      {/* Alias table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : aliases.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-16">
          <Store className="mb-3 h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No merchant aliases yet. Add one to start cleaning up merchant names.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-container-low)]">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Pattern</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Match Type</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Display Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Source</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {aliases.map((alias) => {
                const isGlobal = alias.userId === null;
                return (
                  <tr key={alias.id} className="transition-colors hover:bg-[var(--muted)]/40">
                    <td className="px-5 py-3 font-mono text-xs">{alias.pattern}</td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', MATCH_TYPE_COLORS[alias.matchType] ?? 'bg-gray-100 text-gray-700')}>
                        {MATCH_TYPE_LABELS[alias.matchType] ?? alias.matchType}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-medium">{alias.displayName}</td>
                    <td className="px-5 py-3">
                      {isGlobal ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <Lock className="h-3 w-3" />
                          Global
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--primary)]">
                          Custom
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!isGlobal && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditTarget(alias);
                              setEditForm({ pattern: alias.pattern, matchType: alias.matchType, displayName: alias.displayName });
                            }}
                            className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                            aria-label="Edit alias"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete this alias?')) {
                                deleteAlias.mutate(alias.id);
                              }
                            }}
                            className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive)] transition-colors"
                            aria-label="Delete alias"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Edit Alias</h2>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold">Pattern</label>
                <input
                  type="text"
                  required
                  value={editForm.pattern}
                  onChange={(e) => setEditForm({ ...editForm, pattern: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">Match Type</label>
                <select
                  value={editForm.matchType}
                  onChange={(e) => setEditForm({ ...editForm, matchType: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
                >
                  <option value="contains">Contains</option>
                  <option value="startsWith">Starts With</option>
                  <option value="exact">Exact</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">Display Name</label>
                <input
                  type="text"
                  required
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateAlias.isPending}
                  className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                >
                  {updateAlias.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
