import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Inject,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod/v4';
import { DATABASE_CONNECTION } from '../db/db.module';
import { SyncBackfillService } from './sync-backfill.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthTokenPayload } from '@moneypulse/shared';
import * as schema from '../db/schema';
import { sql, eq } from 'drizzle-orm';

const backfillSchema = z.object({
  userId: z.string().uuid(),
  batchSize: z.number().int().positive().max(500).optional(),
});

const linkFirebaseSchema = z.object({
  firebaseUid: z.string().min(1),
});

type BackfillBody = z.infer<typeof backfillSchema>;
type LinkFirebaseBody = z.infer<typeof linkFirebaseSchema>;

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
   * GET /sync/link-status
   *
   * Returns whether the current user has linked their Firebase account.
   */
  @Get('link-status')
  @Roles('admin', 'member')
  @ApiOperation({ summary: 'Check Firebase account link status for current user' })
  async getLinkStatus(@CurrentUser() user: AuthTokenPayload) {
    const rows = await this.db
      .select({ firebaseUid: schema.users.firebaseUid })
      .from(schema.users)
      .where(eq(schema.users.id, user.sub))
      .limit(1);

    const firebaseUid = rows[0]?.firebaseUid ?? null;
    return { linked: !!firebaseUid, firebaseUid };
  }

  /**
   * POST /sync/link-firebase
   *
   * Stores the caller's Firebase UID so the delivery pipeline can use it
   * as userAliasId in projected payloads.
   */
  @Post('link-firebase')
  @Roles('admin', 'member')
  @ApiOperation({ summary: 'Link Firebase account to local user' })
  async linkFirebase(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(linkFirebaseSchema)) body: LinkFirebaseBody,
  ) {
    await this.db
      .update(schema.users)
      .set({ firebaseUid: body.firebaseUid })
      .where(eq(schema.users.id, user.sub));

    this.logger.log(`User ${user.sub} linked Firebase UID ${body.firebaseUid}`);
    return { linked: true, firebaseUid: body.firebaseUid };
  }

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
  async triggerBackfill(@Body(new ZodValidationPipe(backfillSchema)) body: BackfillBody) {
    const batchSize = body.batchSize ?? 50;
    const start = Date.now();
    const [txResult, catResult, budgetResult] = await Promise.all([
      this.backfillService.backfillPending(body.userId, batchSize),
      this.backfillService.backfillCategories(body.userId),
      this.backfillService.backfillBudgets(body.userId),
    ]);
    const durationMs = Date.now() - start;

    this.logger.log(
      `Backfill for user=${body.userId}: tx enqueued=${txResult.enqueued}, skipped=${txResult.skipped}; categories enqueued=${catResult.enqueued}, skipped=${catResult.skipped}; budgets enqueued=${budgetResult.enqueued}, skipped=${budgetResult.skipped}; durationMs=${durationMs}`,
    );

    return {
      enqueued: txResult.enqueued,
      skipped: txResult.skipped,
      categoriesEnqueued: catResult.enqueued,
      categoriesSkipped: catResult.skipped,
      budgetsEnqueued: budgetResult.enqueued,
      budgetsSkipped: budgetResult.skipped,
      durationMs,
    };
  }
}
