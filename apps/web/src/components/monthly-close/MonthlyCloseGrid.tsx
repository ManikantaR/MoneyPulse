import { Fragment } from 'react';
import Link from 'next/link';
import type { MonthlyFinancialSnapshot } from '@moneypulse/shared';
import { formatCents } from '@/lib/format';
import { STATUS_CHIP_CLASSES, STATUS_LABELS, formatBps, statusFor } from './status';

type Unit = 'cents' | 'bps';

interface RowSpec {
  key: string;
  section: string;
  label: string;
  unit: Unit;
  get: (s: MonthlyFinancialSnapshot) => number | null;
  statusKey?: string;
  /** Transaction-derived rows drill into /transactions filtered by this section. */
  drillHref?: string;
}

const ROWS: RowSpec[] = [
  { key: 'take_home', section: 'Income', label: 'Take-home income', unit: 'cents', get: (s) => s.takeHomeIncomeCents },
  { key: 'gross', section: 'Income', label: 'Gross income', unit: 'cents', get: (s) => s.grossIncomeCents },

  // Expenses is the headline section — credit-card principal payments are excluded
  // from expenseCents by the calculator (folded into Debt Paydown instead), so this
  // number is never double-counted.
  { key: 'expenses', section: 'Expenses', label: 'Total expenses', unit: 'cents', get: (s) => s.expenseCents, statusKey: 'expense_ratio', drillHref: '/transactions' },
  { key: 'fixed', section: 'Expenses', label: 'Fixed', unit: 'cents', get: (s) => s.fixedExpenseCents, drillHref: '/transactions' },
  { key: 'variable', section: 'Expenses', label: 'Variable', unit: 'cents', get: (s) => s.variableExpenseCents, drillHref: '/transactions' },

  { key: 'cash_savings', section: 'Savings', label: 'Cash savings', unit: 'cents', get: (s) => s.cashSavingsCents, statusKey: 'savings_rate' },
  { key: 'savings_rate', section: 'Savings', label: 'Savings rate', unit: 'bps', get: (s) => s.savingsRateBps, statusKey: 'savings_rate' },

  { key: 'investment_contrib', section: 'Investments', label: 'Contributions', unit: 'cents', get: (s) => s.investmentContributionCents, statusKey: 'investing_rate' },
  { key: 'investing_rate', section: 'Investments', label: 'Investing rate', unit: 'bps', get: (s) => s.investingRateBps, statusKey: 'investing_rate' },

  { key: 'debt_paid', section: 'Debt Paydown', label: 'Principal paid', unit: 'cents', get: (s) => s.debtPrincipalPaidCents, statusKey: 'debt_paydown_rate' },
  { key: 'debt_paid_extra', section: 'Debt Paydown', label: 'Extra principal', unit: 'cents', get: (s) => s.extraDebtPrincipalPaidCents },

  { key: 'liquid_assets', section: 'Assets', label: 'Liquid', unit: 'cents', get: (s) => s.liquidAssetCents },
  { key: 'investment_assets', section: 'Assets', label: 'Investments', unit: 'cents', get: (s) => s.investmentAssetCents },
  { key: 'manual_assets', section: 'Assets', label: 'Manual (home/car/gold)', unit: 'cents', get: (s) => s.manualAssetCents },
  { key: 'total_assets', section: 'Assets', label: 'Total assets', unit: 'cents', get: (s) => s.totalAssetCents },

  { key: 'cc_liability', section: 'Liabilities', label: 'Credit cards', unit: 'cents', get: (s) => s.creditCardLiabilityCents },
  { key: 'loan_liability', section: 'Liabilities', label: 'Loans', unit: 'cents', get: (s) => s.loanLiabilityCents },
  { key: 'total_liabilities', section: 'Liabilities', label: 'Total liabilities', unit: 'cents', get: (s) => s.totalLiabilityCents },

  { key: 'net_worth', section: 'Net Worth', label: 'Net worth', unit: 'cents', get: (s) => s.netWorthCents },

  { key: 'expense_ratio', section: 'Ratios', label: 'Expense ratio', unit: 'bps', get: (s) => s.expenseRatioBps, statusKey: 'expense_ratio' },
  { key: 'liquid_nw_ratio', section: 'Ratios', label: 'Liquid / net worth', unit: 'bps', get: (s) => s.liquidNetWorthRatioBps, statusKey: 'liquid_net_worth_ratio' },
  { key: 'debt_asset_ratio', section: 'Ratios', label: 'Debt / asset', unit: 'bps', get: (s) => s.debtAssetRatioBps, statusKey: 'debt_asset_ratio' },
  { key: 'debt_payment_income_ratio', section: 'Ratios', label: 'Debt payment / income', unit: 'bps', get: (s) => s.debtPaymentIncomeRatioBps, statusKey: 'debt_payment_income_ratio' },
];

const SECTIONS = [
  'Income',
  'Expenses',
  'Savings',
  'Investments',
  'Debt Paydown',
  'Assets',
  'Liabilities',
  'Net Worth',
  'Ratios',
];

function fmt(unit: Unit, v: number | null): string {
  if (v === null || v === undefined) return '—';
  return unit === 'cents' ? formatCents(v) : formatBps(v);
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Tiny inline sparkline — no chart library, just a row of relative-height bars. */
function Trend({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return <span className="text-[var(--muted-foreground)]">—</span>;
  const max = Math.max(...nums.map((v) => Math.abs(v)), 1);
  return (
    <div className="flex items-end gap-0.5 h-6" aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-[var(--primary)]/60"
          style={{ height: v === null ? '2px' : `${Math.max(2, (Math.abs(v) / max) * 24)}px` }}
        />
      ))}
    </div>
  );
}

/**
 * Dense desktop spreadsheet grid: Metric | Current | Prior | 3M Avg | 6M Trend |
 * 12M Trend | Target | Status. `snapshots` must be most-recent-first, up to 12
 * months. Hidden below `md` in favor of MonthlyCloseMonthCard.
 */
export function MonthlyCloseGrid({ snapshots }: { snapshots: MonthlyFinancialSnapshot[] }) {
  const [current, prior, ...rest] = snapshots;
  const last3 = snapshots.slice(0, 3);
  const last6 = snapshots.slice(0, 6);
  const last12 = snapshots.slice(0, 12);

  if (!current) {
    return (
      <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
        No monthly closes yet.
      </p>
    );
  }

  return (
    <div className="hidden md:block overflow-auto rounded-lg border border-[var(--border)] max-h-[70vh]">
      <table className="w-full text-left text-sm" data-testid="monthly-close-grid">
        <thead className="sticky top-0 z-10 bg-[var(--muted)]/90 backdrop-blur text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <tr>
            <th className="sticky left-0 z-20 bg-[var(--muted)] px-4 py-2">Metric</th>
            <th className="px-4 py-2">Current</th>
            <th className="px-4 py-2">Prior</th>
            <th className="px-4 py-2">3M Avg</th>
            <th className="px-4 py-2">6M Trend</th>
            <th className="px-4 py-2">12M Trend</th>
            <th className="px-4 py-2">Target</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS.map((section) => (
            <Fragment key={section}>
              <tr className="bg-[var(--muted)]/40">
                <td colSpan={8} className="sticky left-0 px-4 py-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {section}
                </td>
              </tr>
              {ROWS.filter((r) => r.section === section).map((row) => {
                const currentVal = row.get(current);
                const priorVal = prior ? row.get(prior) : null;
                const avg3 = average(last3.map(row.get));
                const status = row.statusKey ? statusFor(current.targetStatus, row.statusKey) : 'unknown';
                return (
                  <tr
                    key={row.key}
                    className="border-b border-[var(--border)] hover:bg-[var(--muted)]/20"
                  >
                    <td className="sticky left-0 z-10 bg-[var(--card)] px-4 py-2 font-medium">
                      {row.drillHref ? (
                        <Link href={row.drillHref} className="hover:underline text-[var(--primary)]">
                          {row.label}
                        </Link>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{fmt(row.unit, currentVal)}</td>
                    <td className="px-4 py-2 tabular-nums text-[var(--muted-foreground)]">{fmt(row.unit, priorVal)}</td>
                    <td className="px-4 py-2 tabular-nums text-[var(--muted-foreground)]">{fmt(row.unit, avg3)}</td>
                    <td className="px-4 py-2"><Trend values={last6.map(row.get).reverse()} /></td>
                    <td className="px-4 py-2"><Trend values={last12.map(row.get).reverse()} /></td>
                    <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                      {row.statusKey ? 'Target band' : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {row.statusKey ? (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP_CLASSES[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
