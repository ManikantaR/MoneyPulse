'use client';

import { useMemo, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import {
  useMonthlyCloses,
  useCreateDraft,
  useConfirmClose,
  useReopenClose,
} from '@/lib/hooks/useMonthlyClose';
import { MonthlyCloseHero } from '@/components/monthly-close/MonthlyCloseHero';
import { MonthlyCloseGrid } from '@/components/monthly-close/MonthlyCloseGrid';
import { MonthlyCloseMonthCard } from '@/components/monthly-close/MonthlyCloseMonthCard';
import { ManualAssetPanel } from '@/components/monthly-close/ManualAssetPanel';
import { LoanVerificationPanel } from '@/components/monthly-close/LoanVerificationPanel';
import { CoachOverlayPanel } from '@/components/monthly-close/CoachOverlayPanel';

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** NAS-only monthly-close workspace: dense grid on desktop, month cards on mobile.
 *  Expenses is the deliberate visual headline (epic #158 design intent). */
export default function HealthPage() {
  const [range, setRange] = useState<6 | 12>(6);
  const [month, setMonth] = useState(currentMonth());
  const { data, isLoading, isFetching } = useMonthlyCloses(range);
  const createDraft = useCreateDraft();
  const confirm = useConfirmClose();
  const reopen = useReopenClose();

  const snapshots = useMemo(() => data?.data ?? [], [data]);
  const current = snapshots.find((s) => s.snapshotMonth.slice(0, 7) === month.slice(0, 7)) ?? snapshots[0] ?? null;
  const currentIdx = current ? snapshots.findIndex((s) => s.id === current.id) : -1;
  const prior = currentIdx >= 0 ? snapshots[currentIdx + 1] ?? null : null;
  const history = currentIdx >= 0 ? snapshots.slice(currentIdx + 1) : [];

  const busy = createDraft.isPending || confirm.isPending || reopen.isPending;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-[var(--primary)]" />
            <h1 className="text-3xl font-extrabold tracking-tight">Health</h1>
          </div>
          <p className="text-[var(--muted-foreground)] text-sm">
            Monthly close: expenses, net worth, savings/investing rates, debt paydown.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) => setMonth(`${e.target.value}-01`)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            {([6, 12] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-2 text-sm font-medium ${
                  range === r ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'hover:bg-[var(--muted)]'
                }`}
              >
                {r}-mo
              </button>
            ))}
          </div>
          <button
            onClick={() => createDraft.mutate(month)}
            disabled={busy}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Create draft
          </button>
          <button
            onClick={() => confirm.mutate(month)}
            disabled={busy || !current || current.status === 'confirmed'}
            className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={() => reopen.mutate(month)}
            disabled={busy || !current || current.status !== 'confirmed'}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Reopen
          </button>
          {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />}
        </div>
      </div>

      {isLoading && <p className="text-sm text-[var(--muted-foreground)] animate-pulse">Loading…</p>}

      <MonthlyCloseHero current={current} prior={prior} history={history} />

      {/* Desktop grid */}
      <MonthlyCloseGrid snapshots={snapshots} />

      {/* Mobile month cards — grouped by section, never a squeezed table */}
      <div className="md:hidden space-y-3">
        {snapshots.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No monthly closes yet.</p>
        )}
        {snapshots.map((s) => (
          <MonthlyCloseMonthCard key={s.id} snapshot={s} />
        ))}
      </div>

      <CoachOverlayPanel snapshot={current} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ManualAssetPanel
          month={month}
          missingManualAssets={current?.freshness && typeof current.freshness === 'object'
            ? ((current.freshness as { missingManualAssets?: string[] }).missingManualAssets ?? [])
            : []}
        />
        <LoanVerificationPanel month={month} />
      </div>
    </div>
  );
}
