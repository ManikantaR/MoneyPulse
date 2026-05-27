import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { sql, and, isNull, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { SyncDeliveryService } from './sync-delivery.service';
import { OutboxService } from './outbox.service';
import { AliasMapperService } from './alias-mapper.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

// ── Validation schemas ────────────────────────────────────────

const backfillSchema = z.object({
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  accountId: z.uuid().optional(),
  force: z.boolean().optional(),
});

const replaySchema = z.object({
  eventIds: z.array(z.uuid()).optional(),
});

const eventsQuerySchema = z.object({
  status: z
    .enum(['pending', 'retry', 'delivered', 'dead_letter', 'policy_failed'])
    .optional(),
  eventType: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

type BackfillInput = z.infer<typeof backfillSchema>;
type ReplayInput = z.infer<typeof replaySchema>;
type EventsQuery = z.infer<typeof eventsQuerySchema>;

@ApiTags('Sync')
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SyncController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly syncDelivery: SyncDeliveryService,
    private readonly outbox: OutboxService,
    private readonly aliasMapper: AliasMapperService,
  ) {}

  /**
   * GET /sync/status — Pipeline health: event counts, last delivery, secret config flags.
   */
  @Get('status')
  @ApiOperation({ summary: 'Sync pipeline health and event counts' })
  async status() {
    const rows = await this.db.execute(sql`
      SELECT status, COUNT(*)::int AS count
      FROM ${schema.outboxEvents}
      GROUP BY status
    `);

    const counts: Record<string, number> = {};
    for (const r of rows.rows ?? rows) {
      counts[(r as any).status] = Number((r as any).count);
    }

    const lastDelivered = await this.db.execute(sql`
      SELECT delivered_at, last_error_message
      FROM ${schema.outboxEvents}
      WHERE status = 'delivered'
      ORDER BY delivered_at DESC
      LIMIT 1
    `);

    const lastError = await this.db.execute(sql`
      SELECT last_error_message, updated_at
      FROM ${schema.outboxEvents}
      WHERE status IN ('retry', 'dead_letter')
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    const lastDeliveredRow = (lastDelivered.rows ?? lastDelivered)[0] as any;
    const lastErrorRow = (lastError.rows ?? lastError)[0] as any;

    const deadLetterCount = counts['dead_letter'] ?? 0;
    const pendingCount = (counts['pending'] ?? 0) + (counts['retry'] ?? 0);

    const hasDeadLetters = deadLetterCount > 0;
    const secretsConfigured =
      Boolean(process.env.FIREBASE_SYNC_ENDPOINT) &&
      Boolean(process.env.ALIAS_SECRET) &&
      Boolean(process.env.SYNC_SIGNING_SECRET);

    const health = hasDeadLetters || !secretsConfigured
      ? 'red'
      : pendingCount > 0
        ? 'yellow'
        : 'green';

    return {
      data: {
        health,
        counts: {
          pending: counts['pending'] ?? 0,
          retry: counts['retry'] ?? 0,
          delivered: counts['delivered'] ?? 0,
          dead_letter: deadLetterCount,
          policy_failed: counts['policy_failed'] ?? 0,
        },
        pendingTotal: pendingCount,
        lastDeliveredAt: lastDeliveredRow?.delivered_at ?? null,
        lastErrorMessage: lastErrorRow?.last_error_message ?? null,
        config: {
          firebaseEndpointSet: Boolean(process.env.FIREBASE_SYNC_ENDPOINT),
          aliasSecretSet: Boolean(process.env.ALIAS_SECRET),
          signingSecretSet: Boolean(process.env.SYNC_SIGNING_SECRET),
        },
      },
    };
  }

  /**
   * POST /sync/trigger — Manually kick off a delivery sweep.
   */
  @Post('trigger')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger sync delivery sweep' })
  async trigger() {
    const processed = await this.syncDelivery.deliverPending();
    return { data: { processed } };
  }

  /**
   * POST /sync/backfill — Enqueue outbox events for transactions that have none.
   * Idempotent: skips transactions that already have an outbox_events row.
   */
  @Post('backfill')
  @HttpCode(200)
  @ApiOperation({ summary: 'Backfill historical transactions to outbox' })
  async backfill(
    @Body(new ZodValidationPipe(backfillSchema)) body: BackfillInput,
  ) {
    const conditions: ReturnType<typeof sql>[] = [
      sql`t.deleted_at IS NULL`,
      sql`t.is_split_parent = false`,
    ];
    if (body.fromDate) conditions.push(sql`t.date >= ${body.fromDate}::date`);
    if (body.toDate) conditions.push(sql`t.date <= ${body.toDate}::date`);
    if (body.accountId) conditions.push(sql`t.account_id = ${body.accountId}::uuid`);

    const whereExpr = conditions.reduce((acc, c) => sql`${acc} AND ${c}`);

    const rows = body.force
      ? await this.db.execute(sql`
          SELECT t.id, t.account_id, t.user_id, t.amount_cents,
                 t.date, t.is_credit, t.category_id, t.tags
          FROM transactions t
          WHERE ${whereExpr}
          ORDER BY t.date ASC
        `)
      : await this.db.execute(sql`
          SELECT t.id, t.account_id, t.user_id, t.amount_cents,
                 t.date, t.is_credit, t.category_id, t.tags
          FROM transactions t
          WHERE ${whereExpr}
            AND NOT EXISTS (
              SELECT 1 FROM outbox_events o
              WHERE o.aggregate_id = t.id::uuid
                AND o.aggregate_type = 'transaction'
            )
          ORDER BY t.date ASC
        `);

    const txns = (rows.rows ?? rows) as Array<{
      id: string;
      account_id: string;
      user_id: string;
      amount_cents: number;
      date: string;
      is_credit: boolean;
      category_id: string | null;
      tags: string[] | null;
    }>;

    let enqueued = 0;
    let skipped = 0;
    let errors = 0;

    for (const txn of txns) {
      try {
        await this.outbox.enqueue({
          eventType: 'transaction.projected.v1',
          aggregateType: 'transaction',
          aggregateId: txn.id,
          userId: txn.user_id,
          payload: {
            transactionAliasId: this.aliasMapper.toAliasId('transaction', txn.id),
            accountAliasId: this.aliasMapper.toAliasId('account', txn.account_id),
            amountCents: txn.amount_cents,
            date: new Date(txn.date).toISOString(),
            categoryId: txn.category_id ?? null,
            isCredit: txn.is_credit,
            isManual: false,
            tags: txn.tags ?? [],
          },
        });
        enqueued++;
      } catch {
        errors++;
      }
    }

    return { data: { enqueued, skipped, errors } };
  }

  /**
   * POST /sync/backfill-categories — Enqueue outbox events for all categories.
   * Forces re-sync so categories use the current userAliasId (Firebase UID).
   */
  @Post('backfill-categories')
  @HttpCode(200)
  @ApiOperation({ summary: 'Backfill all categories to outbox' })
  async backfillCategories() {
    const rows = await this.db.execute(sql`
      SELECT c.id, c.name, c.icon, c.color, c.parent_id, c.sort_order
      FROM categories c
      WHERE c.deleted_at IS NULL
    `);

    const cats = (rows.rows ?? rows) as Array<{
      id: string;
      name: string;
      icon: string;
      color: string;
      parent_id: string | null;
      sort_order: number;
    }>;

    // Need a userId for the outbox — grab the first admin user
    const userRows = await this.db.execute(sql`
      SELECT id FROM users WHERE role = 'admin' LIMIT 1
    `);
    const userId = ((userRows.rows ?? userRows)[0] as any)?.id;
    if (!userId) return { data: { enqueued: 0, errors: 0, reason: 'no admin user found' } };

    let enqueued = 0;
    let errors = 0;

    for (const cat of cats) {
      try {
        await this.outbox.enqueue({
          eventType: 'category.projected.v1',
          aggregateType: 'category',
          aggregateId: cat.id,
          userId,
          payload: {
            categoryId: cat.id,
            name: cat.name,
            icon: cat.icon,
            color: cat.color,
            parentCategoryId: cat.parent_id ?? null,
            sortOrder: cat.sort_order ?? 0,
          },
        });
        enqueued++;
      } catch {
        errors++;
      }
    }

    return { data: { enqueued, errors } };
  }

  /**
   * POST /sync/replay — Reset dead-lettered events back to pending for re-delivery.
   */
  @Post('replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replay dead-lettered sync events' })
  async replay(
    @Body(new ZodValidationPipe(replaySchema)) body: ReplayInput,
  ) {
    let replayed: number;

    if (body.eventIds && body.eventIds.length > 0) {
      const result = await this.db
        .update(schema.outboxEvents)
        .set({
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          deadLetteredAt: null,
          updatedAt: new Date(),
        })
        .where(
          sql`${schema.outboxEvents.status} = 'dead_letter'
            AND ${schema.outboxEvents.id} = ANY(ARRAY[${sql.join(
              body.eventIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}])`,
        )
        .returning({ id: schema.outboxEvents.id });
      replayed = result.length;
    } else {
      const result = await this.db
        .update(schema.outboxEvents)
        .set({
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          deadLetteredAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.outboxEvents.status, 'dead_letter'))
        .returning({ id: schema.outboxEvents.id });
      replayed = result.length;
    }

    return { data: { replayed } };
  }

  /**
   * GET /sync/events — Paginated list of outbox events (metadata only, no payload).
   */
  @Get('events')
  @ApiOperation({ summary: 'List outbox events with pagination and filtering' })
  async events(
    @Query(new ZodValidationPipe(eventsQuerySchema)) query: EventsQuery,
  ) {
    const conditions: ReturnType<typeof sql>[] = [];
    if (query.status) conditions.push(sql`${schema.outboxEvents.status} = ${query.status}`);
    if (query.eventType) conditions.push(sql`${schema.outboxEvents.eventType} = ${query.eventType}`);

    const whereClause =
      conditions.length > 0
        ? conditions.reduce((a, b) => sql`${a} AND ${b}`)
        : sql`TRUE`;

    const offset = (query.page - 1) * query.limit;

    const [countResult, rows] = await Promise.all([
      this.db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM ${schema.outboxEvents}
        WHERE ${whereClause}
      `),
      this.db.execute(sql`
        SELECT id, event_type, aggregate_type, aggregate_id, user_id,
               status, attempts, created_at, delivered_at, last_error_message, last_error_code
        FROM ${schema.outboxEvents}
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${query.limit} OFFSET ${offset}
      `),
    ]);

    const total = Number(((countResult.rows ?? countResult)[0] as any)?.total ?? 0);

    return {
      data: (rows.rows ?? rows),
      total,
      page: query.page,
      pageSize: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
