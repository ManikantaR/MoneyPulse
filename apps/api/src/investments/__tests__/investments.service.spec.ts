import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { InvestmentsService } from '../investments.service';

describe('InvestmentsService', () => {
  let service: InvestmentsService;
  let mockDb: any;

  const userId = 'user-1';
  const otherId = 'user-2';
  const accountId = 'acc-1';

  const baseAccount = {
    id: accountId,
    userId,
    institution: 'Fidelity',
    accountType: '401k',
    nickname: 'My 401k',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function makeDb(overrides: Partial<typeof mockDb> = {}) {
    const db: any = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([baseAccount]),
      limit: vi.fn().mockResolvedValue([baseAccount]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([baseAccount]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      ...overrides,
    };
    return db;
  }

  beforeEach(() => {
    mockDb = makeDb();
    service = new InvestmentsService(mockDb);
  });

  describe('create', () => {
    it('inserts a new account and returns it with null latest values', async () => {
      mockDb.returning.mockResolvedValue([baseAccount]);
      const result = await service.create(userId, {
        institution: 'Fidelity',
        accountType: '401k',
        nickname: 'My 401k',
      });
      expect(result.latestBalanceCents).toBeNull();
      expect(result.latestSnapshotDate).toBeNull();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId, institution: 'Fidelity' }),
      );
    });
  });

  describe('assertOwnership (via addSnapshot)', () => {
    it('throws NotFoundException when account does not exist', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(
        service.addSnapshot(userId, accountId, { balanceCents: 1000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when account belongs to another user', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAccount, userId: otherId }]);
      await expect(
        service.addSnapshot(userId, accountId, { balanceCents: 1000 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when account is soft-deleted', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAccount, deletedAt: new Date() }]);
      await expect(
        service.addSnapshot(userId, accountId, { balanceCents: 1000 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addSnapshot', () => {
    it('inserts a snapshot with provided date', async () => {
      mockDb.limit.mockResolvedValue([baseAccount]);
      mockDb.returning.mockResolvedValue([
        { id: 'snap-1', investmentAccountId: accountId, balanceCents: 50000, date: new Date('2025-01-15') },
      ]);
      const result = await service.addSnapshot(userId, accountId, {
        balanceCents: 50000,
        date: '2025-01-15',
      });
      expect(result.balanceCents).toBe(50000);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('inserts a snapshot with today when date is omitted', async () => {
      mockDb.limit.mockResolvedValue([baseAccount]);
      mockDb.returning.mockResolvedValue([
        { id: 'snap-2', investmentAccountId: accountId, balanceCents: 0, date: new Date() },
      ]);
      await expect(
        service.addSnapshot(userId, accountId, { balanceCents: 0 }),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('throws ForbiddenException when deleting another user\'s account', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAccount, userId: otherId }]);
      await expect(service.remove(userId, accountId)).rejects.toThrow(ForbiddenException);
    });

    it('sets deletedAt on the account', async () => {
      mockDb.limit.mockResolvedValue([baseAccount]);
      await service.remove(userId, accountId);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
    });
  });

  describe('getSnapshots', () => {
    it('throws ForbiddenException when accessing another user\'s snapshots', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAccount, userId: otherId }]);
      await expect(service.getSnapshots(userId, accountId)).rejects.toThrow(ForbiddenException);
    });

    it('returns snapshots for owned account', async () => {
      mockDb.limit.mockResolvedValue([baseAccount]);
      const snap = { id: 'snap-1', investmentAccountId: accountId, balanceCents: 10000, date: new Date() };
      mockDb.orderBy.mockResolvedValue([snap]);
      const result = await service.getSnapshots(userId, accountId);
      expect(result).toHaveLength(1);
      expect(result[0].balanceCents).toBe(10000);
    });
  });
});
