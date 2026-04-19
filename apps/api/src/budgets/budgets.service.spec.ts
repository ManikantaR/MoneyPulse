import { BudgetsService } from './budgets.service';
import { NotFoundException } from '@nestjs/common';

describe('BudgetsService', () => {
  let service: BudgetsService;
  let mockDb: any;

  const TEST_USER = 'user-1';
  const TEST_HOUSEHOLD = 'hh-1';

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'b-1' }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    service = new BudgetsService(mockDb);
  });

  describe('findBudgets', () => {
    it('should query budgets for a user', async () => {
      mockDb.where.mockResolvedValue([]);
      const result = await service.findBudgets(TEST_USER);
      expect(result).toEqual([]);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should include household budgets when householdId is provided', async () => {
      mockDb.where.mockResolvedValue([]);
      await service.findBudgets(TEST_USER, TEST_HOUSEHOLD);
      expect(mockDb.from).toHaveBeenCalled();
    });
  });

  describe('findBudgetsWithSpend', () => {
    it('should return budget rows with spend calculation', async () => {
      const mockRows = [
        {
          id: 'b-1',
          user_id: TEST_USER,
          household_id: null,
          category_id: 'cat-1',
          amount_cents: '50000',
          period: 'monthly',
          category_name: 'Groceries',
          category_icon: '🛒',
          category_color: '#16a34a',
          spent_cents: '30000',
        },
      ];
      mockDb.execute.mockResolvedValue({ rows: mockRows });

      const result = await service.findBudgetsWithSpend(TEST_USER);
      expect(result).toEqual(mockRows);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('createBudget', () => {
    it('should insert a new budget', async () => {
      const input = {
        categoryId: 'cat-1',
        amountCents: 50000,
        period: 'monthly' as const,
      };
      const result = await service.createBudget(TEST_USER, input);
      expect(result).toEqual({ id: 'b-1' });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should reject creating budget for foreign household', async () => {
      const input = {
        categoryId: 'cat-1',
        amountCents: 50000,
        period: 'monthly' as const,
        householdId: 'other-hh',
      };
      await expect(
        service.createBudget(TEST_USER, input, TEST_HOUSEHOLD),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow creating budget for own household', async () => {
      const input = {
        categoryId: 'cat-1',
        amountCents: 50000,
        period: 'monthly' as const,
        householdId: TEST_HOUSEHOLD,
      };
      const result = await service.createBudget(
        TEST_USER,
        input,
        TEST_HOUSEHOLD,
      );
      expect(result).toEqual({ id: 'b-1' });
    });
  });

  describe('updateBudget', () => {
    it('should throw NotFoundException if budget not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(
        service.updateBudget('b-1', TEST_USER, { amountCents: 60000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update the budget when found', async () => {
      mockDb.limit.mockResolvedValue([{ id: 'b-1' }]);
      mockDb.returning.mockResolvedValue([
        { id: 'b-1', amountCents: 60000 },
      ]);
      const result = await service.updateBudget('b-1', TEST_USER, {
        amountCents: 60000,
      });
      expect(result).toEqual({ id: 'b-1', amountCents: 60000 });
    });
  });

  describe('deleteBudget', () => {
    it('should throw NotFoundException if budget not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(
        service.deleteBudget('b-1', TEST_USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSavingsGoals', () => {
    it('should return goals for the user', async () => {
      mockDb.where.mockResolvedValue([{ id: 'g-1', name: 'Vacation' }]);
      const result = await service.findSavingsGoals(TEST_USER);
      expect(result).toEqual([{ id: 'g-1', name: 'Vacation' }]);
    });
  });

  describe('createSavingsGoal', () => {
    it('should insert a new savings goal', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'g-1', name: 'Vacation', currentAmountCents: 0 },
      ]);
      const result = await service.createSavingsGoal(TEST_USER, {
        name: 'Vacation',
        targetAmountCents: 200000,
      });
      expect(result.name).toBe('Vacation');
      expect(result.currentAmountCents).toBe(0);
    });
  });

  describe('contributeSavingsGoal', () => {
    it('should throw NotFoundException when goal not found', async () => {
      mockDb.returning.mockResolvedValue([]);
      await expect(
        service.contributeSavingsGoal('g-1', TEST_USER, 5000),
      ).rejects.toThrow(NotFoundException);
    });

    it('should atomically increment currentAmountCents', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'g-1', currentAmountCents: 15000 },
      ]);
      const result = await service.contributeSavingsGoal(
        'g-1',
        TEST_USER,
        5000,
      );
      expect(result.currentAmountCents).toBe(15000);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('deleteSavingsGoal', () => {
    it('should throw NotFoundException when goal not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(
        service.deleteSavingsGoal('g-1', TEST_USER),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
