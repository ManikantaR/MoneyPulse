import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ManualAssetsService } from '../manual-assets.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

describe('ManualAssetsService', () => {
  let service: ManualAssetsService;
  let mockDb: any;

  const asset = {
    id: 'asset-1',
    userId: 'user-1',
    name: 'Primary home',
    assetType: 'home',
    liquidityClass: 'illiquid',
    isDepreciating: false,
    deletedAt: null,
  };

  beforeEach(async () => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([asset]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([asset]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ManualAssetsService, { provide: DATABASE_CONNECTION, useValue: mockDb }],
    }).compile();

    service = module.get<ManualAssetsService>(ManualAssetsService);
  });

  describe('create — classification defaults', () => {
    it.each([
      ['home', 'illiquid', false],
      ['car', 'illiquid', true],
      ['gold', 'semi_liquid', false],
      ['other', 'illiquid', false],
    ] as const)('defaults %s to %s / depreciating=%s when not provided', async (assetType, liquidityClass, isDepreciating) => {
      await service.create('user-1', { name: 'Test', assetType });
      const values = mockDb.values.mock.calls.at(-1)[0];
      expect(values.liquidityClass).toBe(liquidityClass);
      expect(values.isDepreciating).toBe(isDepreciating);
    });

    it('honors an explicit override instead of the default', async () => {
      await service.create('user-1', {
        name: 'Vintage car',
        assetType: 'car',
        liquidityClass: 'semi_liquid',
        isDepreciating: false,
      });
      const values = mockDb.values.mock.calls.at(-1)[0];
      expect(values.liquidityClass).toBe('semi_liquid');
      expect(values.isDepreciating).toBe(false);
    });
  });

  describe('update/remove ownership', () => {
    it('throws NotFoundException when the asset does not belong to the user', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.update('asset-x', 'user-1', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a soft-deleted asset', async () => {
      mockDb.limit.mockResolvedValueOnce([{ ...asset, deletedAt: new Date() }]);
      await expect(service.remove('asset-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSnapshotForMonth — carry-forward', () => {
    it('returns the exact snapshot when one exists for the month', async () => {
      mockDb.limit
        .mockResolvedValueOnce([asset]) // requireOwned
        .mockResolvedValueOnce([
          { snapshotMonth: '2026-06-01', valueCents: 50_000_00, source: 'manual', notes: null },
        ]); // exact match

      const result = await service.getSnapshotForMonth('asset-1', 'user-1', '2026-06-01');
      expect(result).toEqual({
        snapshotMonth: '2026-06-01',
        valueCents: 50_000_00,
        source: 'manual',
        notes: null,
        asOfMonth: '2026-06-01',
        isCarriedForward: false,
      });
    });

    it('carries forward the most recent prior value and tags it with its own as-of month', async () => {
      mockDb.limit
        .mockResolvedValueOnce([asset]) // requireOwned
        .mockResolvedValueOnce([]) // no exact match for requested month
        .mockResolvedValueOnce([
          { snapshotMonth: '2026-03-01', valueCents: 48_000_00, source: 'manual', notes: 'appraisal' },
        ]); // most recent prior snapshot

      const result = await service.getSnapshotForMonth('asset-1', 'user-1', '2026-06-01');
      expect(result).toEqual({
        snapshotMonth: '2026-06-01',
        valueCents: 48_000_00,
        source: 'manual',
        notes: 'appraisal',
        asOfMonth: '2026-03-01',
        isCarriedForward: true,
      });
    });

    it('returns null when there is no snapshot for the month or any prior month', async () => {
      mockDb.limit
        .mockResolvedValueOnce([asset]) // requireOwned
        .mockResolvedValueOnce([]) // no exact match
        .mockResolvedValueOnce([]); // no prior snapshot either

      const result = await service.getSnapshotForMonth('asset-1', 'user-1', '2026-06-01');
      expect(result).toBeNull();
    });
  });

  describe('upsertSnapshot', () => {
    it('upserts keyed on (asset, month)', async () => {
      mockDb.limit.mockResolvedValueOnce([asset]);
      mockDb.returning.mockResolvedValueOnce([
        { manualAssetId: 'asset-1', snapshotMonth: '2026-06-01', valueCents: 51_000_00 },
      ]);

      const result = await service.upsertSnapshot('asset-1', 'user-1', '2026-06-01', {
        valueCents: 51_000_00,
        source: 'manual',
      });

      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
      expect(result.valueCents).toBe(51_000_00);
    });
  });
});
