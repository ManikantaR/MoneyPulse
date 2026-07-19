import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as webpush from 'web-push';
import * as schema from '../db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * WebPushService manages self-hosted Web Push (PWA) notifications.
 * Uses VAPID keys for authentication and stores push subscriptions in the database.
 * Fire-and-forget delivery: failures logged but never block the domain write.
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    @Inject(DATABASE_CONNECTION) private readonly db: any,
  ) {
    const vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');

    this.enabled = !!(vapidPublicKey && vapidPrivateKey);

    if (this.enabled) {
      webpush.setVapidDetails(
        this.configService.get<string>('VAPID_EMAIL') || 'mailto:admin@moneypulse.home',
        vapidPublicKey!,
        vapidPrivateKey!,
      );
      this.logger.log('Web Push initialized with VAPID keys');
    } else {
      this.logger.warn('Web Push disabled: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not configured');
    }
  }

  /**
   * Register a new push subscription for a user (from browser).
   * Dedupes on (user_id, endpoint) via unique constraint.
   */
  async subscribe(
    userId: string,
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    },
  ): Promise<{ id: string }> {
    const [subscriptionRow] = await this.db
      .insert(schema.pushSubscriptions)
      .values({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: subscription.userAgent,
      })
      .onConflictDoUpdate({
        target: [schema.pushSubscriptions.userId, schema.pushSubscriptions.endpoint],
        set: {
          userAgent: subscription.userAgent,
          updatedAt: new Date(),
        },
      })
      .returning();

    return { id: subscriptionRow.id };
  }

  /**
   * Unregister (delete) a push subscription.
   */
  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.userId, userId),
          eq(schema.pushSubscriptions.endpoint, endpoint),
        ),
      );
    return true;
  }

  /**
   * Send a push notification to all active subscriptions for a user.
   * Fire-and-forget; returns count of delivery attempts (not successes).
   * Never throws.
   */
  async sendToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      icon?: string;
      badge?: string;
      tag?: string;
      data?: Record<string, string>;
    },
  ): Promise<number> {
    if (!this.enabled) return 0;

    try {
      const subscriptions = await this.db
        .select()
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.userId, userId));

      if (subscriptions.length === 0) return 0;

      const message = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/logo-192x192.png',
        badge: payload.badge || '/badge-72x72.png',
        tag: payload.tag || 'moneypulse-notification',
        data: payload.data || {},
      });

      let successCount = 0;

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            message,
          );
          successCount++;

          // Update last_delivery_at on success
          await this.db
            .update(schema.pushSubscriptions)
            .set({ lastDeliveryAt: new Date() })
            .where(eq(schema.pushSubscriptions.id, sub.id))
            .catch((err: any) => {
              this.logger.warn(
                `Failed to update push subscription delivery timestamp: ${(err as Error).message}`,
              );
            });
        } catch (err: any) {
          const error = err as any;
          // 410 Gone = subscription expired, delete it
          if (error.statusCode === 410) {
            await this.db
              .delete(schema.pushSubscriptions)
              .where(eq(schema.pushSubscriptions.id, sub.id))
              .catch((delErr: any) => {
                this.logger.warn(
                  `Failed to delete expired push subscription: ${(delErr as Error).message}`,
                );
              });
          } else {
            this.logger.warn(
              `Web push delivery failed for user ${userId}: ${(error as Error).message}`,
            );
          }
        }
      }

      return successCount;
    } catch (err) {
      this.logger.warn(`Web push send-to-user error: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Get VAPID public key for client-side subscription.
   */
  getVapidPublicKey(): string | null {
    return this.configService.get<string>('VAPID_PUBLIC_KEY') || null;
  }
}
