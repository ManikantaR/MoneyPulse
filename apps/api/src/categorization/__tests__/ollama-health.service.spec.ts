import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaHealthService } from '../ollama-health.service';

function makeService(ollamaUrl = 'http://10.0.0.1:11434') {
  const config = {
    get: (key: string) => {
      if (key === 'OLLAMA_URL') return ollamaUrl;
      if (key === 'OLLAMA_HEALTH_CACHE_TTL_MS') return '30000';
      if (key === 'OLLAMA_PROBE_TIMEOUT_MS') return '2000';
      return undefined;
    },
  };
  return new OllamaHealthService(config as any);
}

describe('OllamaHealthService', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns true when /api/tags responds with 2xx', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true });
    const svc = makeService();

    const result = await svc.isAvailable();

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://10.0.0.1:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns false when the probe fails with a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const svc = makeService();

    const result = await svc.isAvailable();

    expect(result).toBe(false);
  });

  it('returns false when /api/tags responds with non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503 });
    const svc = makeService();

    const result = await svc.isAvailable();

    expect(result).toBe(false);
  });

  it('returns false when the probe times out (AbortError)', async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );
    const svc = makeService();

    const result = await svc.isAvailable();

    expect(result).toBe(false);
  });

  it('caches the result within TTL — does not re-probe', async () => {
    fetchSpy.mockResolvedValue({ ok: true });
    const svc = makeService();

    // First call probes
    await svc.isAvailable();
    // Second call within TTL should use cache
    const result = await svc.isAvailable();

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-probes after the cache TTL expires', async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: true })   // first probe: up
      .mockResolvedValueOnce({ ok: false });  // second probe: down

    const svc = makeService();

    const first = await svc.isAvailable();
    expect(first).toBe(true);

    // Advance past the 30s TTL
    vi.advanceTimersByTime(31_000);

    const second = await svc.isAvailable();
    expect(second).toBe(false);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache() forces a fresh probe on the next call', async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });

    const svc = makeService();

    await svc.isAvailable(); // caches true
    svc.invalidateCache();
    const result = await svc.isAvailable(); // forced re-probe

    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('uses the configured OLLAMA_URL in the probe URL', async () => {
    fetchSpy.mockResolvedValue({ ok: true });
    const svc = makeService('http://192.168.1.100:11434');

    await svc.isAvailable();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://192.168.1.100:11434/api/tags',
      expect.any(Object),
    );
  });
});
