import { AnalyticsService } from '../analytics.service';

const TEST_USER_ID = 'user-test-123';

/**
 * Flattens a drizzle `sql` tagged-template query object (as passed to `db.execute`) into its
 * literal SQL text, inlining bound parameters. Lets tests assert on the shape of hand-built
 * raw-SQL queries (this service has no query builder / ORM layer to intercept instead).
 */
function toSqlText(chunk: any): string {
  if (chunk && Array.isArray(chunk.value)) return chunk.value.join('');
  if (chunk && Array.isArray(chunk.queryChunks)) {
    return chunk.queryChunks.map(toSqlText).join('');
  }
  return String(chunk);
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: vi.fn(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    service = new AnalyticsService(mockDb);
  });

  describe('incomeVsExpenses', () => {
    it('should return monthly income and expense totals in camelCase', async () => {
      const mockRows = [
        { month: '2026-01', income_cents: '500000', expense_cents: '320000' },
        { month: '2026-02', income_cents: '500000', expense_cents: '280000' },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.incomeVsExpenses(TEST_USER_ID, {
        from: '2026-01-01',
        to: '2026-02-28',
      });

      expect(result).toEqual([
        { month: '2026-01', incomeCents: 500000, expenseCents: 320000 },
        { month: '2026-02', incomeCents: 500000, expenseCents: 280000 },
      ]);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('should handle empty result set', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.incomeVsExpenses(TEST_USER_ID, {});
      expect(result).toEqual([]);
    });

    it('should apply account filter when provided', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      await service.incomeVsExpenses(TEST_USER_ID, {
        from: '2026-01-01',
        to: '2026-01-31',
        accountId: 'acc-123',
      });

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('excludes credit-card statement credits from income but still counts genuine deposits (synthetic data)', async () => {
      // Synthetic fixture: two $500 credits in the same month.
      //  - txn A: is_credit=true on a checking account (a genuine paycheck deposit) -> counts as income.
      //  - txn B: is_credit=true on a credit_card account (an Amex-style statement/travel credit) -> must NOT count as income.
      // Simulate the query's own CASE logic against these rows to prove the SQL excludes card credits.
      const syntheticTxns = [
        { isCredit: true, accountType: 'checking', amountCents: 50000 },
        { isCredit: true, accountType: 'credit_card', amountCents: 50000 },
        { isCredit: false, accountType: 'checking', amountCents: 12000 },
      ];

      mockDb.execute.mockResolvedValue({ rows: [] });
      await service.incomeVsExpenses(TEST_USER_ID, { from: '2026-01-01', to: '2026-01-31' });

      const queryText = toSqlText(mockDb.execute.mock.calls[0][0]);
      // The income CASE must reference the joined account's type and exclude credit_card.
      expect(queryText).toMatch(/is_credit = true/);
      expect(queryText).toMatch(/account_type.{0,40}!=\s*'credit_card'/);
      // Sanity-check the fixture against the extracted condition: a naive "any is_credit=true
      // counts as income" implementation (the pre-fix behavior) would wrongly include txn B.
      const incomeCents = syntheticTxns
        .filter((t) => t.isCredit && t.accountType !== 'credit_card')
        .reduce((sum, t) => sum + t.amountCents, 0);
      expect(incomeCents).toBe(50000); // only the checking deposit, not the card credit
    });
  });

  describe('categoryBreakdown', () => {
    it('should return camelCase category totals with percentage', async () => {
      const mockRows = [
        { category_id: 'cat-1', category_name: 'Groceries', icon: '🛒', color: '#16a34a', parent_id: null, total_cents: '85000', txn_count: '12' },
        { category_id: 'cat-2', category_name: 'Dining', icon: '🍽️', color: '#f59e0b', parent_id: null, total_cents: '42000', txn_count: '8' },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.categoryBreakdown(TEST_USER_ID, {
        from: '2026-01-01',
        to: '2026-01-31',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        categoryId: 'cat-1',
        categoryName: 'Groceries',
        categoryIcon: '🛒',
        categoryColor: '#16a34a',
        parentId: null,
        totalCents: 85000,
        transactionCount: 12,
        percentage: 66.9, // 85000 / 127000 * 100 rounded to 1dp
      });
      expect(result[1].categoryId).toBe('cat-2');
      expect(result[1].percentage).toBeCloseTo(33.1, 0);
    });

    it('should return empty array when no transactions', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.categoryBreakdown(TEST_USER_ID, {});
      expect(result).toEqual([]);
    });
  });

  describe('spendingTrend', () => {
    it('should return income + expenses per period', async () => {
      const mockRows = [
        { period: '2026-01-01', income_cents: '0', expense_cents: '15000' },
        { period: '2026-01-02', income_cents: '50000', expense_cents: '8500' },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.spendingTrend(TEST_USER_ID, {
        from: '2026-01-01',
        to: '2026-01-07',
        granularity: 'daily',
      });

      expect(result).toEqual([
        { period: '2026-01-01', income: 0, expenses: 15000 },
        { period: '2026-01-02', income: 50000, expenses: 8500 },
      ]);
    });

    it('should support monthly granularity', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.spendingTrend(TEST_USER_ID, {
        granularity: 'monthly',
      });

      expect(result).toEqual([]);
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('should support weekly granularity', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      await service.spendingTrend(TEST_USER_ID, { granularity: 'weekly' });
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('excludes credit-card statement credits from the income series', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      await service.spendingTrend(TEST_USER_ID, { granularity: 'monthly' });

      const queryText = toSqlText(mockDb.execute.mock.calls[0][0]);
      expect(queryText).toMatch(/is_credit = true/);
      expect(queryText).toMatch(/account_type.{0,40}!=\s*'credit_card'/);
    });
  });

  describe('accountBalances', () => {
    it('should return camelCase per-account balances', async () => {
      const mockRows = [
        {
          account_id: 'acc-1',
          nickname: 'BofA Checking',
          institution: 'boa',
          account_type: 'checking',
          starting_balance_cents: '500000',
          credit_limit_cents: null,
          net_change_cents: '-120000',
          current_balance_cents: '380000',
        },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.accountBalances(TEST_USER_ID, {});

      expect(result).toEqual([
        {
          accountId: 'acc-1',
          nickname: 'BofA Checking',
          institution: 'boa',
          accountType: 'checking',
          balanceCents: 380000,
        },
      ]);
    });

    it('should handle accounts with no transactions', async () => {
      const mockRows = [
        {
          account_id: 'acc-1',
          nickname: 'Empty Account',
          institution: 'chase',
          account_type: 'savings',
          starting_balance_cents: '100000',
          credit_limit_cents: null,
          net_change_cents: '0',
          current_balance_cents: '100000',
        },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.accountBalances(TEST_USER_ID, {});
      expect(result[0].balanceCents).toBe(100000);
    });
  });

  describe('creditUtilization', () => {
    it('should return utilization with percentage', async () => {
      const mockRows = [
        {
          account_id: 'acc-cc1',
          nickname: 'Chase Sapphire',
          credit_limit_cents: '1500000',
          balance_cents: '-450000',
        },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.creditUtilization(TEST_USER_ID, { household: false });

      expect(result).toEqual([
        {
          accountId: 'acc-cc1',
          nickname: 'Chase Sapphire',
          balanceCents: 450000,
          limitCents: 1500000,
          utilizationPercent: 30,
        },
      ]);
    });

    it('should return empty when no credit cards', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.creditUtilization(TEST_USER_ID, { household: false });
      expect(result).toEqual([]);
    });
  });

  describe('netWorth', () => {
    /** netWorth() is built entirely from netWorthBreakdown()'s line items (see #192), which
     *  issues 4 sequential db.execute calls in this order:
     *  1. accounts (one row per checking/savings/cash_sweep/brokerage/edu_529/credit_card account)
     *  2. investment_accounts (one row per account: holdings-x-price else snapshot)
     *  3. manual_assets (one row per asset, carry-forward value)
     *  4. loans (one row per loan: manual-statement else amortized)
     */
    function mockNetWorthQueries(overrides: {
      acct?: any[];
      investment?: any[];
      manualAsset?: any[];
      loans?: any[];
    }) {
      mockDb.execute
        .mockResolvedValueOnce({ rows: overrides.acct ?? [] })
        .mockResolvedValueOnce({ rows: overrides.investment ?? [] })
        .mockResolvedValueOnce({ rows: overrides.manualAsset ?? [] })
        .mockResolvedValueOnce({ rows: overrides.loans ?? [] });
    }

    function acctRow(overrides: any) {
      return {
        account_id: 'acct-1',
        nickname: 'Test Account',
        institution: 'Test Bank',
        account_type: 'checking',
        balance_cents: '0',
        ...overrides,
      };
    }

    it('should calculate net worth with camelCase keys', async () => {
      mockNetWorthQueries({
        acct: [
          acctRow({ account_type: 'checking', balance_cents: '800000' }),
          acctRow({ account_id: 'acct-2', account_type: 'credit_card', balance_cents: '-150000' }),
        ],
        investment: [
          {
            investment_account_id: 'inv-1',
            nickname: 'Brokerage',
            institution: 'Vanguard',
            account_type: 'brokerage',
            balance_cents: '200000',
          },
        ],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.assets).toBe(1000000); // 800000 liquid + 200000 investments
      expect(result.liabilities).toBe(150000);
      expect(result.investments).toBe(200000);
      expect(result.netWorth).toBe(850000); // 1000000 - 150000
    });

    it('should handle zero balances', async () => {
      mockNetWorthQueries({});

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.assets).toBe(0);
      expect(result.liabilities).toBe(0);
      expect(result.netWorth).toBe(0);
    });

    it('should handle missing investment data', async () => {
      mockNetWorthQueries({
        acct: [
          acctRow({ account_type: 'checking', balance_cents: '500000' }),
          acctRow({ account_id: 'acct-2', account_type: 'credit_card', balance_cents: '-100000' }),
        ],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.investments).toBe(0);
      expect(result.netWorth).toBe(400000);
    });

    it('includes brokerage/edu_529 regular-account balances in investments, never double-counted', async () => {
      mockNetWorthQueries({
        acct: [
          acctRow({ account_type: 'checking', balance_cents: '100000' }),
          acctRow({ account_id: 'acct-2', account_type: 'brokerage', balance_cents: '50000' }),
        ],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.investments).toBe(50000);
      expect(result.assets).toBe(150000);
    });

    it('uses holdings x price when holdings exist, ignoring any snapshot for that same total', async () => {
      // The service's per-investment-account balance comes from a SQL CASE that picks
      // holdings-value when holdings exist, else the latest snapshot — never both — so
      // a single row's balance_cents already reflects that exclusivity.
      mockNetWorthQueries({
        investment: [
          {
            investment_account_id: 'inv-1',
            nickname: 'Brokerage',
            institution: 'Vanguard',
            account_type: 'brokerage',
            balance_cents: '300000',
          },
        ],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.investments).toBe(300000);
    });

    it('includes manual assets (home/car/gold/other) in total assets', async () => {
      mockNetWorthQueries({
        acct: [acctRow({ account_type: 'checking', balance_cents: '100000' })],
        manualAsset: [{ id: 'ma-1', name: 'Home', asset_type: 'home', value_cents: '400000' }],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.assets).toBe(500000);
      expect(result.netWorth).toBe(500000);
    });

    it('subtracts loan liabilities: manual-statement balance wins over amortized calc', async () => {
      mockNetWorthQueries({
        acct: [acctRow({ account_type: 'checking', balance_cents: '1000000' })],
        loans: [
          {
            id: 'loan-1',
            name: 'Mortgage',
            loan_type: 'mortgage',
            original_balance_cents: '10000000',
            apr_bps: '400',
            scheduled_payment_cents: '50000',
            start_date: '2020-01-01',
            manual_balance_cents: '9500000',
            latest_source: 'manual_statement',
          },
        ],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.liabilities).toBe(9500000);
      expect(result.netWorth).toBe(1000000 - 9500000);
    });

    it('falls back to amortized loan balance when no manual statement snapshot exists', async () => {
      mockNetWorthQueries({
        acct: [acctRow({ account_type: 'checking', balance_cents: '1000000' })],
        loans: [
          {
            id: 'loan-1',
            name: 'Mortgage',
            loan_type: 'mortgage',
            original_balance_cents: '10000000',
            apr_bps: '400',
            scheduled_payment_cents: '50000',
            start_date: '2020-01-01',
            manual_balance_cents: null,
            latest_source: null,
          },
        ],
      });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      // Amortized balance after time has elapsed since 2020-01-01 must be strictly
      // less than the original balance (payments have been applied) but still positive.
      expect(result.liabilities).toBeGreaterThan(0);
      expect(result.liabilities).toBeLessThan(10000000);
    });

    it('always equals the sum of netWorthBreakdown()\'s own line items (invariant, #192)', async () => {
      mockNetWorthQueries({
        acct: [
          acctRow({ account_type: 'checking', balance_cents: '800000' }),
          acctRow({ account_id: 'acct-2', account_type: 'brokerage', balance_cents: '50000' }),
          acctRow({ account_id: 'acct-3', account_type: 'credit_card', balance_cents: '-150000' }),
        ],
        investment: [
          {
            investment_account_id: 'inv-1',
            nickname: 'Brokerage',
            institution: 'Vanguard',
            account_type: 'brokerage',
            balance_cents: '200000',
          },
        ],
        manualAsset: [{ id: 'ma-1', name: 'Home', asset_type: 'home', value_cents: '400000' }],
        loans: [
          {
            id: 'loan-1',
            name: 'Mortgage',
            loan_type: 'mortgage',
            original_balance_cents: '10000000',
            apr_bps: '400',
            scheduled_payment_cents: '50000',
            start_date: '2020-01-01',
            manual_balance_cents: '9500000',
            latest_source: 'manual_statement',
          },
        ],
      });
      const nw = await service.netWorth(TEST_USER_ID, { household: false });

      mockNetWorthQueries({
        acct: [
          acctRow({ account_type: 'checking', balance_cents: '800000' }),
          acctRow({ account_id: 'acct-2', account_type: 'brokerage', balance_cents: '50000' }),
          acctRow({ account_id: 'acct-3', account_type: 'credit_card', balance_cents: '-150000' }),
        ],
        investment: [
          {
            investment_account_id: 'inv-1',
            nickname: 'Brokerage',
            institution: 'Vanguard',
            account_type: 'brokerage',
            balance_cents: '200000',
          },
        ],
        manualAsset: [{ id: 'ma-1', name: 'Home', asset_type: 'home', value_cents: '400000' }],
        loans: [
          {
            id: 'loan-1',
            name: 'Mortgage',
            loan_type: 'mortgage',
            original_balance_cents: '10000000',
            apr_bps: '400',
            scheduled_payment_cents: '50000',
            start_date: '2020-01-01',
            manual_balance_cents: '9500000',
            latest_source: 'manual_statement',
          },
        ],
      });
      const breakdown = await service.netWorthBreakdown(TEST_USER_ID, { household: false });
      const sum = (items: Array<{ balanceCents: number }>) =>
        items.reduce((s, i) => s + i.balanceCents, 0);

      expect(
        sum(breakdown.assets.liquid) +
          sum(breakdown.assets.investments) +
          sum(breakdown.assets.manualAssets),
      ).toBe(nw.assets);
      expect(sum(breakdown.assets.investments)).toBe(nw.investments);
      expect(sum(breakdown.liabilities.creditCards) + sum(breakdown.liabilities.loans)).toBe(
        nw.liabilities,
      );
      expect(nw.assets - nw.liabilities).toBe(nw.netWorth);
    });

    it('flags a holdings-priced investment account stale and surfaces it in the breakdown (#184)', async () => {
      // The investment_accounts query itself decides, per row, whether any holding was
      // missing a securityPrices match; the service just has to trust and propagate that
      // flag rather than silently treating the fallback/partial total as fully priced.
      mockNetWorthQueries({
        investment: [
          {
            investment_account_id: 'inv-1',
            nickname: 'Brokerage',
            institution: 'Vanguard',
            account_type: 'brokerage',
            balance_cents: '150000', // e.g. fell back to the account's latest manual snapshot
            stale: true,
          },
        ],
      });

      const breakdown = await service.netWorthBreakdown(TEST_USER_ID, { household: false });

      expect(breakdown.assets.investments).toHaveLength(1);
      expect(breakdown.assets.investments[0]).toMatchObject({
        id: 'inv-1',
        balanceCents: 150000,
        stale: true,
      });
    });

    it('does not set stale on a fully-priced investment account row', async () => {
      mockNetWorthQueries({
        investment: [
          {
            investment_account_id: 'inv-1',
            nickname: 'Brokerage',
            institution: 'Vanguard',
            account_type: 'brokerage',
            balance_cents: '300000',
            stale: false,
          },
        ],
      });

      const breakdown = await service.netWorthBreakdown(TEST_USER_ID, { household: false });

      expect(breakdown.assets.investments[0].stale).toBeUndefined();
    });

    it('builds the investment-account query so an unpriced holding falls back to the account\'s ' +
      'latest snapshot (or, absent one, the priced-holdings-only partial total) instead of ' +
      'silently zeroing that holding\'s contribution (#184)', async () => {
      mockNetWorthQueries({});
      await service.netWorthBreakdown(TEST_USER_ID, { household: false });

      // Call order: 1=accounts, 2=investment_accounts.
      const queryText = toSqlText(mockDb.execute.mock.calls[1][0]);
      expect(queryText).toMatch(/missing_price_count/);
      expect(queryText).toMatch(/latest_snapshot/);
      // Zero unpriced holdings must not always resolve to a bare 0 anymore: the CASE must
      // consult the snapshot fallback before it can fall through to COALESCE(hv.value_cents, 0).
      expect(queryText).toMatch(/snap\.balance_cents IS NOT NULL/);
    });
  });

  describe('topMerchants', () => {
    it('should return camelCase top merchants', async () => {
      const mockRows = [
        { merchant: 'WHOLE FOODS', total_cents: '85000', txn_count: '12' },
        { merchant: 'AMAZON', total_cents: '62000', txn_count: '8' },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.topMerchants(TEST_USER_ID, {
        from: '2026-01-01',
        to: '2026-03-31',
        limit: 10,
      });

      expect(result).toEqual([
        { merchantName: 'WHOLE FOODS', totalCents: 85000, transactionCount: 12 },
        { merchantName: 'AMAZON', totalCents: 62000, transactionCount: 8 },
      ]);
    });

    it('should use default limit of 10', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      await service.topMerchants(TEST_USER_ID, { limit: 10 });
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('should respect custom limit', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      await service.topMerchants(TEST_USER_ID, { limit: 5 });
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('budgetProgress', () => {
    it('returns percentUsed=70 and status=warning when 70% spent', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'bgt-1',
            category_id: 'cat-1',
            category_name: 'Groceries',
            category_icon: '🛒',
            category_color: '#16a34a',
            budget_cents: '50000',
            period: 'monthly',
            spent_cents: '35000',
          },
        ],
      });

      const result = await service.budgetProgress(TEST_USER_ID, {});

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        budgetId: 'bgt-1',
        categoryName: 'Groceries',
        budgetCents: 50000,
        spentCents: 35000,
        percentUsed: 70,
        remainingCents: 15000,
        status: 'warning',
      });
    });

    it('returns empty array when no budgets exist', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await service.budgetProgress(TEST_USER_ID, {});

      expect(result).toEqual([]);
    });

    it('returns status=over_budget and negative remainingCents when spending exceeds budget', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'bgt-2',
            category_id: 'cat-2',
            category_name: 'Gas/Auto',
            category_icon: '⛽',
            category_color: '#ef4444',
            budget_cents: '25000',
            period: 'monthly',
            spent_cents: '35000',
          },
        ],
      });

      const result = await service.budgetProgress(TEST_USER_ID, {});

      expect(result[0].status).toBe('over_budget');
      expect(result[0].remainingCents).toBe(-10000);
      expect(result[0].percentUsed).toBe(140);
    });

    it('returns status=on_track when spending is below 70% of budget', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'bgt-3',
            category_id: 'cat-3',
            category_name: 'Dining',
            category_icon: '🍽️',
            category_color: '#f59e0b',
            budget_cents: '60000',
            period: 'monthly',
            spent_cents: '20000',
          },
        ],
      });

      const result = await service.budgetProgress(TEST_USER_ID, {});

      expect(result[0].status).toBe('on_track');
      expect(result[0].percentUsed).toBe(33);
    });

    it('uses provided date range instead of current month default', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });

      await service.budgetProgress(TEST_USER_ID, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      // Verify the SQL was called once (date params are embedded in the sql template)
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('savingsRate', () => {
    it('computes rate = (income - expenses) / income per month, hand-computed', async () => {
      // Fixture: Jan income $5000, expenses $3200 -> rate 36%; Feb income $5000, expenses $4000 -> rate 20%.
      mockDb.execute.mockResolvedValue({
        rows: [
          { month: '2026-01', income_cents: '500000', expense_cents: '320000' },
          { month: '2026-02', income_cents: '500000', expense_cents: '400000' },
        ],
      });

      const result = await service.savingsRate(TEST_USER_ID, {});

      expect(result.series).toEqual([
        { month: '2026-01', incomeCents: 500000, expenseCents: 320000, rate: 0.36 },
        { month: '2026-02', incomeCents: 500000, expenseCents: 400000, rate: 0.2 },
      ]);
      expect(result.current).toEqual(result.series[1]);
    });

    it('returns a null rate for a month with zero income (no divide-by-zero)', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [{ month: '2026-03', income_cents: '0', expense_cents: '10000' }],
      });

      const result = await service.savingsRate(TEST_USER_ID, {});
      expect(result.series[0].rate).toBeNull();
    });

    it('returns null current when there is no history at all', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      const result = await service.savingsRate(TEST_USER_ID, {});
      expect(result.current).toBeNull();
      expect(result.series).toEqual([]);
    });

    it('excludes credit-card statement credits from income feeding the savings rate', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      await service.savingsRate(TEST_USER_ID, {});

      const queryText = toSqlText(mockDb.execute.mock.calls[0][0]);
      expect(queryText).toMatch(/is_credit = true/);
      expect(queryText).toMatch(/account_type.{0,40}!=\s*'credit_card'/);
    });
  });

  describe('cashRunway', () => {
    it('computes liquid / trailing-3mo-avg-expenses, hand-computed', async () => {
      // Liquid = $12,000; trailing 3-month expenses total = $9,000 -> avg $3,000/mo -> 4.0 months.
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ liquid_cents: '1200000' }] })
        .mockResolvedValueOnce({ rows: [{ total_cents: '900000' }] });

      const result = await service.cashRunway(TEST_USER_ID, {});

      expect(result.liquidCents).toBe(1200000);
      expect(result.avgMonthlyExpenseCents).toBe(300000);
      expect(result.months).toBe(4);
    });

    it('returns null months when there is no expense history (no divide-by-zero)', async () => {
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ liquid_cents: '500000' }] })
        .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] });

      const result = await service.cashRunway(TEST_USER_ID, {});
      expect(result.months).toBeNull();
    });
  });

  describe('netWorthDeltas', () => {
    it('returns nulls for all windows when there are no snapshots', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      const result = await service.netWorthDeltas(TEST_USER_ID);
      expect(result).toEqual({ current: null, delta30: null, delta90: null, delta365: null });
    });

    it('computes deltas against the closest snapshot on/before each cutoff', async () => {
      const today = new Date();
      const daysAgo = (n: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return d.toISOString().slice(0, 10);
      };
      mockDb.execute.mockResolvedValue({
        rows: [
          { snapshot_date: daysAgo(400), total_cents: '1000000' },
          { snapshot_date: daysAgo(95), total_cents: '1200000' },
          { snapshot_date: daysAgo(5), total_cents: '1500000' },
        ],
      });

      const result = await service.netWorthDeltas(TEST_USER_ID);
      expect(result.current).toBe(1500000);
      expect(result.delta30).toBe(1500000 - 1200000); // no point within 30d, falls back to 95d-ago point
      expect(result.delta90).toBe(1500000 - 1200000);
      expect(result.delta365).toBe(1500000 - 1000000);
    });
  });

  describe('yoyComparison', () => {
    it('reports insufficientHistory when less than 12 months of transactions exist', async () => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ min_date: twoMonthsAgo.toISOString().slice(0, 10) }],
      });

      const result = await service.yoyComparison(TEST_USER_ID, {});
      expect(result.insufficientHistory).toBe(true);
      expect(result.categories).toEqual([]);
      expect(result.message).toContain('history');
    });

    it('returns per-category deltas when 12+ months of history exist', async () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ min_date: twoYearsAgo.toISOString().slice(0, 10) }] })
        .mockResolvedValueOnce({
          rows: [
            { category_id: 'cat-1', category_name: 'Groceries', this_month_cents: '60000', last_year_cents: '50000' },
          ],
        });

      const result = await service.yoyComparison(TEST_USER_ID, {});
      expect(result.insufficientHistory).toBe(false);
      expect(result.categories).toEqual([
        {
          categoryId: 'cat-1',
          categoryName: 'Groceries',
          thisMonthCents: 60000,
          lastYearCents: 50000,
          deltaCents: 10000,
          deltaPercent: 20,
        },
      ]);
    });
  });

  describe('subscriptionTotal', () => {
    it('sums active bills normalized to monthly-equivalent, hand-computed', async () => {
      // $10 weekly (52/12x, same annualization as /subscriptions) + $30 monthly + $60 quarterly (4/12x)
      // = $43.333... + $30 + $20 = $93.333... -> 9333 cents
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [
            { normalized_name: 'gym', expected_amount_cents: '1000', frequency: 'weekly' },
            { normalized_name: 'netflix', expected_amount_cents: '3000', frequency: 'monthly' },
            { normalized_name: 'insurance', expected_amount_cents: '6000', frequency: 'quarterly' },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.subscriptionTotal(TEST_USER_ID);

      expect(result.activeCount).toBe(3);
      expect(result.monthlyTotalCents).toBe(9333);
    });

    it('returns zero total and skips the trend query when there are no active bills', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await service.subscriptionTotal(TEST_USER_ID);
      expect(result).toEqual({ monthlyTotalCents: 0, activeCount: 0, trend: [] });
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });
  });
});
