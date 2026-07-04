import { Controller, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AdvisorService, ADVISOR_DISCLAIMER } from './advisor.service';

/** Minimal shape of a Telegram update we care about. */
interface TelegramUpdate {
  message?: {
    chat?: { id: number | string };
    text?: string;
  };
}

/**
 * Public webhook for the Telegram advisor bot. Not JWT-guarded (Telegram calls it) —
 * authorized by the path secret + chat→user allowlist. Answers are produced by the
 * same AdvisorService as the web surface.
 */
@ApiTags('Advisor')
@Controller('advisor/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly advisor: AdvisorService,
  ) {}

  @Post('webhook/:secret')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram bot webhook (secret-guarded)' })
  async webhook(
    @Param('secret') secret: string,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: boolean }> {
    // Always 200 quickly so Telegram doesn't retry; reject unauthorized silently.
    if (!this.telegram.verifySecret(secret)) return { ok: true };

    const chatId = update?.message?.chat?.id;
    const text = update?.message?.text?.trim();
    if (chatId == null || !text) return { ok: true };

    const userId = this.telegram.resolveUser(chatId);
    if (!userId) {
      await this.telegram.sendMessage(chatId, 'This chat is not linked to a MoneyPulse account.');
      return { ok: true };
    }

    // Process asynchronously — advisor calls can take several seconds; don't block
    // the webhook response (Telegram would time out and retry).
    void this.handle(chatId, userId, text);
    return { ok: true };
  }

  private async handle(
    chatId: number | string,
    userId: string,
    text: string,
  ): Promise<void> {
    await this.telegram.sendTyping(chatId);
    try {
      const answer = await this.advisor.chat(userId, text);
      await this.telegram.sendMessage(chatId, `${answer}\n\n— ${ADVISOR_DISCLAIMER}`);
    } catch (err: any) {
      this.logger.warn(`Advisor (telegram) failed: ${err.message}`);
      await this.telegram.sendMessage(
        chatId,
        "Sorry — I couldn't answer that right now.",
      );
    }
  }
}
