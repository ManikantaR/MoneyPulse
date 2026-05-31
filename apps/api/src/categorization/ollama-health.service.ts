import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Lightweight liveness probe for the Ollama endpoint.
 *
 * Caches the result for `cacheTtlMs` (default 30 s) to avoid hammering
 * a sleeping or unreachable Mac with a probe on every queued job.
 *
 * Used by IngestionProcessor before attempting AI categorization:
 *   - false → throw so BullMQ retries with backoff (Ollama sleeping)
 *   - true  → proceed with categorizeBatch
 *
 * Also consulted by the ai-reconcile sweep: if unavailable, skip entirely
 * to prevent queue churn while the Mac is asleep.
 */
@Injectable()
export class OllamaHealthService {
  private readonly logger = new Logger(OllamaHealthService.name);
  private readonly ollamaUrl: string;
  private readonly cacheTtlMs: number;
  private readonly probeTimeoutMs: number;

  private cachedResult: boolean | null = null;
  private cacheExpiresAt = 0;

  constructor(private readonly config: ConfigService) {
    this.ollamaUrl =
      this.config.get<string>('OLLAMA_URL') ?? 'http://localhost:11434';
    this.cacheTtlMs = parseInt(
      this.config.get<string>('OLLAMA_HEALTH_CACHE_TTL_MS') ?? '30000',
      10,
    );
    this.probeTimeoutMs = parseInt(
      this.config.get<string>('OLLAMA_PROBE_TIMEOUT_MS') ?? '2000',
      10,
    );
  }

  /**
   * Returns true if Ollama's /api/tags endpoint responds with HTTP 2xx.
   * Result is cached for `cacheTtlMs` to avoid hammering a sleeping host.
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now < this.cacheExpiresAt && this.cachedResult !== null) {
      return this.cachedResult;
    }

    let result = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      result = response.ok;
    } catch {
      result = false;
    } finally {
      clearTimeout(timeout);
    }

    this.cachedResult = result;
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    this.logger.debug(`Ollama health probe: ${result ? 'available' : 'unavailable'}`);
    return result;
  }

  /** Force the cache to expire on the next call (useful for testing). */
  invalidateCache(): void {
    this.cacheExpiresAt = 0;
    this.cachedResult = null;
  }
}
