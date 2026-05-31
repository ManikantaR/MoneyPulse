'use client';

import { useState } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCreateTransaction } from '@/lib/hooks/useTransactions';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useCategories } from '@/lib/hooks/useCategories';
import { CategoryCombobox } from '@/components/CategoryCombobox';
import type { CategoryOption } from '@/components/CategoryCombobox';
import type { Account } from '@moneypulse/shared';

interface AddTransactionModalProps {
  onClose: () => void;
}

interface FormState {
  amountStr: string;
  isCredit: boolean;
  description: string;
  categoryId: string;
  accountId: string;
  date: string;
  foreignAmountStr: string;
  currencyCode: string;
}

interface FormErrors {
  amount?: string;
  description?: string;
  accountId?: string;
}

/** Today's date in YYYY-MM-DD format (local time). */
function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA');
}

function parseCents(str: string): number {
  const n = parseFloat(str);
  if (isNaN(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.amountStr || parseCents(form.amountStr) <= 0) {
    errors.amount = 'Enter an amount greater than $0.00';
  }
  if (!form.description.trim()) {
    errors.description = 'Description is required';
  }
  if (!form.accountId) {
    errors.accountId = 'Select an account';
  }
  return errors;
}

/** Modal for manually adding a single transaction. */
export function AddTransactionModal({ onClose }: AddTransactionModalProps) {
  const [form, setForm] = useState<FormState>({
    amountStr: '',
    isCredit: false,
    description: '',
    categoryId: '',
    accountId: '',
    date: todayLocal(),
    foreignAmountStr: '',
    currencyCode: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const createTransaction = useCreateTransaction();
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories();

  const accounts: Account[] = accountsData?.data ?? [];
  const categoryOptions: CategoryOption[] = (categoriesData?.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    parentId: c.parentId ?? null,
  }));

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    const next = { ...form, [field]: value };
    setForm(next);
    if (submitted) {
      setErrors(validate(next));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const foreignCents = parseCents(form.foreignAmountStr);
    const hasForeign = foreignCents > 0 && form.currencyCode.trim().length === 3;

    createTransaction.mutate(
      {
        accountId: form.accountId,
        date: form.date,
        description: form.description.trim(),
        amountCents: parseCents(form.amountStr),
        isCredit: form.isCredit,
        categoryId: form.categoryId || null,
        merchantName: null,
        originalAmountCents: hasForeign ? foreignCents : null,
        currencyCode: hasForeign ? form.currencyCode.trim().toUpperCase() : null,
      },
      {
        onSuccess: () => {
          toast.success('Transaction added');
          onClose();
        },
        onError: (err: unknown) => {
          const e = err as { message?: string };
          setErrors({ amount: e.message ?? 'Failed to add transaction' });
        },
      },
    );
  }

  const inputCls =
    'w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all placeholder:text-[var(--muted-foreground)]';
  const labelCls =
    'block px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1';
  const errorCls = 'mt-1 px-1 text-xs text-[var(--destructive)]';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add Transaction"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-[var(--card)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              New Transaction
            </p>
            <p className="mt-0.5 text-lg font-extrabold leading-tight">Add Manually</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-[var(--muted)] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-4 px-6 py-5">
            {/* Amount + credit/debit toggle */}
            <div>
              <label className={labelCls}>Amount</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => set('isCredit', !form.isCredit)}
                  aria-label={form.isCredit ? 'Credit (income)' : 'Debit (expense)'}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
                    form.isCredit
                      ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-500',
                  )}
                >
                  {form.isCredit ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {form.isCredit ? 'Credit' : 'Debit'}
                </button>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={form.amountStr}
                  onChange={(e) => set('amountStr', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  aria-label="Amount"
                  className={cn(inputCls, 'flex-1 text-right')}
                />
              </div>
              {errors.amount && <p className={errorCls}>{errors.amount}</p>}
            </div>

            {/* Description */}
            <div>
              <label className={labelCls}>Description *</label>
              <input
                type="text"
                placeholder="e.g. Grocery run, Salary"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                maxLength={500}
                className={inputCls}
              />
              {errors.description && <p className={errorCls}>{errors.description}</p>}
            </div>

            {/* Date */}
            <div>
              <label className={labelCls}>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
                className={inputCls}
              />
            </div>

            {/* Account */}
            <div>
              <label className={labelCls}>Account *</label>
              <select
                value={form.accountId}
                onChange={(e) => set('accountId', e.target.value)}
                className={inputCls}
                aria-label="Account"
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nickname} ••{a.lastFour}
                  </option>
                ))}
              </select>
              {errors.accountId && <p className={errorCls}>{errors.accountId}</p>}
            </div>

            {/* Category (optional) */}
            <div>
              <label className={labelCls}>Category</label>
              <CategoryCombobox
                categories={categoryOptions}
                value={form.categoryId}
                onChange={(v) => set('categoryId', v)}
                placeholder="Select category (optional)"
              />
            </div>

            {/* Foreign Amount (optional — for money sent abroad, informational only) */}
            <div>
              <label className={labelCls}>Foreign Amount <span className="normal-case font-normal">(optional, for reference)</span></label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. INR"
                  value={form.currencyCode}
                  onChange={(e) => set('currencyCode', e.target.value.toUpperCase().slice(0, 3))}
                  maxLength={3}
                  aria-label="Currency code"
                  className={cn(inputCls, 'w-16 shrink-0 text-center font-mono uppercase')}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={form.foreignAmountStr}
                  onChange={(e) => set('foreignAmountStr', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  aria-label="Foreign amount"
                  className={cn(inputCls, 'flex-1 text-right')}
                />
              </div>
              <p className="mt-1 px-1 text-[10px] text-[var(--muted-foreground)]">
                Enter the foreign currency amount for reference (e.g. ₹50,000 = INR 50000). USD total is unchanged.
              </p>
            </div>

            {/* Forward-compat placeholder comment — future fields:
                - transfer/investment link (Prompt 27)
                - reimbursable flag (Prompt 29)
            */}
          </div>

          {/* Footer */}
          <div className="border-t border-[var(--border)] px-6 py-4">
            <button
              type="submit"
              disabled={createTransaction.isPending}
              className="w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {createTransaction.isPending ? 'Adding…' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
