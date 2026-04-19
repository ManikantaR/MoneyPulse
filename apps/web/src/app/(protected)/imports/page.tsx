'use client';

import { FileText, CheckCircle2, AlertCircle, Loader2, Clock, X, Trash2, ChevronDown, ChevronRight, BarChart3, FileWarning, SkipForward, Upload } from 'lucide-react';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useUploads, useDeleteUpload } from '@/lib/hooks/useUpload';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { useMemo, useState, Fragment } from 'react';
import type { FileUpload } from '@moneypulse/shared';

function StepItem({ icon, label, detail, status }: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  status: 'done' | 'pending' | 'error';
}) {
  const colors = {
    done: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
    pending: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
    error: 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400',
  };
  const dotColors = {
    done: 'bg-emerald-500',
    pending: 'bg-amber-500',
    error: 'bg-red-500',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-3', colors[status])}>
      <div className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white', dotColors[status])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="truncate text-xs opacity-80">{detail}</p>
      </div>
    </div>
  );
}

/** File imports status page — shows all imported files with detailed status. */
export default function ImportsPage() {
  const { data: uploadsData, isLoading } = useUploads();
  const { data: accountsData } = useAccounts();
  const deleteUpload = useDeleteUpload();
  const [errorUpload, setErrorUpload] = useState<FileUpload | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const uploads = uploadsData?.data ?? [];
  const accounts = accountsData?.data ?? [];

  const accountMap = useMemo(
    () =>
      Object.fromEntries(
        accounts.map((a) => [a.id, `${a.nickname} (••${a.lastFour})`]),
      ),
    [accounts],
  );

  // Sort most recent first
  const sortedUploads = useMemo(
    () =>
      [...uploads].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [uploads],
  );

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

  const totalImported = sortedUploads.reduce((s, u) => s + u.rowsImported, 0);
  const totalFiles = sortedUploads.length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl font-extrabold tracking-tight">
          File Imports
        </h1>
        <p className="text-[var(--muted-foreground)]">
          {totalFiles} files imported · {totalImported} total transactions
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {[
          {
            label: 'Total Files',
            value: totalFiles,
            color: 'text-[var(--primary)]',
          },
          {
            label: 'Completed',
            value: sortedUploads.filter((u) => u.status === 'completed').length,
            color: 'text-emerald-500',
          },
          {
            label: 'Failed',
            value: sortedUploads.filter((u) => u.status === 'failed').length,
            color: 'text-red-500',
          },
          {
            label: 'Rows Imported',
            value: totalImported,
            color: 'text-[var(--secondary)]',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
          >
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
              {stat.label}
            </p>
            <p className={cn('mt-1 text-3xl font-extrabold tabular-nums', stat.color)}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl bg-[var(--card)] shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-container-low)]/50 text-left">
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
                File
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
                Account
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
                Status
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] text-right">
                Imported
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] text-right">
                Skipped
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] text-right">
                Errors
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">
                Date
              </th>
              <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)] text-right">
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {isLoading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-[var(--muted-foreground)]"
                >
                  Loading...
                </td>
              </tr>
            ) : sortedUploads.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-[var(--muted-foreground)]"
                >
                  No files imported yet. Upload a statement from the{' '}
                  <a href="/upload" className="text-[var(--primary)] hover:underline">
                    Upload
                  </a>{' '}
                  page or drop a CSV in the watch folder.
                </td>
              </tr>
            ) : (
              sortedUploads.map((upload) => {
                const isExpanded = expandedId === upload.id;
                const totalRows = upload.rowsImported + upload.rowsSkipped + upload.rowsErrored;
                const importPct = totalRows > 0 ? Math.round((upload.rowsImported / totalRows) * 100) : 0;
                const skipPct = totalRows > 0 ? Math.round((upload.rowsSkipped / totalRows) * 100) : 0;
                const errorPct = totalRows > 0 ? Math.round((upload.rowsErrored / totalRows) * 100) : 0;

                return (
                <Fragment key={upload.id}>
                <tr
                  className={cn(
                    'hover:bg-[var(--surface-container-low)] transition-colors cursor-pointer',
                    isExpanded && 'bg-[var(--surface-container-low)]',
                  )}
                  onClick={() => setExpandedId(isExpanded ? null : upload.id)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--primary)]" />
                        : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />}
                      <div>
                        <span className="font-medium">{upload.filename}</span>
                        <span className="ml-2 text-[10px] font-bold uppercase text-[var(--muted-foreground)]">
                          {upload.fileType}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-[var(--muted-foreground)]">
                    {accountMap[upload.accountId] ?? '—'}
                  </td>
                  <td className="px-6 py-4">
                    {upload.status === 'failed' ? (
                      <button onClick={(e) => { e.stopPropagation(); setErrorUpload(upload); }} className="cursor-pointer">
                        {statusBadge(upload.status)}
                      </button>
                    ) : (
                      statusBadge(upload.status)
                    )}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums font-semibold">
                    {upload.rowsImported}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-[var(--muted-foreground)]">
                    {upload.rowsSkipped}
                  </td>
                  <td
                    className={cn(
                      'px-6 py-4 text-right tabular-nums',
                      upload.rowsErrored > 0 || upload.status === 'failed'
                        ? 'font-bold text-red-500'
                        : 'text-[var(--muted-foreground)]',
                    )}
                  >
                    {upload.rowsErrored > 0 || upload.status === 'failed' ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setErrorUpload(upload); }}
                        className="cursor-pointer underline decoration-dotted underline-offset-4 hover:decoration-solid"
                      >
                        {upload.rowsErrored || (upload.status === 'failed' ? 'View' : 0)}
                      </button>
                    ) : (
                      upload.rowsErrored
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap tabular-nums text-[var(--muted-foreground)]">
                    {formatDate(upload.createdAt)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {(upload.status === 'completed' || upload.status === 'failed') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${upload.filename}" and its ${upload.rowsImported} imported transactions?`)) {
                            deleteUpload.mutate(upload.id);
                          }
                        }}
                        disabled={deleteUpload.isPending}
                        className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                        title="Delete import and transactions"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>

                {/* Expanded details panel */}
                {isExpanded && (
                  <tr>
                    <td colSpan={8} className="border-b border-[var(--border)] bg-[var(--surface-container-low)]/50 px-6 py-5">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        {/* Step timeline */}
                        <div className="space-y-3">
                          <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Processing Steps</h4>
                          <div className="space-y-2.5">
                            <StepItem
                              icon={<Upload className="h-3.5 w-3.5" />}
                              label="File Uploaded"
                              detail={`${upload.filename} (${upload.fileType.toUpperCase()})`}
                              status="done"
                            />
                            <StepItem
                              icon={<FileText className="h-3.5 w-3.5" />}
                              label="CSV Parsed"
                              detail={totalRows > 0 ? `${totalRows} rows detected` : 'Parsing...'}
                              status={upload.status === 'pending' ? 'pending' : 'done'}
                            />
                            <StepItem
                              icon={<SkipForward className="h-3.5 w-3.5" />}
                              label="Deduplication"
                              detail={upload.rowsSkipped > 0 ? `${upload.rowsSkipped} duplicates removed` : 'No duplicates'}
                              status={upload.status === 'pending' || upload.status === 'processing' ? 'pending' : 'done'}
                            />
                            <StepItem
                              icon={upload.status === 'failed' ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              label={upload.status === 'failed' ? 'Import Failed' : 'Import Complete'}
                              detail={upload.status === 'failed'
                                ? `${upload.rowsErrored} rows with errors`
                                : upload.status === 'completed'
                                  ? `${upload.rowsImported} transactions created`
                                  : 'In progress...'}
                              status={upload.status === 'completed' ? 'done' : upload.status === 'failed' ? 'error' : 'pending'}
                            />
                          </div>
                        </div>

                        {/* Breakdown bar chart */}
                        <div className="space-y-3">
                          <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Row Breakdown</h4>
                          {totalRows > 0 ? (
                            <div className="space-y-3">
                              <div className="flex h-4 w-full overflow-hidden rounded-full bg-[var(--surface-container-low)]">
                                {importPct > 0 && (
                                  <div className="bg-emerald-500 transition-all" style={{ width: `${importPct}%` }} title={`Imported: ${importPct}%`} />
                                )}
                                {skipPct > 0 && (
                                  <div className="bg-amber-500 transition-all" style={{ width: `${skipPct}%` }} title={`Skipped: ${skipPct}%`} />
                                )}
                                {errorPct > 0 && (
                                  <div className="bg-red-500 transition-all" style={{ width: `${errorPct}%` }} title={`Errors: ${errorPct}%`} />
                                )}
                              </div>
                              <div className="flex flex-wrap gap-4 text-xs">
                                <span className="flex items-center gap-1.5">
                                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                  Imported: {upload.rowsImported} ({importPct}%)
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                                  Skipped: {upload.rowsSkipped} ({skipPct}%)
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                                  Errors: {upload.rowsErrored} ({errorPct}%)
                                </span>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-[var(--muted-foreground)]">No row data yet</p>
                          )}
                        </div>

                        {/* Error summary + actions */}
                        <div className="space-y-3">
                          <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Details</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-[var(--muted-foreground)]">Account</span>
                              <span className="font-medium">{accountMap[upload.accountId] ?? '—'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--muted-foreground)]">Upload Date</span>
                              <span className="font-medium tabular-nums">{formatDate(upload.createdAt)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[var(--muted-foreground)]">Last Updated</span>
                              <span className="font-medium tabular-nums">{formatDate(upload.updatedAt)}</span>
                            </div>
                          </div>
                          {upload.rowsErrored > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setErrorUpload(upload); }}
                              className="mt-2 w-full rounded-xl bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
                            >
                              <FileWarning className="mr-1.5 inline h-4 w-4" />
                              View {upload.rowsErrored} Error{upload.rowsErrored !== 1 ? 's' : ''}
                            </button>
                          )}
                          <a
                            href={`/imports/${upload.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 block w-full rounded-xl bg-[var(--primary)]/10 px-4 py-2.5 text-center text-sm font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20"
                          >
                            <BarChart3 className="mr-1.5 inline h-4 w-4" />
                            View Full Details →
                          </a>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Error details modal */}
      {errorUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setErrorUpload(null)}
        >
          <div
            className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div>
                <h2 className="text-lg font-bold">Error Details</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {errorUpload.filename}
                </p>
              </div>
              <button
                onClick={() => setErrorUpload(null)}
                className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {errorUpload.errorLog && errorUpload.errorLog.length > 0 ? (
                <div className="space-y-3">
                  {errorUpload.errorLog.map((err, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-red-500/20 bg-red-500/5 p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="shrink-0 rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-500">
                          Row {err.row}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                        {err.error}
                      </p>
                      {err.raw && (
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--surface-container-low)] p-3 text-xs text-[var(--muted-foreground)]">
                          {err.raw}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Import failed. No detailed row-level errors were recorded.
                    The file may have an unsupported format or contain malformed CSV data.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
