'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useIngestionCoverage, type CoverageCell } from '@/lib/hooks/useUpload';
import { useSnoozeStatementSchedule } from '@/lib/hooks/useStatementSchedule';

const CELL_STYLES: Record<CoverageCell['status'], string> = {
  received: 'bg-emerald-500/70 hover:bg-emerald-500',
  late: 'bg-amber-500/70 hover:bg-amber-500',
  empty: 'bg-amber-400/50 hover:bg-amber-400',
  missing: 'bg-red-500/70 hover:bg-red-500',
  due: 'bg-sky-500/40 hover:bg-sky-500/70',
  na: 'bg-[var(--border)]',
};

const LEGEND: { status: CoverageCell['status']; label: string }[] = [
  { status: 'received', label: 'Received' },
  { status: 'late', label: 'Late' },
  { status: 'empty', label: 'Empty (0 rows)' },
  { status: 'due', label: 'Due soon' },
  { status: 'missing', label: 'Missing' },
  { status: 'na', label: 'Not expected' },
];

/** Accounts x months coverage grid — Import Pipeline Radar Phase 3. */
export function CoverageGrid({ months = 6 }: { months?: number }) {
  const { data, isLoading, error } = useIngestionCoverage(months);
  const snooze = useSnoozeStatementSchedule();
  const router = useRouter();

  const accounts = data?.data ?? [];

  if (isLoading) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading coverage…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-500">Couldn&apos;t load import coverage.</p>;
  }
  if (accounts.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">No accounts to show coverage for yet.</p>;
  }

  const monthLabels = accounts[0]?.cells.map((c) => c.month) ?? [];

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left font-semibold">Account</th>
              {monthLabels.map((m) => (
                <th key={m} className="p-2 text-center text-xs font-semibold text-[var(--muted-foreground)]">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((acct) => (
              <tr key={acct.accountId} className="border-t border-[var(--border)]">
                <td className="whitespace-nowrap p-2 font-medium">
                  {acct.nickname} <span className="text-[var(--muted-foreground)]">••{acct.lastFour}</span>
                </td>
                {acct.cells.map((cell) => (
                  <td key={cell.month} className="p-1.5 text-center">
                    <button
                      type="button"
                      title={`${acct.nickname} · ${cell.month} · ${cell.status}`}
                      className={cn('h-6 w-6 rounded-md transition-colors', CELL_STYLES[cell.status])}
                      onClick={() => {
                        if (cell.uploadId) {
                          router.push(`/imports/${cell.uploadId}`);
                        } else if (cell.status === 'missing' || cell.status === 'due') {
                          snooze.mutate({ accountId: acct.accountId, days: 1 });
                        }
                      }}
                    >
                      <span className="sr-only">{cell.status}</span>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-[var(--muted-foreground)]">
        {LEGEND.map((l) => (
          <div key={l.status} className="flex items-center gap-1.5">
            <span className={cn('h-3 w-3 rounded-sm', CELL_STYLES[l.status])} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
