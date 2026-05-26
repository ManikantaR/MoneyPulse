'use client';

import { useState } from 'react';
import {
  useSyncStatus,
  useSyncEvents,
  useTriggerSync,
  useBackfillSync,
  useReplayDeadLetters,
  type OutboxEvent,
} from '@/lib/hooks/useSync';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  DatabaseZap,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function HealthBadge({ health }: { health: 'green' | 'yellow' | 'red' }) {
  if (health === 'green')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-sm font-medium text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" /> Healthy
      </span>
    );
  if (health === 'yellow')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/10 px-3 py-1 text-sm font-medium text-yellow-600 dark:text-yellow-400">
        <Clock className="h-4 w-4" /> Pending
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-sm font-medium text-red-600 dark:text-red-400">
      <AlertTriangle className="h-4 w-4" /> Degraded
    </span>
  );
}

function StatusBadge({ status }: { status: OutboxEvent['status'] }) {
  const styles: Record<OutboxEvent['status'], string> = {
    pending: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    retry: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    delivered: 'bg-green-500/10 text-green-600 dark:text-green-400',
    dead_letter: 'bg-red-500/10 text-red-600 dark:text-red-400',
    policy_failed: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: 'default' | 'danger' | 'warning' | 'success';
}) {
  const border =
    variant === 'danger'
      ? 'border-red-500/30'
      : variant === 'warning'
        ? 'border-yellow-500/30'
        : variant === 'success'
          ? 'border-green-500/30'
          : 'border-[var(--border)]';
  return (
    <div className={`rounded-xl border ${border} bg-[var(--card)] p-5 shadow-sm`}>
      <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{sub}</p>}
    </div>
  );
}

// ── Backfill modal ────────────────────────────────────────────────────────────

function BackfillModal({ onClose }: { onClose: () => void }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const backfill = useBackfillSync();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await backfill.mutateAsync({
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Backfill Transactions</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Enqueue outbox events for transactions that have none. Idempotent — skips already-queued transactions.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">From Date (optional)</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">To Date (optional)</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={backfill.isPending}
              className="flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {backfill.isPending && <RefreshCw className="h-4 w-4 animate-spin" />}
              Run Backfill
            </button>
          </div>
          {backfill.isSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">
              Enqueued {backfill.data?.data.enqueued} · Errors {backfill.data?.data.errors}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SyncPage() {
  const [statusFilter, setStatusFilter] = useState<OutboxEvent['status'] | ''>('');
  const [page, setPage] = useState(1);
  const [showBackfill, setShowBackfill] = useState(false);
  const pageSize = 25;

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useSyncStatus();
  const { data: eventsData, isLoading: eventsLoading } = useSyncEvents({
    status: statusFilter || undefined,
    page,
    limit: pageSize,
  });

  const trigger = useTriggerSync();
  const replay = useReplayDeadLetters();

  const status = statusData?.data;
  const events = eventsData?.data ?? [];
  const total = eventsData?.total ?? 0;
  const totalPages = eventsData?.totalPages ?? 1;

  const handleTrigger = async () => {
    await trigger.mutateAsync();
    void refetchStatus();
  };

  const handleReplay = async () => {
    await replay.mutateAsync(undefined);
    void refetchStatus();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sync Admin</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Firebase Firestore sync pipeline — outbox events and delivery status
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleTrigger}
            disabled={trigger.isPending}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)] disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${trigger.isPending ? 'animate-spin' : ''}`} />
            {trigger.isPending ? 'Delivering…' : 'Trigger Delivery'}
          </button>
          <button
            onClick={() => setShowBackfill(true)}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)] transition-colors"
          >
            <DatabaseZap className="h-4 w-4" />
            Backfill
          </button>
          {(status?.counts.dead_letter ?? 0) > 0 && (
            <button
              onClick={handleReplay}
              disabled={replay.isPending}
              className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className={`h-4 w-4 ${replay.isPending ? 'animate-spin' : ''}`} />
              Replay Dead Letters ({status?.counts.dead_letter})
            </button>
          )}
        </div>
      </div>

      {/* Mutation feedback */}
      {trigger.isSuccess && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-600 dark:text-green-400">
          Delivery sweep complete — processed {trigger.data?.data.processed} events.
        </div>
      )}
      {replay.isSuccess && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm text-green-600 dark:text-green-400">
          Replayed {replay.data?.data.replayed} dead-letter events.
        </div>
      )}

      {/* Health + Stats */}
      {statusLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      ) : status ? (
        <>
          <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-sm">
            <Activity className="h-5 w-5 text-[var(--muted-foreground)]" />
            <span className="text-sm font-medium">Pipeline health</span>
            <HealthBadge health={status.health} />
            {status.lastDeliveredAt && (
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                Last delivered {new Date(status.lastDeliveredAt).toLocaleString()}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Pending" value={status.counts.pending} />
            <StatCard label="Retry" value={status.counts.retry} variant={status.counts.retry > 0 ? 'warning' : 'default'} />
            <StatCard label="Delivered" value={status.counts.delivered} variant="success" />
            <StatCard
              label="Dead Letter"
              value={status.counts.dead_letter}
              variant={status.counts.dead_letter > 0 ? 'danger' : 'default'}
              sub={status.counts.dead_letter > 0 ? status.lastErrorMessage ?? undefined : undefined}
            />
            <StatCard label="Policy Failed" value={status.counts.policy_failed} variant={status.counts.policy_failed > 0 ? 'warning' : 'default'} />
          </div>

          {/* Config flags */}
          <div className="flex flex-wrap gap-3 text-xs">
            {([
              ['Firebase endpoint', status.config.firebaseEndpointSet],
              ['Alias secret', status.config.aliasSecretSet],
              ['Signing secret', status.config.signingSecretSet],
            ] as [string, boolean][]).map(([label, set]) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                  set
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
              >
                {set ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {label}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {/* Events Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <h2 className="text-base font-semibold">Outbox Events</h2>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as OutboxEvent['status'] | '');
                setPage(1);
              }}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="retry">Retry</option>
              <option value="delivered">Delivered</option>
              <option value="dead_letter">Dead Letter</option>
              <option value="policy_failed">Policy Failed</option>
            </select>
            <span className="text-xs text-[var(--muted-foreground)]">{total} total</span>
          </div>
        </div>

        {eventsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
          </div>
        ) : events.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            <Activity className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>No outbox events.</p>
            <p className="mt-1 text-xs">Import transactions or run a backfill to generate events.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                    <th className="px-5 py-2 font-medium">Type</th>
                    <th className="px-5 py-2 font-medium">Aggregate</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium text-right">Attempts</th>
                    <th className="px-5 py-2 font-medium">Created</th>
                    <th className="px-5 py-2 font-medium">Delivered</th>
                    <th className="px-5 py-2 font-medium">Last Error</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/40">
                      <td className="px-5 py-2.5 font-mono text-xs text-[var(--muted-foreground)]">
                        {ev.event_type}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className="inline-flex rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
                          {ev.aggregate_type}
                        </span>
                        <span className="ml-2 font-mono text-xs text-[var(--muted-foreground)]">
                          {ev.aggregate_id.slice(0, 8)}…
                        </span>
                      </td>
                      <td className="px-5 py-2.5">
                        <StatusBadge status={ev.status} />
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{ev.attempts}</td>
                      <td className="px-5 py-2.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                        {ev.delivered_at ? new Date(ev.delivered_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-5 py-2.5 max-w-[200px]">
                        {ev.last_error_message ? (
                          <span
                            className="truncate block text-xs text-red-600 dark:text-red-400"
                            title={ev.last_error_message}
                          >
                            {ev.last_error_message}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <span className="text-xs text-[var(--muted-foreground)]">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showBackfill && <BackfillModal onClose={() => setShowBackfill(false)} />}
    </div>
  );
}
