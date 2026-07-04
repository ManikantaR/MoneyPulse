import { describe, it, expect } from 'vitest';
import { TelegramService } from '../telegram.service';

function make(env: Record<string, string | undefined>) {
  return new TelegramService({ get: (k: string) => env[k] } as any);
}

describe('TelegramService', () => {
  describe('verifySecret', () => {
    it('accepts the correct secret and rejects wrong/short ones', () => {
      const svc = make({ TELEGRAM_WEBHOOK_SECRET: 'super-secret-value' });
      expect(svc.verifySecret('super-secret-value')).toBe(true);
      expect(svc.verifySecret('wrong-secret-value!')).toBe(false);
      expect(svc.verifySecret('short')).toBe(false);
    });

    it('rejects everything when no secret is configured', () => {
      const svc = make({});
      expect(svc.verifySecret('anything')).toBe(false);
    });
  });

  describe('resolveUser', () => {
    it('maps chat ids via the allowlist', () => {
      const svc = make({ TELEGRAM_CHAT_MAP: '111:user-a, 222:user-b' });
      expect(svc.resolveUser(111)).toBe('user-a');
      expect(svc.resolveUser('222')).toBe('user-b');
      expect(svc.resolveUser(999)).toBeNull(); // not in allowlist
    });

    it('falls back to the single default user when no allowlist is set', () => {
      const svc = make({ TELEGRAM_DEFAULT_USER_ID: 'sole-user' });
      expect(svc.resolveUser(12345)).toBe('sole-user');
    });

    it('returns null when neither allowlist nor default is configured', () => {
      const svc = make({});
      expect(svc.resolveUser(12345)).toBeNull();
    });
  });

  it('reports disabled without a bot token', () => {
    expect(make({}).enabled).toBe(false);
    expect(make({ TELEGRAM_BOT_TOKEN: 't' }).enabled).toBe(true);
  });
});
