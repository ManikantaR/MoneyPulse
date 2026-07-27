import { formatCents } from '@/lib/format';
import type { MonthlyFinancialSnapshot } from '@moneypulse/shared';
import { STATUS_CHIP_CLASSES, STATUS_LABELS, formatBps, formatDelta, statusFor } from './status';

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Restrained hero row: Expenses is deliberately first / visually largest — it's the
 *  first number the user should feel, per the epic's design intent. */
export function MonthlyCloseHero({
  current,
  prior,
  history,
}: {
  current: MonthlyFinancialSnapshot | null;
  prior: MonthlyFinancialSnapshot | null;
  /** Up to the trailing 3 months (excluding current), most-recent-first, used for the
   *  3-mo average expense delta on the Expenses card. */
  history: MonthlyFinancialSnapshot[];
}) {
  if (!current) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        No close for this month yet — create a draft to see hero metrics.
      </div>
    );
  }

  const expenseDelta = prior ? current.expenseCents - prior.expenseCents : null;
  const threeMoAvgExpense = average(history.slice(0, 3).map((s) => s.expenseCents));
  const threeMoAvgDelta =
    threeMoAvgExpense !== null ? current.expenseCents - threeMoAvgExpense : null;
  const expenseStatus = statusFor(current.targetStatus, 'expense_ratio');

  const cards = [
    {
      key: 'net_worth',
      label: 'Net Worth',
      value: formatCents(current.netWorthCents),
      sub: prior ? formatDelta(current.netWorthCents - prior.netWorthCents) + ' vs prior' : undefined,
    },
    {
      key: 'savings_rate',
      label: 'Savings Rate',
      value: formatBps(current.savingsRateBps),
      status: statusFor(current.targetStatus, 'savings_rate'),
    },
    {
      key: 'investing_rate',
      label: 'Investing Rate',
      value: formatBps(current.investingRateBps),
      status: statusFor(current.targetStatus, 'investing_rate'),
    },
    {
      key: 'debt_paydown',
      label: 'Debt Paydown',
      value: formatCents(current.debtPrincipalPaidCents),
      status: statusFor(current.targetStatus, 'debt_paydown_rate'),
    },
    {
      key: 'liquid_pct',
      label: 'Liquid %',
      value: formatBps(current.liquidNetWorthRatioBps),
      status: statusFor(current.targetStatus, 'liquid_net_worth_ratio'),
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6" data-testid="monthly-close-hero">
      {/* Expenses — the headline card, spans 2 columns on large screens */}
      <div
        data-testid="hero-expenses"
        className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Expenses
        </p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums">{formatCents(current.expenseCents)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <span>{formatDelta(expenseDelta)} vs prior month</span>
          <span>{formatDelta(threeMoAvgDelta)} vs 3-mo avg</span>
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CHIP_CLASSES[expenseStatus]}`}
          >
            {STATUS_LABELS[expenseStatus]}
          </span>
        </div>
      </div>

      {cards.map((card) => (
        <div key={card.key} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {card.label}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{card.value}</p>
          {'status' in card && card.status && (
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP_CLASSES[card.status]}`}
            >
              {STATUS_LABELS[card.status]}
            </span>
          )}
          {'sub' in card && card.sub && (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{card.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}
