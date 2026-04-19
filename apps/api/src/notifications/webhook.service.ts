import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly ALLOWED_PROTOCOLS = ['https:', 'http:'];

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  private isUrlSafe(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      if (!this.ALLOWED_PROTOCOLS.includes(url.protocol)) return false;
      // Block private/internal IPs
      const hostname = url.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        hostname.endsWith('.internal') ||
        hostname.endsWith('.local')
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async sendWebhook(
    userId: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const settings = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);

    const webhookUrl = settings[0]?.haWebhookUrl;
    if (!webhookUrl) return;

    if (!this.isUrlSafe(webhookUrl)) {
      this.logger.warn(`Blocked unsafe webhook URL for user ${userId}`);
      return;
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.logger.warn(`Webhook returned ${res.status} for user ${userId}`);
      }
    } catch (err: any) {
      this.logger.error(`Webhook failed for user ${userId}: ${err.message}`);
    }
  }
}
