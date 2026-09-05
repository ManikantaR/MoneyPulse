'use client';

import { CheckCircle2, AlertTriangle, XCircle, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { FileUpload } from '@moneypulse/shared';

type NodeState = 'ok' | 'pending' | 'warn' | 'error' | 'idle';

interface SwimLaneNode {
  label: string;
  detail: string;
  state: NodeState;
}

/**
 * Derives the 6-node journey (Downloaded -> Detected -> Matched -> Staged ->
 * Ingested -> Transactions) client-side from existing `file_uploads` fields —
 * no extra API surface needed. Import Pipeline Radar Phase 3.
 */
export function deriveSwimLane(upload: FileUpload): SwimLaneNode[] {
  const { status } = upload;
  const isException = ['failed', 'stalled'].includes(status);

  const downloaded: NodeState = 'ok'; // the row existing means a file landed somewhere
  const detected: NodeState = upload.watcherBank || upload.detectedAt ? 'ok' : 'pending';
  const matched: NodeState = status === 'orphaned' ? 'warn' : upload.accountId ? 'ok' : 'pending';
  const staged: NodeState = status === 'orphaned' ? 'idle' : upload.stagedAt ? 'ok' : status === 'pending' ? 'pending' : 'ok';
  const ingested: NodeState =
    status === 'orphaned' ? 'idle' : isException ? 'error' : status === 'processing' || status === 'pending' ? 'pending' : 'ok';
  const transactions: NodeState =
    status === 'orphaned' || isException
      ? 'idle'
      : status === 'empty'
        ? 'warn'
        : status === 'completed'
          ? 'ok'
          : 'pending';

  return [
    {
      label: 'Downloaded',
      detail: upload.originalFilename ?? upload.filename,
      state: downloaded,
    },
    {
      label: 'Detected',
      detail: upload.watcherBank ? upload.watcherBank : upload.detectedAt ? formatDate(upload.detectedAt) : 'Manual upload',
      state: detected,
    },
    {
      label: 'Matched',
      detail: status === 'orphaned' ? 'No matching account' : upload.watcherSlug ?? 'Account matched',
      state: matched,
    },
    {
      label: 'Staged',
      detail: upload.stagedAt ? formatDate(upload.stagedAt) : '—',
      state: staged,
    },
    {
      label: 'Ingested',
      detail: isException ? `${status} — see error log` : status,
      state: ingested,
    },
    {
      label: 'Transactions',
      detail: status === 'empty' ? '0 added' : `${upload.rowsImported} added`,
      state: transactions,
    },
  ];
}

const STATE_STYLES: Record<NodeState, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  pending: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  error: 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400',
  idle: 'border-[var(--border)] bg-transparent text-[var(--muted-foreground)] opacity-60',
};

const STATE_ICON: Record<NodeState, React.ReactNode> = {
  ok: <CheckCircle2 className="h-4 w-4" />,
  pending: <Circle className="h-4 w-4" />,
  warn: <AlertTriangle className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />,
  idle: <Circle className="h-4 w-4" />,
};

/** Horizontal per-file journey — used on the import detail page and expandable "needs attention" rows. */
export function ImportSwimLane({ upload }: { upload: FileUpload }) {
  const nodes = deriveSwimLane(upload);
  return (
    <div className="flex flex-wrap items-stretch gap-2" data-testid="import-swim-lane">
      {nodes.map((node, i) => (
        <div key={node.label} className="flex items-center gap-2">
          <div
            className={cn('flex min-w-[110px] flex-col gap-1 rounded-xl border px-3 py-2', STATE_STYLES[node.state])}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold">
              {STATE_ICON[node.state]}
              {node.label}
            </div>
            <p className="truncate text-[11px] opacity-80" title={node.detail}>
              {node.detail}
            </p>
          </div>
          {i < nodes.length - 1 && <span className="text-[var(--muted-foreground)]">→</span>}
        </div>
      ))}
    </div>
  );
}
