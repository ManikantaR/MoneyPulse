'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTransactions, useUpdateTransaction, useBulkCategorize } from '@/lib/hooks/useTransactions';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useCategories } from '@/lib/hooks/useCategories';
import { formatCents, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
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
    URL.revokeObjectURL(a.href);
  }, [query]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {data?.total ?? 0} total transactions
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2 pl-9 pr-3 text-sm placeholder:text-[var(--muted-foreground)]"
          />
        </div>
        <select
          value={query.accountId ?? ''}
          onChange={(e) => setQuery({ ...query, accountId: e.target.value || undefined, page: 1 })}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.nickname}</option>
          ))}
        </select>
        <select
          value={query.categoryId ?? ''}
          onChange={(e) => setQuery({ ...query, categoryId: e.target.value || undefined, page: 1 })}
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--primary)] bg-[var(--accent)] px-4 py-2.5">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
          >
            <option value="">Assign category...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkCategorize}
            disabled={!bulkCategoryId || bulkCategorize.isPending}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {bulkCategorize.isPending ? 'Applying...' : 'Apply'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={transactions.length > 0 && selectedIds.size === transactions.length}
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Date</th>
              <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Description</th>
              <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Account</th>
              <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Category</th>
              <th className="px-4 py-3 font-medium text-[var(--muted-foreground)] text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
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
                    'border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)] transition-colors',
                    selectedIds.has(txn.id) && 'bg-[var(--accent)]',
                  )}
                >
                  <td className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(txn.id)}
                      onChange={() => toggleSelect(txn.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                    {formatDate(txn.date)}
                  </td>
                  <td className="px-4 py-3 max-w-[300px] truncate">
                    {txn.description}
                    {txn.merchantName && (
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                        {txn.merchantName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {accountMap[txn.accountId] ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={txn.categoryId ?? ''}
                      onChange={(e) => handleCategoryChange(txn.id, e.target.value)}
                      className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap',
                      txn.isCredit ? 'text-emerald-500' : 'text-[var(--foreground)]',
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted-foreground)]">
          Page {query.page} of {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setQuery({ ...query, page: Math.max(1, (query.page ?? 1) - 1) })}
            disabled={(query.page ?? 1) <= 1}
            className="rounded-lg border border-[var(--border)] p-2 hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setQuery({ ...query, page: Math.min(totalPages, (query.page ?? 1) + 1) })}
            disabled={(query.page ?? 1) >= totalPages}
            className="rounded-lg border border-[var(--border)] p-2 hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
