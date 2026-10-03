import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DATABASE_CONNECTION } from '../db/db.module';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { APP_VERSION } from '@moneypulse/shared';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /**
   * Liveness for the container healthcheck: no I/O, so a slow or sleeping
   * dependency (Ollama on the Mac) can never mark the API unhealthy and make
   * Traefik drop the /api route.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (no dependency checks)' })
  live() {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const services: Record<string, string> = {
      database: 'disconnected',
      redis: 'disconnected',
      ollama: 'unavailable',
    };

    // Check database
    try {
      await withTimeout(this.db.execute(sql`SELECT 1`), CHECK_TIMEOUT_MS);
      services.database = 'connected';
    } catch {
      services.database = 'disconnected';
    }

    // Check Redis
    try {
      const pong = await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      services.redis = pong === 'PONG' ? 'connected' : 'disconnected';
    } catch {
      services.redis = 'disconnected';
    }

    // Check Ollama
    try {
      const ollamaUrl = this.config.get<string>('OLLAMA_URL');
      if (ollamaUrl) {
        const response = await fetch(`${ollamaUrl}/api/tags`, {
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
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
