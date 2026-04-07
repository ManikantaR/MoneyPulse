'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTransactions, useUpdateTransaction, useBulkCategorize } from '@/lib/hooks/useTransactions';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useCategories } from '@/lib/hooks/useCategories';
import { formatCents, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TransactionQueryParams } from '@/lib/hooks/useTransactions';

/** Transactions page — searchable, filterable, paginated transaction grid with bulk actions. */
export default function TransactionsPage() {
  const [query, setQuery] = useState<TransactionQueryParams>({
    page: 1,
    pageSize: 25,
    sortBy: 'date',
    sortOrder: 'desc',
  });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState('');

  const { data, isLoading } = useTransactions({ ...query, search: search || undefined });
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories();
  const updateTxn = useUpdateTransaction();
  const bulkCategorize = useBulkCategorize();

  const accounts = accountsData?.data ?? [];
  const categories = categoriesData?.data ?? [];
  const transactions = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  /** Build account ID → nickname lookup. */
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.nickname])),
    [accounts],
  );

  /** Handle inline category change for a transaction. */
  function handleCategoryChange(txnId: string, categoryId: string) {
    updateTxn.mutate({ id: txnId, categoryId: categoryId || null });
  }

  /** Toggle a single row selection. */
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Toggle select all on the current page. */
  function toggleAll() {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.id)));
    }
  }

  /** Apply bulk category assignment. */
  function handleBulkCategorize() {
    if (selectedIds.size > 0 && bulkCategoryId) {
      bulkCategorize.mutate(
        { transactionIds: Array.from(selectedIds), categoryId: bulkCategoryId },
        { onSuccess: () => { setSelectedIds(new Set()); setBulkCategoryId(''); } },
      );
    }
  }

  /** Download CSV export. */
  const handleExport = useCallback(async () => {
    const params: Record<string, string> = {};
    if (query.from) params.from = query.from;
    if (query.to) params.to = query.to;
    if (query.accountId) params.accountId = query.accountId;
    if (query.categoryId) params.categoryId = query.categoryId;
    const qs = new URLSearchParams(params).toString();
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/transactions/export${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 0);
  }, [query]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Transactions</h1>
          <p className="text-[var(--muted-foreground)]">
            {data?.total ?? 0} total transactions
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] transition-colors"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Search & Filters */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl bg-[var(--surface-container-low)] p-4 md:grid-cols-4">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-9 pr-3 text-sm placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Account
          </label>
          <select
            value={query.accountId ?? ''}
            onChange={(e) => setQuery({ ...query, accountId: e.target.value || undefined, page: 1 })}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
          >
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.nickname}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Category
          </label>
          <select
            value={query.categoryId ?? ''}
            onChange={(e) => setQuery({ ...query, categoryId: e.target.value || undefined, page: 1 })}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--primary)]/30 bg-[var(--accent)] px-5 py-3">
          <span className="text-sm font-bold">{selectedIds.size} selected</span>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
          >
            <option value="">Assign category...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkCategorize}
            disabled={!bulkCategoryId || bulkCategorize.isPending}
            className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {bulkCategorize.isPending ? 'Applying...' : 'Apply'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-[var(--card)] shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-container-low)]/50 text-left">
              <th className="w-10 px-3 py-4">
                <input
                  type="checkbox"
                  checked={transactions.length > 0 && selectedIds.size === transactions.length}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Date</th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Description</th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Account</th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Category</th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                  Loading...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                  No transactions found
                </td>
              </tr>
            ) : (
              transactions.map((txn) => (
                <tr
                  key={txn.id}
                  className={cn(
                    'cursor-pointer hover:bg-[var(--surface-container-low)] transition-colors',
                    selectedIds.has(txn.id) && 'bg-[var(--accent)]',
                  )}
                >
                  <td className="w-10 px-3 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(txn.id)}
                      onChange={() => toggleSelect(txn.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-6 py-5 tabular-nums whitespace-nowrap">
                    <div className="text-sm font-semibold">{formatDate(txn.date)}</div>
                  </td>
                  <td className="px-6 py-5 max-w-[300px] truncate">
                    <span className="font-medium">{txn.description}</span>
                    {txn.merchantName && (
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                        {txn.merchantName}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5 whitespace-nowrap text-[var(--muted-foreground)]">
                    {accountMap[txn.accountId] ?? '—'}
                  </td>
                  <td className="px-6 py-5">
                    <select
                      value={txn.categoryId ?? ''}
                      onChange={(e) => handleCategoryChange(txn.id, e.target.value)}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-1 text-xs font-medium hover:border-[var(--primary)] transition-colors"
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={cn(
                      'px-6 py-5 text-right font-extrabold tabular-nums whitespace-nowrap',
                      txn.isCredit ? 'text-[var(--secondary)]' : 'text-[var(--foreground)]',
                    )}
                  >
                    {txn.isCredit ? '+' : '-'}{formatCents(txn.amountCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between rounded-xl bg-[var(--surface-container-low)]/50 px-6 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
          Page {query.page} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setQuery({ ...query, page: Math.max(1, (query.page ?? 1) - 1) })}
            disabled={(query.page ?? 1) <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-container)] disabled:opacity-50 transition-colors text-[var(--muted-foreground)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setQuery({ ...query, page: Math.min(totalPages, (query.page ?? 1) + 1) })}
            disabled={(query.page ?? 1) >= totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-container)] disabled:opacity-50 transition-colors text-[var(--muted-foreground)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
