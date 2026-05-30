import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { MerchantAliasService } from '../merchant-alias.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

describe('MerchantAliasService', () => {
  let service: MerchantAliasService;
  let mockDb: any;

  const globalAlias = { id: 'alias-g1', userId: null, pattern: 'amazon', matchType: 'contains', displayName: 'Amazon' };
  const userAlias = { id: 'alias-u1', userId: 'user-1', pattern: 'spotify', matchType: 'exact', displayName: 'Spotify' };

  beforeEach(async () => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([globalAlias, userAlias]),
      limit: vi.fn().mockResolvedValue([userAlias]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([userAlias]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantAliasService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
      ],
    }).compile();

    service = module.get<MerchantAliasService>(MerchantAliasService);
  });

  describe('findAllForUser', () => {
    it('returns aliases for user and global aliases', async () => {
      const result = await service.findAllForUser('user-1');
      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual([globalAlias, userAlias]);
    });
  });

  describe('create', () => {
    it('inserts and returns new alias', async () => {
      const result = await service.create('user-1', { pattern: 'spotify', matchType: 'exact', displayName: 'Spotify' });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual(userAlias);
    });
  });

  describe('update', () => {
    it('updates owned alias', async () => {
      mockDb.limit.mockResolvedValue([userAlias]);
      mockDb.returning.mockResolvedValue([{ ...userAlias, displayName: 'Spotify Premium' }]);
      const result = await service.update('alias-u1', 'user-1', { displayName: 'Spotify Premium' });
      expect(result.displayName).toBe('Spotify Premium');
    });

    it('throws NotFoundException when alias not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(service.update('nonexistent', 'user-1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for global alias', async () => {
      mockDb.limit.mockResolvedValue([globalAlias]);
      await expect(service.update('alias-g1', 'user-1', {})).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes owned alias', async () => {
      mockDb.limit.mockResolvedValue([userAlias]);
      await service.remove('alias-u1', 'user-1');
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('throws ForbiddenException for global alias', async () => {
      mockDb.limit.mockResolvedValue([globalAlias]);
      await expect(service.remove('alias-g1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when alias not found', async () => {
      mockDb.limit.mockResolvedValue([]);
      await expect(service.remove('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
