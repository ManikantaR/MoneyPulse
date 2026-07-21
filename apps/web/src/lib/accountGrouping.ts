import type { AccountBalanceItem } from './hooks/useAnalytics';
import type { InvestmentAccount } from '@moneypulse/shared';

/** Category keys for the consolidated all-accounts overview screen. */
export type AccountGroupKey = 'cash' | 'credit' | 'investments';

/** One row rendered within a category group on the overview screen. */
export interface GroupedAccountRow {
  id: string;
  nickname: string;
  institution: string;
  accountType: string;
  /** Balance in cents. For credit accounts this is the amount owed (always >= 0). */
  balanceCents: number;
  /** True for rows sourced from the investmentAccounts/investmentSnapshots tables. */
  isInvestmentAccount: boolean;
}

/** A single category group with its member accounts and subtotal. */
export interface AccountGroup {
  key: AccountGroupKey;
  label: string;
  accounts: GroupedAccountRow[];
  subtotalCents: number;
}

/** Regular (bank) account types that belong to the "cash" group. */
const CASH_TYPES = new Set(['checking', 'savings', 'cash_sweep']);
/** Regular (bank) account types that belong to the "investments" group. */
const INVESTMENT_LIKE_TYPES = new Set(['edu_529', 'brokerage']);

const GROUP_LABELS: Record<AccountGroupKey, string> = {
  cash: 'Cash',
  credit: 'Credit',
  investments: 'Investments',
};

/**
 * Groups regular bank accounts (from GET /analytics/account-balances) and
 * investment accounts (from GET /investments) into Cash / Credit / Investments
 * categories, each with a subtotal, plus a combined grand total (assets minus
 * credit owed). Pure function — no I/O, no duplicated balance-computation
 * logic; balances are taken as already-computed inputs.
 */
export function groupAccountsByCategory(
  accountBalances: AccountBalanceItem[],
  investmentAccounts: InvestmentAccount[],
): { groups: AccountGroup[]; grandTotalCents: number } {
  const cash: GroupedAccountRow[] = [];
  const credit: GroupedAccountRow[] = [];
  const investments: GroupedAccountRow[] = [];

  for (const acct of accountBalances ?? []) {
    if (CASH_TYPES.has(acct.accountType)) {
      cash.push({
        id: acct.accountId,
        nickname: acct.nickname,
        institution: acct.institution,
        accountType: acct.accountType,
        balanceCents: acct.balanceCents,
        isInvestmentAccount: false,
      });
    } else if (acct.accountType === 'credit_card') {
      // Credit card balances are stored as a signed net (typically <= 0 as a
      // liability); normalize to a positive "amount owed" for display/subtotal.
      credit.push({
        id: acct.accountId,
        nickname: acct.nickname,
        institution: acct.institution,
        accountType: acct.accountType,
        balanceCents: Math.abs(acct.balanceCents),
        isInvestmentAccount: false,
      });
    } else if (INVESTMENT_LIKE_TYPES.has(acct.accountType)) {
      investments.push({
        id: acct.accountId,
        nickname: acct.nickname,
        institution: acct.institution,
        accountType: acct.accountType,
        balanceCents: acct.balanceCents,
        isInvestmentAccount: false,
      });
    }
    // Unknown/unsupported account types are intentionally skipped rather than
    // silently miscategorized.
  }

  for (const inv of investmentAccounts ?? []) {
    investments.push({
      id: inv.id,
      nickname: inv.nickname,
      institution: inv.institution,
      accountType: inv.accountType,
      // No snapshot recorded yet — treat as zero for subtotal purposes.
      balanceCents: inv.latestBalanceCents ?? 0,
      isInvestmentAccount: true,
    });
  }

  const sum = (rows: GroupedAccountRow[]) =>
    rows.reduce((total, r) => total + r.balanceCents, 0);

  const cashSubtotal = sum(cash);
  const creditSubtotal = sum(credit);
  const investmentsSubtotal = sum(investments);

  const groups: AccountGroup[] = [
    { key: 'cash', label: GROUP_LABELS.cash, accounts: cash, subtotalCents: cashSubtotal },
    { key: 'credit', label: GROUP_LABELS.credit, accounts: credit, subtotalCents: creditSubtotal },
    {
      key: 'investments',
      label: GROUP_LABELS.investments,
      accounts: investments,
      subtotalCents: investmentsSubtotal,
    },
  ];

  // Grand total = assets (cash + investments) minus credit owed.
  const grandTotalCents = cashSubtotal + investmentsSubtotal - creditSubtotal;

  return { groups, grandTotalCents };
}
