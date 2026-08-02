'use client';

import Link from 'next/link';
import { Check, Server } from 'lucide-react';
import { useSetupProgress } from '@/lib/hooks/useSettings';
import type { SetupProgressStep } from '@moneypulse/shared';

/**
 * Setup-completeness card shown at the top of Settings (#224/#230, web half of
 * the setup-tracker epic — server half is #225's `GET /settings/setup-progress`).
 *
 * `kind: 'user-data'` steps are the ones the % is computed from and get an
 * actionable deep-link when pending. `kind: 'server-config'` steps (e.g. the AI
 * advisor's API key) are shown for visibility only — the user can't complete
 * them from the web UI, so they're visually separated and excluded from the math.
 */
export function SetupProgressCard() {
  const { data, isLoading, isError } = useSetupProgress();

  if (isLoading || isError || !data) return null;

  const { percent, completed, total, steps } = data.data;
  const isComplete = percent === 100;

  const userDataSteps = steps.filter((s: SetupProgressStep) => s.kind === 'user-data');
  const serverConfigSteps = steps.filter((s: SetupProgressStep) => s.kind === 'server-config');

  return (
    <section
      data-testid="setup-progress-card"
      className="space-y-4 rounded-2xl bg-[var(--surface-container-low)] p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Setup Progress</h2>
          {isComplete ? (
            <p className="text-sm text-[var(--primary)]" data-testid="setup-progress-complete">
              Setup complete ✓
            </p>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              {completed} of {total} steps done
            </p>
          )}
        </div>
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{
            background: `conic-gradient(var(--primary) ${percent}%, var(--border) 0)`,
          }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-container-low)] text-xs">
            {percent}%
          </span>
        </div>
      </div>

      {!isComplete && (
        <ul className="space-y-2">
          {userDataSteps.map((step: SetupProgressStep) => (
            <li
              key={step.id}
              className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between"
            >
              {step.done ? (
                <span className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] line-through">
                  <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden />
                  {step.label}
                </span>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <Link
                    href={step.href}
                    className="text-sm font-medium text-[var(--primary)] hover:underline"
                  >
                    {step.label}
                  </Link>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    unlocks: {step.unlocks}
                  </span>
                </div>
              )}
            </li>
          ))}

          {serverConfigSteps.length > 0 && (
            <li className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
              {serverConfigSteps.map((step: SetupProgressStep) => (
                <div
                  key={step.id}
                  className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2"
                >
                  <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-medium text-[var(--muted-foreground)]">
                    <Server className="h-3 w-3" aria-hidden />
                    server setup
                  </span>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {step.label}
                    {!step.done && (
                      <span className="ml-1 text-xs">— Configured on the server</span>
                    )}
                  </span>
                </div>
              ))}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
