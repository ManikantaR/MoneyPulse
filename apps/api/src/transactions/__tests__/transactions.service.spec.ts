import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TransactionsService } from '../transactions.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { OutboxService } from '../../sync/outbox.service';
import { AliasMapperService } from '../../sync/alias-mapper.service';

vi.mock('../../common/crypto', () => ({
  encryptField: vi.fn().mockReturnValue('encrypted_test_value'),
  decryptField: vi.fn().mockReturnValue('decrypted_test_value'),
}));

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

    const mockOutbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      enqueueInTx: vi.fn().mockResolvedValue(undefined),
    };

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

  describe('isTransfer in outbox payload', () => {
    let mockOutbox: any;

    beforeEach(async () => {
      mockOutbox = { enqueue: vi.fn().mockResolvedValue(undefined) };

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

    it('includes isTransfer: true when the category is a transfer category', async () => {
      const txnWithTransferCat = { ...baseTxn, categoryId: 'cat-transfer' };
      vi.spyOn(service, 'findById').mockResolvedValue(txnWithTransferCat as any);
      mockDb.returning.mockResolvedValue([txnWithTransferCat]);
      // category lookup returns isTransfer: true
      mockDb.limit.mockResolvedValue([{ isTransfer: true }]);

      await service.update('txn-1', 'user-1', { categoryId: 'cat-transfer' });

      expect(mockOutbox.enqueue).toHaveBeenCalledOnce();
      const payload = mockOutbox.enqueue.mock.calls[0][0].payload;
      expect(payload.isTransfer).toBe(true);
    });

    it('includes isTransfer: false when the category is not a transfer category', async () => {
      const txnWithGroceryCat = { ...baseTxn, categoryId: 'cat-grocery' };
      vi.spyOn(service, 'findById').mockResolvedValue(txnWithGroceryCat as any);
      mockDb.returning.mockResolvedValue([txnWithGroceryCat]);
      // category lookup returns isTransfer: false
      mockDb.limit.mockResolvedValue([{ isTransfer: false }]);

      await service.update('txn-1', 'user-1', { categoryId: 'cat-grocery' });

      const payload = mockOutbox.enqueue.mock.calls[0][0].payload;
      expect(payload.isTransfer).toBe(false);
    });

    it('includes isTransfer: false when categoryId is null (no category lookup performed)', async () => {
      vi.spyOn(service, 'findById').mockResolvedValue(baseTxn as any);
      mockDb.returning.mockResolvedValue([baseTxn]); // baseTxn.categoryId = null

      await service.update('txn-1', 'user-1', {});

      const payload = mockOutbox.enqueue.mock.calls[0][0].payload;
      expect(payload.isTransfer).toBe(false);
    });
  });

  describe('foreign amount fields', () => {
    it('create() passes originalAmountCents and currencyCode to the DB insert', async () => {
      const account = [{ id: 'acc-1' }];
      const inserted = {
        ...baseTxn,
        originalAmountCents: 5000000,
        currencyCode: 'INR',
      };

      mockDb.transaction = vi.fn().mockImplementation(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([inserted]),
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ isTransfer: false }]),
        };
        const outboxTx = {
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
        };
        // Merge outbox into tx for the enqueueInTx call
        Object.assign(tx, outboxTx);
        return fn(tx);
      });

      // account ownership check
      mockDb.limit.mockResolvedValue(account);

      const result = await service.create('user-1', {
        accountId: 'acc-1',
        date: '2026-05-01',
        description: 'Family support May',
        amountCents: 60000,
        isCredit: false,
        originalAmountCents: 5000000,
        currencyCode: 'INR',
      });

      expect(result.originalAmountCents).toBe(5000000);
      expect(result.currencyCode).toBe('INR');
    });

    it('update() calls set() with originalAmountCents and currencyCode', async () => {
      const updated = {
        ...baseTxn,
        originalAmountCents: 5000000,
        currencyCode: 'INR',
      };
      vi.spyOn(service, 'findById').mockResolvedValue(baseTxn as any);
      mockDb.returning.mockResolvedValue([updated]);

      const result = await service.update('txn-1', 'user-1', {
        originalAmountCents: 5000000,
        currencyCode: 'INR',
      });

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          originalAmountCents: 5000000,
          currencyCode: 'INR',
        }),
      );
      expect(result.originalAmountCents).toBe(5000000);
      expect(result.currencyCode).toBe('INR');
    });

    it('update() can clear foreign amount by setting both fields to null', async () => {
      const withForeign = { ...baseTxn, originalAmountCents: 5000000, currencyCode: 'INR' };
      const cleared = { ...baseTxn, originalAmountCents: null, currencyCode: null };
      vi.spyOn(service, 'findById').mockResolvedValue(withForeign as any);
      mockDb.returning.mockResolvedValue([cleared]);

      const result = await service.update('txn-1', 'user-1', {
        originalAmountCents: null,
        currencyCode: null,
      });

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ originalAmountCents: null, currencyCode: null }),
      );
      expect(result.originalAmountCents).toBeNull();
    });

    it('USD amountCents is unchanged when foreign fields are set', async () => {
      const updated = {
        ...baseTxn,
        amountCents: 1000, // unchanged
        originalAmountCents: 5000000,
        currencyCode: 'INR',
      };
      vi.spyOn(service, 'findById').mockResolvedValue(baseTxn as any);
      mockDb.returning.mockResolvedValue([updated]);

      const result = await service.update('txn-1', 'user-1', {
        originalAmountCents: 5000000,
        currencyCode: 'INR',
      });

      expect(result.amountCents).toBe(1000);
    });
  });
});
