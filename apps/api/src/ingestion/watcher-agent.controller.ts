import { Controller, Post, Body, Logger } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { watcherHeartbeatSchema } from '@moneypulse/shared';
import type { WatcherHeartbeatInput, AuthTokenPayload } from '@moneypulse/shared';
import { WatcherAgentService } from './watcher-agent.service';
import { IngestKeyOrJwtGuard } from '../common/guards/ingest-key-or-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

/**
 * Phase 14 S2b — `POST /api/ingestion/agent/heartbeat`.
 *
 * Guarded the same way as `/ingestion/watcher-events` (`IngestKeyOrJwtGuard`):
 * either the shared `X-Ingest-Key` header (headless laptop watcher, no
 * login) or a normal JWT. When authenticated via the shared key there is no
 * `req.user`, so ownership falls back to `INGEST_DEFAULT_USER_ID` — same
 * pattern as the `slug="unknown"` fallback in `ingestion.controller.ts`
 * (Open Question 2 in the spec: a per-agent key is a future narrowing, not
 * required for S2b).
 */
@ApiTags('Ingestion')
@Controller('ingestion/agent')
export class WatcherAgentController {
  private readonly logger = new Logger(WatcherAgentController.name);

  constructor(
    private readonly watcherAgentService: WatcherAgentService,
    private readonly configService: ConfigService,
  ) {}

  @Post('heartbeat')
  @UseGuards(IngestKeyOrJwtGuard)
  @ApiOperation({ summary: 'Laptop watcher agent heartbeat' })
  async heartbeat(
    @Body(new ZodValidationPipe(watcherHeartbeatSchema)) body: WatcherHeartbeatInput,
    @CurrentUser() user?: AuthTokenPayload,
  ) {
    let userId = user?.sub;
    if (!userId) {
      userId = this.configService.get<string>('INGEST_DEFAULT_USER_ID');
      if (!userId) {
        this.logger.warn(
          'agent/heartbeat (API-key auth): no INGEST_DEFAULT_USER_ID configured; dropping heartbeat without an owner',
        );
        return { data: { commands: [] } };
      }
    }

    const result = await this.watcherAgentService.recordHeartbeat(userId, body);
    return { data: result };
  }
}
