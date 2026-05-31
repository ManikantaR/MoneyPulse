import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { WebhookService } from './webhook.service';
import { OutboxService } from '../sync/outbox.service';
import { AliasMapperService } from '../sync/alias-mapper.service';

interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  dedupeKey?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly outbox: OutboxService,
    private readonly aliasMapper: AliasMapperService,
  ) {}

  async findByUser(userId: string, limit = 50) {
    return this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM ${schema.notifications}
      WHERE user_id = ${userId} AND is_read = false
    `);
    return (rows.rows ?? rows)[0]?.count ?? 0;
  }

  async markRead(id: string, userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userId, userId),
        ),
      );
  }

  async markAllRead(userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.isRead, false),
        ),
      );
  }

  async findByMetadata(userId: string, dedupeKey: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      SELECT 1 FROM ${schema.notifications}
      WHERE user_id = ${userId}
        AND metadata->>'dedupeKey' = ${dedupeKey}
      LIMIT 1
    `);
    return (rows.rows ?? rows).length > 0;
  }

  async createAndDispatch(input: CreateNotificationInput) {
    // Domain write — must always succeed
    const [notification] = await this.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: {
          ...(input.metadata ?? {}),
          ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        },
      })
      .returning();

    // Best-effort outbox projection — never blocks the domain write
    try {
      await this.outbox.enqueue({
        eventType: 'notification.projected.v1',
        aggregateType: 'notification',
        aggregateId: notification.id,
        userId: input.userId,
        payload: {
          notificationAliasId: this.aliasMapper.toAliasId('notification', notification.id),
          type: notification.type,
          title: notification.title,
          body: notification.message, // web contract uses 'body', not 'message'
        },
      });
    } catch (err) {
      this.logger.warn(`notification outbox enqueue failed: ${(err as Error).message}`);
    }

    // Best-effort HA webhook — fire-and-forget; webhookSent updated only on 2xx
    const notificationId = notification.id;
    this.webhookService
      .sendWebhook(input.userId, {
        title: input.title,
        message: input.message,
        type: input.type,
      })
      .then((delivered) => {
        if (delivered) {
          return this.db
            .update(schema.notifications)
            .set({ webhookSent: true })
            .where(eq(schema.notifications.id, notificationId));
        }
      })
      .catch((err: Error) => {
        this.logger.warn(`HA webhook dispatch error: ${err.message}`);
      });

    return notification;
  }
}
