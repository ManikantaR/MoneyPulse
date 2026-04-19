'use client';

import { useState } from 'react';
import {
  useAiLogs,
  useAiLogsStats,
  useAiLogsPiiAlerts,
  type AiLogEntry,
} from '@/lib/hooks/useAiLogs';
import {
  Brain,
  ShieldAlert,
  Clock,
  Activity,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Zap,
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
  variant?: 'default' | 'danger' | 'success';
}) {
  const borderColor =
    variant === 'danger'
      ? 'border-red-500/30'
      : variant === 'success'
        ? 'border-green-500/30'
        : 'border-[var(--border)]';
  return (
    <div
      className={`rounded-xl border ${borderColor} bg-[var(--card)] p-5 shadow-sm`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            variant === 'danger'
              ? 'bg-red-500/10 text-red-500'
              : variant === 'success'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-[var(--accent)] text-[var(--primary)]'
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && (
            <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: AiLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(log.created_at);
  const timeStr = date.toLocaleString();

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--muted)]/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        )}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            log.prompt_type === 'categorization'
              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
          }`}
        >
          {log.prompt_type === 'categorization' ? 'Categorize' : 'PDF Parse'}
        </span>
        <span className="text-sm font-medium">{log.model}</span>
        {log.latency_ms != null && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {log.latency_ms}ms
          </span>
        )}
        {log.pii_detected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
            <ShieldAlert className="h-3 w-3" />
            PII
          </span>
        )}
        {log.avg_confidence != null && (
          <span className="ml-auto text-xs text-[var(--muted-foreground)]">
            conf: {(log.avg_confidence * 100).toFixed(0)}%
          </span>
        )}
        <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
          {timeStr}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[var(--muted-foreground)]">Tokens In</p>
              <p className="font-medium">{log.token_count_in ?? '—'}</p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Tokens Out</p>
              <p className="font-medium">{log.token_count_out ?? '—'}</p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Transactions</p>
              <p className="font-medium">{log.transactions_count ?? '—'}</p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Categorized</p>
              <p className="font-medium">{log.categories_assigned ?? '—'}</p>
            </div>
          </div>
          {log.pii_detected && log.pii_types_found.length > 0 && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
                PII Types Detected (pre-sanitization)
              </p>
              <div className="flex flex-wrap gap-1">
                {log.pii_types_found.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-[var(--muted-foreground)] mb-1">
              Prompt Sent (sanitized)
            </p>
            <pre className="max-h-48 overflow-auto rounded-lg bg-[var(--card)] p-3 text-xs whitespace-pre-wrap break-words border border-[var(--border)]">
              {log.input_text}
            </pre>
          </div>
          {log.output_text && (
            <div>
              <p className="text-xs font-semibold text-[var(--muted-foreground)] mb-1">
                Model Response
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-[var(--card)] p-3 text-xs whitespace-pre-wrap break-words border border-[var(--border)]">
                {log.output_text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AiLogsPage() {
  const [promptType, setPromptType] = useState<string>('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const {
    data: logsData,
    isLoading: logsLoading,
  } = useAiLogs({
    limit: pageSize,
    offset: page * pageSize,
    promptType: promptType || undefined,
  });

  const { data: statsData, isLoading: statsLoading } = useAiLogsStats();
  const { data: piiData } = useAiLogsPiiAlerts(10);

  const logs = logsData?.data ?? [];
  const total = logsData?.total ?? 0;
  const stats = statsData?.data ?? [];
  const piiAlerts = piiData?.data ?? [];

  // Aggregate stats
  const totalCalls = stats.reduce((s, r) => s + (r.total_calls ?? 0), 0);
  const avgLatency =
    stats.length > 0
      ? Math.round(
          stats.reduce((s, r) => s + (r.avg_latency_ms ?? 0) * (r.total_calls ?? 0), 0) /
            Math.max(totalCalls, 1),
        )
      : 0;
  const totalPii = stats.reduce((s, r) => s + (r.pii_detections ?? 0), 0);
  const avgConf =
    stats.length > 0
      ? stats
          .filter((r) => r.avg_confidence != null)
          .reduce((s, r) => s + Number(r.avg_confidence ?? 0), 0) /
        Math.max(stats.filter((r) => r.avg_confidence != null).length, 1)
      : 0;

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">AI Observability</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Monitor local AI prompts, model performance, and PII safeguards
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total AI Calls"
          value={statsLoading ? '—' : totalCalls}
          icon={Brain}
        />
        <StatCard
          label="Avg Latency"
          value={statsLoading ? '—' : `${avgLatency}ms`}
          icon={Clock}
        />
        <StatCard
          label="Avg Confidence"
          value={
            statsLoading ? '—' : `${(avgConf * 100).toFixed(0)}%`
          }
          sub="AI categorization accuracy"
          icon={Zap}
          variant="success"
        />
        <StatCard
          label="PII Detections"
          value={statsLoading ? '—' : totalPii}
          sub={
            totalPii > 0
              ? 'PII found in raw text (sanitized before sending)'
              : 'No PII detected'
          }
          icon={ShieldAlert}
          variant={totalPii > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Model Performance Table */}
      {stats.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
          <div className="border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" /> Model Performance
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Model</th>
                  <th className="px-5 py-2 font-medium text-right">Calls</th>
                  <th className="px-5 py-2 font-medium text-right">
                    Avg Latency
                  </th>
                  <th className="px-5 py-2 font-medium text-right">
                    Avg Confidence
                  </th>
                  <th className="px-5 py-2 font-medium text-right">
                    Transactions
                  </th>
                  <th className="px-5 py-2 font-medium text-right">
                    PII Hits
                  </th>
                  <th className="px-5 py-2 font-medium">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/50"
                  >
                    <td className="px-5 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.prompt_type === 'categorization'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                        }`}
                      >
                        {row.prompt_type}
                      </span>
                    </td>
                    <td className="px-5 py-2 font-mono text-xs">
                      {row.model}
                    </td>
                    <td className="px-5 py-2 text-right">{row.total_calls}</td>
                    <td className="px-5 py-2 text-right">
                      {row.avg_latency_ms ?? '—'}ms
                    </td>
                    <td className="px-5 py-2 text-right">
                      {row.avg_confidence != null
                        ? `${(Number(row.avg_confidence) * 100).toFixed(0)}%`
                        : '—'}
                    </td>
                    <td className="px-5 py-2 text-right">
                      {row.total_transactions ?? 0}
                    </td>
                    <td className="px-5 py-2 text-right">
                      {row.pii_detections > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" />
                          {row.pii_detections}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-3 w-3" />0
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-xs text-[var(--muted-foreground)]">
                      {row.last_call
                        ? new Date(row.last_call).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PII Alerts */}
      {piiAlerts.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 shadow-sm">
          <div className="border-b border-red-500/20 px-5 py-3">
            <h2 className="text-base font-semibold flex items-center gap-2 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-4 w-4" /> Recent PII Alerts
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              PII was detected in raw transaction descriptions before
              sanitization. Data was cleaned before being sent to the AI model.
            </p>
          </div>
          <div className="divide-y divide-red-500/10">
            {piiAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center gap-3 px-5 py-2.5"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                <span className="text-sm font-medium">
                  {alert.prompt_type} — {alert.model}
                </span>
                <div className="flex flex-wrap gap-1">
                  {alert.pii_types_found.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600 dark:text-red-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <span className="ml-auto text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                  {new Date(alert.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log Explorer */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <h2 className="text-base font-semibold">Prompt Log Explorer</h2>
          <div className="flex items-center gap-2">
            <select
              value={promptType}
              onChange={(e) => {
                setPromptType(e.target.value);
                setPage(0);
              }}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
            >
              <option value="">All Types</option>
              <option value="categorization">Categorization</option>
              <option value="pdf_parse">PDF Parse</option>
            </select>
            <span className="text-xs text-[var(--muted-foreground)]">
              {total} total
            </span>
          </div>
        </div>

        {logsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
            <Brain className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>No AI prompt logs yet.</p>
            <p className="text-xs mt-1">
              Logs will appear here after AI categorization or PDF parsing runs.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y-0">
              {logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-[var(--muted-foreground)]">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() =>
                    setPage(Math.min(totalPages - 1, page + 1))
                  }
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
