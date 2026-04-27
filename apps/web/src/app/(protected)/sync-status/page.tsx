'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useSyncStats, useSyncBackfill, type SyncAuditLog } from '@/lib/hooks/useSyncStatus';
import {
  CloudUpload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  RefreshCw,
  Loader2,
} from 'lucide-react';

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'danger' | 'warning' | 'success';
}) {
  const borderColor =
    variant === 'danger'
      ? 'border-red-500/30'
      : variant === 'warning'
        ? 'border-yellow-500/30'
        : variant === 'success'
          ? 'border-green-500/30'
          : 'border-[var(--border)]';
  const iconBg =
    variant === 'danger'
      ? 'bg-red-500/10 text-red-500'
      : variant === 'warning'
        ? 'bg-yellow-500/10 text-yellow-500'
        : variant === 'success'
          ? 'bg-green-500/10 text-green-500'
          : 'bg-[var(--accent)] text-[var(--primary)]';

  return (
    <div className={`rounded-xl border ${borderColor} bg-[var(--card)] p-5 shadow-sm`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function AuditRow({ log }: { log: SyncAuditLog }) {
  const time = new Date(log.created_at).toLocaleString();
  const shortId = log.outbox_event_id.slice(0, 8) + '…';

  return (
    <tr className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/40 transition-colors">
      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap">{time}</td>
      <td className="px-4 py-2.5 font-mono text-xs">{shortId}</td>
      <td className="px-4 py-2.5">
        {log.policy_passed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" /> Pass
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            <XCircle className="h-3 w-3" /> Fail
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-center text-sm">{log.attempt_no ?? '—'}</td>
      <td className="px-4 py-2.5 text-center text-sm">
        {log.http_status ? (
          <span className={log.http_status === 200 ? 'text-green-500' : 'text-red-500'}>
            {log.http_status}
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
        {log.error_code ?? '—'}
      </td>
    </tr>
  );
}

const BATCH_OPTIONS = [10, 25, 50, 100, 200] as const;
type BatchOption = typeof BATCH_OPTIONS[number];

export default function SyncStatusPage() {
  const { user } = useAuth();
  const { data: stats, isLoading, refetch, isRefetching } = useSyncStats();
  const backfill = useSyncBackfill();
  const [backfillResult, setBackfillResult] = useState<{ enqueued: number; skipped: number; durationMs: number } | null>(null);
  const [batchSize, setBatchSize] = useState<BatchOption>(50);

  const loading = isLoading;

  const lastSyncText = stats?.lastDeliveredAt
    ? new Date(stats.lastDeliveredAt).toLocaleString()
    : 'Never';

  async function handleBackfill() {
    if (!user?.id) return;
    setBackfillResult(null);
    const result = await backfill.mutateAsync({ userId: user.id, batchSize });
    setBackfillResult(result);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cloud Sync</h1>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            Outbox delivery status and backfill controls
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Delivered"
          value={loading ? '—' : (stats?.delivered ?? 0).toLocaleString()}
          icon={CheckCircle2}
          variant="success"
          sub="All time"
        />
        <StatCard
          label="Pending"
          value={loading ? '—' : stats?.pending ?? 0}
          icon={Clock}
        />
        <StatCard
          label="Retrying"
          value={loading ? '—' : stats?.retry ?? 0}
          icon={RefreshCw}
          variant={(stats?.retry ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Dead Letter"
          value={loading ? '—' : stats?.deadLetter ?? 0}
          icon={XCircle}
          variant={(stats?.deadLetter ?? 0) > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Policy Failed"
          value={loading ? '—' : stats?.policyFailed ?? 0}
          icon={ShieldAlert}
          variant={(stats?.policyFailed ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Last sync */}
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-3">
        <CloudUpload className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span className="text-sm text-[var(--muted-foreground)]">Last delivered:</span>
        <span className="text-sm font-medium">{loading ? '—' : lastSyncText}</span>
      </div>

      {/* Backfill panel */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Backfill existing transactions</h2>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            Enqueues all transactions that have never been synced to Firebase. Safe to run multiple times — already-delivered transactions are skipped.
          </p>
        </div>

        {backfillResult && (
          <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-2.5 text-sm">
            <span className="font-semibold text-green-600 dark:text-green-400">Done.</span>
            {' '}Enqueued <strong>{backfillResult.enqueued}</strong> transactions,
            skipped <strong>{backfillResult.skipped}</strong> already synced
            <span className="text-[var(--muted-foreground)]"> ({backfillResult.durationMs}ms)</span>
          </div>
        )}

        {backfill.isError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Backfill failed. Check that the API is running and your account has admin access.
          </div>
        )}

        <div className="flex items-center gap-3">
          <label htmlFor="batch-size" className="text-sm text-[var(--muted-foreground)] whitespace-nowrap">
            Batch size
          </label>
          <select
            id="batch-size"
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value) as BatchOption)}
            disabled={backfill.isPending}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm disabled:opacity-50"
          >
            {BATCH_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} transactions</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleBackfill}
          disabled={backfill.isPending || !user?.id}
          className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {backfill.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running backfill…
            </>
          ) : (
            <>
              <CloudUpload className="h-4 w-4" />
              Run backfill for my account
            </>
          )}
        </button>
      </div>

      {/* Audit log */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold">Recent delivery attempts</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Last 20 events, auto-refreshes every 30s</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30 text-left">
                <th className="px-4 py-2.5 text-xs font-medium text-[var(--muted-foreground)]">Time</th>
                <th className="px-4 py-2.5 text-xs font-medium text-[var(--muted-foreground)]">Event</th>
                <th className="px-4 py-2.5 text-xs font-medium text-[var(--muted-foreground)]">Policy</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-[var(--muted-foreground)]">Attempt</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-[var(--muted-foreground)]">HTTP</th>
                <th className="px-4 py-2.5 text-xs font-medium text-[var(--muted-foreground)]">Error</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                    Loading…
                  </td>
                </tr>
              ) : !stats?.recentAuditLogs?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                    No delivery attempts yet. Try running a backfill.
                  </td>
                </tr>
              ) : (
                stats.recentAuditLogs.map((log) => (
                  <AuditRow key={log.id} log={log} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
