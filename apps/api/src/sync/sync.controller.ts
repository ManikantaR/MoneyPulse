import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DATABASE_CONNECTION } from '../db/db.module';
import { SyncBackfillService } from './sync-backfill.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import * as schema from '../db/schema';
import { sql, desc } from 'drizzle-orm';

export class BackfillBodyDto {
  userId!: string;
  batchSize?: number;
}

@ApiTags('Sync')
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly backfillService: SyncBackfillService,
  ) {}

  /**
   * GET /sync/stats
   *
   * Returns aggregate outbox status counts and the last 20 audit log rows.
   */
  @Get('stats')
  @ApiOperation({ summary: 'Sync pipeline status and audit log' })
  async getStats() {
    // Status counts from outbox_events grouped by status
    const countsResult = await this.db.execute(sql`
      SELECT
        status,
        COUNT(*)::int AS cnt
      FROM ${schema.outboxEvents}
      GROUP BY status
    `);

    const rows: { status: string; cnt: number }[] = countsResult.rows ?? countsResult;
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = row.cnt;
    }

    // Last delivered timestamp
    const lastDeliveredResult = await this.db.execute(sql`
      SELECT MAX(delivered_at) AS last_delivered_at
      FROM ${schema.outboxEvents}
      WHERE status = 'delivered'
    `);
    const lastDeliveredRow = (lastDeliveredResult.rows ?? lastDeliveredResult)[0];
    const lastDeliveredAt = lastDeliveredRow?.last_delivered_at ?? null;

    // Recent audit logs (last 20)
    const auditResult = await this.db.execute(sql`
      SELECT
        id,
        outbox_event_id AS "outboxEventId",
        action,
        policy_passed AS "policyPassed",
        attempt_no AS "attemptNo",
        http_status AS "httpStatus",
        error_code AS "errorCode",
        created_at AS "createdAt"
      FROM ${schema.syncAuditLogs}
      ORDER BY created_at DESC
      LIMIT 20
    `);
    const recentAuditLogs = auditResult.rows ?? auditResult;

    return {
      pending: counts['pending'] ?? 0,
      retry: counts['retry'] ?? 0,
      delivered: counts['delivered'] ?? 0,
      policyFailed: counts['policy_failed'] ?? 0,
      deadLetter: counts['dead_letter'] ?? 0,
      lastDeliveredAt,
      recentAuditLogs,
    };
  }

  /**
   * POST /sync/backfill
   *
   * Enqueues pre-existing transactions that have never been synced.
   * Admin only. Safe to run multiple times.
   */
  @Post('backfill')
  @ApiOperation({ summary: 'Backfill un-synced transactions into the outbox' })
  async triggerBackfill(@Body() body: BackfillBodyDto) {
    if (!body?.userId) {
      throw new BadRequestException('userId is required');
    }

    const batchSize = body.batchSize && body.batchSize > 0 ? Math.min(body.batchSize, 500) : 50;
    const start = Date.now();
    const result = await this.backfillService.backfillPending(body.userId, batchSize);
    const durationMs = Date.now() - start;

    this.logger.log(
      `Backfill for user=${body.userId}: enqueued=${result.enqueued}, skipped=${result.skipped}, durationMs=${durationMs}`,
    );

    return { ...result, durationMs };
  }
}
