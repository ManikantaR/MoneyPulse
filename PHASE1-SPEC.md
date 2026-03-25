# Phase 1: Authentication & User Management — Implementation Spec

## Decisions Summary

| #   | Decision        | Choice                                                                          |
| --- | --------------- | ------------------------------------------------------------------------------- |
| 1   | Token strategy  | Dual tokens: Access (15min, httpOnly cookie) + Refresh (7d, httpOnly cookie)    |
| 2   | Redis storage   | Allowlist: store active refresh tokens; logout = delete                         |
| 3   | First user      | `POST /auth/register` open only when 0 users exist, 403 after                   |
| 4   | Invite flow     | Return temp password to admin (manual share, no email)                          |
| 5   | Sessions        | Multi-device: one refresh token per device, keyed `refresh:{userId}:{deviceId}` |
| 6   | Frontend auth   | Next.js middleware (redirect) + client React Query context (user data)          |
| 7   | Password change | Dedicated `/change-password` page; middleware redirects if `mustChangePassword` |

---

## File Inventory

All files to create/modify, in implementation order:

### Backend (apps/api/)

| #   | File                                              | Purpose                                                                     |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `src/common/decorators/current-user.decorator.ts` | `@CurrentUser()` param decorator                                            |
| 2   | `src/common/decorators/roles.decorator.ts`        | `@Roles('admin')` metadata decorator                                        |
| 3   | `src/common/guards/jwt-auth.guard.ts`             | JWT cookie extraction + validation guard                                    |
| 4   | `src/common/guards/roles.guard.ts`                | Role-based access guard                                                     |
| 5   | `src/common/guards/throttle-login.guard.ts`       | Login-specific rate limit (5/min)                                           |
| 6   | `src/auth/auth.module.ts`                         | Auth module wiring                                                          |
| 7   | `src/auth/auth.service.ts`                        | Register, login, refresh, logout, validateUser                              |
| 8   | `src/auth/auth.controller.ts`                     | REST endpoints: register, login, refresh, logout, me                        |
| 9   | `src/auth/strategies/jwt.strategy.ts`             | Passport JWT strategy (from cookie)                                         |
| 10  | `src/auth/strategies/local.strategy.ts`           | Passport local strategy (email+password)                                    |
| 11  | `src/auth/token.service.ts`                       | JWT sign/verify + Redis refresh token management                            |
| 12  | `src/users/users.module.ts`                       | Users module wiring                                                         |
| 13  | `src/users/users.service.ts`                      | CRUD: findById, findByEmail, create, invite, changePassword, updateSettings |
| 14  | `src/users/users.controller.ts`                   | REST endpoints: invite, list, getMe, updateSettings, changePassword         |
| 15  | `src/audit/audit.module.ts`                       | Audit module                                                                |
| 16  | `src/audit/audit.service.ts`                      | Log security events to audit_logs table                                     |
| 17  | `src/redis/redis.module.ts`                       | Global Redis provider (ioredis)                                             |
| 18  | `src/redis/redis.provider.ts`                     | Redis client factory                                                        |
| 19  | `src/app.module.ts`                               | **MODIFY** — import AuthModule, UsersModule, AuditModule, RedisModule       |

### Frontend (apps/web/)

| #   | File                                    | Purpose                                                    |
| --- | --------------------------------------- | ---------------------------------------------------------- |
| 20  | `src/lib/api.ts`                        | Fetch wrapper with credentials + error handling            |
| 21  | `src/lib/auth.ts`                       | Auth context: useAuth hook, AuthProvider                   |
| 22  | `src/middleware.ts`                     | Next.js middleware: cookie check → redirect to /login      |
| 23  | `src/app/login/page.tsx`                | Login form                                                 |
| 24  | `src/app/register/page.tsx`             | First-user registration form                               |
| 25  | `src/app/change-password/page.tsx`      | Force password change page                                 |
| 26  | `src/app/(protected)/layout.tsx`        | Protected route group layout with auth context             |
| 27  | `src/app/(protected)/settings/page.tsx` | User settings (display name, timezone, theme, preferences) |
| 28  | `src/components/ThemeToggle.tsx`        | Light/dark/system toggle                                   |

### Shared Package

| #   | File                                 | Purpose                                                                 |
| --- | ------------------------------------ | ----------------------------------------------------------------------- |
| 29  | `packages/shared/src/types/index.ts` | **MODIFY** — add `AuthTokenPayload`, `AuthResponse`, `MeResponse` types |

### Tests (TDD)

| #   | File                                       | Purpose                                           |
| --- | ------------------------------------------ | ------------------------------------------------- |
| 30  | `apps/api/test/auth.e2e-spec.ts`           | E2E: register, login, refresh, logout, me, invite |
| 31  | `apps/api/src/auth/auth.service.spec.ts`   | Unit: auth service logic                          |
| 32  | `apps/api/src/users/users.service.spec.ts` | Unit: user CRUD + invite logic                    |
| 33  | `apps/api/src/audit/audit.service.spec.ts` | Unit: audit logging                               |

---

## New Dependencies

```bash
# apps/api — add ioredis for direct Redis access (BullMQ uses it too but we need raw client)
cd apps/api && pnpm add ioredis && pnpm add -D @types/ioredis
# ioredis provides its own types, @types/ioredis may not be needed — check at install time

# apps/web — add js-cookie for reading non-httpOnly theme cookie (optional)
cd apps/web && pnpm add sonner  # toast notifications for login/error feedback
```

---

## 1. Shared Types — New Auth Types

**File: `packages/shared/src/types/index.ts`** — ADD to existing file:

```typescript
// ── Auth Types ──────────────────────────────────────────────

export interface AuthTokenPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
  householdId: string | null;
  mustChangePassword: boolean;
}

export interface AuthResponse {
  user: User;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: User;
  settings: UserSettings | null;
  household: Household | null;
  mustChangePassword: boolean;
}

export interface InviteResponse {
  user: User;
  temporaryPassword: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
```

---

## 2. Redis Module

### `src/redis/redis.provider.ts`

```typescript
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.getOrThrow<string>('REDIS_URL');
    return new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });
  },
};
```

### `src/redis/redis.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { redisProvider } from './redis.provider';

@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule {}
```

---

## 3. Token Service

### `src/auth/token.service.ts`

Handles JWT creation/validation and Redis refresh token allowlist.

```typescript
import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { REDIS_CLIENT } from '../redis/redis.provider';
import type { AuthTokenPayload } from '@moneypulse/shared';

@Injectable()
export class TokenService {
  private readonly accessTokenTtl: number; // seconds
  private readonly refreshTokenTtl: number; // seconds

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.accessTokenTtl = 15 * 60; // 15 minutes
    this.refreshTokenTtl = 7 * 24 * 60 * 60; // 7 days
  }

  /**
   * Generate a unique device ID for session tracking.
   * Called once on first login from a device; stored in a separate cookie.
   */
  generateDeviceId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Create access + refresh tokens and store refresh in Redis allowlist.
   */
  async generateTokenPair(
    payload: AuthTokenPayload,
    deviceId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.accessTokenTtl,
    });

    const refreshToken = this.jwt.sign(
      { sub: payload.sub, deviceId },
      { expiresIn: this.refreshTokenTtl },
    );

    // Store in Redis allowlist: refresh:{userId}:{deviceId} -> refreshToken
    const key = this.refreshKey(payload.sub, deviceId);
    await this.redis.set(key, refreshToken, 'EX', this.refreshTokenTtl);

    return { accessToken, refreshToken };
  }

  /**
   * Validate a refresh token against the Redis allowlist.
   * Returns the decoded payload if valid.
   */
  async validateRefreshToken(
    token: string,
  ): Promise<{ sub: string; deviceId: string }> {
    let decoded: { sub: string; deviceId: string };
    try {
      decoded = this.jwt.verify(token) as { sub: string; deviceId: string };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const key = this.refreshKey(decoded.sub, decoded.deviceId);
    const stored = await this.redis.get(key);

    if (!stored || stored !== token) {
      // Token reuse detected or token was revoked — invalidate all sessions
      await this.revokeAllUserSessions(decoded.sub);
      throw new UnauthorizedException('Refresh token revoked');
    }

    return decoded;
  }

  /**
   * Revoke a specific device session.
   */
  async revokeSession(userId: string, deviceId: string): Promise<void> {
    await this.redis.del(this.refreshKey(userId, deviceId));
  }

  /**
   * Revoke all sessions for a user (e.g., on password change or token reuse).
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  getAccessTokenTtlMs(): number {
    return this.accessTokenTtl * 1000;
  }

  getRefreshTokenTtlMs(): number {
    return this.refreshTokenTtl * 1000;
  }

  private refreshKey(userId: string, deviceId: string): string {
    return `refresh:${userId}:${deviceId}`;
  }
}
```

---

## 4. Passport Strategies

### `src/auth/strategies/local.strategy.ts`

Used for `POST /auth/login` — validates email + password.

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' }); // use "email" instead of default "username"
  }

  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }
}
```

### `src/auth/strategies/jwt.strategy.ts`

Extracts JWT from the `access_token` httpOnly cookie.

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { AuthTokenPayload } from '@moneypulse/shared';

function extractJwtFromCookie(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractJwtFromCookie]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: AuthTokenPayload): AuthTokenPayload {
    if (!payload.sub) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
```

---

## 5. Guards & Decorators

### `src/common/decorators/current-user.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthTokenPayload } from '@moneypulse/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof AuthTokenPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthTokenPayload;
    return data ? user?.[data] : user;
  },
);
```

### `src/common/decorators/roles.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@moneypulse/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

### `src/common/guards/jwt-auth.guard.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

### `src/common/guards/roles.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole, AuthTokenPayload } from '@moneypulse/shared';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No roles required — allow access
    }
    const user = context.switchToHttp().getRequest().user as AuthTokenPayload;
    return requiredRoles.includes(user.role);
  }
}
```

---

## 6. Audit Service

### `src/audit/audit.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import type { AuditAction } from '@moneypulse/shared';

interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.insert(schema.auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  }
}
```

### `src/audit/audit.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

---

## 7. Users Service

### `src/users/users.service.ts`

```typescript
import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, count } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { BCRYPT_COST_FACTOR, MIN_PASSWORD_LENGTH } from '@moneypulse/shared';
import type {
  InviteUserInput,
  UpdateUserSettingsInput,
} from '@moneypulse/shared';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async getTotalUserCount(): Promise<number> {
    const result = await this.db.select({ value: count() }).from(schema.users);
    return result[0].value;
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: {
    email: string;
    password: string;
    displayName: string;
    role: 'admin' | 'member';
    mustChangePassword?: boolean;
  }) {
    const existing = await this.findByEmail(data.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST_FACTOR);

    const rows = await this.db
      .insert(schema.users)
      .values({
        email: data.email.toLowerCase(),
        passwordHash,
        displayName: data.displayName,
        role: data.role,
        mustChangePassword: data.mustChangePassword ?? false,
      })
      .returning();

    const user = rows[0];

    // Create default user_settings
    await this.db.insert(schema.userSettings).values({
      userId: user.id,
    });

    return user;
  }

  /**
   * Admin invite: create user with temporary password.
   * Returns the user + temp password (for admin to share manually).
   */
  async invite(input: InviteUserInput, adminHouseholdId: string | null) {
    const tempPassword = this.generateTempPassword();

    const user = await this.create({
      email: input.email,
      password: tempPassword,
      displayName: input.displayName,
      role: input.role,
      mustChangePassword: true,
    });

    // Assign to admin's household if exists
    if (adminHouseholdId) {
      await this.db
        .update(schema.users)
        .set({ householdId: adminHouseholdId })
        .where(eq(schema.users.id, user.id));
    }

    return { user, temporaryPassword: tempPassword };
  }

  async changePassword(userId: string, newPasswordHash: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));
  }

  async getSettings(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async updateSettings(userId: string, data: UpdateUserSettingsInput) {
    const rows = await this.db
      .update(schema.userSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.userSettings.userId, userId))
      .returning();
    return rows[0];
  }

  async getHousehold(householdId: string) {
    const rows = await this.db
      .select()
      .from(schema.households)
      .where(eq(schema.households.id, householdId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listUsers() {
    return this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
        householdId: schema.users.householdId,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(schema.users.createdAt);
  }

  /**
   * Generate a 24-char random password for invite flow.
   * Uses crypto.randomBytes — cryptographically secure.
   */
  private generateTempPassword(): string {
    return randomBytes(18).toString('base64url'); // 24 chars, URL-safe
  }
}
```

### `src/users/users.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```

### `src/users/users.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type {
  AuthTokenPayload,
  InviteUserInput,
  UpdateUserSettingsInput,
} from '@moneypulse/shared';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Post('invite')
  @Roles('admin')
  @HttpCode(201)
  @ApiOperation({ summary: 'Admin invite — create user with temp password' })
  async invite(
    @Body() body: InviteUserInput,
    @CurrentUser() currentUser: AuthTokenPayload,
    @Req() req: Request,
  ) {
    const result = await this.usersService.invite(
      body,
      currentUser.householdId,
    );

    await this.auditService.log({
      userId: currentUser.sub,
      action: 'role_changed',
      entityType: 'user',
      entityId: result.user.id,
      newValue: { email: body.email, role: body.role },
      ipAddress: req.ip ?? null,
    });

    return {
      data: {
        user: this.sanitizeUser(result.user),
        temporaryPassword: result.temporaryPassword,
      },
    };
  }

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all users (admin only)' })
  async list() {
    const users = await this.usersService.listUsers();
    return { data: users };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile + settings' })
  async getMe(@CurrentUser() currentUser: AuthTokenPayload) {
    const user = await this.usersService.findById(currentUser.sub);
    const settings = await this.usersService.getSettings(currentUser.sub);
    const household = currentUser.householdId
      ? await this.usersService.getHousehold(currentUser.householdId)
      : null;

    return {
      data: {
        user: this.sanitizeUser(user),
        settings,
        household,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update user settings' })
  async updateSettings(
    @Body() body: UpdateUserSettingsInput,
    @CurrentUser() currentUser: AuthTokenPayload,
  ) {
    const settings = await this.usersService.updateSettings(
      currentUser.sub,
      body,
    );
    return { data: settings };
  }

  private sanitizeUser(user: any): any {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
```

---

## 8. Auth Service

### `src/auth/auth.service.ts`

```typescript
import {
  Injectable,
  Inject,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { BCRYPT_COST_FACTOR } from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  RegisterInput,
  ChangePasswordInput,
} from '@moneypulse/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Register first user as admin. Only works when 0 users exist.
   */
  async register(input: RegisterInput, ipAddress: string | null) {
    const userCount = await this.usersService.getTotalUserCount();
    if (userCount > 0) {
      throw new ForbiddenException(
        'Registration is closed. Contact admin for an invite.',
      );
    }

    const user = await this.usersService.create({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      role: 'admin',
    });

    await this.auditService.log({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      newValue: { event: 'first_user_registered' },
      ipAddress,
    });

    return this.sanitizeUser(user);
  }

  /**
   * Validate email + password. Returns user (without hash) or null.
   * Used by LocalStrategy.
   */
  async validateUser(email: string, password: string): Promise<any | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;
    if (user.deletedAt) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    return user;
  }

  /**
   * After LocalStrategy validates, generate tokens + set cookies.
   */
  async login(user: any, deviceId: string | null, ipAddress: string | null) {
    const effectiveDeviceId = deviceId || this.tokenService.generateDeviceId();

    const payload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      householdId: user.householdId,
      mustChangePassword: user.mustChangePassword,
    };

    const tokens = await this.tokenService.generateTokenPair(
      payload,
      effectiveDeviceId,
    );

    await this.auditService.log({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
    });

    return {
      ...tokens,
      deviceId: effectiveDeviceId,
      user: this.sanitizeUser(user),
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * Rotate refresh token: validate old, issue new pair, revoke old.
   */
  async refresh(refreshToken: string) {
    const decoded = await this.tokenService.validateRefreshToken(refreshToken);
    const user = await this.usersService.findById(decoded.sub);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }

    // Revoke the old refresh token
    await this.tokenService.revokeSession(decoded.sub, decoded.deviceId);

    // Issue new pair
    const payload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      householdId: user.householdId,
      mustChangePassword: user.mustChangePassword,
    };

    const tokens = await this.tokenService.generateTokenPair(
      payload,
      decoded.deviceId,
    );

    return {
      ...tokens,
      deviceId: decoded.deviceId,
    };
  }

  /**
   * Logout: revoke refresh token for this device.
   */
  async logout(userId: string, deviceId: string): Promise<void> {
    await this.tokenService.revokeSession(userId, deviceId);
  }

  /**
   * Change password: validate current, hash new, revoke all sessions.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    ipAddress: string | null,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    // If mustChangePassword, currentPassword is the temp password
    const valid = await bcrypt.compare(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_COST_FACTOR);
    await this.usersService.changePassword(userId, newHash);

    // Revoke all sessions — user must re-login with new password
    await this.tokenService.revokeAllUserSessions(userId);

    await this.auditService.log({
      userId,
      action: 'password_changed',
      entityType: 'user',
      entityId: userId,
      ipAddress,
    });
  }

  /**
   * Check if registration is open (0 users).
   */
  async isRegistrationOpen(): Promise<boolean> {
    const count = await this.usersService.getTotalUserCount();
    return count === 0;
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
```

---

## 9. Auth Controller

### `src/auth/auth.controller.ts`

Cookie configuration and all endpoints:

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerRes,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import type {
  AuthTokenPayload,
  RegisterInput,
  ChangePasswordInput,
} from '@moneypulse/shared';

// Cookie options — secure, httpOnly, SameSite
const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * POST /api/auth/register
   * Only works when 0 users exist. Creates admin user.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register first admin user (only when no users exist)',
  })
  async register(@Body() body: RegisterInput, @Req() req: Request) {
    const user = await this.authService.register(body, req.ip ?? null);
    return { data: { user } };
  }

  /**
   * POST /api/auth/login
   * Validates email+password via LocalStrategy, sets cookies.
   */
  @Post('login')
  @UseGuards(AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const deviceId = req.cookies?.device_id ?? null;
    const result = await this.authService.login(
      req.user,
      deviceId,
      req.ip ?? null,
    );

    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.deviceId,
    );

    return {
      data: {
        user: result.user,
        mustChangePassword: result.mustChangePassword,
      },
    };
  }

  /**
   * POST /api/auth/refresh
   * Reads refresh_token cookie, rotates tokens, sets new cookies.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      this.clearAuthCookies(res);
      return { data: null };
    }

    const result = await this.authService.refresh(refreshToken);

    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.deviceId,
    );

    return { data: { refreshed: true } };
  }

  /**
   * POST /api/auth/logout
   * Revokes refresh token, clears cookies.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke session' })
  async logout(
    @CurrentUser() user: AuthTokenPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const deviceId = req.cookies?.device_id;
    if (deviceId) {
      await this.authService.logout(user.sub, deviceId);
    }

    this.clearAuthCookies(res);

    return { data: { loggedOut: true } };
  }

  /**
   * GET /api/auth/me
   * Returns current user info (from JWT, no DB hit for basic info).
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@CurrentUser() user: AuthTokenPayload) {
    return { data: user };
  }

  /**
   * GET /api/auth/registration-status
   * Public endpoint: returns whether registration is open.
   */
  @Get('registration-status')
  @ApiOperation({ summary: 'Check if first-user registration is open' })
  async registrationStatus() {
    const open = await this.authService.isRegistrationOpen();
    return { data: { registrationOpen: open } };
  }

  /**
   * POST /api/auth/change-password
   * Requires auth. Revokes all sessions after success.
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change password (also clears mustChangePassword flag)',
  })
  async changePassword(
    @Body() body: ChangePasswordInput,
    @CurrentUser() user: AuthTokenPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.changePassword(user.sub, body, req.ip ?? null);

    this.clearAuthCookies(res);

    return { data: { passwordChanged: true } };
  }

  // ── Cookie Helpers ──────────────────────────────────────────

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    deviceId: string,
  ): void {
    res.cookie('access_token', accessToken, {
      ...COOKIE_BASE,
      maxAge: this.tokenService.getAccessTokenTtlMs(),
    });

    res.cookie('refresh_token', refreshToken, {
      ...COOKIE_BASE,
      maxAge: this.tokenService.getRefreshTokenTtlMs(),
      path: '/api/auth/refresh', // Only sent to refresh endpoint
    });

    res.cookie('device_id', deviceId, {
      ...COOKIE_BASE,
      httpOnly: false, // Readable by frontend for logout
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
    // Keep device_id — reused on next login
  }
}
```

### Cookie Summary

| Cookie          | HttpOnly | Secure (prod) | SameSite | MaxAge | Path                |
| --------------- | -------- | ------------- | -------- | ------ | ------------------- |
| `access_token`  | yes      | yes           | lax      | 15min  | `/`                 |
| `refresh_token` | yes      | yes           | lax      | 7 days | `/api/auth/refresh` |
| `device_id`     | no       | yes           | lax      | 1 year | `/`                 |

---

## 10. Auth Module

### `src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, LocalStrategy, JwtStrategy],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
```

---

## 11. App Module Update

### `src/app.module.ts` — MODIFY

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
    }),
    DbModule,
    RedisModule,
    AuditModule,
    AuthModule,
    UsersModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

---

## 12. Health Controller Update

### `src/health/health.controller.ts` — MODIFY

Add real Redis health check using the ioredis client:

```typescript
import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { DATABASE_CONNECTION } from '../db/db.module';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { APP_VERSION } from '@moneypulse/shared';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const services: Record<string, string> = {
      database: 'disconnected',
      redis: 'disconnected',
      ollama: 'unavailable',
    };

    // Database
    try {
      await this.db.execute(sql`SELECT 1`);
      services.database = 'connected';
    } catch {
      services.database = 'disconnected';
    }

    // Redis — real ping
    try {
      const pong = await this.redis.ping();
      services.redis = pong === 'PONG' ? 'connected' : 'disconnected';
    } catch {
      services.redis = 'disconnected';
    }

    // Ollama
    try {
      const ollamaUrl = this.config.get<string>('OLLAMA_URL');
      if (ollamaUrl) {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        services.ollama = response.ok ? 'connected' : 'unavailable';
      }
    } catch {
      services.ollama = 'unavailable';
    }

    const status = services.database === 'connected' ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      services,
      version: APP_VERSION,
    };
  }
}
```

Also update `src/health/health.module.ts` to remove standalone module (it uses globally-provided DI now):

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

---

## 13. Frontend — API Client

### `src/lib/api.ts`

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public error?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include', // sends httpOnly cookies
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (res.status === 401) {
    // Try refresh
    const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      // Retry original request with refreshed token
      const retryRes = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        ...rest,
      });

      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({}));
        throw new ApiError(
          retryRes.status,
          err.message || 'Request failed',
          err.error,
        );
      }

      return retryRes.json();
    }

    // Refresh also failed — redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.message || 'Request failed', err.error);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export { ApiError };
```

---

## 14. Frontend — Auth Context

### `src/lib/auth.ts`

```typescript
'use client';

import { createContext, useContext, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { User, UserSettings, Household } from '@moneypulse/shared';

interface MeData {
  user: User;
  settings: UserSettings | null;
  household: Household | null;
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: User | null;
  settings: UserSettings | null;
  household: Household | null;
  mustChangePassword: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ data: MeData }>('/users/me'),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      return api.post<{ data: { user: User; mustChangePassword: boolean } }>(
        '/auth/login',
        { email, password },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginMutation.mutateAsync({ email, password });
      return { mustChangePassword: result.data.mustChangePassword };
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const meData = data?.data ?? null;

  const value: AuthContextValue = {
    user: meData?.user ?? null,
    settings: meData?.settings ?? null,
    household: meData?.household ?? null,
    mustChangePassword: meData?.mustChangePassword ?? false,
    isLoading,
    isAuthenticated: !!meData?.user,
    login,
    logout,
    refetchUser: refetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

---

## 15. Frontend — Next.js Middleware

### `src/middleware.ts`

Server-side route protection. Checks for `access_token` cookie.

```typescript
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/api'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for access_token cookie
  const accessToken = request.cookies.get('access_token')?.value;

  if (!accessToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Decode JWT payload (base64, no verification — just for mustChangePassword check)
  // Actual verification happens on the API side
  try {
    const payloadBase64 = accessToken.split('.')[1];
    const payload = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString(),
    );

    // Force password change if required
    if (payload.mustChangePassword && pathname !== '/change-password') {
      return NextResponse.redirect(new URL('/change-password', request.url));
    }
  } catch {
    // Invalid token — let API handle it
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

## 16. Frontend — Login Page

### `src/app/login/page.tsx`

```tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    api
      .get<{ data: { registrationOpen: boolean } }>('/auth/registration-status')
      .then((res) => setRegistrationOpen(res.data.registrationOpen))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post<{
        data: { user: any; mustChangePassword: boolean };
      }>('/auth/login', { email, password });

      if (res.data.mustChangePassword) {
        router.push('/change-password');
      } else {
        router.push(redirect);
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">MoneyPulse</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground
                         focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground
                         focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium
                       text-primary-foreground shadow hover:bg-primary/90
                       disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {registrationOpen && (
          <p className="text-center text-sm text-muted-foreground">
            No account yet?{' '}
            <a href="/register" className="text-primary hover:underline">
              Create admin account
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
```

---

## 17. Frontend — Register Page

### `src/app/register/page.tsx`

```tsx
'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    api
      .get<{ data: { registrationOpen: boolean } }>('/auth/registration-status')
      .then((res) => {
        setRegistrationOpen(res.data.registrationOpen);
        if (!res.data.registrationOpen) {
          router.replace('/login');
        }
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 16) {
      setError('Password must be at least 16 characters');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/register', { email, password, displayName });
      // Auto-login after registration
      await api.post('/auth/login', { email, password });
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (registrationOpen === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">MoneyPulse</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your admin account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium">
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password (min 16 characters)
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={16}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={16}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium
                       text-primary-foreground shadow hover:bg-primary/90
                       disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

---

## 18. Frontend — Change Password Page

### `src/app/change-password/page.tsx`

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 16) {
      setError('Password must be at least 16 characters');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      // All sessions revoked — redirect to login
      router.push('/login');
    } catch (err: any) {
      setError(err.message || 'Password change failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Change Password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You must change your password before continuing
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium"
            >
              Current / Temporary Password
            </label>
            <input
              id="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium">
              New Password (min 16 characters)
            </label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={16}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium"
            >
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={16}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm shadow-sm focus:border-primary
                         focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium
                       text-primary-foreground shadow hover:bg-primary/90
                       disabled:opacity-50"
          >
            {loading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

---

## 19. Frontend — Protected Layout

### `src/app/(protected)/layout.tsx`

```tsx
'use client';

import { AuthProvider, useAuth } from '@/lib/auth';

function ProtectedContent({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <ProtectedContent>{children}</ProtectedContent>
    </AuthProvider>
  );
}
```

Move current `src/app/page.tsx` (dashboard placeholder) into `src/app/(protected)/page.tsx`.

---

## 20. Frontend — Settings Page

### `src/app/(protected)/settings/page.tsx`

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function SettingsPage() {
  const { user, settings, refetchUser, logout } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [timezone, setTimezone] = useState(
    settings?.timezone ?? 'America/New_York',
  );
  const [weeklyDigest, setWeeklyDigest] = useState(
    settings?.weeklyDigestEnabled ?? false,
  );
  const [haWebhookUrl, setHaWebhookUrl] = useState(
    settings?.haWebhookUrl ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await api.patch('/users/settings', {
        timezone,
        weeklyDigestEnabled: weeklyDigest,
        haWebhookUrl: haWebhookUrl || null,
      });
      refetchUser();
      setMessage('Settings saved');
    } catch (err: any) {
      setMessage(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Theme */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <ThemeToggle />
      </section>

      {/* Profile + Preferences */}
      <form onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div>
            <label className="block text-sm font-medium">Email</label>
            <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium">Role</label>
            <p className="mt-1 text-sm text-muted-foreground capitalize">
              {user?.role}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Preferences</h2>
          <div>
            <label htmlFor="timezone" className="block text-sm font-medium">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm"
            >
              {[
                'America/New_York',
                'America/Chicago',
                'America/Denver',
                'America/Los_Angeles',
                'America/Phoenix',
                'Pacific/Honolulu',
                'Europe/London',
                'Europe/Berlin',
                'Asia/Tokyo',
                'UTC',
              ].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="weeklyDigest"
              type="checkbox"
              checked={weeklyDigest}
              onChange={(e) => setWeeklyDigest(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="weeklyDigest" className="text-sm">
              Enable weekly spending digest
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <div>
            <label htmlFor="haWebhookUrl" className="block text-sm font-medium">
              Home Assistant Webhook URL
            </label>
            <input
              id="haWebhookUrl"
              type="url"
              value={haWebhookUrl}
              onChange={(e) => setHaWebhookUrl(e.target.value)}
              placeholder="https://homeassistant.local/api/webhook/..."
              className="mt-1 block w-full rounded-lg border border-input bg-background
                         px-3 py-2 text-sm"
            />
          </div>
        </section>

        {message && (
          <p
            className={`text-sm ${message.includes('Failed') ? 'text-destructive' : 'text-green-600'}`}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium
                     text-primary-foreground shadow hover:bg-primary/90
                     disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Security */}
      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">Security</h2>
        <a
          href="/change-password"
          className="inline-block text-sm text-primary hover:underline"
        >
          Change password
        </a>
        <div>
          <button
            onClick={() => logout()}
            className="rounded-lg border border-destructive px-4 py-2 text-sm
                       text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
```

---

## 21. Frontend — Theme Toggle

### `src/components/ThemeToggle.tsx`

```tsx
'use client';

import { useTheme } from 'next-themes';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex gap-2">
      {THEMES.map((t) => (
        <button
          key={t.value}
          onClick={() => setTheme(t.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors
            ${
              theme === t.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input hover:bg-accent'
            }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

---

## 22. E2E Tests

### `apps/api/test/auth.e2e-spec.ts`

Tests run against a real database. Requires Postgres + Redis running.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const adminUser = {
    email: 'admin@test.com',
    password: 'a-very-secure-password-at-least-16-chars',
    displayName: 'Admin User',
  };

  let cookies: string[];

  describe('POST /api/auth/registration-status', () => {
    it('should report registration is open', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/registration-status')
        .expect(200);

      expect(res.body.data.registrationOpen).toBe(true);
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register first user as admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(adminUser)
        .expect(201);

      expect(res.body.data.user.email).toBe(adminUser.email);
      expect(res.body.data.user.role).toBe('admin');
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('should reject second registration', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'second@test.com',
          password: 'another-password-at-least-16-chars',
          displayName: 'Second User',
        })
        .expect(403);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login and set cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: adminUser.email, password: adminUser.password })
        .expect(200);

      expect(res.body.data.user.email).toBe(adminUser.email);
      expect(res.headers['set-cookie']).toBeDefined();

      // Store cookies for subsequent requests
      cookies = res.headers['set-cookie'] as unknown as string[];

      // Verify cookies include access_token and refresh_token
      const cookieNames = cookies.map((c: string) => c.split('=')[0]);
      expect(cookieNames).toContain('access_token');
      expect(cookieNames).toContain('refresh_token');
      expect(cookieNames).toContain('device_id');
    });

    it('should reject wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: adminUser.email, password: 'wrong-password-is-wrong' })
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with cookies', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.sub).toBeDefined();
      expect(res.body.data.email).toBe(adminUser.email);
      expect(res.body.data.role).toBe('admin');
    });

    it('should 401 without cookies', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens and set new cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.refreshed).toBe(true);
      expect(res.headers['set-cookie']).toBeDefined();

      // Update cookies for subsequent requests
      cookies = res.headers['set-cookie'] as unknown as string[];
    });
  });

  describe('POST /api/users/invite', () => {
    it('should invite a member (admin only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users/invite')
        .set('Cookie', cookies)
        .send({
          email: 'member@test.com',
          displayName: 'Family Member',
          role: 'member',
        })
        .expect(201);

      expect(res.body.data.user.email).toBe('member@test.com');
      expect(res.body.data.user.role).toBe('member');
      expect(res.body.data.temporaryPassword).toBeDefined();
      expect(res.body.data.temporaryPassword.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Force password change flow', () => {
    let memberCookies: string[];

    it('invited user should login with temp password', async () => {
      // First get the temp password by re-inviting (or use from above)
      // For this test we need to get the temp password from the invite response
      const inviteRes = await request(app.getHttpServer())
        .post('/api/users/invite')
        .set('Cookie', cookies)
        .send({
          email: 'member2@test.com',
          displayName: 'Member Two',
          role: 'member',
        })
        .expect(201);

      const tempPassword = inviteRes.body.data.temporaryPassword;

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'member2@test.com', password: tempPassword })
        .expect(200);

      expect(loginRes.body.data.mustChangePassword).toBe(true);
      memberCookies = loginRes.headers['set-cookie'] as unknown as string[];
    });

    it('should change password successfully', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/api/users/invite')
        .set('Cookie', cookies)
        .send({
          email: 'member3@test.com',
          displayName: 'Member Three',
          role: 'member',
        })
        .expect(201);

      const tempPassword = inviteRes.body.data.temporaryPassword;

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'member3@test.com', password: tempPassword })
        .expect(200);

      const memberCookies3 = loginRes.headers[
        'set-cookie'
      ] as unknown as string[];

      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Cookie', memberCookies3)
        .send({
          currentPassword: tempPassword,
          newPassword: 'my-brand-new-secure-password-here',
        })
        .expect(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and clear cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.data.loggedOut).toBe(true);
    });
  });
});
```

---

## 23. Unit Test — Auth Service

### `apps/api/src/auth/auth.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: Partial<Record<keyof UsersService, jest.Mock>>;
  let tokenService: Partial<Record<keyof TokenService, jest.Mock>>;
  let auditService: Partial<Record<keyof AuditService, jest.Mock>>;

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
```

---

## Implementation Order

Execute in this sequence — each step builds on the previous:

```
Step 1:  Install dependencies (ioredis for API, sonner for web)
Step 2:  Add shared types (AuthTokenPayload, AuthResponse, etc.)
Step 3:  Create Redis module (redis.provider.ts, redis.module.ts)
Step 4:  Create Audit module (audit.service.ts, audit.module.ts)
Step 5:  Create common decorators (current-user, roles)
Step 6:  Create common guards (jwt-auth, roles)
Step 7:  Create Users service + module + controller
Step 8:  Create Token service
Step 9:  Create Passport strategies (local, jwt)
Step 10: Create Auth service
Step 11: Create Auth controller
Step 12: Create Auth module
Step 13: Update App module (import all new modules + ThrottlerGuard)
Step 14: Update Health controller (real Redis ping)
Step 15: Write unit tests (auth.service.spec.ts, users.service.spec.ts, audit.service.spec.ts)
Step 16: Write E2E tests (auth.e2e-spec.ts)
Step 17: Build + verify API starts
Step 18: Run tests against live database
Step 19: Create frontend API client (lib/api.ts)
Step 20: Create auth context (lib/auth.ts)
Step 21: Create Next.js middleware
Step 22: Create login page
Step 23: Create register page
Step 24: Create change-password page
Step 25: Move page.tsx into (protected) group + create layout
Step 26: Create settings page + ThemeToggle
Step 27: Build frontend + verify
Step 28: Full integration test (register → login → settings → invite → member login → change password)
Step 29: Git commit
```

---

## API Endpoints Summary

| Method  | Path                            | Auth                    | Rate Limit   | Description                    |
| ------- | ------------------------------- | ----------------------- | ------------ | ------------------------------ |
| `GET`   | `/api/auth/registration-status` | Public                  | 100/min      | Check if registration open     |
| `POST`  | `/api/auth/register`            | Public (0 users only)   | 100/min      | Register first admin           |
| `POST`  | `/api/auth/login`               | Public (local strategy) | 5/min (TODO) | Login, set cookies             |
| `POST`  | `/api/auth/refresh`             | Cookie only             | 100/min      | Rotate tokens                  |
| `POST`  | `/api/auth/logout`              | JWT                     | 100/min      | Revoke session, clear cookies  |
| `GET`   | `/api/auth/me`                  | JWT                     | 100/min      | Get JWT payload                |
| `POST`  | `/api/auth/change-password`     | JWT                     | 100/min      | Change password, revoke all    |
| `GET`   | `/api/users/me`                 | JWT                     | 100/min      | Full profile + settings        |
| `PATCH` | `/api/users/settings`           | JWT                     | 100/min      | Update user settings           |
| `GET`   | `/api/users`                    | JWT + admin             | 100/min      | List all users                 |
| `POST`  | `/api/users/invite`             | JWT + admin             | 100/min      | Create user with temp password |

---

## Auth Flow Diagrams

### First User Registration

```
Browser                    API                         Database
  │                         │                            │
  │  GET /registration-status│                            │
  │────────────────────────>│  SELECT COUNT(*) FROM users │
  │  { registrationOpen: true }                          │
  │<────────────────────────│                            │
  │                         │                            │
  │  POST /register         │                            │
  │  { email, password, displayName }                    │
  │────────────────────────>│  COUNT=0? → INSERT user(admin)
  │                         │  INSERT user_settings       │
  │  { user: {...} }        │  INSERT audit_log(login)    │
  │<────────────────────────│                            │
  │                         │                            │
  │  POST /login            │                            │
  │  { email, password }    │                            │
  │────────────────────────>│  bcrypt.compare → OK        │
  │                         │  Redis SET refresh:uid:did  │
  │  Set-Cookie: access_token, refresh_token, device_id  │
  │  { user, mustChangePassword: false }                 │
  │<────────────────────────│                            │
```

### Invited User Flow

```
Admin Browser              API                         Database     Redis
  │                         │                            │           │
  │  POST /users/invite     │                            │           │
  │  { email, displayName, role: "member" }              │           │
  │────────────────────────>│  Generate tempPassword      │           │
  │                         │  INSERT user(mustChangePassword=true)   │
  │  { user, temporaryPassword: "..." }                  │           │
  │<────────────────────────│                            │           │
  │                         │                            │           │
  │ Admin manually shares temp password with member      │           │
  │                         │                            │           │

Member Browser             API                         Database     Redis
  │                         │                            │           │
  │  POST /login            │                            │           │
  │  { email, tempPassword }│                            │           │
  │────────────────────────>│  bcrypt.compare → OK        │           │
  │                         │  Redis SET refresh:uid:did  │           │
  │  Set-Cookie: ...        │                            │           │
  │  { mustChangePassword: true }                        │           │
  │<────────────────────────│                            │           │
  │                         │                            │           │
  │ → Middleware redirects to /change-password            │           │
  │                         │                            │           │
  │  POST /change-password  │                            │           │
  │  { currentPassword(temp), newPassword }              │           │
  │────────────────────────>│  bcrypt.compare → OK        │           │
  │                         │  UPDATE passwordHash        │           │
  │                         │  SET mustChangePassword=false│          │
  │                         │  Redis DEL refresh:uid:*    │←──────── │
  │                         │  INSERT audit_log           │           │
  │  Clear cookies          │                            │           │
  │  → Redirect to /login   │                            │           │
  │<────────────────────────│                            │           │
```

### Token Refresh Flow

```
Browser                    API                         Redis
  │                         │                            │
  │  Any request with expired access_token               │
  │────────────────────────>│  JWT verify → expired       │
  │  401 Unauthorized       │                            │
  │<────────────────────────│                            │
  │                         │                            │
  │  POST /auth/refresh     │                            │
  │  Cookie: refresh_token  │                            │
  │────────────────────────>│  JWT verify refresh_token   │
  │                         │  GET refresh:uid:did       │
  │                         │  Compare stored === sent    │←────────│
  │                         │  DEL old refresh:uid:did   │←────────│
  │                         │  SET new refresh:uid:did   │─────────>│
  │  Set-Cookie: new access_token, new refresh_token     │
  │<────────────────────────│                            │
  │                         │                            │
  │  Retry original request │                            │
  │────────────────────────>│  JWT verify → OK            │
  │  200 OK                 │                            │
  │<────────────────────────│                            │
```

---

## ADDENDUM: Missing Items (Post-Review)

The following sections address gaps identified during spec review.

---

## A1. Throttle Login Guard

### `src/common/guards/throttle-login.guard.ts`

Custom rate limit for login endpoint: 5 attempts per minute per IP.

```typescript
import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { CanActivate } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';
import { LOGIN_RATE_LIMIT } from '@moneypulse/shared';

@Injectable()
export class ThrottleLoginGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.connection.remoteAddress || 'unknown';
    const key = `login_throttle:${ip}`;

    const current = await this.redis.incr(key);

    if (current === 1) {
      // First request — set TTL
      await this.redis.expire(key, LOGIN_RATE_LIMIT.ttl);
    }

    if (current > LOGIN_RATE_LIMIT.limit) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many login attempts. Try again in ${ttl} seconds.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
```

Apply to the login endpoint in `auth.controller.ts`:

```typescript
// Add to imports:
import { ThrottleLoginGuard } from '../common/guards/throttle-login.guard';

// Change login decorator:
@Post('login')
@UseGuards(ThrottleLoginGuard, AuthGuard('local'))  // ThrottleLoginGuard BEFORE local strategy
@HttpCode(HttpStatus.OK)
async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  // ... existing code
}
```

---

## A2. Zod Validation Pipe

NestJS `ValidationPipe` uses class-validator, not Zod. We need a custom pipe.

### `src/common/pipes/zod-validation.pipe.ts`

```typescript
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import type { ZodType, ZodError } from 'zod/v4';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodType<any>) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const error = result.error as ZodError;
      const messages = error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      throw new BadRequestException({
        statusCode: 400,
        message: messages,
        error: 'Validation Error',
      });
    }
    return result.data;
  }
}
```

### Usage in Controllers

```typescript
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { registerSchema, loginSchema, changePasswordSchema } from '@moneypulse/shared';

// In AuthController:
@Post('register')
async register(
  @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  @Req() req: Request,
) { /* ... */ }

@Post('change-password')
async changePassword(
  @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  // ...
) { /* ... */ }

// In UsersController:
@Post('invite')
async invite(
  @Body(new ZodValidationPipe(inviteUserSchema)) body: InviteUserInput,
  // ...
) { /* ... */ }

@Patch('settings')
async updateSettings(
  @Body(new ZodValidationPipe(updateUserSettingsSchema)) body: UpdateUserSettingsInput,
  // ...
) { /* ... */ }
```

---

## A3. Login Failed Audit Logging

The `login_failed` audit action is defined but never logged. Fix by adding a custom handler.

### Modify `src/auth/auth.service.ts` — add `logLoginFailed`:

```typescript
/**
 * Log a failed login attempt. Called by the controller when LocalStrategy throws.
 */
async logLoginFailed(email: string, ipAddress: string | null): Promise<void> {
  await this.auditService.log({
    userId: null,
    action: 'login_failed',
    entityType: 'auth',
    entityId: null,
    newValue: { email },
    ipAddress,
  });
}
```

### Modify `src/auth/auth.controller.ts` — wrap login to catch failures:

```typescript
@Post('login')
@HttpCode(HttpStatus.OK)
async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  // Manual validation instead of @UseGuards(AuthGuard('local'))
  // so we can audit login failures
  const { email, password } = req.body;
  const user = await this.authService.validateUser(email, password);

  if (!user) {
    await this.authService.logLoginFailed(email, req.ip ?? null);
    throw new UnauthorizedException('Invalid email or password');
  }

  const deviceId = req.cookies?.device_id ?? null;
  const result = await this.authService.login(user, deviceId, req.ip ?? null);

  this.setAuthCookies(res, result.accessToken, result.refreshToken, result.deviceId);

  return {
    data: {
      user: result.user,
      mustChangePassword: result.mustChangePassword,
    },
  };
}
```

> **Note**: This replaces `@UseGuards(AuthGuard('local'))` with manual validation to intercept failures. The `ThrottleLoginGuard` remains on the endpoint. The `LocalStrategy` is still used by Passport but we call `validateUser` directly for better control.

---

## A4. Household Management (Admin-only)

### Modify `src/users/users.service.ts` — add household methods:

```typescript
async createHousehold(name: string) {
  const rows = await this.db
    .insert(schema.households)
    .values({ name })
    .returning();
  return rows[0];
}

async assignUserToHousehold(userId: string, householdId: string): Promise<void> {
  await this.db
    .update(schema.users)
    .set({ householdId, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

async removeUserFromHousehold(userId: string): Promise<void> {
  await this.db
    .update(schema.users)
    .set({ householdId: null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

async listHouseholdMembers(householdId: string) {
  return this.db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(eq(schema.users.householdId, householdId));
}
```

### Modify `src/users/users.controller.ts` — add household endpoints:

```typescript
@Post('household')
@Roles('admin')
@HttpCode(201)
@ApiOperation({ summary: 'Create a household (admin only)' })
async createHousehold(
  @Body() body: { name: string },
  @CurrentUser() currentUser: AuthTokenPayload,
) {
  const household = await this.usersService.createHousehold(body.name);
  // Auto-assign admin to this household
  await this.usersService.assignUserToHousehold(currentUser.sub, household.id);
  return { data: household };
}

@Post('household/members/:userId')
@Roles('admin')
@HttpCode(200)
@ApiOperation({ summary: 'Assign user to admin\'s household' })
async addToHousehold(
  @Param('userId') userId: string,
  @CurrentUser() currentUser: AuthTokenPayload,
) {
  if (!currentUser.householdId) {
    throw new BadRequestException('Create a household first');
  }
  await this.usersService.assignUserToHousehold(userId, currentUser.householdId);
  return { data: { assigned: true } };
}

@Delete('household/members/:userId')
@Roles('admin')
@HttpCode(200)
@ApiOperation({ summary: 'Remove user from household' })
async removeFromHousehold(@Param('userId') userId: string) {
  await this.usersService.removeUserFromHousehold(userId);
  return { data: { removed: true } };
}

@Get('household/members')
@ApiOperation({ summary: 'List household members' })
async listHouseholdMembers(@CurrentUser() currentUser: AuthTokenPayload) {
  if (!currentUser.householdId) {
    return { data: [] };
  }
  const members = await this.usersService.listHouseholdMembers(currentUser.householdId);
  return { data: members };
}
```

### `src/common/guards/household.guard.ts`

Ensures the user belongs to a household (for household-scoped endpoints).

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthTokenPayload } from '@moneypulse/shared';

@Injectable()
export class HouseholdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthTokenPayload;

    if (!user.householdId) {
      throw new ForbiddenException(
        'You must belong to a household to access this resource',
      );
    }

    return true;
  }
}
```

---

## A5. Unit Test — Users Service

### `apps/api/src/users/users.service.spec.ts`

```typescript
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
```

---

## A6. Unit Test — Audit Service

### `apps/api/src/audit/audit.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { DATABASE_CONNECTION } from '../db/db.module';

describe('AuditService', () => {
  let service: AuditService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should insert an audit log entry', async () => {
    await service.log({
      userId: 'user-1',
      action: 'login',
      entityType: 'user',
      entityId: 'user-1',
      ipAddress: '127.0.0.1',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'login',
        entityType: 'user',
      }),
    );
  });

  it('should handle null optional fields', async () => {
    await service.log({
      userId: null,
      action: 'login_failed',
      entityType: 'auth',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        entityId: null,
        oldValue: null,
        newValue: null,
        ipAddress: null,
      }),
    );
  });
});
```

---

## Updated File Inventory

Additional files from this addendum:

| #   | File                                        | Purpose                                 |
| --- | ------------------------------------------- | --------------------------------------- |
| 34  | `src/common/pipes/zod-validation.pipe.ts`   | Zod schema validation for NestJS        |
| 35  | `src/common/guards/throttle-login.guard.ts` | Redis-based login rate limit (5/min/IP) |
| 36  | `src/common/guards/household.guard.ts`      | Ensure user belongs to a household      |

## Updated API Endpoints

| Method   | Path                                   | Auth        | Description                |
| -------- | -------------------------------------- | ----------- | -------------------------- |
| `POST`   | `/api/users/household`                 | JWT + admin | Create household           |
| `POST`   | `/api/users/household/members/:userId` | JWT + admin | Assign user to household   |
| `DELETE` | `/api/users/household/members/:userId` | JWT + admin | Remove user from household |
| `GET`    | `/api/users/household/members`         | JWT         | List household members     |

## Updated Implementation Order

Insert after Step 6 in the original order:

```
Step 5b: Create ZodValidationPipe
Step 6b: Create ThrottleLoginGuard
Step 6c: Create HouseholdGuard
```

Update Step 10 (Auth Service): include `logLoginFailed` method.
Update Step 11 (Auth Controller): use manual validation instead of `AuthGuard('local')` for login, apply `ThrottleLoginGuard`.
Update Step 7 (Users Service): include household CRUD methods.
Update Step 7 (Users Controller): include household endpoints.
