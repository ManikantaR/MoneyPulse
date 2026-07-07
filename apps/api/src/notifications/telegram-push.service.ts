import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Outbound-only Telegram push, used to deliver notifications (digests, missed-payment
 * nudges, alerts) to a user's chat. Deliberately depends on nothing but ConfigService so
 * it can live in NotificationsModule without the circular dependency that injecting the
 * inbound advisor {@link TelegramService} (in AdvisorModule → NotificationsModule) would
 * create. Reuses the same TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_MAP as the advisor bot, but
 * resolves the mapping in reverse (userId → chatIds). LAN-safe: dials OUT only.
 */
@Injectable()
export class TelegramPushService {
  private readonly logger = new Logger(TelegramPushService.name);
  private readonly token: string | undefined;
  /** userId → chatIds (a user may have more than one linked chat). */
  private readonly userToChats: Map<string, string[]>;
  private readonly defaultUserId: string | undefined;
  private readonly defaultChatId: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.defaultUserId = this.config.get<string>('TELEGRAM_DEFAULT_USER_ID');
    this.defaultChatId = this.config.get<string>('TELEGRAM_DEFAULT_CHAT_ID');
    this.userToChats = this.parseChatMap(this.config.get<string>('TELEGRAM_CHAT_MAP'));
  }

  get enabled(): boolean {
    return !!this.token;
  }

  /** Invert the `chatId:userId,...` allowlist into userId → [chatId, ...]. */
  private parseChatMap(raw?: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!raw) return map;
    for (const pair of raw.split(',')) {
      const [chatId, userId] = pair.split(':').map((s) => s.trim());
      if (chatId && userId) {
        map.set(userId, [...(map.get(userId) ?? []), chatId]);
      }
    }
    return map;
  }

  /** Resolve the chat ids to push to for a given MoneyPulse user. */
  private chatsForUser(userId: string): string[] {
    const mapped = this.userToChats.get(userId);
    if (mapped && mapped.length > 0) return mapped;
    // Single-user fallback: if this user is the configured default, use the default chat.
    if (this.defaultUserId && userId === this.defaultUserId && this.defaultChatId) {
      return [this.defaultChatId];
    }
    return [];
  }

  /**
   * Best-effort push of a message to every chat linked to `userId`. Returns true if at
   * least one chat was delivered to. Never throws — notification delivery must not block
   * the domain write.
   */
  async sendToUser(userId: string, text: string): Promise<boolean> {
    if (!this.token) return false;
    const chats = this.chatsForUser(userId);
    if (chats.length === 0) return false;

    let delivered = false;
    for (const chatId of chats) {
      const ok = await this.send(chatId, text);
      delivered = delivered || ok;
    }
    return delivered;
  }

  private async send(chatId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Telegram push failed for chat ${chatId}: ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram push error for chat ${chatId}: ${(err as Error).message}`);
      return false;
    }
  }
}
