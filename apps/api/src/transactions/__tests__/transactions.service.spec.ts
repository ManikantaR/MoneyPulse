import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TransactionsService } from '../transactions.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { OutboxService } from '../../sync/outbox.service';
import { AliasMapperService } from '../../sync/alias-mapper.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let mockDb: any;
  let mockAliasMapper: { toAliasId: ReturnType<typeof vi.fn> };

  const baseTxn = {
    id: 'txn-1',
    userId: 'user-1',
    accountId: 'acc-1',
    categoryId: null,
    originalDescription: null,
    amountCents: 1000,
    isCredit: false,
    isManual: false,
    tags: [],
  };

  beforeEach(async () => {
    mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    mockAliasMapper = { toAliasId: vi.fn().mockReturnValue('alias-abc123') };

    const mockOutbox = { enqueue: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: AliasMapperService, useValue: mockAliasMapper },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  describe('update — category assignment', () => {
    it('persists category change and returns updated transaction', async () => {
      const updated = { ...baseTxn, categoryId: 'cat-uuid-1' };
      vi.spyOn(service, 'findById').mockResolvedValue(baseTxn as any);
      mockDb.returning.mockResolvedValue([updated]);

      const result = await service.update('txn-1', 'user-1', {
        categoryId: 'cat-uuid-1',
      });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'cat-uuid-1' }),
      );
      expect(result.categoryId).toBe('cat-uuid-1');
    });

    it('persists category change even when ALIAS_SECRET is absent (outbox failure is best-effort)', async () => {
      // Simulates the NAS deployment without ALIAS_SECRET configured.
      // Before the fix this rolled back the domain write; now it must not.
      mockAliasMapper.toAliasId.mockImplementation(() => {
        throw new Error('ALIAS_SECRET must be set for sync alias mapping');
      });
      const updated = { ...baseTxn, categoryId: 'cat-uuid-1' };
      vi.spyOn(service, 'findById').mockResolvedValue(baseTxn as any);
      mockDb.returning.mockResolvedValue([updated]);

      const result = await service.update('txn-1', 'user-1', {
        categoryId: 'cat-uuid-1',
      });

      expect(result.categoryId).toBe('cat-uuid-1');
    });

    it('clears category when categoryId is null', async () => {
      const withCat = { ...baseTxn, categoryId: 'old-cat-id' };
      const cleared = { ...baseTxn, categoryId: null };
      vi.spyOn(service, 'findById').mockResolvedValue(withCat as any);
      mockDb.returning.mockResolvedValue([cleared]);

      const result = await service.update('txn-1', 'user-1', {
        categoryId: null,
      });

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: null }),
      );
      expect(result.categoryId).toBeNull();
    });

    it('throws NotFoundException when transaction does not exist', async () => {
      vi.spyOn(service, 'findById').mockResolvedValue(null);
      await expect(service.update('txn-1', 'user-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when user does not own the transaction', async () => {
      vi.spyOn(service, 'findById').mockResolvedValue({
        ...baseTxn,
        userId: 'other-user',
      } as any);
      await expect(service.update('txn-1', 'user-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkCategorize', () => {
    it('updates all specified transactions and returns count', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'txn-1' }, { id: 'txn-2' }]);

      const result = await service.bulkCategorize('user-1', {
        transactionIds: ['txn-1', 'txn-2'],
        categoryId: 'cat-uuid-1',
      });

      expect(result.updatedCount).toBe(2);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'cat-uuid-1' }),
      );
    });

    it('returns zero when no matching transactions found', async () => {
      mockDb.returning.mockResolvedValue([]);

      const result = await service.bulkCategorize('user-1', {
        transactionIds: ['txn-ghost'],
        categoryId: 'cat-uuid-1',
      });

      expect(result.updatedCount).toBe(0);
    });
  });
});
