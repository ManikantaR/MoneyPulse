import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiLogsService } from '../ai-logs/ai-logs.service';

export const EMBEDDING_MODEL = 'nomic-embed-text';
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Thin client around Ollama's `/api/embeddings` endpoint for the
 * `nomic-embed-text` model (768-dim). Returns `null` on any failure
 * (network error, non-2xx, wrong dimensionality) so callers can treat
 * embedding as best-effort — never throws for "Ollama is unreachable".
 *
 * Runs entirely against the local Ollama instance, so — unlike the cloud
 * advisor providers — no PII pre-redaction is needed before logging; the
 * text never leaves the box.
 */
@Injectable()
export class OllamaEmbeddingService {
  private readonly logger = new Logger(OllamaEmbeddingService.name);
  private readonly ollamaUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly aiLogs: AiLogsService,
  ) {
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
    const startMs = Date.now();
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Ollama embeddings HTTP ${response.status}`);
        this.logPrompt(trimmed, null, startMs);
        return null;
      }
      const data = (await response.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding) || data.embedding.length !== EMBEDDING_DIMENSIONS) {
        this.logger.warn(
          `Unexpected embedding dimensionality: ${data.embedding?.length ?? 'none'}`,
        );
        this.logPrompt(trimmed, null, startMs);
        return null;
      }
      this.logPrompt(trimmed, `[${data.embedding.length}-dim vector]`, startMs);
      return data.embedding;
    } catch (err: any) {
      this.logger.warn(`Ollama embedding request failed: ${err.message}`);
      this.logPrompt(trimmed, null, startMs);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Fire-and-forget: log this embedding call to the database for observability. */
  private logPrompt(inputText: string, outputText: string | null, startMs: number) {
    this.aiLogs
      .create({
        promptType: 'categorization',
        model: EMBEDDING_MODEL,
        inputText,
        outputText: outputText ?? undefined,
        latencyMs: Date.now() - startMs,
        piiDetected: false,
        piiTypesFound: [],
      })
      .catch((err) => this.logger.warn(`Failed to log AI prompt: ${err.message}`));
  }
}
