import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { and, eq } from 'drizzle-orm';

export interface NotificationPreference {
  id: string;
  userId: string;
  notificationType: string;
  mode: 'instant' | 'brief' | 'off';
  enabledChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationType = typeof schema.notificationTypeEnum.enumValues[number];
export type NotificationChannel = typeof schema.notificationChannelEnum.enumValues[number];

/**
 * Default notification preferences: sensible defaults per type.
 * All default to 'instant' mode with 'inApp' channel.
 */
const DEFAULT_PREFERENCES: Record<NotificationType, {
  mode: 'instant' | 'brief' | 'off';
  enabledChannels: NotificationChannel[];
}> = {
  loan_payment_due: { mode: 'instant', enabledChannels: ['inApp', 'telegram', 'haWebhook'] },
  loan_payment_missed: { mode: 'instant', enabledChannels: ['inApp', 'telegram', 'haWebhook'] },
  bill_due: { mode: 'instant', enabledChannels: ['inApp', 'telegram'] },
  budget_overage: { mode: 'brief', enabledChannels: ['inApp', 'email'] },
  anomaly_detected: { mode: 'instant', enabledChannels: ['inApp'] },
  data_freshness: { mode: 'brief', enabledChannels: ['inApp'] },
  market_event: { mode: 'off', enabledChannels: ['inApp'] },
  advisor_insight: { mode: 'brief', enabledChannels: ['inApp', 'email'] },
  system_alert: { mode: 'instant', enabledChannels: ['inApp'] },
  // The brief message itself always dispatches "instant" (at the user's configured hour) —
  // it IS the batched delivery, so it must never be re-deferred into another brief.
  daily_brief: { mode: 'instant', enabledChannels: ['inApp', 'telegram', 'webPush'] },
};

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Get all preferences for a user; seed missing types with defaults.
   */
  async getPreferencesForUser(userId: string): Promise<NotificationPreference[]> {
    const existing = await this.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));

    const existingTypes = new Set(
      existing.map((p: any) => p.notificationType),
    );

    // Seed any missing types with defaults
    const toInsert = (
      Object.entries(DEFAULT_PREFERENCES) as Array<[NotificationType, typeof DEFAULT_PREFERENCES[NotificationType]]>
    )
      .filter(([type]) => !existingTypes.has(type))
      .map(([type, defaults]) => ({
        userId,
        notificationType: type,
        mode: defaults.mode,
        enabledChannels: defaults.enabledChannels,
      }));

    if (toInsert.length > 0) {
      try {
        await this.db.insert(schema.notificationPreferences).values(toInsert);
      } catch (err) {
        this.logger.warn(
          `Failed to seed notification preferences: ${(err as Error).message}`,
        );
      }
    }

    // Fetch all again
    return this.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId));
  }

  /**
   * Get a single preference or default.
   */
  async getPreference(
    userId: string,
    notificationType: NotificationType,
  ): Promise<NotificationPreference> {
    const rows = await this.db
      .select()
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.userId, userId),
          eq(schema.notificationPreferences.notificationType, notificationType),
        ),
      )
      .limit(1);

    if (rows.length > 0) {
      return rows[0];
    }

    // Return default
    const defaults = DEFAULT_PREFERENCES[notificationType];
    return {
      id: '', // Will be created on first update
      userId,
      notificationType,
      mode: defaults.mode,
      enabledChannels: defaults.enabledChannels,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Update a user's preference.
   */
  async updatePreference(
    userId: string,
    notificationType: NotificationType,
    update: {
      mode?: 'instant' | 'brief' | 'off';
      enabledChannels?: NotificationChannel[];
    },
  ): Promise<NotificationPreference> {
    const existing = await this.getPreference(userId, notificationType);

    const [updated] = await this.db
      .insert(schema.notificationPreferences)
      .values({
        userId,
        notificationType,
        mode: update.mode ?? existing.mode,
        enabledChannels: update.enabledChannels ?? existing.enabledChannels,
      })
      .onConflictDoUpdate({
        target: [
          schema.notificationPreferences.userId,
          schema.notificationPreferences.notificationType,
        ],
        set: {
          mode: update.mode ?? existing.mode,
          enabledChannels: update.enabledChannels ?? existing.enabledChannels,
          updatedAt: new Date(),
        },
      })
      .returning();

    return updated;
  }

  /**
   * Get user's quiet hours.
   */
  async getQuietHours(
    userId: string,
  ): Promise<{ start: string; end: string }> {
    const rows = await this.db
      .select({
        quietHoursStart: schema.userSettings.quietHoursStart,
        quietHoursEnd: schema.userSettings.quietHoursEnd,
      })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);

    if (rows.length > 0) {
      return {
        start: rows[0].quietHoursStart || '22:00',
        end: rows[0].quietHoursEnd || '08:00',
      };
    }

    return { start: '22:00', end: '08:00' };
  }

  /**
   * Update user's quiet hours.
   */
  async updateQuietHours(
    userId: string,
    start: string,
    end: string,
  ): Promise<{ start: string; end: string }> {
    await this.db
      .update(schema.userSettings)
      .set({
        quietHoursStart: start,
        quietHoursEnd: end,
        updatedAt: new Date(),
      })
      .where(eq(schema.userSettings.userId, userId));

    return { start, end };
  }

  /**
   * Check if we're currently in quiet hours for a user.
   */
  async isInQuietHours(userId: string): Promise<boolean> {
    const { start, end } = await this.getQuietHours(userId);

    // Parse HH:MM
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    // If start > end (e.g., 22:00-08:00), it spans midnight
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    } else {
      return currentTime >= startTime && currentTime < endTime;
    }
  }
}
