import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, desc, sql, isNull, inArray } from 'drizzle-orm';
import { WebhookService } from './webhook.service';
import { TelegramPushService } from './telegram-push.service';
import { WebPushService } from './web-push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { OutboxService } from '../sync/outbox.service';
import { AliasMapperService } from '../sync/alias-mapper.service';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  severity?: 'info' | 'insight' | 'warning' | 'critical';
  source?: 'watchdog' | 'freshness' | 'market' | 'advisor' | 'budget' | 'system';
  data?: Record<string, any>;
  voiceSummary?: string;
  dedupeKey?: string;
  metadata?: Record<string, any>;
  notificationType?: string; // Maps to notification_preferences.notification_type
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly telegramPush: TelegramPushService,
    private readonly webPush: WebPushService,
    private readonly preferencesService: NotificationPreferencesService,
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

  /**
   * Get insights feed (reverse-chron, undismissed only by default).
   */
  async getInsightsFeed(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      severityFilter?: string[]; // ['warning', 'critical', ...]
      sourceFilter?: string[]; // ['watchdog', 'freshness', ...]
      includeDismissed?: boolean;
    } = {},
  ) {
    const {
      limit = 50,
      offset = 0,
      severityFilter,
      sourceFilter,
      includeDismissed = false,
    } = options;

    const conditions = [eq(schema.notifications.userId, userId)];

    if (!includeDismissed) {
      conditions.push(isNull(schema.notifications.dismissedAt));
    }

    if (severityFilter && severityFilter.length > 0) {
      conditions.push(
        inArray(
          schema.notifications.severity,
          severityFilter as Array<'info' | 'insight' | 'warning' | 'critical'>,
        ),
      );
    }

    if (sourceFilter && sourceFilter.length > 0) {
      conditions.push(
        inArray(
          schema.notifications.source,
          sourceFilter as Array<
            'watchdog' | 'freshness' | 'market' | 'advisor' | 'budget' | 'system'
          >,
        ),
      );
    }

    const whereClause = and(...conditions);

    const total = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(whereClause);

    const data = await this.db
      .select()
      .from(schema.notifications)
      .where(whereClause)
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data,
      total: total[0]?.count ?? 0,
      limit,
      offset,
    };
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

  /** Permanently dismiss (delete) a single notification owned by the user. */
  async remove(id: string, userId: string) {
    await this.db
      .delete(schema.notifications)
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

  /**
   * Dismiss (mark with dismissedAt timestamp) a notification.
   */
  async dismiss(id: string, userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userId, userId),
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
        severity: input.severity ?? 'insight',
        source: input.source ?? 'system',
        data: input.data ?? {},
        metadata: {
          ...(input.metadata ?? {}),
          ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
          ...(input.voiceSummary ? { voiceSummary: input.voiceSummary } : {}),
        },
      })
      .returning();

    // Dispatch through preference-aware channels (best-effort, never blocks domain write)
    void this.dispatch(notification.id, input.userId, input.notificationType ?? 'system_alert', {
      title: input.title,
      message: input.message,
      voiceSummary: input.voiceSummary,
      severity: input.severity ?? 'insight',
      data: input.data ?? {},
    });

    // Best-effort outbox projection for moneypulse-web sync
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

    return notification;
  }

  /**
   * Dispatch a notification through configured channels based on user preferences.
   * Never throws or blocks; all errors logged but swallowed.
   * Respects quiet hours and brief batching mode.
   */
  private async dispatch(
    notificationId: string,
    userId: string,
    notificationType: string,
    payload: {
      title: string;
      message: string;
      voiceSummary?: string;
      severity: string;
      data: Record<string, any>;
    },
  ): Promise<void> {
    try {
      // Get user's preferences
      const prefs = await this.preferencesService.getPreference(userId, notificationType as any);

      // If disabled, skip all dispatch
      if (prefs.mode === 'off') return;

      // Check quiet hours
      const inQuietHours = await this.preferencesService.isInQuietHours(userId);

      // If brief mode or in quiet hours, queue for batch delivery (for 11.4 brief digest)
      if (prefs.mode === 'brief' || (inQuietHours && prefs.mode === 'instant')) {
        // TODO(11.4): Enqueue into BullMQ brief-digest queue
        this.logger.debug(
          `Notification ${notificationId} queued for brief digest (mode=${prefs.mode}, quiet=${inQuietHours})`,
        );
        return;
      }

      // Instant delivery: route through enabled channels
      const channels = Array.isArray(prefs.enabledChannels)
        ? prefs.enabledChannels
        : JSON.parse(prefs.enabledChannels as any as string);

      // inApp is implicit (always shown in feed)
      // Route to other channels in parallel (fire-and-forget)
      for (const channel of channels) {
        if (channel === 'inApp') continue; // Already in DB

        if (channel === 'telegram') {
          // Check if user has enabled Telegram notifications
          if (this.telegramPush.enabled) {
            this.db
              .select({ enabled: schema.userSettings.telegramNotificationsEnabled })
              .from(schema.userSettings)
              .where(eq(schema.userSettings.userId, userId))
              .limit(1)
              .then((rows: any) => {
                if (rows[0]?.enabled) {
                  const text = `${payload.title}\n\n${payload.message}`;
                  return this.telegramPush.sendToUser(userId, text);
                }
              })
              .catch((err: any) => {
                this.logger.warn(`Telegram dispatch error: ${(err as Error).message}`);
              });
          }
        } else if (channel === 'webPush') {
          this.webPush
            .sendToUser(userId, {
              title: payload.title,
              body: payload.message,
              tag: notificationType,
              data: {
                notificationId,
                severity: payload.severity,
                ...payload.data,
              },
            })
            .catch((err: any) => {
              this.logger.warn(`Web Push dispatch error: ${(err as Error).message}`);
            });
        } else if (channel === 'haWebhook') {
          this.webhookService
            .sendWebhook(userId, {
              title: payload.title,
              message: payload.message,
              type: notificationType,
              voiceSummary: payload.voiceSummary,
            })
            .then((delivered) => {
              if (delivered) {
                this.db
                  .update(schema.notifications)
                  .set({ webhookSent: true })
                  .where(eq(schema.notifications.id, notificationId))
                  .catch((err: any) => {
                    this.logger.warn(
                      `Failed to mark webhook as sent: ${(err as Error).message}`,
                    );
                  });
              }
            })
            .catch((err: Error) => {
              this.logger.warn(`HA webhook dispatch error: ${err.message}`);
            });
        }
        // TODO(11.3): email channel
      }
    } catch (err) {
      this.logger.warn(`Dispatch routing error: ${(err as Error).message}`);
    }
  }

  /**
   * Push a notification to the user's Telegram chat when they've opted in
   * (user_settings.telegram_notifications_enabled) and a bot token is configured.
   * Never throws — notification delivery must not block the domain write. #79
   */
  private async pushToTelegram(input: CreateNotificationInput): Promise<void> {
    if (!this.telegramPush.enabled) return;
    try {
      const rows = await this.db
        .select({ enabled: schema.userSettings.telegramNotificationsEnabled })
        .from(schema.userSettings)
        .where(eq(schema.userSettings.userId, input.userId))
        .limit(1);
      if (!rows[0]?.enabled) return;

      const text = `${input.title}\n\n${input.message}`;
      await this.telegramPush.sendToUser(input.userId, text);
    } catch (err) {
      this.logger.warn(`Telegram push dispatch error: ${(err as Error).message}`);
    }
  }
}
