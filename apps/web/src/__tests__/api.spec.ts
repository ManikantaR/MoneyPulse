import { api, ApiError } from '@/lib/api';

/**
 * Regression coverage for the 2026-07-26 login-lockout bug: api.ts's 401
 * handling used to treat EVERY 401 (including /auth/login's own "wrong
 * password" response) as "session expired, try refreshing" — and treated
 * /auth/refresh's deliberate no-op `{ data: null }` (no refresh_token cookie)
 * as a successful refresh, silently re-firing the original request. For
 * /auth/login specifically this meant every failed login attempt burned TWO
 * hits against ThrottleLoginGuard's per-IP rate limit instead of one.
 */
describe('api request 401 handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not attempt a refresh or retry on /auth/login 401 — surfaces the real message once', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid email or password', error: 'Unauthorized' }),
    });

    await expect(api.post('/auth/login', { email: 'a@b.com', password: 'wrong' })).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid email or password',
    });

    // Exactly one network call — no /auth/refresh, no retried /auth/login.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat /auth/refresh\'s no-op 200 (no cookie) as a successful refresh', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) })
      // /auth/refresh: 200 but data: null — a no-op, not a real refresh.
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: null }) });

    await expect(api.get('/accounts')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Session expired',
    });

    // Original request + the refresh probe — but crucially NO retried /accounts call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries the original request only when refresh reports data.refreshed === true', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { refreshed: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: '1' } }) });

    const result = await api.get('/accounts');

    expect(result).toEqual({ data: { id: '1' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
