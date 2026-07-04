import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin Telegram Bot API client + chat→user authorization for the advisor bot.
 * Uses `fetch` (matching the app's Ollama client); no telegraf dependency.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string | undefined;
  private readonly chatMap: Map<string, string>;
  private readonly defaultUserId: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.defaultUserId = this.config.get<string>('TELEGRAM_DEFAULT_USER_ID');
    this.chatMap = this.parseChatMap(this.config.get<string>('TELEGRAM_CHAT_MAP'));
    if (!this.token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram advisor is disabled.');
    }
  }

  get enabled(): boolean {
    return !!this.token;
  }

  private parseChatMap(raw?: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!raw) return map;
    for (const pair of raw.split(',')) {
      const [chatId, userId] = pair.split(':').map((s) => s.trim());
      if (chatId && userId) map.set(chatId, userId);
    }
    return map;
  }

  /** Verify the webhook path secret in constant time. */
  verifySecret(provided: string): boolean {
    const expected = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!expected) return false;
    if (provided.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  }

  /**
   * Map a Telegram chat id to a MoneyPulse user id. Uses the explicit allowlist if
   * configured; otherwise falls back to a single configured user. Returns null for
   * unauthorized chats.
   */
  resolveUser(chatId: string | number): string | null {
    const key = String(chatId);
    if (this.chatMap.size > 0) return this.chatMap.get(key) ?? null;
    return this.defaultUserId ?? null;
  }

  private async api(method: string, body: Record<string, unknown>): Promise<void> {
    if (!this.token) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.logger.warn(`Telegram ${method} failed: ${res.status}`);
      }
    } catch (err: any) {
      this.logger.warn(`Telegram ${method} error: ${err.message}`);
    }
  }

  sendTyping(chatId: string | number): Promise<void> {
    return this.api('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  sendMessage(chatId: string | number, text: string): Promise<void> {
    return this.api('sendMessage', { chat_id: chatId, text });
  }
}
