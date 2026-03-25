import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: Partial<
    Record<keyof UsersService, ReturnType<typeof vi.fn>>
  >;
  let tokenService: Partial<
    Record<keyof TokenService, ReturnType<typeof vi.fn>>
  >;
  let auditService: Partial<
    Record<keyof AuditService, ReturnType<typeof vi.fn>>
  >;

  beforeEach(async () => {
    usersService = {
      getTotalUserCount: vi.fn(),
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      changePassword: vi.fn(),
    };

    tokenService = {
      generateDeviceId: vi.fn().mockReturnValue('test-device-id'),
      generateTokenPair: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      validateRefreshToken: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllUserSessions: vi.fn(),
    };

    auditService = {
      log: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: TokenService, useValue: tokenService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should create admin when no users exist', async () => {
      usersService.getTotalUserCount!.mockResolvedValue(0);
      usersService.create!.mockResolvedValue({
        id: 'user-1',
        email: 'admin@test.com',
        displayName: 'Admin',
        role: 'admin',
        passwordHash: 'hashed',
      });

      const result = await service.register(
        {
          email: 'admin@test.com',
          password: 'secure-password-16chars',
          displayName: 'Admin',
        },
        '127.0.0.1',
      );

      expect(result.email).toBe('admin@test.com');
      expect(result.passwordHash).toBeUndefined();
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
      );
    });

    it('should throw ForbiddenException when users exist', async () => {
      usersService.getTotalUserCount!.mockResolvedValue(1);

      await expect(
        service.register(
          {
            email: 'x@test.com',
            password: 'secure-password-16chars',
            displayName: 'X',
          },
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateUser', () => {
    it('should return user for valid credentials', async () => {
      const hash = await bcrypt.hash('my-password-value', 4);
      usersService.findByEmail!.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: hash,
        deletedAt: null,
      });

      const result = await service.validateUser(
        'test@test.com',
        'my-password-value',
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('user-1');
    });

    it('should return null for wrong password', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      usersService.findByEmail!.mockResolvedValue({
        id: 'user-1',
        passwordHash: hash,
        deletedAt: null,
      });

      const result = await service.validateUser(
        'test@test.com',
        'wrong-password',
      );
      expect(result).toBeNull();
    });

    it('should return null for deleted user', async () => {
      const hash = await bcrypt.hash('password', 4);
      usersService.findByEmail!.mockResolvedValue({
        id: 'user-1',
        passwordHash: hash,
        deletedAt: new Date(),
      });

      const result = await service.validateUser('test@test.com', 'password');
      expect(result).toBeNull();
    });

    it('should return null for non-existent user', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      const result = await service.validateUser('nobody@test.com', 'password');
      expect(result).toBeNull();
    });
  });
});
