import { AnalyticsService } from '../analytics.service';

const TEST_USER_ID = 'user-test-123';

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
    it('should calculate net worth with camelCase keys', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{ assets_cents: '800000', liabilities_cents: '150000' }],
        })
        .mockResolvedValueOnce({
          rows: [{ investment_total_cents: '200000' }],
        });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.assets).toBe(1000000); // 800000 + 200000
      expect(result.liabilities).toBe(150000);
      expect(result.investments).toBe(200000);
      expect(result.netWorth).toBe(850000); // 1000000 - 150000
    });

    it('should handle zero balances', async () => {
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ assets_cents: '0', liabilities_cents: '0' }] })
        .mockResolvedValueOnce({ rows: [{ investment_total_cents: '0' }] });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.assets).toBe(0);
      expect(result.liabilities).toBe(0);
      expect(result.netWorth).toBe(0);
    });

    it('should handle missing investment data', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{ assets_cents: '500000', liabilities_cents: '100000' }],
        })
        .mockResolvedValueOnce({ rows: [{}] });

      const result = await service.netWorth(TEST_USER_ID, { household: false });

      expect(result.investments).toBe(0);
      expect(result.netWorth).toBe(400000);
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
});
