import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { WebhookService } from './webhook.service';

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
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly webhookService: WebhookService,
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
    const [notification] = await this.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata
          ? { ...input.metadata, dedupeKey: input.dedupeKey }
          : undefined,
      })
      .returning();

    // Fire webhook asynchronously (don't block)
    this.webhookService
      .sendWebhook(input.userId, {
        event: input.type,
        title: input.title,
        message: input.message,
        ...input.metadata,
      })
      .catch((err) => {
        console.error('Webhook dispatch failed:', err.message);
      });

    return notification;
  }
}
