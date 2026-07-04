import { describe, it, expect, vi, afterEach } from 'vitest';
import { TelegramService } from '../telegram.service';

function make(
  env: Record<string, string | undefined>,
  advisor: { chat: (...a: any[]) => Promise<string> } = { chat: vi.fn() },
) {
  return new TelegramService({ get: (k: string) => env[k] } as any, advisor as any);
}

/** Capture Telegram Bot API calls by stubbing global fetch. */
function stubFetch() {
  const calls: Array<{ method: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init: any) => {
    const method = String(url).split('/').pop()!;
    calls.push({ method, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true, result: [] }) } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('TelegramService', () => {
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

  describe('dispatch (polling handler)', () => {
    it('answers an allowlisted chat with the advisor reply + disclaimer', async () => {
      const calls = stubFetch();
      const advisor = { chat: vi.fn().mockResolvedValue('You spent $12.00 on coffee.') };
      const svc = make(
        { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_MAP: '111:user-a' },
        advisor,
      );

      await (svc as any).dispatch({
        update_id: 1,
        message: { chat: { id: 111 }, text: 'coffee this week?' },
      });

      expect(advisor.chat).toHaveBeenCalledWith('user-a', 'coffee this week?');
      const sent = calls.find((c) => c.method === 'sendMessage')!;
      expect(sent.body.chat_id).toBe(111);
      expect(sent.body.text).toContain('You spent $12.00 on coffee.');
      expect(sent.body.text).toContain('—'); // disclaimer appended
    });

    it('rejects an unlinked chat without invoking the advisor', async () => {
      const calls = stubFetch();
      const advisor = { chat: vi.fn() };
      const svc = make({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_MAP: '111:user-a' }, advisor);

      await (svc as any).dispatch({
        update_id: 2,
        message: { chat: { id: 999 }, text: 'hi' },
      });

      expect(advisor.chat).not.toHaveBeenCalled();
      const sent = calls.find((c) => c.method === 'sendMessage')!;
      expect(sent.body.text).toMatch(/not linked/i);
    });

    it('ignores updates with no text', async () => {
      const calls = stubFetch();
      const advisor = { chat: vi.fn() };
      const svc = make({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_DEFAULT_USER_ID: 'u' }, advisor);

      await (svc as any).dispatch({ update_id: 3, message: { chat: { id: 1 } } });

      expect(advisor.chat).not.toHaveBeenCalled();
      expect(calls.length).toBe(0);
    });
  });
});
