import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MonthlyFinancialSnapshot } from '@moneypulse/shared';
import { MonthlyCloseHero } from '@/components/monthly-close/MonthlyCloseHero';
import { MonthlyCloseGrid } from '@/components/monthly-close/MonthlyCloseGrid';
import { MonthlyCloseMonthCard } from '@/components/monthly-close/MonthlyCloseMonthCard';
import { CoachOverlayPanel } from '@/components/monthly-close/CoachOverlayPanel';

function makeSnapshot(overrides: Partial<MonthlyFinancialSnapshot> = {}): MonthlyFinancialSnapshot {
  return {
    id: 'snap-1',
    userId: 'user-1',
    snapshotMonth: '2026-06-01',
    status: 'draft',
    takeHomeIncomeCents: 500000,
    grossIncomeCents: 650000,
    expenseCents: 320000,
    fixedExpenseCents: 200000,
    variableExpenseCents: 120000,
    cashSavingsCents: 80000,
    investmentContributionCents: 60000,
    debtPrincipalPaidCents: 40000,
    extraDebtPrincipalPaidCents: 0,
    liquidAssetCents: 1500000,
    investmentAssetCents: 4000000,
    manualAssetCents: 3000000,
    totalAssetCents: 8500000,
    creditCardLiabilityCents: 50000,
    loanLiabilityCents: 2500000,
    totalLiabilityCents: 2550000,
    netWorthCents: 5950000,
    savingsRateBps: 1600,
    investingRateBps: 1200,
    debtPaydownRateBps: 800,
    wealthBuildingRateBps: 3600,
    expenseRatioBps: 6400,
    liquidNetWorthRatioBps: 2521,
    debtAssetRatioBps: 3000,
    debtPaymentIncomeRatioBps: 900,
    targetStatus: {
      expense_ratio: 'yellow',
      savings_rate: 'info',
      investing_rate: 'info',
      debt_paydown_rate: 'info',
      liquid_net_worth_ratio: 'green',
      debt_asset_ratio: 'green',
      debt_payment_income_ratio: 'green',
    },
    freshness: { isComplete: true, missingManualAssets: [], staleAccounts: [], unverifiedLoans: [] },
    calculationVersion: 'v1',
    notes: null,
    aiReview: null,
    editedAt: null,
    isEdited: false,
    confirmedAt: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('MonthlyCloseHero', () => {
  it('renders Expenses as the headline card', () => {
    render(<MonthlyCloseHero current={makeSnapshot()} prior={null} history={[]} />);
    const heroExpenses = screen.getByTestId('hero-expenses');
    expect(heroExpenses).toHaveTextContent('Expenses');
    expect(heroExpenses).toHaveTextContent('$3,200.00');
  });

  it('shows an empty state with no current month', () => {
    render(<MonthlyCloseHero current={null} prior={null} history={[]} />);
    expect(screen.getByText(/create a draft/i)).toBeInTheDocument();
  });

  it('computes prior-month and 3-mo-avg expense deltas', () => {
    const current = makeSnapshot({ expenseCents: 320000 });
    const prior = makeSnapshot({ expenseCents: 300000 });
    const history = [
      makeSnapshot({ expenseCents: 300000 }),
      makeSnapshot({ expenseCents: 310000 }),
      makeSnapshot({ expenseCents: 290000 }),
    ];
    render(<MonthlyCloseHero current={current} prior={prior} history={history} />);
    expect(screen.getByText(/vs prior month/)).toBeInTheDocument();
    expect(screen.getByText(/vs 3-mo avg/)).toBeInTheDocument();
  });
});

describe('MonthlyCloseGrid', () => {
  it('renders the desktop grid with section headers and Metric/Current columns', () => {
    render(<MonthlyCloseGrid snapshots={[makeSnapshot()]} />);
    expect(screen.getByTestId('monthly-close-grid')).toBeInTheDocument();
    expect(screen.getByText('Metric')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
    expect(screen.getByText('Total expenses')).toBeInTheDocument();
  });

  it('does not double-count credit-card payments in the Expenses section', () => {
    // Expenses row must reflect expenseCents (which the calculator already excludes
    // debt-principal transfers from), not expenseCents + creditCardLiabilityCents.
    const snapshot = makeSnapshot({ expenseCents: 320000, creditCardLiabilityCents: 50000 });
    render(<MonthlyCloseGrid snapshots={[snapshot]} />);
    const rows = screen.getAllByText('$3,200.00');
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.queryByText('$3,700.00')).not.toBeInTheDocument();
  });

  it('shows an empty state with no snapshots', () => {
    render(<MonthlyCloseGrid snapshots={[]} />);
    expect(screen.getByText(/no monthly closes yet/i)).toBeInTheDocument();
  });
});

describe('MonthlyCloseMonthCard', () => {
  it('renders a readable month card grouped by section', () => {
    render(<MonthlyCloseMonthCard snapshot={makeSnapshot()} />);
    const card = screen.getByTestId('monthly-close-month-card');
    expect(card).toHaveTextContent('Expenses');
    expect(card).toHaveTextContent('Income');
    expect(card).toHaveTextContent('Net Worth');
  });
});

describe('CoachOverlayPanel', () => {
  it('renders Shashank ratios, Ramit buckets, and the FOO next-dollar step', () => {
    render(<CoachOverlayPanel snapshot={makeSnapshot()} />);
    const panel = screen.getByTestId('coach-overlay-panel');
    expect(panel).toHaveTextContent('Shashank Ratios');
    expect(panel).toHaveTextContent('Ramit 4-Bucket');
    expect(panel).toHaveTextContent('Money Guy FOO');
  });

  it('shows a placeholder when there is no current close', () => {
    render(<CoachOverlayPanel snapshot={null} />);
    expect(screen.getByText(/create a draft close/i)).toBeInTheDocument();
  });
});
