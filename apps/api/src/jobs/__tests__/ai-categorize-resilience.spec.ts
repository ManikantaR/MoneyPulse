/**
 * Tests for the Ollama-resilience changes in IngestionProcessor:
 *   - processAiCategorize: throws (retryable) when Ollama is unavailable
 *   - processAiReconcileSweep: enqueues ai-categorize for uncategorized txns
 *     only when Ollama is up; skips entirely when Ollama is down
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionProcessor } from '../ingestion.processor';

// Stub crypto so tests don't need a real ENCRYPTION_KEY.
vi.mock('../../common/crypto', () => ({
  encryptField: vi.fn((v: string) => `enc:${v}`),
  decryptField: vi.fn((v: string) => v.replace(/^enc:/, '')),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeJob(name: string, data: Record<string, unknown>) {
  return { name, data } as any;
}

/**
 * Build a minimal IngestionProcessor with the services required for the
 * ai-categorize / ai-reconcile paths.  Other services are stubs.
 *
 * Constructor order (14 params as of the Ollama-resilience change):
 *  0  db
 *  1  dedupService
 *  2  archiverService
 *  3  ingestionService
 *  4  pdfProxyService
 *  5  auditService
 *  6  categorizationService
 *  7  merchantNormalizer
 *  8  outbox
 *  9  aliasMapper
 *  10 anomalyDetector
 *  11 ollamaHealth          ← NEW
 *  12 alertsQueue
 *  13 ingestionQueue
 */
function makeProcessor(opts: {
  ollamaAvailable?: boolean;
  dbRows?: Array<{ id: string; userId: string }>;
  categorizeSpy?: ReturnType<typeof vi.fn>;
  ingestionQueueAddSpy?: ReturnType<typeof vi.fn>;
} = {}) {
  const ollamaAvailable = opts.ollamaAvailable ?? true;
  const dbRows = opts.dbRows ?? [];
  const categorizeSpy =
    opts.categorizeSpy ??
    vi.fn().mockResolvedValue({
      total: 0,
      categorizedByRule: 0,
      categorizedByAi: 0,
      suggested: 0,
      uncategorized: 0,
    });
  const ingestionQueueAddSpy =
    opts.ingestionQueueAddSpy ?? vi.fn().mockResolvedValue(undefined);

  // Drizzle-style query chain for the reconcile sweep DB query
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(dbRows),
    // Also needed for insertTransactions path (not exercised here)
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const mockOllamaHealth = {
    isAvailable: vi.fn().mockResolvedValue(ollamaAvailable),
  };

  const mockCategorizationService = {
    categorizeBatch: categorizeSpy,
    categorizeByRulesOnly: vi.fn().mockResolvedValue({
      categorizedByRule: 0,
      uncategorizedIds: [],
    }),
  };

  const processor = new IngestionProcessor(
    mockDb as any,                                // 0  db
    { computeHash: vi.fn() } as any,              // 1  dedupService
    { archiveFile: vi.fn() } as any,              // 2  archiverService
    { updateUploadStatus: vi.fn() } as any,       // 3  ingestionService
    { parsePdf: vi.fn() } as any,                 // 4  pdfProxyService
    { log: vi.fn() } as any,                      // 5  auditService
    mockCategorizationService as any,              // 6  categorizationService
    { ruleBasedNormalize: vi.fn() } as any,       // 7  merchantNormalizer
    { enqueue: vi.fn() } as any,                  // 8  outbox
    { toAliasId: vi.fn().mockReturnValue('a') } as any, // 9  aliasMapper
    { detectAnomalies: vi.fn() } as any,          // 10 anomalyDetector
    mockOllamaHealth as any,                      // 11 ollamaHealth
    { add: vi.fn() } as any,                      // 12 alertsQueue
    { add: ingestionQueueAddSpy } as any,         // 13 ingestionQueue
  );

  return { processor, mockOllamaHealth, categorizeSpy, ingestionQueueAddSpy, mockDb };
}

// ── processAiCategorize ──────────────────────────────────────────────────────

describe('IngestionProcessor.processAiCategorize', () => {
  it('throws a retryable error when Ollama is unavailable', async () => {
    const { processor } = makeProcessor({ ollamaAvailable: false });
    const job = makeJob('ai-categorize', { transactionIds: ['txn-1'], userId: 'u1' });

    await expect(
      (processor as any)['processAiCategorize'](job),
    ).rejects.toThrow('ollama-unavailable');
  });

  it('does NOT call categorizeBatch when Ollama is unavailable', async () => {
    const { processor, categorizeSpy } = makeProcessor({ ollamaAvailable: false });
    const job = makeJob('ai-categorize', { transactionIds: ['txn-1'], userId: 'u1' });

    await expect(
      (processor as any)['processAiCategorize'](job),
    ).rejects.toThrow();

    expect(categorizeSpy).not.toHaveBeenCalled();
  });

  it('calls categorizeBatch with the job transaction IDs when Ollama is up', async () => {
    const { processor, categorizeSpy } = makeProcessor({ ollamaAvailable: true });
    const job = makeJob('ai-categorize', {
      transactionIds: ['txn-1', 'txn-2'],
      userId: 'u1',
    });

    await (processor as any)['processAiCategorize'](job);

    expect(categorizeSpy).toHaveBeenCalledWith(['txn-1', 'txn-2'], 'u1');
  });

  it('propagates categorizeBatch errors so BullMQ can retry', async () => {
    const categorizeSpy = vi
      .fn()
      .mockRejectedValue(new Error('unexpected DB error'));
    const { processor } = makeProcessor({ ollamaAvailable: true, categorizeSpy });
    const job = makeJob('ai-categorize', { transactionIds: ['txn-1'], userId: 'u1' });

    await expect(
      (processor as any)['processAiCategorize'](job),
    ).rejects.toThrow('unexpected DB error');
  });

  it('completes successfully when Ollama is up and categorization succeeds', async () => {
    const { processor } = makeProcessor({ ollamaAvailable: true });
    const job = makeJob('ai-categorize', { transactionIds: ['txn-1'], userId: 'u1' });

    await expect(
      (processor as any)['processAiCategorize'](job),
    ).resolves.toBeUndefined();
  });
});

// ── processAiReconcileSweep ──────────────────────────────────────────────────

describe('IngestionProcessor.processAiReconcileSweep', () => {
  it('skips DB query and enqueue entirely when Ollama is unavailable', async () => {
    const { processor, mockDb, ingestionQueueAddSpy } = makeProcessor({
      ollamaAvailable: false,
    });

    await (processor as any)['processAiReconcileSweep']();

    expect(mockDb.select).not.toHaveBeenCalled();
    expect(ingestionQueueAddSpy).not.toHaveBeenCalled();
  });

  it('does nothing when there are no uncategorized transactions', async () => {
    const { processor, ingestionQueueAddSpy } = makeProcessor({
      ollamaAvailable: true,
      dbRows: [],
    });

    await (processor as any)['processAiReconcileSweep']();

    expect(ingestionQueueAddSpy).not.toHaveBeenCalled();
  });

  it('enqueues one ai-categorize job per user when uncategorized txns exist', async () => {
    const dbRows = [
      { id: 'txn-1', userId: 'user-a' },
      { id: 'txn-2', userId: 'user-a' },
      { id: 'txn-3', userId: 'user-b' },
    ];
    const { processor, ingestionQueueAddSpy } = makeProcessor({
      ollamaAvailable: true,
      dbRows,
    });

    await (processor as any)['processAiReconcileSweep']();

    expect(ingestionQueueAddSpy).toHaveBeenCalledTimes(2);

    const callArgs = ingestionQueueAddSpy.mock.calls.map((c: any[]) => ({
      name: c[0],
      data: c[1],
      opts: c[2],
    }));

    const userACall = callArgs.find((c: any) => c.data.userId === 'user-a');
    expect(userACall).toBeDefined();
    expect(userACall.name).toBe('ai-categorize');
    expect(userACall.data.transactionIds).toEqual(['txn-1', 'txn-2']);
    expect(userACall.opts.jobId).toBe('reconcile-user-a');

    const userBCall = callArgs.find((c: any) => c.data.userId === 'user-b');
    expect(userBCall).toBeDefined();
    expect(userBCall.data.transactionIds).toEqual(['txn-3']);
    expect(userBCall.opts.jobId).toBe('reconcile-user-b');
  });

  it('enqueued reconcile jobs use the long-retry backoff policy', async () => {
    const dbRows = [{ id: 'txn-1', userId: 'user-a' }];
    const { processor, ingestionQueueAddSpy } = makeProcessor({
      ollamaAvailable: true,
      dbRows,
    });

    await (processor as any)['processAiReconcileSweep']();

    const opts = ingestionQueueAddSpy.mock.calls[0][2];
    expect(opts.attempts).toBe(8);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 60_000 });
  });

  it('uses a stable jobId to prevent duplicate reconcile jobs per user', async () => {
    const dbRows = [{ id: 'txn-1', userId: 'user-a' }];
    const { processor, ingestionQueueAddSpy } = makeProcessor({
      ollamaAvailable: true,
      dbRows,
    });

    await (processor as any)['processAiReconcileSweep']();

    const opts = ingestionQueueAddSpy.mock.calls[0][2];
    expect(opts.jobId).toBe('reconcile-user-a');
  });
});

// ── process() routing ────────────────────────────────────────────────────────

describe('IngestionProcessor.process() routing', () => {
  it('routes ai-categorize jobs to processAiCategorize', async () => {
    const { processor } = makeProcessor({ ollamaAvailable: true });
    const spy = vi
      .spyOn(processor as any, 'processAiCategorize')
      .mockResolvedValue(undefined);

    await (processor as any).process(
      makeJob('ai-categorize', { transactionIds: [], userId: 'u1' }),
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('routes ai-reconcile jobs to processAiReconcileSweep', async () => {
    const { processor } = makeProcessor({ ollamaAvailable: true });
    const spy = vi
      .spyOn(processor as any, 'processAiReconcileSweep')
      .mockResolvedValue(undefined);

    await (processor as any).process(makeJob('ai-reconcile', {}));

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
