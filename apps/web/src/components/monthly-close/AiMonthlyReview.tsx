'use client';

import { Sparkles } from 'lucide-react';
import { useAiMonthlyReview } from '@/lib/hooks/useMonthlyClose';

/**
 * 13.7 — AI monthly review card: 3-5 bullets generated from this month's aggregate
 * close data (+ prior-month trend), never raw transactions. Purely on-demand — the
 * user triggers generation and the result is rendered as-is, including any caveat
 * bullet the API forces to the front when the close is flagged incomplete.
 */
export function AiMonthlyReview({ month, hasClose }: { month: string; hasClose: boolean }) {
  const { mutate, data, isPending, isError, error } = useAiMonthlyReview();

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4" data-testid="ai-monthly-review">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-bold">
          <Sparkles className="h-4 w-4 text-[var(--primary)]" />
          AI Monthly Review
        </h3>
        <button
          onClick={() => mutate(month)}
          disabled={!hasClose || isPending}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50"
        >
          {isPending ? 'Generating…' : data ? 'Regenerate' : 'Generate review'}
        </button>
      </div>

      {!hasClose && (
        <p className="text-sm text-[var(--muted-foreground)]">Create a draft close first to generate a review.</p>
      )}

      {isError && (
        <p className="text-sm text-[var(--destructive,#dc2626)]">
          {(error as any)?.message ?? 'Could not generate the AI review — is the advisor configured?'}
        </p>
      )}

      {data?.data && (
        <div className="space-y-2">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {data.data.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--muted-foreground)]">{data.data.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
