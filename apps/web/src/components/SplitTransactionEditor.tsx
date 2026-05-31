'use client';

import { useState } from 'react';
import { Plus, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/format';
import { useCategories } from '@/lib/hooks/useCategories';
import { useSplitTransaction } from '@/lib/hooks/useTransactions';
import { CategoryCombobox } from '@/components/CategoryCombobox';
import type { CategoryOption } from '@/components/CategoryCombobox';
import type { Transaction } from '@moneypulse/shared';

interface SplitRow {
  amountStr: string;
  categoryId: string;
  description: string;
}

interface SplitTransactionEditorProps {
  transaction: Transaction;
  onSuccess: () => void;
  onCancel: () => void;
}

function parseCents(str: string): number {
  const n = parseFloat(str);
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Inline editor for splitting a transaction into ≥2 categorized parts. */
export function SplitTransactionEditor({
  transaction,
  onSuccess,
  onCancel,
}: SplitTransactionEditorProps) {
  const [rows, setRows] = useState<SplitRow[]>([
    {
      amountStr: (transaction.amountCents / 100).toFixed(2),
      categoryId: transaction.categoryId ?? '',
      description: '',
    },
    { amountStr: '0.00', categoryId: '', description: '' },
  ]);
  const [apiError, setApiError] = useState<string | null>(null);

  const { data: categoriesData } = useCategories();
  const categoryOptions: CategoryOption[] = (categoriesData?.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    parentId: c.parentId ?? null,
  }));

  const splitTransaction = useSplitTransaction();

  const rowCents = rows.map((r) => parseCents(r.amountStr));
  const sumCents = rowCents.reduce((a, b) => a + b, 0);
  const remainderCents = transaction.amountCents - sumCents;
  const allPositive = rowCents.every((c) => c > 0);
  const allCategorized = rows.every((r) => r.categoryId !== '');
  const canSubmit =
    remainderCents === 0 &&
    allPositive &&
    allCategorized &&
    rows.length >= 2 &&
    !splitTransaction.isPending;

  function addRow() {
    setRows((prev) => [...prev, { amountStr: '0.00', categoryId: '', description: '' }]);
  }

  function removeRow(i: number) {
    if (rows.length <= 2) return;
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateRow(i: number, field: keyof SplitRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function handleSubmit() {
    setApiError(null);
    const splits = rows.map((r, i) => ({
      amountCents: rowCents[i],
      categoryId: r.categoryId,
      ...(r.description.trim() && { description: r.description.trim() }),
    }));
    splitTransaction.mutate(
      { id: transaction.id, splits },
      {
        onSuccess: () => onSuccess(),
        onError: (err: unknown) => {
          const e = err as { message?: string };
          setApiError(e.message ?? 'Split failed. Please try again.');
        },
      },
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
          Split Transaction
        </span>
        <button
          onClick={onCancel}
          className="text-xs text-[var(--muted-foreground)] hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border)] p-2.5 space-y-2"
          >
            <div className="flex items-center gap-2">
              {/* Amount input */}
              <div className="relative w-24 shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)] pointer-events-none">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={row.amountStr}
                  onChange={(e) => updateRow(i, 'amountStr', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  aria-label="Amount"
                  className="w-full pl-5 pr-2 py-1.5 text-sm text-right rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                />
              </div>

              {/* Category */}
              <div className="flex-1 min-w-0">
                <CategoryCombobox
                  categories={categoryOptions}
                  value={row.categoryId}
                  onChange={(v) => updateRow(i, 'categoryId', v)}
                  placeholder="Category *"
                  size="sm"
                />
              </div>

              {/* Remove row */}
              <button
                onClick={() => removeRow(i)}
                disabled={rows.length <= 2}
                aria-label="Remove row"
                className="shrink-0 rounded-lg p-1.5 hover:bg-[var(--destructive)]/10 transition-colors disabled:opacity-30"
              >
                <XIcon className="h-3.5 w-3.5 text-[var(--destructive)]" />
              </button>
            </div>

            {/* Optional description */}
            <input
              type="text"
              placeholder="Description (optional)"
              value={row.description}
              onChange={(e) => updateRow(i, 'description', e.target.value)}
              maxLength={500}
              className="w-full text-xs py-1 px-2.5 rounded-lg border border-[var(--border)] bg-transparent placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
        ))}

        {/* Add row */}
        <button
          onClick={addRow}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] py-2 text-xs text-[var(--muted-foreground)] hover:text-foreground hover:border-[var(--primary)] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add split
        </button>
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border)] px-4 py-3 space-y-2">
        {/* Remainder indicator */}
        <div
          className={cn(
            'flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold',
            remainderCents === 0
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-red-500/10 text-red-500',
          )}
        >
          <span>
            {remainderCents === 0
              ? '✓ Balanced'
              : remainderCents > 0
                ? `${formatCents(remainderCents)} left to allocate`
                : `${formatCents(-remainderCents)} over allocated`}
          </span>
          <span className="text-xs opacity-70">{formatCents(transaction.amountCents)} total</span>
        </div>

        {apiError && (
          <p className="text-xs text-[var(--destructive)]">{apiError}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {splitTransaction.isPending ? 'Splitting…' : 'Split Transaction'}
        </button>
      </div>
    </div>
  );
}
