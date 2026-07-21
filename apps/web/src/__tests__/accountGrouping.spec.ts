import { groupAccountsByCategory } from '@/lib/accountGrouping';
import type { AccountBalanceItem } from '@/lib/hooks/useAnalytics';
import type { InvestmentAccount } from '@moneypulse/shared';

function invAccount(overrides: Partial<InvestmentAccount>): InvestmentAccount {
  return {
    id: 'inv-1',
    userId: 'user-1',
    institution: 'other',
    accountType: 'brokerage',
    nickname: 'Test Investment',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    latestBalanceCents: 100000,
    latestSnapshotDate: '2026-01-01',
    ...overrides,
  };
}

describe('groupAccountsByCategory', () => {
  it('returns empty groups with zero subtotals for no accounts', () => {
    const { groups, grandTotalCents } = groupAccountsByCategory([], []);
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.accounts).toHaveLength(0);
      expect(g.subtotalCents).toBe(0);
    }
    expect(grandTotalCents).toBe(0);
  });

  it('groups checking, savings, and cash_sweep accounts into "cash"', () => {
    const balances: AccountBalanceItem[] = [
      { accountId: 'a1', nickname: 'Checking', institution: 'boa', accountType: 'checking', balanceCents: 10000 },
      { accountId: 'a2', nickname: 'Savings', institution: 'chase', accountType: 'savings', balanceCents: 25000 },
      { accountId: 'a3', nickname: 'Sweep', institution: 'other', accountType: 'cash_sweep', balanceCents: 5000 },
    ];
    const { groups } = groupAccountsByCategory(balances, []);
    const cash = groups.find((g) => g.key === 'cash')!;
    expect(cash.accounts).toHaveLength(3);
    expect(cash.subtotalCents).toBe(40000);
  });

  it('groups credit_card accounts into "credit" and normalizes balance to a positive amount owed', () => {
    const balances: AccountBalanceItem[] = [
      { accountId: 'c1', nickname: 'Visa', institution: 'chase', accountType: 'credit_card', balanceCents: -15000 },
    ];
    const { groups } = groupAccountsByCategory(balances, []);
    const credit = groups.find((g) => g.key === 'credit')!;
    expect(credit.accounts).toHaveLength(1);
    expect(credit.accounts[0].balanceCents).toBe(15000);
    expect(credit.subtotalCents).toBe(15000);
  });

  it('groups edu_529 and brokerage regular accounts plus investmentAccounts into "investments"', () => {
    const balances: AccountBalanceItem[] = [
      { accountId: 'e1', nickname: '529 Plan', institution: 'other', accountType: 'edu_529', balanceCents: 30000 },
      { accountId: 'b1', nickname: 'Brokerage', institution: 'other', accountType: 'brokerage', balanceCents: 70000 },
    ];
    const invAccounts: InvestmentAccount[] = [
      invAccount({ id: 'inv-1', nickname: 'Retirement', latestBalanceCents: 200000 }),
    ];
    const { groups } = groupAccountsByCategory(balances, invAccounts);
    const investments = groups.find((g) => g.key === 'investments')!;
    expect(investments.accounts).toHaveLength(3);
    expect(investments.subtotalCents).toBe(300000);
    expect(investments.accounts.find((a) => a.id === 'inv-1')?.isInvestmentAccount).toBe(true);
  });

  it('treats an investment account with no snapshot yet as zero for the subtotal', () => {
    const invAccounts: InvestmentAccount[] = [
      invAccount({ id: 'inv-2', latestBalanceCents: null, latestSnapshotDate: null }),
    ];
    const { groups } = groupAccountsByCategory([], invAccounts);
    const investments = groups.find((g) => g.key === 'investments')!;
    expect(investments.accounts[0].balanceCents).toBe(0);
    expect(investments.subtotalCents).toBe(0);
  });

  it('computes a grand total as assets (cash + investments) minus credit owed', () => {
    const balances: AccountBalanceItem[] = [
      { accountId: 'a1', nickname: 'Checking', institution: 'boa', accountType: 'checking', balanceCents: 100000 },
      { accountId: 'c1', nickname: 'Visa', institution: 'chase', accountType: 'credit_card', balanceCents: -20000 },
      { accountId: 'b1', nickname: 'Brokerage', institution: 'other', accountType: 'brokerage', balanceCents: 50000 },
    ];
    const invAccounts: InvestmentAccount[] = [invAccount({ latestBalanceCents: 30000 })];
    const { grandTotalCents } = groupAccountsByCategory(balances, invAccounts);
    // cash 100000 + investments (50000 + 30000) - credit 20000 = 160000
    expect(grandTotalCents).toBe(160000);
  });

  it('skips unrecognized account types rather than miscategorizing them', () => {
    const balances = [
      { accountId: 'x1', nickname: 'Mystery', institution: 'other', accountType: 'mystery_type', balanceCents: 999 },
    ] as unknown as AccountBalanceItem[];
    const { groups, grandTotalCents } = groupAccountsByCategory(balances, []);
    for (const g of groups) {
      expect(g.accounts).toHaveLength(0);
    }
    expect(grandTotalCents).toBe(0);
  });
});
