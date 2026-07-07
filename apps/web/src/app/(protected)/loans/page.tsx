'use client';

import { useState } from 'react';
import { Landmark, Plus, Pencil, Trash2, X, Sparkles, AlertTriangle } from 'lucide-react';
import { formatCents } from '@/lib/format';
import { MobileCard } from '@/components/MobileCard';
import type { Loan, LoanType, CreateLoanInput } from '@moneypulse/shared';
import { computeLoanState, projectPayoff } from '@moneypulse/shared';
import { useLoans, useCreateLoan, useUpdateLoan, useDeleteLoan } from '@/lib/hooks/useLoans';

// ── Helpers ──────────────────────────────────────────────────

const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  mortgage: 'Mortgage',
  auto: 'Auto',
  personal: 'Personal',
  student: 'Student',
  other: 'Other',
};

function formatApr(bps: number): string {
  return `${(bps / 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}

function formatStartDate(dateStr: string): string {
  // Stored as a plain calendar date (YYYY-MM-DD); render in UTC to avoid tz drift.
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonths(months: number): string {
  if (!Number.isFinite(months)) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

// ── Payoff status (client-side amortization) ──────────────────

/**
 * Live payoff summary computed from the loan's own fields — no server round trip and
 * nothing sensitive leaves the browser. Extras are folded into the scheduled payment
 * (the recommended data model), so we replay with no separate extra-principal stream.
 * Pattern-based extra-principal splitting is a Phase-2, advisor-side feature.
 */
function LoanStatusCard({ loan }: { loan: Loan }) {
  const inputs = {
    originalBalanceCents: loan.originalBalanceCents,
    aprBps: loan.aprBps,
    scheduledPaymentCents: loan.scheduledPaymentCents,
    startDate: loan.startDate,
  };
  const state = computeLoanState(inputs, []);
  const proj = projectPayoff(state.currentBalanceCents, loan.aprBps, loan.scheduledPaymentCents);

  const paidCents = loan.originalBalanceCents - state.currentBalanceCents;
  const pctPaid = loan.originalBalanceCents > 0
    ? Math.min(100, Math.max(0, (paidCents / loan.originalBalanceCents) * 100))
    : 0;
  const nonAmortizing = !state.amortizes || !proj.amortizes;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{loan.name}</span>
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
            {LOAN_TYPE_LABELS[loan.loanType]}
          </span>
        </div>
        <span className="text-lg font-bold tabular-nums">{formatCents(state.currentBalanceCents)}</span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pctPaid}%` }} />
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {pctPaid.toFixed(1)}% paid off · {formatCents(paidCents)} of {formatCents(loan.originalBalanceCents)}
        </p>
      </div>

      {nonAmortizing ? (
        <div className="flex items-start gap-2 rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The monthly payment doesn&apos;t cover interest at this APR — the balance won&apos;t
            amortize. Check the payment amount and APR.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Payoff</p>
            <p className="text-sm font-semibold">{formatStartDate(proj.payoffDate)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Time left</p>
            <p className="text-sm font-semibold">{formatMonths(proj.monthsRemaining)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Interest left</p>
            <p className="text-sm font-semibold">{formatCents(proj.remainingInterestCents)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Form ──────────────────────────────────────────────────────

interface FormState {
  name: string;
  lenderPattern: string;
  loanType: LoanType;
  originalBalance: string; // dollars
  apr: string; // percent
  termMonths: string;
  startDate: string;
  scheduledPayment: string; // dollars
  extraPrincipalPattern: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  lenderPattern: '',
  loanType: 'mortgage',
  originalBalance: '',
  apr: '',
  termMonths: '',
  startDate: '',
  scheduledPayment: '',
  extraPrincipalPattern: '',
};

function loanToForm(loan: Loan): FormState {
  return {
    name: loan.name,
    lenderPattern: loan.lenderPattern,
    loanType: loan.loanType,
    originalBalance: (loan.originalBalanceCents / 100).toString(),
    apr: (loan.aprBps / 100).toString(),
    termMonths: loan.termMonths?.toString() ?? '',
    startDate: loan.startDate,
    scheduledPayment: (loan.scheduledPaymentCents / 100).toString(),
    extraPrincipalPattern: loan.extraPrincipalPattern ?? '',
  };
}

/** Convert form dollars/percent into the API's cents/bps payload. */
function formToPayload(f: FormState): CreateLoanInput {
  return {
    name: f.name.trim(),
    lenderPattern: f.lenderPattern.trim(),
    loanType: f.loanType,
    originalBalanceCents: Math.round(parseFloat(f.originalBalance) * 100),
    aprBps: Math.round(parseFloat(f.apr) * 100),
    termMonths: f.termMonths ? parseInt(f.termMonths, 10) : undefined,
    startDate: f.startDate,
    scheduledPaymentCents: Math.round(parseFloat(f.scheduledPayment) * 100),
    extraPrincipalPattern: f.extraPrincipalPattern.trim() || null,
  };
}

function LoanForm({
  initial,
  onDone,
}: {
  initial?: Loan;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial ? loanToForm(initial) : EMPTY_FORM);
  const create = useCreateLoan();
  const update = useUpdateLoan();
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

  const valid =
    form.name.trim() &&
    form.lenderPattern.trim() &&
    parseFloat(form.originalBalance) > 0 &&
    parseFloat(form.apr) >= 0 &&
    form.startDate &&
    parseFloat(form.scheduledPayment) > 0;

  const field = 'w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm';
  const label = 'block text-xs font-medium text-[var(--muted-foreground)] mb-1';

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{initial ? 'Edit loan' : 'Add a loan'}</h3>
        <button onClick={onDone} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Name</label>
          <input className={field} value={form.name} placeholder="Langley Mortgage"
            onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className={label}>Type</label>
          <select className={field} value={form.loanType}
            onChange={(e) => set('loanType', e.target.value as LoanType)}>
            {Object.entries(LOAN_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Lender pattern (text on the payment transaction)</label>
          <input className={field} value={form.lenderPattern} placeholder="Langley Federal"
            onChange={(e) => set('lenderPattern', e.target.value)} />
        </div>
        <div>
          <label className={label}>Original balance ($)</label>
          <input className={field} type="number" inputMode="decimal" value={form.originalBalance}
            placeholder="568888" onChange={(e) => set('originalBalance', e.target.value)} />
        </div>
        <div>
          <label className={label}>APR (%)</label>
          <input className={field} type="number" inputMode="decimal" step="0.001" value={form.apr}
            placeholder="3.25" onChange={(e) => set('apr', e.target.value)} />
        </div>
        <div>
          <label className={label}>Start date</label>
          <input className={field} type="date" value={form.startDate}
            onChange={(e) => set('startDate', e.target.value)} />
        </div>
        <div>
          <label className={label}>Term (months, optional)</label>
          <input className={field} type="number" inputMode="numeric" value={form.termMonths}
            placeholder="360" onChange={(e) => set('termMonths', e.target.value)} />
        </div>
        <div>
          <label className={label}>Monthly payment ($) — principal + interest</label>
          <input className={field} type="number" inputMode="decimal" value={form.scheduledPayment}
            placeholder="3069" onChange={(e) => set('scheduledPayment', e.target.value)} />
        </div>
        <div>
          <label className={label}>Extra-principal pattern (optional)</label>
          <input className={field} value={form.extraPrincipalPattern} placeholder="leave blank if none"
            onChange={(e) => set('extraPrincipalPattern', e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-[var(--muted-foreground)]">
        If you pay a steady extra amount every month, fold it into the monthly payment above for an
        accurate balance. The advisor answers payoff questions (&ldquo;when&rsquo;s my mortgage paid
        off?&rdquo;, &ldquo;what if I add $500/mo?&rdquo;).
      </p>

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!valid || pending}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50">
          {pending ? 'Saving…' : initial ? 'Save changes' : 'Add loan'}
        </button>
        <button onClick={onDone}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--muted)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Row / Card ────────────────────────────────────────────────

function LoanRow({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  const remove = useDeleteLoan();
  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--muted)]/30 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium text-sm">{loan.name}</p>
        {loan.lenderPattern !== loan.name && (
          <p className="text-xs text-[var(--muted-foreground)]">{loan.lenderPattern}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
          {LOAN_TYPE_LABELS[loan.loanType]}
        </span>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums">{formatCents(loan.originalBalanceCents)}</td>
      <td className="px-4 py-3 text-sm tabular-nums">{formatApr(loan.aprBps)}</td>
      <td className="px-4 py-3 text-sm tabular-nums">{formatCents(loan.scheduledPaymentCents)}</td>
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">{formatStartDate(loan.startDate)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button onClick={onEdit} title="Edit"
            className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => remove.mutate(loan.id)} disabled={remove.isPending} title="Delete"
            className="rounded p-1.5 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function LoanCard({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  const remove = useDeleteLoan();
  return (
    <MobileCard
      fields={[
        { primary: true, value: loan.name },
        { amount: true, value: formatCents(loan.originalBalanceCents) },
        { label: 'Type', value: LOAN_TYPE_LABELS[loan.loanType] },
        { label: 'APR', value: formatApr(loan.aprBps) },
        { label: 'Monthly', value: formatCents(loan.scheduledPaymentCents) },
        { label: 'Started', value: formatStartDate(loan.startDate) },
        { label: 'Pattern', value: loan.lenderPattern !== loan.name ? loan.lenderPattern : undefined },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <button onClick={onEdit} title="Edit"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-[var(--muted)] text-[var(--muted-foreground)]">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => remove.mutate(loan.id)} disabled={remove.isPending} title="Delete"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-[var(--destructive)]/10 text-[var(--destructive)]">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      }
    />
  );
}

// ── Page ──────────────────────────────────────────────────────

/** Loan payoff tracker — manage mortgage / auto / other loans. */
export default function LoansPage() {
  const { data, isLoading } = useLoans();
  const [editing, setEditing] = useState<Loan | null>(null);
  const [adding, setAdding] = useState(false);

  const loans: Loan[] = data?.data ?? [];
  const showForm = adding || editing !== null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Landmark className="h-6 w-6 text-[var(--primary)]" />
            <h1 className="text-3xl font-extrabold tracking-tight">Loans</h1>
          </div>
          <p className="text-[var(--muted-foreground)] text-sm">
            Track mortgage &amp; auto payoff. Ask the{' '}
            <a href="/advisor" className="inline-flex items-center gap-0.5 text-[var(--primary)] underline">
              <Sparkles className="h-3 w-3" /> Advisor
            </a>{' '}
            when a loan will be paid off or how much extra payments save.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" /> Add loan
          </button>
        )}
      </div>

      {showForm && (
        <LoanForm
          initial={editing ?? undefined}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      {isLoading && (
        <p className="text-sm text-[var(--muted-foreground)] animate-pulse">Loading loans…</p>
      )}

      {!isLoading && loans.length === 0 && !showForm && (
        <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
          No loans tracked yet. Click &ldquo;Add loan&rdquo; to track your mortgage or auto loan.
        </p>
      )}

      {/* Payoff status */}
      {loans.length > 0 && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {loans.map((loan) => (
            <LoanStatusCard key={loan.id} loan={loan} />
          ))}
        </section>
      )}

      {loans.length > 0 && (
        <>
          {/* Manage / details table */}
          <h2 className="text-lg font-bold">Details</h2>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Original Balance</th>
                  <th className="px-4 py-3">APR</th>
                  <th className="px-4 py-3">Monthly</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <LoanRow key={loan.id} loan={loan} onEdit={() => setEditing(loan)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {loans.map((loan) => (
              <LoanCard key={loan.id} loan={loan} onEdit={() => setEditing(loan)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
