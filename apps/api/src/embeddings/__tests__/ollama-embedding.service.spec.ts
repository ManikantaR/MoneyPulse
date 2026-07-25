import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OllamaEmbeddingService, EMBEDDING_MODEL } from '../ollama-embedding.service';

const mockConfig = { get: vi.fn(() => undefined) };
const mockAiLogs = { create: vi.fn().mockResolvedValue({ id: 1 }) };

function makeService() {
  return new OllamaEmbeddingService(mockConfig as any, mockAiLogs as any);
}

describe('OllamaEmbeddingService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAiLogs.create.mockClear();
  });

  it('logs a successful embedding call to ai_prompt_logs with model + latency', async () => {
    const embedding = Array(768).fill(0.01);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding }),
      }),
    );

    const svc = makeService();
    const result = await svc.embed('Starbucks purchase');

    expect(result).toEqual(embedding);
    expect(mockAiLogs.create).toHaveBeenCalledTimes(1);
    const dto = mockAiLogs.create.mock.calls[0][0];
    expect(dto.promptType).toBe('categorization');
    expect(dto.model).toBe(EMBEDDING_MODEL);
    expect(dto.inputText).toBe('Starbucks purchase');
    expect(dto.latencyMs).toBeGreaterThanOrEqual(0);
    expect(dto.piiDetected).toBe(false);

    vi.unstubAllGlobals();
  });

  it('still logs (with a null output) when Ollama returns a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const svc = makeService();
    const result = await svc.embed('some description');

    expect(result).toBeNull();
    expect(mockAiLogs.create).toHaveBeenCalledTimes(1);
    expect(mockAiLogs.create.mock.calls[0][0].outputText).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('does not call Ollama or log for empty/blank input', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const svc = makeService();
    const result = await svc.embed('   ');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockAiLogs.create).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
