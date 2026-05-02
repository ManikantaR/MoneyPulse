'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, Download, ChevronLeft, ChevronRight, X, ArrowUpDown, ArrowUp, ArrowDown, Scissors, Plus, Trash2 } from 'lucide-react';
import {
  useTransactions,
  useUpdateTransaction,
  useBulkCategorize,
  useAutoCategorize,
  useSplitTransaction,
  useEditSplit,
} from '@/lib/hooks/useTransactions';
import type { SplitTransactionInput } from '@moneypulse/shared';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useCategories } from '@/lib/hooks/useCategories';
import { CategorySelect } from '@/components/CategorySelect';
import { formatCents, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TransactionQueryParams } from '@/lib/hooks/useTransactions';

/** Transactions page — searchable, filterable, paginated transaction grid with bulk actions. */
export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  /** Human-readable label for the active drill-down source (if any). */
  const drillLabel = searchParams.get('drill');

  /** Initialise query state from URL search params so dashboard drill-downs work. */
  const [query, setQuery] = useState<TransactionQueryParams>(() => ({
    page: 1,
    pageSize: 25,
    sortBy: 'date',
    sortOrder: 'desc',
    accountId: searchParams.get('accountId') || undefined,
    categoryId: searchParams.get('categoryId') || undefined,
    from: searchParams.get('from') || undefined,
    to: searchParams.get('to') || undefined,
    isCredit: searchParams.get('isCredit') === 'true' ? true : searchParams.get('isCredit') === 'false' ? false : undefined,
  }));
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [autoCategResult, setAutoCategResult] = useState<string | null>(null);
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);

  const { data, isLoading } = useTransactions({
    ...query,
    search: search || undefined,
    ...(uncategorizedOnly ? { categoryId: '__uncategorized__' } : {}),
  });
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories();
  const updateTxn = useUpdateTransaction();
  const bulkCategorize = useBulkCategorize();
  const autoCategorize = useAutoCategorize();
  const splitTxn = useSplitTransaction();
  const editSplitTxn = useEditSplit();

  const accounts = accountsData?.data ?? [];
  const categories = categoriesData?.data ?? [];
  const transactions = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  /** Build account ID → display label lookup. */
  const accountMap = useMemo(
    () =>
      Object.fromEntries(
        accounts.map((a) => [
          a.id,
          `${a.nickname} (••${a.lastFour})`,
        ]),
      ),
    [accounts],
  );

  /** Build account ID → type lookup (credit_card, checking, savings). */
  const accountTypeMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.accountType])),
    [accounts],
  );

  /** Build category ID → icon+name lookup. */
  const categoryMap = useMemo(
    () =>
      Object.fromEntries(
        categories.map((c) => [c.id, { icon: c.icon, name: c.name }]),
      ),
    [categories],
  );

  /** Group categories: parents with children for <optgroup> dropdowns. */
  const categoryGroups = useMemo(() => {
    const parents = categories.filter((c) => !c.parentId);
    const childMap = new Map<string, typeof categories>();
    for (const c of categories) {
      if (c.parentId) {
        const arr = childMap.get(c.parentId) ?? [];
        arr.push(c);
        childMap.set(c.parentId, arr);
      }
    }
    return parents.map((p) => ({ ...p, children: childMap.get(p.id) ?? [] }));
  }, [categories]);

  const [learnToast, setLearnToast] = useState<string | null>(null);

  type SplitRow = { amountCents: number; description: string; categoryId: string };
  const [splitTarget, setSplitTarget] = useState<{ id: string; amountCents: number; description: string; isEdit: boolean } | null>(null);
  const [splitRows, setSplitRows] = useState<SplitRow[]>([]);
  const [splitError, setSplitError] = useState<string | null>(null);

  function openSplit(txn: { id: string; amountCents: number; description: string; isSplitParent: boolean }, children: { amountCents: number; description: string; categoryId: string | null }[]) {
    setSplitError(null);
    setSplitTarget({ id: txn.id, amountCents: txn.amountCents, description: txn.description, isEdit: txn.isSplitParent });
    if (txn.isSplitParent && children.length > 0) {
      setSplitRows(children.map((c) => ({ amountCents: c.amountCents, description: c.description, categoryId: c.categoryId ?? '' })));
    } else {
      setSplitRows([
        { amountCents: 0, description: '', categoryId: '' },
        { amountCents: 0, description: '', categoryId: '' },
      ]);
    }
  }

  function closeSplit() {
    setSplitTarget(null);
    setSplitRows([]);
    setSplitError(null);
  }

  function updateSplitRow(idx: number, field: keyof SplitRow, value: string | number) {
    setSplitRows((rows) => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function addSplitRow() {
    if (splitRows.length < 10) setSplitRows((rows) => [...rows, { amountCents: 0, description: '', categoryId: '' }]);
  }

  function removeSplitRow(idx: number) {
    if (splitRows.length > 2) setSplitRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function submitSplit() {
    if (!splitTarget) return;
    const total = splitRows.reduce((s, r) => s + r.amountCents, 0);
    if (total !== splitTarget.amountCents) {
      setSplitError(`Split total ${formatCents(total)} ≠ parent ${formatCents(splitTarget.amountCents)}`);
      return;
    }
    if (splitRows.some((r) => r.amountCents <= 0)) {
      setSplitError('Each split amount must be greater than zero.');
      return;
    }
    setSplitError(null);
    const splits: SplitTransactionInput['splits'] = splitRows.map((r) => ({
      amountCents: r.amountCents,
      description: r.description || undefined,
      categoryId: r.categoryId || undefined,
    }));
    const action = splitTarget.isEdit ? editSplitTxn : splitTxn;
    action.mutate({ id: splitTarget.id, splits }, { onSuccess: closeSplit, onError: (e: any) => setSplitError(e?.message ?? 'Split failed') });
  }

  /** Handle inline category change for a transaction — also triggers auto-learn rule creation. */
  function handleCategoryChange(txnId: string, categoryId: string) {
    updateTxn.mutate(
      { id: txnId, categoryId: categoryId || null },
      {
        onSuccess: () => {
          if (categoryId) {
            const cat = categoryMap[categoryId];
            const label = cat ? `${cat.icon} ${cat.name}` : 'category';
            setLearnToast(`Rule learned — future similar transactions will auto-assign to ${label}`);
            setTimeout(() => setLearnToast(null), 4000);
          }
        },
      },
    );
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
        {
          onSuccess: () => {
            setSelectedIds(new Set());
            setBulkCategoryId('');
          },
        },
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
          <h1 className="text-4xl font-extrabold tracking-tight">
            Transactions
          </h1>
          <p className="text-[var(--muted-foreground)]">
            {data?.total ?? 0} total transactions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setAutoCategResult(null);
              autoCategorize.mutate(undefined, {
                onSuccess: (res) => {
                  const s = res.data;
                  if (s.total === 0) {
                    setAutoCategResult(
                      'All transactions are already categorized.',
                    );
                  } else {
                    setAutoCategResult(
                      `Processed ${s.total}: ${s.categorizedByRule} by rules, ${s.categorizedByAi} by AI, ${s.uncategorized} still uncategorized.`,
                    );
                  }
                  setTimeout(() => setAutoCategResult(null), 8000);
                },
                onError: () => {
                  setAutoCategResult(
                    'Auto-categorize failed. Is Ollama running?',
                  );
                  setTimeout(() => setAutoCategResult(null), 5000);
                },
              });
            }}
            disabled={autoCategorize.isPending}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
            title="Run AI + rule engine on all uncategorized transactions"
          >
            {autoCategorize.isPending
              ? 'Categorizing...'
              : '✨ Auto-Categorize'}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Auto-categorize result banner */}
      {autoCategResult && (
        <div className="rounded-xl border border-[var(--primary)]/30 bg-[var(--accent)] px-4 py-2.5 text-sm">
          {autoCategResult}
        </div>
      )}

      {/* Learning feedback toast */}
      {learnToast && (
        <div className="rounded-xl border border-[var(--secondary)]/30 bg-[var(--secondary)]/10 px-4 py-2.5 text-sm animate-in fade-in slide-in-from-top-2">
          🧠 {learnToast}
        </div>
      )}

      {/* Drill-down context banner — shown when navigating from dashboard */}
      {drillLabel && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--primary)]/30 bg-[var(--accent)] px-4 py-2.5 text-sm">
          <span>
            <span className="font-bold">Showing:</span> {drillLabel}
            {query.from && query.to && (
              <span className="ml-1 text-[var(--muted-foreground)]">
                ({query.from} – {query.to})
              </span>
            )}
          </span>
          <button
            onClick={() => {
              router.replace('/transactions');
              setQuery({ page: 1, pageSize: 25, sortBy: 'date', sortOrder: 'desc' });
              setSearch('');
            }}
            className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-3 py-1 text-xs font-semibold hover:bg-[var(--border)] transition-colors"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl bg-[var(--surface-container-low)] p-4 md:grid-cols-5">
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
            onChange={(e) =>
              setQuery({
                ...query,
                accountId: e.target.value || undefined,
                page: 1,
              })
            }
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
          >
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nickname}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Category
          </label>
          <CategorySelect
            value={uncategorizedOnly ? '__uncategorized__' : (query.categoryId ?? '')}
            onChange={(val) => {
              if (val === '__uncategorized__') {
                setUncategorizedOnly(true);
                setQuery({ ...query, categoryId: undefined, page: 1 });
              } else {
                setUncategorizedOnly(false);
                setQuery({ ...query, categoryId: val || undefined, page: 1 });
              }
            }}
            categoryGroups={[
              { id: '__uncategorized__', name: 'Uncategorized', icon: '⚠', children: [] },
              ...categoryGroups,
            ]}
            className="rounded-xl text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Per page
          </label>
          <select
            value={query.pageSize ?? 25}
            onChange={(e) =>
              setQuery({ ...query, pageSize: Number(e.target.value), page: 1 })
            }
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--primary)]/30 bg-[var(--accent)] px-5 py-3">
          <span className="text-sm font-bold">{selectedIds.size} selected</span>
          <CategorySelect
            value={bulkCategoryId}
            onChange={setBulkCategoryId}
            categoryGroups={categoryGroups}
            className="w-48 text-sm"
          />
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
                  checked={
                    transactions.length > 0 &&
                    selectedIds.size === transactions.length
                  }
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <SortHeader
                label="Date"
                field="date"
                current={query.sortBy}
                order={query.sortOrder}
                onSort={(field) => {
                  const newOrder =
                    query.sortBy === field && query.sortOrder === 'desc'
                      ? 'asc'
                      : 'desc';
                  setQuery({ ...query, sortBy: field, sortOrder: newOrder, page: 1 });
                }}
              />
              <SortHeader
                label="Description"
                field="description"
                current={query.sortBy}
                order={query.sortOrder}
                onSort={(field) => {
                  const newOrder =
                    query.sortBy === field && query.sortOrder === 'asc'
                      ? 'desc'
                      : 'asc';
                  setQuery({ ...query, sortBy: field, sortOrder: newOrder, page: 1 });
                }}
              />
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
                Account
              </th>
              <SortHeader
                label="Category"
                field="category"
                current={query.sortBy}
                order={query.sortOrder}
                onSort={(field) => {
                  const newOrder =
                    query.sortBy === field && query.sortOrder === 'asc'
                      ? 'desc'
                      : 'asc';
                  setQuery({ ...query, sortBy: field, sortOrder: newOrder, page: 1 });
                }}
              />
              <SortHeader
                label="Amount"
                field="amount"
                current={query.sortBy}
                order={query.sortOrder}
                onSort={(field) => {
                  const newOrder =
                    query.sortBy === field && query.sortOrder === 'desc'
                      ? 'asc'
                      : 'desc';
                  setQuery({ ...query, sortBy: field, sortOrder: newOrder, page: 1 });
                }}
                align="right"
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {isLoading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-[var(--muted-foreground)]"
                >
                  Loading...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-[var(--muted-foreground)]"
                >
                  No transactions found
                </td>
              </tr>
            ) : (
              transactions.map((txn) => {
                const isParent = txn.isSplitParent;
                const isChild = !!txn.parentTransactionId;
                const childrenOfParent = isParent
                  ? transactions.filter((t) => t.parentTransactionId === txn.id)
                  : [];

                return (
                  <tr
                    key={txn.id}
                    className={cn(
                      'transition-colors',
                      isParent
                        ? 'opacity-50 bg-[var(--surface-container-low)]/40'
                        : isChild
                          ? 'bg-[var(--surface-container-low)]/20 hover:bg-[var(--surface-container-low)]'
                          : 'cursor-pointer hover:bg-[var(--surface-container-low)]',
                      !isParent && selectedIds.has(txn.id) && 'bg-[var(--accent)]',
                    )}
                  >
                    <td className="w-10 px-3 py-4">
                      {!isParent && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(txn.id)}
                          onChange={() => toggleSelect(txn.id)}
                          className="rounded"
                        />
                      )}
                    </td>
                    <td className="px-6 py-5 tabular-nums whitespace-nowrap">
                      <div className="text-sm font-semibold">
                        {formatDate(txn.date)}
                      </div>
                    </td>
                    <td className="px-6 py-5 max-w-[300px]">
                      <div className="flex items-center gap-2 truncate">
                        {isChild && (
                          <span className="shrink-0 text-xs text-[var(--muted-foreground)]">↳</span>
                        )}
                        <span className={cn('font-medium truncate', isParent && 'line-through text-[var(--muted-foreground)]')}>
                          {txn.description}
                        </span>
                        {isParent && (
                          <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                            split
                          </span>
                        )}
                        {isChild && (
                          <span className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                            part
                          </span>
                        )}
                      </div>
                      {txn.merchantName && !isParent && (
                        <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                          {txn.merchantName}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap text-[var(--muted-foreground)]">
                      {accountMap[txn.accountId] ?? '—'}
                    </td>
                    <td className="px-6 py-5">
                      {isParent ? (
                        <button
                          onClick={() => openSplit(txn, childrenOfParent)}
                          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          <Scissors className="h-3 w-3" />
                          Edit Split
                        </button>
                      ) : (
                        <CategorySelect
                          value={txn.categoryId ?? ''}
                          onChange={(v) => handleCategoryChange(txn.id, v)}
                          categoryGroups={categoryGroups}
                        />
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-6 py-5 text-right font-extrabold tabular-nums whitespace-nowrap',
                        isParent
                          ? 'text-[var(--muted-foreground)]'
                          : txn.isCredit && accountTypeMap[txn.accountId] !== 'credit_card'
                            ? 'text-[var(--secondary)]'
                            : txn.isCredit && accountTypeMap[txn.accountId] === 'credit_card'
                              ? 'text-[var(--muted-foreground)]'
                              : 'text-[var(--foreground)]',
                      )}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span>
                          {txn.isCredit ? '+' : '-'}
                          {formatCents(txn.amountCents)}
                        </span>
                        {!isParent && !isChild && (
                          <button
                            onClick={() => openSplit(txn, [])}
                            title="Split transaction"
                            className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <Scissors className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Split Transaction Modal */}
      {splitTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeSplit(); }}>
          <div className="w-full max-w-lg rounded-2xl bg-[var(--card)] shadow-2xl">
            <div className="border-b border-[var(--border)] px-6 py-5">
              <h2 className="text-lg font-extrabold tracking-tight">
                {splitTarget.isEdit ? 'Edit Split' : 'Split Transaction'}
              </h2>
              <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">
                {splitTarget.description}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Total: <span className="font-bold">{formatCents(splitTarget.amountCents)}</span>
              </p>
            </div>

            <div className="max-h-[50vh] overflow-y-auto px-6 py-4 space-y-3">
              {splitRows.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 shrink-0 text-xs text-[var(--muted-foreground)] font-mono">{idx + 1}.</span>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">$</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={row.amountCents > 0 ? (row.amountCents / 100).toFixed(2) : ''}
                          onChange={(e) => updateSplitRow(idx, 'amountCents', Math.round(parseFloat(e.target.value || '0') * 100))}
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] py-2 pl-7 pr-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Description (optional)"
                        value={row.description}
                        onChange={(e) => updateSplitRow(idx, 'description', e.target.value)}
                        className="flex-[2] rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30"
                      />
                    </div>
                    <CategorySelect
                      value={row.categoryId}
                      onChange={(v) => updateSplitRow(idx, 'categoryId', v)}
                      categoryGroups={categoryGroups}
                      className="text-xs"
                    />
                  </div>
                  <button
                    onClick={() => removeSplitRow(idx)}
                    disabled={splitRows.length <= 2}
                    className="mt-2 rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-30 transition-colors"
                    title="Remove row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <button
                onClick={addSplitRow}
                disabled={splitRows.length >= 10}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-40 transition-colors"
              >
                <Plus className="h-4 w-4" /> Add row
              </button>
            </div>

            <div className="border-t border-[var(--border)] px-6 py-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">Running total</span>
                <span className={cn(
                  'font-bold',
                  splitRows.reduce((s, r) => s + r.amountCents, 0) === splitTarget.amountCents
                    ? 'text-[var(--secondary)]'
                    : 'text-destructive',
                )}>
                  {formatCents(splitRows.reduce((s, r) => s + r.amountCents, 0))}
                  {' / '}
                  {formatCents(splitTarget.amountCents)}
                </span>
              </div>
              {splitError && (
                <p className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{splitError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={closeSplit}
                  className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitSplit}
                  disabled={splitTxn.isPending || editSplitTxn.isPending}
                  className="flex-1 rounded-full bg-[var(--primary)] py-2.5 text-sm font-bold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {splitTxn.isPending || editSplitTxn.isPending
                    ? 'Saving...'
                    : splitTarget.isEdit
                      ? 'Save Changes'
                      : 'Split'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between rounded-xl bg-[var(--surface-container-low)]/50 px-6 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
          Page {query.page} of {totalPages} · {data?.total ?? 0} results
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              setQuery({ ...query, page: Math.max(1, (query.page ?? 1) - 1) })
            }
            disabled={(query.page ?? 1) <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-container)] disabled:opacity-50 transition-colors text-[var(--muted-foreground)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers(query.page ?? 1, totalPages).map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-[var(--muted-foreground)]">…</span>
            ) : (
              <button
                key={p}
                onClick={() => setQuery({ ...query, page: Number(p) })}
                className={cn(
                  'flex h-8 min-w-[2rem] items-center justify-center rounded-lg text-xs font-semibold transition-colors',
                  Number(p) === (query.page ?? 1)
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'hover:bg-[var(--surface-container)] text-[var(--muted-foreground)]',
                )}
              >
                {p}
              </button>
            ),
          )}
          <button
            onClick={() =>
              setQuery({
                ...query,
                page: Math.min(totalPages, (query.page ?? 1) + 1),
              })
            }
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

/** Sortable column header component. */
function SortHeader({
  label,
  field,
  current,
  order,
  onSort,
  align,
}: {
  label: string;
  field: 'date' | 'amount' | 'description' | 'category';
  current?: string;
  order?: string;
  onSort: (field: 'date' | 'amount' | 'description' | 'category') => void;
  align?: 'right';
}) {
  const active = current === field;
  return (
    <th
      className={cn(
        'px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] cursor-pointer select-none hover:text-[var(--foreground)] transition-colors',
        align === 'right' && 'text-right',
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          order === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

/** Build an array of page numbers with ellipsis gaps. */
function pageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}
