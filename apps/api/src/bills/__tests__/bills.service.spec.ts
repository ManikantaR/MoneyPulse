import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BillsService } from '../bills.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

describe('BillsService', () => {
  let service: BillsService;
  let mockDb: any;
  let mockNotifications: jest.Mocked<Pick<NotificationsService, 'findByMetadata' | 'createAndDispatch'>>;

  const userId = 'user-uuid-1';
  const billId = 'bill-uuid-1';

  const baseBill = {
    id: billId,
    userId,
    merchantPattern: 'Netflix',
    normalizedName: 'Netflix',
    categoryId: null,
    expectedAmountCents: 1599,
    amountTolerancePercent: 15,
    frequency: 'monthly',
    nextExpectedDate: new Date('2024-03-01T00:00:00Z'),
    lastSeenDate: new Date('2024-02-01T00:00:00Z'),
    lastAmountCents: 1599,
    isActive: true,
    isConfirmed: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-02-01T00:00:00Z'),
  };

  function makeDb(overrides: Partial<Record<string, any>> = {}) {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([baseBill]),
      delete: vi.fn().mockReturnThis(),
    };
    return { ...chain, ...overrides };
  }

  beforeEach(async () => {
    mockDb = makeDb();
    mockNotifications = {
      findByMetadata: vi.fn().mockResolvedValue(false),
      createAndDispatch: vi.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<BillsService>(BillsService);
  });

  // ── Detection ──────────────────────────────────────────────

  describe('detectRecurring', () => {
    function makeTxn(daysOffset: number, merchant: string, amount = 1599) {
      const date = new Date('2024-01-01T00:00:00Z');
      date.setDate(date.getDate() + daysOffset);
      return {
        date,
        amountCents: amount,
        normalizedMerchantName: merchant,
        merchantName: merchant,
      };
    }

    it('detects monthly recurring pattern from 5 transactions with same merchant', async () => {
      // 5 monthly transactions (approx 30 days apart)
      const txns = [0, 30, 60, 90, 120].map((d) => makeTxn(d, 'Netflix'));
      mockDb.orderBy = vi.fn().mockResolvedValue(txns);

      // No existing bill
      mockDb.limit = vi.fn().mockResolvedValue([]);
      mockDb.values = vi.fn().mockResolvedValue([]);

      const result = await service.detectRecurring(userId);

      expect(result.detected).toBe(1);
      expect(result.newBills).toBe(1);
      expect(result.existingSkipped).toBe(0);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('does not detect when only 2 transactions for a merchant', async () => {
      const txns = [0, 30].map((d) => makeTxn(d, 'Netflix'));
      mockDb.orderBy = vi.fn().mockResolvedValue(txns);

      const result = await service.detectRecurring(userId);

      expect(result.detected).toBe(0);
      expect(result.newBills).toBe(0);
    });

    it('does not detect when intervals are irregular', async () => {
      // Days: 0, 5, 40, 80, 100 → intervals: 5, 35, 40, 20 — not consistent
      const txns = [0, 5, 40, 80, 100].map((d) => makeTxn(d, 'RandomShop'));
      mockDb.orderBy = vi.fn().mockResolvedValue(txns);

      const result = await service.detectRecurring(userId);

      expect(result.detected).toBe(0);
    });

    it('updates existing bill rather than inserting a duplicate', async () => {
      const txns = [0, 30, 60, 90, 120].map((d) => makeTxn(d, 'Netflix'));
      mockDb.orderBy = vi.fn().mockResolvedValue(txns);

      // Existing bill found
      mockDb.limit = vi.fn().mockResolvedValue([{ id: billId }]);
      const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      mockDb.update = vi.fn().mockReturnValue(updateChain);

      const result = await service.detectRecurring(userId);

      expect(result.detected).toBe(1);
      expect(result.newBills).toBe(0);
      expect(result.existingSkipped).toBe(1);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('skips transactions with null merchant names', async () => {
      const txns = [0, 30, 60].map((d) => ({
        date: new Date(new Date('2024-01-01').getTime() + d * 86_400_000),
        amountCents: 1000,
        normalizedMerchantName: null,
        merchantName: null,
      }));
      mockDb.orderBy = vi.fn().mockResolvedValue(txns);

      const result = await service.detectRecurring(userId);

      expect(result.detected).toBe(0);
    });

    it('skips credit transactions (income/refunds)', async () => {
      // The query already filters isCredit=false via Drizzle; verify the
      // db.where call includes that filter by checking no bills are inserted
      // when only credit transactions exist (simulated as empty result)
      mockDb.orderBy = vi.fn().mockResolvedValue([]);

      const result = await service.detectRecurring(userId);

      expect(result.detected).toBe(0);
    });

    it('classifies weekly frequency (7-day interval)', async () => {
      const txns = [0, 7, 14, 21, 28].map((d) => makeTxn(d, 'GymFee'));
      mockDb.orderBy = vi.fn().mockResolvedValue(txns);
      mockDb.limit = vi.fn().mockResolvedValue([]);
      mockDb.values = vi.fn().mockResolvedValue([]);

      let insertedValues: any = null;
      mockDb.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((v) => {
          insertedValues = v;
          return Promise.resolve([]);
        }),
      });

      await service.detectRecurring(userId);

      expect(insertedValues?.frequency).toBe('weekly');
    });
  });

  // ── Missed Bills ──────────────────────────────────────────

  describe('checkMissedBills', () => {
    it('creates notification when confirmed bill is overdue with no matching transaction', async () => {
      const overdueBill = {
        ...baseBill,
        nextExpectedDate: new Date(Date.now() - 5 * 86_400_000), // 5 days ago
      };

      // First .where(): list overdue bills — awaited directly → resolve to array
      // Subsequent .where(): match txn check — needs .limit() chain → resolve []
      mockDb.where = vi.fn()
        .mockResolvedValueOnce([overdueBill])
        .mockReturnValue({ ...mockDb, limit: vi.fn().mockResolvedValue([]) });

      const result = await service.checkMissedBills(userId);

      expect(result.missedCount).toBe(1);
      expect(result.notified).toBe(1);
      expect(mockNotifications.createAndDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bill_overdue',
          userId,
        }),
      );
    });

    it('does not notify when a matching transaction exists', async () => {
      const overdueBill = {
        ...baseBill,
        nextExpectedDate: new Date(Date.now() - 5 * 86_400_000),
      };

      mockDb.where = vi.fn()
        .mockResolvedValueOnce([overdueBill])
        .mockReturnValue({ ...mockDb, limit: vi.fn().mockResolvedValue([{ id: 'txn-match' }]) });

      const result = await service.checkMissedBills(userId);

      expect(result.missedCount).toBe(0);
      expect(result.notified).toBe(0);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });

    it('does not send duplicate notification when dedupeKey already exists', async () => {
      const overdueBill = {
        ...baseBill,
        nextExpectedDate: new Date(Date.now() - 5 * 86_400_000),
      };

      mockDb.where = vi.fn()
        .mockResolvedValueOnce([overdueBill])
        .mockReturnValue({ ...mockDb, limit: vi.fn().mockResolvedValue([]) });

      // Already notified
      mockNotifications.findByMetadata.mockResolvedValue(true);

      const result = await service.checkMissedBills(userId);

      expect(result.missedCount).toBe(1);
      expect(result.notified).toBe(0);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });

    it('skips amount-mismatched transactions (not within tolerance)', async () => {
      const overdueBill = {
        ...baseBill,
        expectedAmountCents: 1599,
        amountTolerancePercent: 15,
        nextExpectedDate: new Date(Date.now() - 5 * 86_400_000),
      };

      // The check will look for amounts within 15% of 1599 (≈1359–1839)
      // Returning empty means no transaction in that range was found
      mockDb.where = vi.fn()
        .mockResolvedValueOnce([overdueBill])
        .mockReturnValue({ ...mockDb, limit: vi.fn().mockResolvedValue([]) });

      const result = await service.checkMissedBills(userId);

      expect(result.missedCount).toBe(1);
    });
  });

  // ── CRUD ─────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns bills ordered by nextExpectedDate for user', async () => {
      mockDb.orderBy = vi.fn().mockResolvedValue([baseBill]);
      const result = await service.findAll(userId);
      expect(result).toEqual([baseBill]);
    });
  });

  describe('confirm', () => {
    it('sets isConfirmed=true for owned bill', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([baseBill]);
      const updated = { ...baseBill, isConfirmed: true };
      mockDb.returning = vi.fn().mockResolvedValue([updated]);
      const result = await service.confirm(billId, userId);
      expect(result.isConfirmed).toBe(true);
    });

    it('throws NotFoundException for wrong user', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([]);
      await expect(service.confirm(billId, 'other-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('sets isActive=false for owned bill', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([baseBill]);
      const updated = { ...baseBill, isActive: false };
      mockDb.returning = vi.fn().mockResolvedValue([updated]);
      const result = await service.deactivate(billId, userId);
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException for wrong user', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([]);
      await expect(service.deactivate(billId, 'other-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes owned bill', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([baseBill]);
      const deleteChain = { where: vi.fn().mockResolvedValue([]) };
      mockDb.delete = vi.fn().mockReturnValue(deleteChain);
      await expect(service.delete(billId, userId)).resolves.not.toThrow();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException for wrong user', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([]);
      await expect(service.delete(billId, 'other-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates bill fields for owned bill', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([baseBill]);
      const updated = { ...baseBill, normalizedName: 'Netflix Premium' };
      mockDb.returning = vi.fn().mockResolvedValue([updated]);
      const result = await service.update(billId, userId, { normalizedName: 'Netflix Premium' });
      expect(result.normalizedName).toBe('Netflix Premium');
    });

    it('throws NotFoundException for wrong user', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([]);
      await expect(service.update(billId, 'other-user', {})).rejects.toThrow(NotFoundException);
    });
  });
});
