import { AlertEngineService } from './alert-engine.service';

describe('AlertEngineService', () => {
  let service: AlertEngineService;
  let mockDb: any;
  let mockNotificationsService: any;

  const TEST_USER = 'user-1';

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    mockNotificationsService = {
      createAndDispatch: vi.fn().mockResolvedValue({ id: 'n-1' }),
      findByMetadata: vi.fn().mockResolvedValue(false),
    };

    service = new AlertEngineService(mockDb, mockNotificationsService);
  });

  describe('checkBudgets', () => {
    it('should return empty alerts when no budgets exceed thresholds', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'b-1',
            user_id: TEST_USER,
            amount_cents: '100000',
            category_name: 'Groceries',
            spent_cents: '50000',
          },
        ],
      });

      const alerts = await service.checkBudgets();
      expect(alerts).toHaveLength(0);
      expect(mockNotificationsService.createAndDispatch).not.toHaveBeenCalled();
    });

    it('should generate a warning alert at 80%+ spend', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'b-1',
            user_id: TEST_USER,
            amount_cents: '100000',
            category_name: 'Dining',
            spent_cents: '85000',
          },
        ],
      });

      const alerts = await service.checkBudgets();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('warning');
      expect(alerts[0].percentage).toBeCloseTo(0.85);
      expect(mockNotificationsService.createAndDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'budget_alert',
          userId: TEST_USER,
        }),
      );
    });

    it('should generate an over_budget alert at 100%+ spend', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'b-1',
            user_id: TEST_USER,
            amount_cents: '100000',
            category_name: 'Shopping',
            spent_cents: '120000',
          },
        ],
      });

      const alerts = await service.checkBudgets();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('over_budget');
    });

    it('should not create duplicate alerts for same budget+period', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            budget_id: 'b-1',
            user_id: TEST_USER,
            amount_cents: '100000',
            category_name: 'Groceries',
            spent_cents: '110000',
          },
        ],
      });

      // Simulate that alert was already sent
      mockNotificationsService.findByMetadata.mockResolvedValue(true);

      const alerts = await service.checkBudgets();
      expect(alerts).toHaveLength(1);
      expect(mockNotificationsService.createAndDispatch).not.toHaveBeenCalled();
    });

    it('should filter by userIds when provided', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      await service.checkBudgets([TEST_USER]);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('checkSavingsMilestones', () => {
    it('should return empty when no goals exist', async () => {
      mockDb.where.mockResolvedValue([]);
      const milestones = await service.checkSavingsMilestones(TEST_USER);
      expect(milestones).toHaveLength(0);
    });

    it('should detect 25% milestone', async () => {
      mockDb.where.mockResolvedValue([
        {
          id: 'g-1',
          name: 'Vacation',
          targetAmountCents: 100000,
          currentAmountCents: 30000,
        },
      ]);
      mockNotificationsService.findByMetadata.mockResolvedValue(false);

      const milestones = await service.checkSavingsMilestones(TEST_USER);
      expect(milestones).toHaveLength(1);
      expect(milestones[0].milestone).toBe(25);
    });

    it('should detect multiple milestones for high-progress goal', async () => {
      mockDb.where.mockResolvedValue([
        {
          id: 'g-1',
          name: 'House',
          targetAmountCents: 100000,
          currentAmountCents: 80000,
        },
      ]);
      mockNotificationsService.findByMetadata.mockResolvedValue(false);

      const milestones = await service.checkSavingsMilestones(TEST_USER);
      // 25%, 50%, 75% all reached
      expect(milestones).toHaveLength(3);
    });

    it('should skip already-notified milestones', async () => {
      mockDb.where.mockResolvedValue([
        {
          id: 'g-1',
          name: 'Trip',
          targetAmountCents: 100000,
          currentAmountCents: 30000,
        },
      ]);
      // 25% milestone already sent
      mockNotificationsService.findByMetadata.mockResolvedValue(true);

      const milestones = await service.checkSavingsMilestones(TEST_USER);
      expect(milestones).toHaveLength(0);
    });

    it('should skip goals with zero target', async () => {
      mockDb.where.mockResolvedValue([
        {
          id: 'g-1',
          name: 'Empty',
          targetAmountCents: 0,
          currentAmountCents: 0,
        },
      ]);

      const milestones = await service.checkSavingsMilestones(TEST_USER);
      expect(milestones).toHaveLength(0);
    });
  });
});
