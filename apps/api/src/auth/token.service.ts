import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { REDIS_CLIENT } from '../redis/redis.provider';
import type { AuthTokenPayload } from '@moneypulse/shared';

@Injectable()
export class TokenService {
  private readonly accessTokenTtl: number;
  private readonly refreshTokenTtl: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.accessTokenTtl = 15 * 60; // 15 minutes
    this.refreshTokenTtl = 7 * 24 * 60 * 60; // 7 days
  }

  generateDeviceId(): string {
    return randomBytes(16).toString('hex');
  }

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

    const key = this.refreshKey(payload.sub, deviceId);
    await this.redis.set(key, refreshToken, 'EX', this.refreshTokenTtl);

    return { accessToken, refreshToken };
  }

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
      await this.revokeAllUserSessions(decoded.sub);
      throw new UnauthorizedException('Refresh token revoked');
    }

    return decoded;
  }

  async revokeSession(userId: string, deviceId: string): Promise<void> {
    await this.redis.del(this.refreshKey(userId, deviceId));
  }

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
