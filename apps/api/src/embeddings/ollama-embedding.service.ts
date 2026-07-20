import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const EMBEDDING_MODEL = 'nomic-embed-text';
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Thin client around Ollama's `/api/embeddings` endpoint for the
 * `nomic-embed-text` model (768-dim). Returns `null` on any failure
 * (network error, non-2xx, wrong dimensionality) so callers can treat
 * embedding as best-effort — never throws for "Ollama is unreachable".
 */
@Injectable()
export class OllamaEmbeddingService {
  private readonly logger = new Logger(OllamaEmbeddingService.name);
  private readonly ollamaUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.ollamaUrl = this.config.get<string>('OLLAMA_URL') || 'http://localhost:11434';
    this.timeoutMs = parseInt(
      this.config.get<string>('OLLAMA_EMBEDDING_TIMEOUT_MS') || '30000',
      10,
    );
  }

  async embed(text: string): Promise<number[] | null> {
    const trimmed = text?.trim();
    if (!trimmed) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Ollama embeddings HTTP ${response.status}`);
        return null;
      }
      const data = (await response.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding) || data.embedding.length !== EMBEDDING_DIMENSIONS) {
        this.logger.warn(
          `Unexpected embedding dimensionality: ${data.embedding?.length ?? 'none'}`,
        );
        return null;
      }
      return data.embedding;
    } catch (err: any) {
      this.logger.warn(`Ollama embedding request failed: ${err.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
