import {
  Injectable,
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

  async validateUser(email: string, password: string): Promise<any | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;
    if (user.deletedAt) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    return user;
  }

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

  async refresh(refreshToken: string) {
    const decoded = await this.tokenService.validateRefreshToken(refreshToken);
    const user = await this.usersService.findById(decoded.sub);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }

    await this.tokenService.revokeSession(decoded.sub, decoded.deviceId);

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

  async logout(userId: string, deviceId: string): Promise<void> {
    await this.tokenService.revokeSession(userId, deviceId);
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    ipAddress: string | null,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_COST_FACTOR);
    await this.usersService.changePassword(userId, newHash);

    await this.tokenService.revokeAllUserSessions(userId);

    await this.auditService.log({
      userId,
      action: 'password_changed',
      entityType: 'user',
      entityId: userId,
      ipAddress,
    });
  }

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

  async isRegistrationOpen(): Promise<boolean> {
    const count = await this.usersService.getTotalUserCount();
    return count === 0;
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
