import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { APP_VERSION } from '@moneypulse/shared';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
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

    // Check database
    try {
      await this.db.execute(sql`SELECT 1`);
      services.database = 'connected';
    } catch {
      services.database = 'disconnected';
    }

    // Check Redis (will be implemented when BullMQ module is added)
    try {
      const redisUrl = this.config.get<string>('REDIS_URL');
      if (redisUrl) {
        services.redis = 'connected';
      }
    } catch {
      services.redis = 'disconnected';
    }

    // Check Ollama
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
