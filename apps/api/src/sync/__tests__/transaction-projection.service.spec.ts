import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionProjectionService } from '../transaction-projection.service';

/**
 * Contract tests for the shared transaction projection payload (#89 #90):
 * the local category UUID must be aliased, and reprojection must re-emit for
 * every mutated row.
 */
describe('TransactionProjectionService', () => {
  let mockDb: any;
  let mockOutbox: { enqueue: any; enqueueInTx: any };
  let aliasMapper: { toAliasId: any };
  let service: TransactionProjectionService;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      // Chains for the isTransfer lookup (…where().limit()); the reprojectByIds
      // test overrides `where` to resolve the row list directly.
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockOutbox = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      enqueueInTx: vi.fn().mockResolvedValue(undefined),
    };
    // Deterministic alias so we can assert the category UUID was obfuscated.
    aliasMapper = {
      toAliasId: vi.fn((entity: string, id: string) => `alias:${entity}:${id}`),
    };
    service = new TransactionProjectionService(
      mockDb,
      mockOutbox as any,
      aliasMapper as any,
    );
  });

  const baseTxn = {
    id: 'txn-1',
    userId: 'user-1',
    accountId: 'acc-1',
    categoryId: 'cat-uuid-9',
    amountCents: 1200,
    date: new Date('2026-07-01T00:00:00.000Z'),
    isCredit: false,
    isManual: false,
    tags: [],
  };

  it('aliases the local category UUID instead of leaking it (#90)', async () => {
    mockDb.limit.mockResolvedValue([{ isTransfer: false }]);

    await service.project('transaction.projected.v1', baseTxn);

    expect(mockOutbox.enqueue).toHaveBeenCalledOnce();
    const payload = mockOutbox.enqueue.mock.calls[0][0].payload;
    // categoryId is the aliased value, not the raw UUID that was on the row.
    expect(payload.categoryId).toBe('alias:category:cat-uuid-9');
    expect(payload.transactionAliasId).toBe('alias:transaction:txn-1');
    expect(aliasMapper.toAliasId).toHaveBeenCalledWith('category', 'cat-uuid-9');
  });

  it('emits categoryId: null when the transaction is uncategorized', async () => {
    await service.project('transaction.projected.v1', {
      ...baseTxn,
      categoryId: null,
    });
    const payload = mockOutbox.enqueue.mock.calls[0][0].payload;
    expect(payload.categoryId).toBeNull();
    // No category lookup performed for an uncategorized transaction.
    expect(aliasMapper.toAliasId).not.toHaveBeenCalledWith('category', null);
  });

  it('reflects the category transfer flag from the DB (#89)', async () => {
    mockDb.limit.mockResolvedValue([{ isTransfer: true }]);
    await service.project('transaction.projected.v1', baseTxn);
    const payload = mockOutbox.enqueue.mock.calls[0][0].payload;
    expect(payload.isTransfer).toBe(true);
  });

  it('never throws when aliasing fails — best-effort (#89)', async () => {
    aliasMapper.toAliasId.mockImplementation(() => {
      throw new Error('ALIAS_SECRET must be set for sync alias mapping');
    });
    await expect(
      service.project('transaction.projected.v1', baseTxn),
    ).resolves.toBeUndefined();
    expect(mockOutbox.enqueue).not.toHaveBeenCalled();
  });

  it('reprojectByIds re-emits a projection for each loaded row (#89)', async () => {
    mockDb.where.mockResolvedValue([
      { ...baseTxn, id: 'txn-1', categoryId: null },
      { ...baseTxn, id: 'txn-2', categoryId: null },
    ]);
    await service.reprojectByIds(['txn-1', 'txn-2']);
    expect(mockOutbox.enqueue).toHaveBeenCalledTimes(2);
  });

  it('reprojectByIds is a no-op for an empty id list', async () => {
    await service.reprojectByIds([]);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockOutbox.enqueue).not.toHaveBeenCalled();
  });
});
