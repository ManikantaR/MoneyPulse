import { HealthController } from './health.controller';

describe('HealthController', () => {
  const okDb = { execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const okRedis = { ping: vi.fn().mockResolvedValue('PONG') };
  const config = (ollamaUrl?: string) =>
    ({ get: vi.fn().mockReturnValue(ollamaUrl) }) as any;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('live() returns ok without touching any dependency', () => {
    const db = { execute: vi.fn() };
    const redis = { ping: vi.fn() };
    const controller = new HealthController(db, redis as any, config('http://x'));

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(db.execute).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('check() bounds a hanging Ollama call and still reports ok', async () => {
    // fetch that never resolves unless aborted — like a sleeping Ollama host
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ),
    );
    const controller = new HealthController(
      okDb,
      okRedis as any,
      config('http://10.0.0.1:11434'),
    );

    const started = Date.now();
    const result = await controller.check();

    expect(Date.now() - started).toBeLessThan(4000);
    expect(result.status).toBe('ok');
    expect(result.services.ollama).toBe('unavailable');
    expect(result.services.database).toBe('connected');
  });

  it('check() reports degraded when the database hangs', async () => {
    const hangingDb = { execute: vi.fn(() => new Promise(() => {})) };
    const controller = new HealthController(hangingDb, okRedis as any, config());

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('disconnected');
  });
});
