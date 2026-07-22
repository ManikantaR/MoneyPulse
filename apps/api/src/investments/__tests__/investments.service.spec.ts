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

  describe('addHolding', () => {
    it('throws ForbiddenException when declaring a holding on another user\'s account', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAccount, userId: otherId }]);
      await expect(
        service.addHolding(userId, accountId, {
          ticker: 'VTI',
          shareCount: 100,
          asOf: '2026-07-01',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('appends a new holding row rather than mutating an existing one', async () => {
      mockDb.limit.mockResolvedValue([baseAccount]);
      const holdingRow = {
        id: 'hold-1',
        investmentAccountId: accountId,
        ticker: 'VTI',
        shareCount: '100',
        asOf: '2026-07-01',
        notes: null,
      };
      mockDb.returning.mockResolvedValue([holdingRow]);
      const result = await service.addHolding(userId, accountId, {
        ticker: 'VTI',
        shareCount: 100,
        asOf: '2026-07-01',
      });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled(); // append, never mutate
      expect(result.ticker).toBe('VTI');
    });
  });

  describe('getPortfolioValue', () => {
    it('returns zero total with no holdings when the user has none', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      const result = await service.getPortfolioValue(userId);
      expect(result).toEqual({
        totalCents: 0,
        holdings: [],
        staleFound: false,
        missingPriceFound: false,
        staleDays: 90,
      });
    });

    it('computes market value as shares x latest close and flags stale/missing-price holdings', async () => {
      const recentDate = new Date().toISOString().slice(0, 10);
      const staleDate = '2020-01-01';
      mockDb.execute
        // getCurrentHoldings query
        .mockResolvedValueOnce({
          rows: [
            {
              investment_account_id: accountId,
              ticker: 'AAA',
              share_count: '10',
              as_of: recentDate,
              notes: null,
            },
            {
              investment_account_id: accountId,
              ticker: 'BBB',
              share_count: '5',
              as_of: staleDate,
              notes: null,
            },
          ],
        })
        // security_prices query — only AAA has a price
        .mockResolvedValueOnce({
          rows: [{ ticker: 'AAA', price_date: recentDate, close_cents: 1000, source: 'test' }],
        });

      const result = await service.getPortfolioValue(userId, 90);
      expect(result.totalCents).toBe(10 * 1000);
      expect(result.staleFound).toBe(true);
      expect(result.missingPriceFound).toBe(true);
      const bbb = result.holdings.find((h: any) => h.ticker === 'BBB');
      expect(bbb.marketValueCents).toBeNull();
      expect(bbb.isStale).toBe(true);
    });
  });

  describe('getAllocation', () => {
    it('computes percent of total value per ticker, excluding unpriced holdings', async () => {
      const recentDate = new Date().toISOString().slice(0, 10);
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [
            {
              investment_account_id: accountId,
              ticker: 'AAA',
              share_count: '10',
              as_of: recentDate,
              notes: null,
            },
            {
              investment_account_id: accountId,
              ticker: 'CCC',
              share_count: '30',
              as_of: recentDate,
              notes: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { ticker: 'AAA', price_date: recentDate, close_cents: 1000, source: 'test' },
            { ticker: 'CCC', price_date: recentDate, close_cents: 1000, source: 'test' },
          ],
        });

      const result = await service.getAllocation(userId);
      expect(result.totalCents).toBe(40000);
      const ccc = result.allocations.find((a) => a.ticker === 'CCC');
      expect(ccc?.pct).toBeCloseTo(75);
    });
  });

  describe('getHoldings', () => {
    it('throws ForbiddenException when reading another user\'s holdings', async () => {
      mockDb.limit.mockResolvedValue([{ ...baseAccount, userId: otherId }]);
      await expect(service.getHoldings(userId, accountId)).rejects.toThrow(ForbiddenException);
    });

    it('returns holding history newest-first for owned account', async () => {
      mockDb.limit.mockResolvedValue([baseAccount]);
      const rows = [
        { id: 'h2', ticker: 'VTI', shareCount: '110', asOf: '2026-07-15' },
        { id: 'h1', ticker: 'VTI', shareCount: '100', asOf: '2026-07-01' },
      ];
      mockDb.orderBy.mockResolvedValue(rows);
      const result = await service.getHoldings(userId, accountId);
      expect(result).toEqual(rows);
    });
  });
});
