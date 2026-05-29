'use client';

import { useMemo, Fragment } from 'react';
import { CreditCard } from 'lucide-react';
import type { CreditCardPaymentItem } from '@/lib/hooks/useAnalytics';

interface CreditCardPaymentsTableProps {
  data: CreditCardPaymentItem[];
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function formatMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  if (!y || !m) return yyyyMm;
  const date = new Date(Number(y), Number(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Displays monthly credit card payment totals per account.
 * Groups by month, shows each card's payment and a monthly total.
 */
export function CreditCardPaymentsTable({ data }: CreditCardPaymentsTableProps) {
  // Group by month
  const grouped = useMemo(() => {
    const map = new Map<string, { rows: CreditCardPaymentItem[]; total: number }>();
    for (const row of data) {
      const entry = map.get(row.month) ?? { rows: [], total: 0 };
      entry.rows.push(row);
      entry.total += row.totalCents;
      map.set(row.month, entry);
    }
    // Sort months descending (most recent first)
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  if (grouped.length === 0) {
    return (
      <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="h-5 w-5 text-[var(--muted-foreground)]" />
          <h3 className="text-base font-bold">Credit Card Payments</h3>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          No credit card payments found in this period. Make sure payments are categorized as &ldquo;Credit Card Payment&rdquo;.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <CreditCard className="h-5 w-5 text-[var(--muted-foreground)]" />
        <h3 className="text-base font-bold">Credit Card Payments</h3>
      </div>
      <p className="text-xs text-[var(--muted-foreground)] mb-4">
        Monthly payments toward your credit cards
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
              <th className="pb-2 font-medium">Month</th>
              <th className="pb-2 font-medium">Card</th>
              <th className="pb-2 font-medium text-right">Amount</th>
              <th className="pb-2 font-medium text-right">Payments</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([month, { rows, total }]) => (
              <Fragment key={month}>
                {rows.map((row, idx) => (
                  <tr
                    key={`${month}-${row.accountId}`}
                    className="border-b border-[var(--border)]/50"
                  >
                    {idx === 0 && (
                      <td
                        className="py-2.5 font-medium whitespace-nowrap"
                        rowSpan={rows.length}
                      >
                        {formatMonth(month)}
                      </td>
                    )}
                    <td className="py-2.5 text-[var(--muted-foreground)]">
                      {row.accountName}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-medium text-[var(--primary)]">
                      {formatCents(row.totalCents)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-[var(--muted-foreground)]">
                      {row.paymentCount}
                    </td>
                  </tr>
                ))}
                {rows.length > 1 && (
                  <tr className="border-b border-[var(--border)]">
                    <td />
                    <td className="py-2 text-xs font-semibold text-[var(--muted-foreground)]">
                      Monthly total
                    </td>
                    <td className="py-2 text-right tabular-nums font-bold">
                      {formatCents(total)}
                    </td>
                    <td />
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
