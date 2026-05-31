'use client';

import { useState } from 'react';
import { CalendarClock, ScanSearch, BellRing, Check, X, Pencil, Ban } from 'lucide-react';
import { formatCents } from '@/lib/format';
import { MobileCard } from '@/components/MobileCard';
import type { RecurringBill, BillFrequency } from '@moneypulse/shared';
import {
  useBills,
  useDetectBills,
  useCheckMissedBills,
  useConfirmBill,
  useDeactivateBill,
  useDeleteBill,
  useUpdateBill,
} from '@/lib/hooks/useBills';

// ── Helpers ──────────────────────────────────────────────────

const FREQ_LABELS: Record<BillFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semi_annual: 'Semi-annual',
  annual: 'Annual',
};

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return Infinity;
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function billStatus(bill: RecurringBill): { label: string; cls: string } {
  const days = daysUntil(bill.nextExpectedDate);
  if (days < 0)
    return {
      label: 'Overdue',
      cls: 'bg-[var(--destructive)]/10 text-[var(--destructive)]',
    };
  if (days <= 7)
    return {
      label: 'Upcoming',
      cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    };
  return {
    label: 'On Track',
    cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };
}

function formatNextDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Mobile Card ───────────────────────────────────────────────

function BillMobileCard({
  bill,
  confirmed,
}: {
  bill: RecurringBill;
  confirmed: boolean;
}) {
  const confirm = useConfirmBill();
  const deactivate = useDeactivateBill();
  const remove = useDeleteBill();
  const status = billStatus(bill);

  return (
    <MobileCard
      fields={[
        { primary: true, value: bill.normalizedName },
        { amount: true, value: formatCents(bill.expectedAmountCents) },
        { label: 'Pattern', value: bill.merchantPattern },
        {
          label: 'Frequency',
          value: FREQ_LABELS[bill.frequency as BillFrequency] ?? bill.frequency,
        },
        { label: 'Next Due', value: formatNextDate(bill.nextExpectedDate) },
        { label: 'Last Paid', value: formatNextDate(bill.lastSeenDate) },
        ...(confirmed
          ? [
              {
                label: 'Status',
                value: (
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}
                  >
                    {status.label}
                  </span>
                ),
              },
            ]
          : []),
      ]}
      actions={
        <div className="flex items-center gap-2">
          {!confirmed && (
            <button
              onClick={() => confirm.mutate(bill.id)}
              disabled={confirm.isPending}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              title="Confirm"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          {confirmed && (
            <button
              onClick={() => deactivate.mutate(bill.id)}
              disabled={deactivate.isPending}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
              title="Deactivate"
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => remove.mutate(bill.id)}
            disabled={remove.isPending}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-[var(--destructive)]/10 text-[var(--destructive)]"
            title="Dismiss / Delete"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    />
  );
}

// ── Table Row ─────────────────────────────────────────────────

function BillRow({
  bill,
  confirmed,
}: {
  bill: RecurringBill;
  confirmed: boolean;
}) {
  const confirm = useConfirmBill();
  const deactivate = useDeactivateBill();
  const remove = useDeleteBill();
  const status = billStatus(bill);

  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--muted)]/30 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium text-sm">{bill.normalizedName}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{bill.merchantPattern}</p>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums">
        {formatCents(bill.expectedAmountCents)}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
          {FREQ_LABELS[bill.frequency as BillFrequency] ?? bill.frequency}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
        {formatNextDate(bill.nextExpectedDate)}
      </td>
      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
        {formatNextDate(bill.lastSeenDate)}
      </td>
      {confirmed && (
        <td className="px-4 py-3">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}>
            {status.label}
          </span>
        </td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {!confirmed && (
            <button
              onClick={() => confirm.mutate(bill.id)}
              disabled={confirm.isPending}
              title="Confirm"
              className="rounded p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          {confirmed && (
            <button
              onClick={() => deactivate.mutate(bill.id)}
              disabled={deactivate.isPending}
              title="Deactivate"
              className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => remove.mutate(bill.id)}
            disabled={remove.isPending}
            title="Dismiss / Delete"
            className="rounded p-1.5 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Section Table ─────────────────────────────────────────────

function BillsTable({
  bills,
  confirmed,
}: {
  bills: RecurringBill[];
  confirmed: boolean;
}) {
  if (bills.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
        {confirmed
          ? 'No confirmed bills yet. Confirm detected bills below to enable alerts.'
          : 'No unconfirmed bills. Click "Detect Bills" to scan your transaction history.'}
      </p>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3">Merchant</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Frequency</th>
              <th className="px-4 py-3">Next Due</th>
              <th className="px-4 py-3">Last Paid</th>
              {confirmed && <th className="px-4 py-3">Status</th>}
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((bill) => (
              <BillRow key={bill.id} bill={bill} confirmed={confirmed} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {bills.map((bill) => (
          <BillMobileCard key={bill.id} bill={bill} confirmed={confirmed} />
        ))}
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────

/** Recurring bills management page. */
export default function BillsPage() {
  const { data, isLoading } = useBills();
  const detect = useDetectBills();
  const checkMissed = useCheckMissedBills();

  const [detectResult, setDetectResult] = useState<{
    detected: number;
    newBills: number;
    existingSkipped: number;
  } | null>(null);
  const [checkResult, setCheckResult] = useState<{
    missedCount: number;
    notified: number;
  } | null>(null);

  const bills: RecurringBill[] = data?.data ?? [];
  const confirmed = bills.filter((b) => b.isConfirmed && b.isActive);
  const unconfirmed = bills.filter((b) => !b.isConfirmed && b.isActive);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-[var(--primary)]" />
            <h1 className="text-3xl font-extrabold tracking-tight">Recurring Bills</h1>
          </div>
          <p className="text-[var(--muted-foreground)] text-sm">
            Track expected recurring charges and get alerts when bills are missed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() =>
              detect.mutateAsync({} as any).then((res) => setDetectResult(res.data))
            }
            disabled={detect.isPending}
            className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <ScanSearch className="h-4 w-4" />
            {detect.isPending ? 'Scanning…' : 'Detect Bills'}
          </button>
          <button
            onClick={() =>
              checkMissed.mutateAsync({} as any).then((res) => setCheckResult(res.data))
            }
            disabled={checkMissed.isPending}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
          >
            <BellRing className="h-4 w-4" />
            {checkMissed.isPending ? 'Checking…' : 'Check Missed'}
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {detectResult && (
        <div className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800">
          <span>
            Scan complete — {detectResult.detected} recurring pattern
            {detectResult.detected !== 1 ? 's' : ''} detected,{' '}
            {detectResult.newBills} new,{' '}
            {detectResult.existingSkipped} existing updated.
          </span>
          <button onClick={() => setDetectResult(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {checkResult && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          <span>
            Missed bill check complete — {checkResult.missedCount} overdue,{' '}
            {checkResult.notified} alert{checkResult.notified !== 1 ? 's' : ''} sent.
          </span>
          <button onClick={() => setCheckResult(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-[var(--muted-foreground)] animate-pulse">
          Loading bills…
        </p>
      )}

      {/* Confirmed Bills */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">
          Confirmed Bills{' '}
          <span className="ml-1 text-sm font-normal text-[var(--muted-foreground)]">
            ({confirmed.length})
          </span>
        </h2>
        <BillsTable bills={confirmed} confirmed />
      </section>

      {/* Unconfirmed / Detected */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">
            Detected — Awaiting Confirmation{' '}
            <span className="ml-1 text-sm font-normal text-[var(--muted-foreground)]">
              ({unconfirmed.length})
            </span>
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            These recurring charges were auto-detected from your transaction history.
            Confirm to enable missed-payment alerts.
          </p>
        </div>
        <BillsTable bills={unconfirmed} confirmed={false} />
      </section>
    </div>
  );
}
