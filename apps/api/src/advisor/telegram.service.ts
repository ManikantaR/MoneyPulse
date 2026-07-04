import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdvisorService, ADVISOR_DISCLAIMER } from './advisor.service';

/** Minimal shape of a Telegram update we consume from getUpdates. */
interface TelegramUpdate {
  update_id: number;
  message?: {
    chat?: { id: number | string };
    text?: string;
  };
}

/** Long-poll wait (seconds) the Telegram server holds a getUpdates request open. */
const POLL_TIMEOUT_S = 30;
/** Backoff after a polling error before retrying. */
const ERROR_BACKOFF_MS = 5000;

/**
 * Telegram advisor bot over **long-polling** — the API dials OUT to api.telegram.org
 * and pulls updates via getUpdates. Nothing inbound is ever exposed, which is required
 * here: MoneyPulse is LAN-only and never publicly reachable, so an inbound webhook could
 * never be delivered. Authorization is the chat→user allowlist. Answers come from the same
 * AdvisorService as the web surface. Uses `fetch` (matching the Ollama client); no telegraf.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string | undefined;
  private readonly chatMap: Map<string, string>;
  private readonly defaultUserId: string | undefined;

  private running = false;
  private offset = 0;
  private abort?: AbortController;

  constructor(
    private readonly config: ConfigService,
    private readonly advisor: AdvisorService,
  ) {
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

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    // A previously-registered webhook blocks getUpdates — clear it before polling.
    await this.call('deleteWebhook', { drop_pending_updates: false });
    this.running = true;
    void this.pollLoop();
    this.logger.log('Telegram advisor started (long-polling).');
  }

  onModuleDestroy(): void {
    this.running = false;
    this.abort?.abort();
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

  // ── Polling loop ────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        this.abort = new AbortController();
        const updates = await this.call<TelegramUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: POLL_TIMEOUT_S },
          this.abort.signal,
        );
        if (!updates) {
          if (this.running) await this.sleep(ERROR_BACKOFF_MS);
          continue;
        }
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.dispatch(update);
        }
      } catch (err: any) {
        if (!this.running) break; // aborted on shutdown
        this.logger.warn(`Telegram poll error: ${err.message}`);
        await this.sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  private async dispatch(update: TelegramUpdate): Promise<void> {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim();
    if (chatId == null || !text) return;

    const userId = this.resolveUser(chatId);
    if (!userId) {
      await this.sendMessage(chatId, 'This chat is not linked to a MoneyPulse account.');
      return;
    }

    await this.sendTyping(chatId);
    try {
      const answer = await this.advisor.chat(userId, text);
      await this.sendMessage(chatId, `${answer}\n\n— ${ADVISOR_DISCLAIMER}`);
    } catch (err: any) {
      this.logger.warn(`Advisor (telegram) failed: ${err.message}`);
      await this.sendMessage(chatId, "Sorry — I couldn't answer that right now.");
    }
  }

  // ── Telegram Bot API ────────────────────────────────────────

  /** Call a Bot API method; returns the parsed `result`, or null on any failure. */
  private async call<T = unknown>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = 10000,
  ): Promise<T | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        this.logger.warn(`Telegram ${method} failed: ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { ok: boolean; result: T };
      return json.ok ? json.result : null;
    } catch (err: any) {
      // A getUpdates abort during shutdown is expected — stay quiet for that case.
      if (this.running || method !== 'getUpdates') {
        this.logger.warn(`Telegram ${method} error: ${err.message}`);
      }
      return null;
    }
  }

  sendTyping(chatId: string | number): Promise<unknown> {
    return this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  sendMessage(chatId: string | number, text: string): Promise<unknown> {
    return this.call('sendMessage', { chat_id: chatId, text });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
