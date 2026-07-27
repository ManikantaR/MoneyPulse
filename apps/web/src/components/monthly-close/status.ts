import type { TargetStatusLevel } from '@moneypulse/shared';

/** Tailwind classes for a status chip, keyed by the calculator's target-status level. */
export const STATUS_CHIP_CLASSES: Record<TargetStatusLevel, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  unknown: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
};

export const STATUS_LABELS: Record<TargetStatusLevel, string> = {
  green: 'On track',
  yellow: 'Watch',
  red: 'Off track',
  info: 'Tracked',
  unknown: '—',
};

/** Read a status level out of a snapshot's `targetStatus` map, defaulting to 'unknown'. */
export function statusFor(
  targetStatus: Record<string, string> | null | undefined,
  key: string,
): TargetStatusLevel {
  const level = targetStatus?.[key];
  if (level === 'green' || level === 'yellow' || level === 'red' || level === 'info') return level;
  return 'unknown';
}

export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 100).toFixed(1)}%`;
}

export function formatDelta(deltaCents: number | null): string {
  if (deltaCents === null) return '—';
  const sign = deltaCents > 0 ? '+' : deltaCents < 0 ? '−' : '';
  return `${sign}$${(Math.abs(deltaCents) / 100).toFixed(0)}`;
}

/** first-of-month string -> "Mar 2026" */
export function formatMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month.slice(0, 7)}-01T00:00:00Z`),
  );
}
