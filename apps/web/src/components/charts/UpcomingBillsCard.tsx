import Link from 'next/link';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import type { RecurringBill } from '@moneypulse/shared';
import { formatCents } from '@/lib/format';

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return Infinity;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.round(diff / 86_400_000);
}

function statusLabel(days: number): { label: string; cls: string } {
  if (days < 0)
    return {
      label: 'Overdue',
      cls: 'bg-[var(--destructive)]/10 text-[var(--destructive)]',
    };
  if (days <= 3)
    return {
      label: `${days}d`,
      cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    };
  return {
    label: `${days}d`,
    cls: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  };
}

interface Props {
  bills: RecurringBill[];
}

/** Dashboard widget showing the next 5 upcoming confirmed bills. */
export function UpcomingBillsCard({ bills }: Props) {
  const overdue = bills.filter((b) => daysUntil(b.nextExpectedDate) < 0);

  return (
    <div className="rounded-xl bg-[var(--surface-container-low)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-[var(--primary)]" />
          <h2 className="text-sm font-semibold">Upcoming Bills</h2>
          {overdue.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--destructive)]/10 px-2 py-0.5 text-xs font-bold text-[var(--destructive)]">
              <AlertTriangle className="h-3 w-3" />
              {overdue.length} overdue
            </span>
          )}
        </div>
        <Link
          href="/bills"
          className="text-xs text-[var(--primary)] hover:underline"
        >
          Manage →
        </Link>
      </div>

      {bills.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          No upcoming bills in the next 7 days.{' '}
          <Link href="/bills" className="underline">
            Set up recurring bills →
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {bills.map((bill) => {
            const days = daysUntil(bill.nextExpectedDate);
            const status = statusLabel(days);
            return (
              <li key={bill.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium truncate max-w-[160px]">
                    {bill.normalizedName}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {formatCents(bill.expectedAmountCents)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.cls}`}
                >
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
