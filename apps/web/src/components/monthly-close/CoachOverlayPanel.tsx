import type { MonthlyFinancialSnapshot } from '@moneypulse/shared';
import { formatBps, statusFor, STATUS_CHIP_CLASSES, STATUS_LABELS } from './status';

/** Ramit's 4-bucket split (Investments here is the calculator-derived bucket, per
 *  epic #158 decision #4 — never a separate user-entered figure). Falls back to
 *  the close's own rates when the calculator's `ramitBuckets` breakdown isn't
 *  present on the persisted row. */
function ramitBuckets(snapshot: MonthlyFinancialSnapshot) {
  const buckets = (snapshot as unknown as { ramitBuckets?: Record<string, number> }).ramitBuckets;
  if (buckets) return buckets;
  return {
    fixed_costs: snapshot.fixedExpenseCents,
    investments: snapshot.investmentContributionCents,
    savings: snapshot.cashSavingsCents,
    guilt_free: snapshot.variableExpenseCents,
  };
}

/** Money Guy FOO next-dollar priority — uses the employer-match capture field when
 *  present on the row (decision #12); degrades to a generic nudge otherwise. */
function fooStep(snapshot: MonthlyFinancialSnapshot): string {
  const foo = (snapshot as unknown as { fooRecommendation?: string }).fooRecommendation;
  if (foo) return foo;
  if (snapshot.investingRateBps !== null && snapshot.investingRateBps < 1500) {
    return 'Increase investing rate toward 15% of take-home before extra debt payoff.';
  }
  return 'On track — keep following your current priority order.';
}

/** Coach overlays: Shashank ratio strip, Ramit 4-bucket, Money Guy FOO next-dollar. */
export function CoachOverlayPanel({ snapshot }: { snapshot: MonthlyFinancialSnapshot | null }) {
  if (!snapshot) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Create a draft close to see coach overlays.
      </div>
    );
  }

  const buckets = ramitBuckets(snapshot);
  const ratioRows = [
    { key: 'expense_ratio', label: 'Expense ratio', value: snapshot.expenseRatioBps },
    { key: 'liquid_net_worth_ratio', label: 'Liquid / net worth', value: snapshot.liquidNetWorthRatioBps },
    { key: 'debt_asset_ratio', label: 'Debt / asset', value: snapshot.debtAssetRatioBps },
    { key: 'debt_payment_income_ratio', label: 'Debt payment / income', value: snapshot.debtPaymentIncomeRatioBps },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="coach-overlay-panel">
      {/* Shashank ratio strip */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="mb-2 font-bold">Shashank Ratios</h3>
        <div className="space-y-1">
          {ratioRows.map((r) => {
            const status = statusFor(snapshot.targetStatus, r.key);
            return (
              <div key={r.key} className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">{r.label}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {formatBps(r.value)}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CHIP_CLASSES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ramit 4-bucket */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="mb-2 font-bold">Ramit 4-Bucket</h3>
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between"><span className="text-[var(--muted-foreground)]">Fixed costs</span><span className="tabular-nums font-medium">${(buckets.fixed_costs / 100).toFixed(0)}</span></li>
          <li className="flex justify-between"><span className="text-[var(--muted-foreground)]">Investments</span><span className="tabular-nums font-medium">${(buckets.investments / 100).toFixed(0)}</span></li>
          <li className="flex justify-between"><span className="text-[var(--muted-foreground)]">Savings</span><span className="tabular-nums font-medium">${(buckets.savings / 100).toFixed(0)}</span></li>
          <li className="flex justify-between"><span className="text-[var(--muted-foreground)]">Guilt-free spending</span><span className="tabular-nums font-medium">${(buckets.guilt_free / 100).toFixed(0)}</span></li>
        </ul>
      </div>

      {/* Money Guy FOO */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="mb-2 font-bold">Money Guy FOO — Next Dollar</h3>
        <p className="text-sm text-[var(--muted-foreground)]">{fooStep(snapshot)}</p>
      </div>
    </div>
  );
}
