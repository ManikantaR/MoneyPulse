import type { MonthlyFinancialSnapshot } from '@moneypulse/shared';
import { formatCents } from '@/lib/format';
import { STATUS_CHIP_CLASSES, STATUS_LABELS, formatBps, formatMonthLabel, statusFor } from './status';

interface FieldSpec {
  label: string;
  unit: 'cents' | 'bps';
  get: (s: MonthlyFinancialSnapshot) => number | null;
  statusKey?: string;
}

const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'Income',
    fields: [{ label: 'Take-home', unit: 'cents', get: (s) => s.takeHomeIncomeCents }],
  },
  {
    title: 'Expenses',
    fields: [
      { label: 'Total', unit: 'cents', get: (s) => s.expenseCents, statusKey: 'expense_ratio' },
      { label: 'Fixed', unit: 'cents', get: (s) => s.fixedExpenseCents },
      { label: 'Variable', unit: 'cents', get: (s) => s.variableExpenseCents },
    ],
  },
  {
    title: 'Savings',
    fields: [{ label: 'Cash savings', unit: 'cents', get: (s) => s.cashSavingsCents, statusKey: 'savings_rate' }],
  },
  {
    title: 'Investments',
    fields: [{ label: 'Contributions', unit: 'cents', get: (s) => s.investmentContributionCents, statusKey: 'investing_rate' }],
  },
  {
    title: 'Debt Paydown',
    fields: [{ label: 'Principal paid', unit: 'cents', get: (s) => s.debtPrincipalPaidCents, statusKey: 'debt_paydown_rate' }],
  },
  {
    title: 'Assets',
    fields: [
      { label: 'Liquid', unit: 'cents', get: (s) => s.liquidAssetCents },
      { label: 'Investments', unit: 'cents', get: (s) => s.investmentAssetCents },
      { label: 'Manual', unit: 'cents', get: (s) => s.manualAssetCents },
    ],
  },
  {
    title: 'Liabilities',
    fields: [
      { label: 'Credit cards', unit: 'cents', get: (s) => s.creditCardLiabilityCents },
      { label: 'Loans', unit: 'cents', get: (s) => s.loanLiabilityCents },
    ],
  },
  {
    title: 'Net Worth',
    fields: [{ label: 'Net worth', unit: 'cents', get: (s) => s.netWorthCents }],
  },
  {
    title: 'Ratios',
    fields: [
      { label: 'Savings rate', unit: 'bps', get: (s) => s.savingsRateBps, statusKey: 'savings_rate' },
      { label: 'Investing rate', unit: 'bps', get: (s) => s.investingRateBps, statusKey: 'investing_rate' },
      { label: 'Liquid / net worth', unit: 'bps', get: (s) => s.liquidNetWorthRatioBps, statusKey: 'liquid_net_worth_ratio' },
    ],
  },
];

function fmt(unit: 'cents' | 'bps', v: number | null): string {
  if (v === null || v === undefined) return '—';
  return unit === 'cents' ? formatCents(v) : formatBps(v);
}

/** Mobile view: one card per month, sections stacked as readable label/value rows
 *  (never a squeezed table). */
export function MonthlyCloseMonthCard({ snapshot }: { snapshot: MonthlyFinancialSnapshot }) {
  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 space-y-4"
      data-testid="monthly-close-month-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{formatMonthLabel(snapshot.snapshotMonth)}</h3>
        <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium capitalize text-[var(--primary)]">
          {snapshot.status}
        </span>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {section.title}
          </p>
          <div className="mt-1 space-y-1">
            {section.fields.map((f) => {
              const status = f.statusKey ? statusFor(snapshot.targetStatus, f.statusKey) : undefined;
              return (
                <div key={f.label} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted-foreground)]">{f.label}</span>
                  <span className="flex items-center gap-2 tabular-nums font-medium">
                    {fmt(f.unit, f.get(snapshot))}
                    {status && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CHIP_CLASSES[status]}`}>
                        {STATUS_LABELS[status]}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
