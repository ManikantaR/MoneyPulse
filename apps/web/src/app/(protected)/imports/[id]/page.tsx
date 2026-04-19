'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  SkipForward,
  Upload,
  TrendingUp,
  TrendingDown,
  X,
} from 'lucide-react';
import { useUploadDetail } from '@/lib/hooks/useUpload';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { useCategories } from '@/lib/hooks/useCategories';
import { cn } from '@/lib/utils';
import { formatDate, formatCents } from '@/lib/format';

export default function ImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: uploadData, isLoading } = useUploadDetail(id);
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories();
  const { data: txnData } = useTransactions({ uploadId: id, pageSize: 100, sortBy: 'date', sortOrder: 'asc' });

  const upload = uploadData?.data;
  const accounts = accountsData?.data ?? [];
  const transactions = txnData?.data ?? [];
  const categories = categoriesData?.data ?? [];

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, `${a.nickname} (••${a.lastFour})`])),
    [accounts],
  );

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const totalRows = upload ? upload.rowsImported + upload.rowsSkipped + upload.rowsErrored : 0;
  const importPct = totalRows > 0 ? Math.round((upload!.rowsImported / totalRows) * 100) : 0;
  const skipPct = totalRows > 0 ? Math.round((upload!.rowsSkipped / totalRows) * 100) : 0;
  const errorPct = totalRows > 0 ? Math.round((upload!.rowsErrored / totalRows) * 100) : 0;

  // Compute transaction summaries
  const { totalCredits, totalDebits, categorizedCount, uncategorizedCount } = useMemo(() => {
    let credits = 0;
    let debits = 0;
    let categorized = 0;
    let uncategorized = 0;
    for (const txn of transactions) {
      if (txn.isCredit) credits += txn.amountCents;
      else debits += Math.abs(txn.amountCents);
      if (txn.categoryId) categorized++;
      else uncategorized++;
    }
    return { totalCredits: credits, totalDebits: debits, categorizedCount: categorized, uncategorizedCount: uncategorized };
  }, [transactions]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!upload) {
    return (
      <div className="space-y-4 py-20 text-center">
        <p className="text-[var(--muted-foreground)]">Import not found</p>
        <button onClick={() => router.push('/imports')} className="text-[var(--primary)] hover:underline">
          Back to imports
        </button>
      </div>
    );
  }

  function statusBadge(status: string) {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold text-red-600 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" /> Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-500/10 px-3 py-1 text-xs font-bold text-[var(--muted-foreground)]">
            <Clock className="h-3.5 w-3.5" /> Pending
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => router.push('/imports')}
          className="mt-1 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{upload.filename}</h1>
            {statusBadge(upload.status)}
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Uploaded {formatDate(upload.createdAt)} · {accountMap[upload.accountId] ?? 'Unknown account'} · {upload.fileType.toUpperCase()}
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Rows" value={totalRows} color="text-[var(--primary)]" />
        <StatCard label="Imported" value={upload.rowsImported} color="text-emerald-500" />
        <StatCard label="Skipped" value={upload.rowsSkipped} color="text-amber-500" />
        <StatCard label="Errors" value={upload.rowsErrored} color="text-red-500" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Processing timeline */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="mb-4 text-sm font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
            Processing Timeline
          </h3>
          <div className="space-y-0">
            <TimelineStep
              icon={<Upload className="h-4 w-4" />}
              label="File Uploaded"
              detail={`${upload.filename} (${upload.fileType.toUpperCase()})`}
              status="done"
              isLast={false}
            />
            <TimelineStep
              icon={<FileText className="h-4 w-4" />}
              label="CSV Parsed"
              detail={totalRows > 0 ? `${totalRows} rows detected` : 'Parsing file...'}
              status={upload.status === 'pending' ? 'active' : 'done'}
              isLast={false}
            />
            <TimelineStep
              icon={<SkipForward className="h-4 w-4" />}
              label="Deduplication"
              detail={
                upload.rowsSkipped > 0
                  ? `${upload.rowsSkipped} duplicate${upload.rowsSkipped !== 1 ? 's' : ''} removed`
                  : 'No duplicates found'
              }
              status={
                upload.status === 'pending' ? 'pending' : upload.status === 'processing' ? 'active' : 'done'
              }
              isLast={false}
            />
            <TimelineStep
              icon={
                upload.status === 'failed' ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )
              }
              label={upload.status === 'failed' ? 'Import Failed' : 'Import Complete'}
              detail={
                upload.status === 'failed'
                  ? `${upload.rowsErrored} rows with errors`
                  : upload.status === 'completed'
                    ? `${upload.rowsImported} transactions created`
                    : 'Processing...'
              }
              status={
                upload.status === 'completed' ? 'done' : upload.status === 'failed' ? 'error' : 'pending'
              }
              isLast={true}
            />
          </div>
        </div>

        {/* Row breakdown + money summary */}
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
              Row Breakdown
            </h3>
            {totalRows > 0 ? (
              <div className="space-y-4">
                <div className="flex h-5 w-full overflow-hidden rounded-full bg-[var(--surface-container-low)]">
                  {importPct > 0 && (
                    <div className="bg-emerald-500 transition-all" style={{ width: `${importPct}%` }} />
                  )}
                  {skipPct > 0 && (
                    <div className="bg-amber-500 transition-all" style={{ width: `${skipPct}%` }} />
                  )}
                  {errorPct > 0 && (
                    <div className="bg-red-500 transition-all" style={{ width: `${errorPct}%` }} />
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <span className="block text-2xl font-extrabold text-emerald-500">{importPct}%</span>
                    <span className="text-[var(--muted-foreground)]">Imported ({upload.rowsImported})</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-extrabold text-amber-500">{skipPct}%</span>
                    <span className="text-[var(--muted-foreground)]">Skipped ({upload.rowsSkipped})</span>
                  </div>
                  <div>
                    <span className="block text-2xl font-extrabold text-red-500">{errorPct}%</span>
                    <span className="text-[var(--muted-foreground)]">Errors ({upload.rowsErrored})</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No row data available</p>
            )}
          </div>

          {/* Money summary */}
          {transactions.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
              <h3 className="mb-4 text-sm font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
                Financial Summary
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                    <TrendingUp className="h-4 w-4 text-emerald-500" /> Credits
                  </span>
                  <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatCents(totalCredits)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                    <TrendingDown className="h-4 w-4 text-red-500" /> Debits
                  </span>
                  <span className="font-bold tabular-nums text-red-600 dark:text-red-400">
                    {formatCents(totalDebits)}
                  </span>
                </div>
                <hr className="border-[var(--border)]" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Net</span>
                  <span
                    className={cn(
                      'font-extrabold tabular-nums',
                      totalCredits - totalDebits >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {formatCents(totalCredits - totalDebits)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                  <span>Categorized: {categorizedCount}</span>
                  <span>Uncategorized: {uncategorizedCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error log */}
      {upload.errorLog && upload.errorLog.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="mb-4 text-sm font-extrabold uppercase tracking-widest text-red-500">
            Errors ({upload.errorLog.length})
          </h3>
          <div className="space-y-3">
            {upload.errorLog.map((err, i) => (
              <div key={i} className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="shrink-0 rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-500">
                    Row {err.row}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{err.error}</p>
                {err.raw && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--surface-container-low)] p-3 text-xs text-[var(--muted-foreground)]">
                    {err.raw}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction preview table */}
      {transactions.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          <div className="border-b border-[var(--border)] px-6 py-4">
            <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
              Imported Transactions ({txnData?.total ?? transactions.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-6 py-3 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Date</th>
                  <th className="px-6 py-3 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Description</th>
                  <th className="px-6 py-3 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Category</th>
                  <th className="px-6 py-3 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {transactions.map((txn) => {
                  const cat = txn.categoryId ? categoryMap[txn.categoryId] : null;
                  return (
                    <tr key={txn.id} className="hover:bg-[var(--surface-container-low)] transition-colors">
                      <td className="px-6 py-3 whitespace-nowrap tabular-nums text-[var(--muted-foreground)]">
                        {formatDate(txn.date)}
                      </td>
                      <td className="px-6 py-3">
                        <div>
                          <span className="font-medium">{txn.merchantName ?? txn.description}</span>
                          {txn.merchantName && txn.merchantName !== txn.description && (
                            <p className="truncate text-xs text-[var(--muted-foreground)]">{txn.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        {cat ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <span>{cat.icon}</span> {cat.name}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-6 py-3 text-right tabular-nums font-semibold',
                          txn.isCredit ? 'text-emerald-600 dark:text-emerald-400' : '',
                        )}
                      >
                        {txn.isCredit ? '+' : '-'}{formatCents(Math.abs(txn.amountCents))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(txnData?.total ?? 0) > 100 && (
            <div className="border-t border-[var(--border)] px-6 py-3 text-center text-xs text-[var(--muted-foreground)]">
              Showing first 100 of {txnData?.total} transactions.{' '}
              <a href={`/transactions?uploadId=${id}`} className="text-[var(--primary)] hover:underline">
                View all →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className={cn('mt-1 text-3xl font-extrabold tabular-nums', color)}>{value}</p>
    </div>
  );
}

function TimelineStep({
  icon,
  label,
  detail,
  status,
  isLast,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  status: 'done' | 'active' | 'pending' | 'error';
  isLast: boolean;
}) {
  const dotColor = {
    done: 'bg-emerald-500 text-white',
    active: 'bg-amber-500 text-white',
    pending: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
    error: 'bg-red-500 text-white',
  }[status];

  const lineColor = status === 'done' ? 'bg-emerald-500' : 'bg-[var(--border)]';

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-full', dotColor)}>
          {status === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        </div>
        {!isLast && <div className={cn('w-0.5 flex-1 min-h-6', lineColor)} />}
      </div>
      <div className={cn('pb-6', isLast && 'pb-0')}>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{detail}</p>
      </div>
    </div>
  );
}
