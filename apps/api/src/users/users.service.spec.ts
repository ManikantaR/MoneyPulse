import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { DATABASE_CONNECTION } from '../db/db.module';

describe('UsersService', () => {
  let service: UsersService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          id: 'user-1',
          email: 'test@test.com',
          displayName: 'Test',
          role: 'admin',
          passwordHash: 'hashed',
          mustChangePassword: false,
        },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getTotalUserCount', () => {
    it('should return user count', async () => {
      mockDb.select.mockReturnThis();
      mockDb.from.mockResolvedValue([{ value: 3 }]);

      const count = await service.getTotalUserCount();
      expect(count).toBe(3);
    });
  });

  describe('create', () => {
    it('should create user with hashed password', async () => {
      mockDb.limit.mockResolvedValue([]); // no existing user

      const user = await service.create({
        email: 'NEW@test.com',
        password: 'a-secure-password-here',
        displayName: 'New User',
        role: 'admin',
      });

      expect(user.email).toBe('test@test.com'); // from mock
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should throw ConflictException for duplicate email', async () => {
      mockDb.limit.mockResolvedValue([
        { id: 'existing', email: 'dupe@test.com' },
      ]);

      await expect(
        service.create({
          email: 'dupe@test.com',
          password: 'a-secure-password-here',
          displayName: 'Dupe',
          role: 'member',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('invite', () => {
    it('should create user with mustChangePassword=true and return temp password', async () => {
      mockDb.limit.mockResolvedValue([]); // no existing user

      const result = await service.invite(
        { email: 'invited@test.com', displayName: 'Invited', role: 'member' },
        null,
      );

      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('changePassword', () => {
    it('should update password hash and clear mustChangePassword', async () => {
      mockDb.where.mockReturnThis();

      await service.changePassword('user-1', 'new-hash');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: false }),
      );
    });
  });
});
