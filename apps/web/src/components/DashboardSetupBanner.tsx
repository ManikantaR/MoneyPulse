'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useDismissSetupTracker, useSetupProgress } from '@/lib/hooks/useSettings';

/**
 * Slim dashboard banner nudging the user toward the settings-page setup
 * tracker (#224/#230/#229/#235 — final sub-issue of the setup-completeness
 * epic). Shows only while setup is incomplete and not dismissed; dismissing
 * here reuses the same `setupTrackerDismissed` PATCH as the settings card, so
 * either surface dismissing hides both (they share the same query cache key).
 */
export function DashboardSetupBanner() {
  const { data, isLoading, isError } = useSetupProgress();
  const dismissMutation = useDismissSetupTracker();

  if (isLoading || isError || !data) return null;

  const { percent, completed, total, dismissedAt } = data.data;

  if (percent === 100 || dismissedAt) return null;

  return (
    <div
      data-testid="dashboard-setup-banner"
      className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <div
          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--border)]"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="truncate text-sm text-[var(--muted-foreground)]">
          Finish setting up MoneyPulse — {completed} of {total} steps done ({percent}%)
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3 self-end sm:self-auto">
        <Link
          href="/settings"
          className="text-sm font-medium text-[var(--primary)] hover:underline"
        >
          Finish setup
        </Link>
        <button
          type="button"
          aria-label="Dismiss setup reminder"
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
