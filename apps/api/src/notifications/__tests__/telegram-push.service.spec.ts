import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TelegramPushService } from '../telegram-push.service';

/** Build a service with a fake ConfigService backed by a plain map. */
function make(env: Record<string, string | undefined>): TelegramPushService {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new TelegramPushService(config);
}

describe('TelegramPushService', () => {
  it('is disabled without a bot token', () => {
    const svc = make({});
    expect(svc.enabled).toBe(false);
  });

  it('is enabled once a token is present', () => {
    const svc = make({ TELEGRAM_BOT_TOKEN: 't' });
    expect(svc.enabled).toBe(true);
  });

  it('returns false (no chats) for an unmapped user', async () => {
    const svc = make({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_MAP: '111:user-a' });
    // user-b has no chat → nothing sent, no fetch attempted.
    await expect(svc.sendToUser('user-b', 'hi')).resolves.toBe(false);
  });

  it('returns false when disabled even if the user is mapped', async () => {
    const svc = make({ TELEGRAM_CHAT_MAP: '111:user-a' });
    await expect(svc.sendToUser('user-a', 'hi')).resolves.toBe(false);
  });

  it('maps multiple chats to the same user (inverted allowlist)', () => {
    const svc = make({
      TELEGRAM_BOT_TOKEN: 't',
      TELEGRAM_CHAT_MAP: '111:user-a, 222:user-a, 333:user-b',
    });
    // @ts-expect-error private access for the inversion assertion
    expect(svc.chatsForUser('user-a')).toEqual(['111', '222']);
    // @ts-expect-error private access for the inversion assertion
    expect(svc.chatsForUser('user-b')).toEqual(['333']);
  });

  it('falls back to the default chat for the single configured default user', () => {
    const svc = make({
      TELEGRAM_BOT_TOKEN: 't',
      TELEGRAM_DEFAULT_USER_ID: 'user-solo',
      TELEGRAM_DEFAULT_CHAT_ID: '999',
    });
    // @ts-expect-error private access
    expect(svc.chatsForUser('user-solo')).toEqual(['999']);
    // @ts-expect-error private access
    expect(svc.chatsForUser('someone-else')).toEqual([]);
  });
});
