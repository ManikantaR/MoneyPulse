import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { decryptField } from '../common/crypto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly ALLOWED_PROTOCOLS = ['https:', 'http:'];

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  private getAllowedHosts(): Set<string> {
    const raw = process.env.HA_WEBHOOK_ALLOWED_HOSTS ?? '';
    return new Set(
      raw
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  isUrlSafe(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      if (!this.ALLOWED_PROTOCOLS.includes(url.protocol)) return false;
      const hostname = url.hostname.toLowerCase();

      // Explicit HA allowlist takes priority over the private-IP block
      if (this.getAllowedHosts().has(hostname)) return true;

      // Block private/internal IPs (SSRF guard)
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
  ): Promise<boolean> {
    const settings = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);

    const webhookUrl = settings[0]?.haWebhookUrl;
    if (!webhookUrl) return false;

    // Decrypt the stored (encrypted) webhook URL
    const decryptedUrl = decryptField(webhookUrl);
    if (!decryptedUrl) return false;

    if (!this.isUrlSafe(decryptedUrl)) {
      this.logger.warn(`Blocked unsafe webhook URL for user ${userId}`);
      return false;
    }

    try {
      const res = await fetch(decryptedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.logger.warn(`Webhook returned ${res.status} for user ${userId}`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Webhook failed for user ${userId}: ${err.message}`);
      return false;
    }
  }
}
