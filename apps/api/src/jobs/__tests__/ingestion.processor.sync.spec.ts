/**
 * Tests focused on the outbox-enqueue behaviour added to IngestionProcessor.
 * The processor now calls OutboxService after every successful insertTransactions()
 * so imported bank statements appear in Firestore via the sync pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionProcessor } from '../ingestion.processor';

// encryptField requires ENCRYPTION_KEY env var; stub it out so unit tests
// don't need a real 64-char key.
vi.mock('../../common/crypto', () => ({
  encryptField: vi.fn((v: string) => `enc:${v}`),
  decryptField: vi.fn((v: string) => v.replace(/^enc:/, '')),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTxn(overrides: Partial<{ amountCents: number; isCredit: boolean; date: string }> = {}) {
  return {
    externalId: 'ext-1',
    date: overrides.date ?? '2026-01-15',
    description: 'WHOLE FOODS',
    amountCents: overrides.amountCents ?? 1234,
    isCredit: overrides.isCredit ?? false,
    merchantName: 'Whole Foods',
  };
}

function makeProcessor(opts: {
  dbReturning?: Array<{ id: string }>;
  aliasShouldThrow?: boolean;
  outboxEnqueueSpy?: ReturnType<typeof vi.fn>;
  aliasMock?: { toAliasId: ReturnType<typeof vi.fn> };
} = {}): {
  processor: IngestionProcessor;
  outboxEnqueueSpy: ReturnType<typeof vi.fn>;
} {
  const insertedId = 'inserted-uuid-1';
  const dbReturning = opts.dbReturning ?? [{ id: insertedId }];

  const mockDb = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(dbReturning),
  };

  const outboxEnqueueSpy = opts.outboxEnqueueSpy ?? vi.fn().mockResolvedValue(undefined);
  const mockOutbox = { enqueue: outboxEnqueueSpy };

  const aliasMock = opts.aliasMock ?? {
    toAliasId: opts.aliasShouldThrow
      ? vi.fn().mockImplementation(() => {
          throw new Error('ALIAS_SECRET must be set for sync alias mapping');
        })
      : vi.fn().mockImplementation((type: string, id: string) => `alias-${type}-${id}`),
  };

  const processor = new IngestionProcessor(
    mockDb as any,
    { computeHash: vi.fn().mockReturnValue('hash-abc') } as any,
    { archiveFile: vi.fn() } as any,
    { updateUploadStatus: vi.fn() } as any,
    { parsePdf: vi.fn() } as any,
    { log: vi.fn() } as any,
    {
      categorizeByRulesOnly: vi
        .fn()
        .mockResolvedValue({ categorizedByRule: 0, uncategorizedIds: [] }),
    } as any,
    mockOutbox as any,
    aliasMock as any,
    { add: vi.fn() } as any,
    { add: vi.fn() } as any,
  );

  return { processor, outboxEnqueueSpy };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('IngestionProcessor — outbox enqueue on import', () => {
  it('insertTransactions returns the inserted UUIDs', async () => {
    const expectedIds = ['uuid-a', 'uuid-b'];
    const { processor } = makeProcessor({
      dbReturning: expectedIds.map((id) => ({ id })),
    });

    const result = await (processor as any)['insertTransactions'](
      [makeTxn(), makeTxn()],
      'acc-1',
      'user-1',
      'upload-1',
    );

    expect(result).toEqual(expectedIds);
  });

  it('enqueues one outbox event per inserted transaction', async () => {
    const { processor, outboxEnqueueSpy } = makeProcessor({
      dbReturning: [{ id: 'txn-uuid-1' }],
    });
    const txns = [makeTxn({ amountCents: 5000, isCredit: true })];

    await (processor as any)['enqueueIngestionEvents'](
      ['txn-uuid-1'],
      'acc-1',
      'user-1',
      txns,
    );

    expect(outboxEnqueueSpy).toHaveBeenCalledTimes(1);
    const payload = outboxEnqueueSpy.mock.calls[0][0];
    expect(payload.eventType).toBe('transaction.projected.v1');
    expect(payload.aggregateType).toBe('transaction');
    expect(payload.aggregateId).toBe('txn-uuid-1');
    expect(payload.userId).toBe('user-1');
    expect(payload.payload.amountCents).toBe(5000);
    expect(payload.payload.isCredit).toBe(true);
    expect(payload.payload.isManual).toBe(false);
    expect(payload.payload.categoryId).toBeNull();
  });

  it('enqueues one event per transaction for a multi-transaction import', async () => {
    const ids = ['id-1', 'id-2', 'id-3'];
    const { processor, outboxEnqueueSpy } = makeProcessor({
      dbReturning: ids.map((id) => ({ id })),
    });
    const txns = ids.map((_, i) => makeTxn({ amountCents: 100 * (i + 1) }));

    await (processor as any)['enqueueIngestionEvents'](ids, 'acc-1', 'user-1', txns);

    expect(outboxEnqueueSpy).toHaveBeenCalledTimes(3);
    expect(outboxEnqueueSpy.mock.calls[0][0].aggregateId).toBe('id-1');
    expect(outboxEnqueueSpy.mock.calls[1][0].aggregateId).toBe('id-2');
    expect(outboxEnqueueSpy.mock.calls[2][0].aggregateId).toBe('id-3');
  });

  it('does not throw and skips events when ALIAS_SECRET is absent', async () => {
    const { processor, outboxEnqueueSpy } = makeProcessor({ aliasShouldThrow: true });

    await expect(
      (processor as any)['enqueueIngestionEvents'](
        ['id-1'],
        'acc-1',
        'user-1',
        [makeTxn()],
      ),
    ).resolves.toBeUndefined();

    // alias threw before reaching outbox.enqueue
    expect(outboxEnqueueSpy).not.toHaveBeenCalled();
  });

  it('continues processing remaining events when one alias call throws', async () => {
    let callCount = 0;
    const aliasMock = {
      toAliasId: vi.fn().mockImplementation((type: string, id: string) => {
        callCount++;
        if (callCount === 1) throw new Error('alias error on first call');
        return `alias-${type}-${id}`;
      }),
    };
    const outboxEnqueueSpy = vi.fn().mockResolvedValue(undefined);
    const { processor } = makeProcessor({ aliasMock, outboxEnqueueSpy });

    await (processor as any)['enqueueIngestionEvents'](
      ['id-1', 'id-2'],
      'acc-1',
      'user-1',
      [makeTxn(), makeTxn()],
    );

    // First event failed (alias threw), second should still succeed
    expect(outboxEnqueueSpy).toHaveBeenCalledTimes(1);
    expect(outboxEnqueueSpy.mock.calls[0][0].aggregateId).toBe('id-2');
  });

  it('enqueueIngestionEvents is resilient to outbox insert failure', async () => {
    const outboxEnqueueSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValue(undefined);

    const { processor } = makeProcessor({ outboxEnqueueSpy });

    // Should not throw even when outbox.enqueue rejects
    await expect(
      (processor as any)['enqueueIngestionEvents'](
        ['id-1', 'id-2'],
        'acc-1',
        'user-1',
        [makeTxn(), makeTxn()],
      ),
    ).resolves.toBeUndefined();

    // Both called — first rejected but we continued
    expect(outboxEnqueueSpy).toHaveBeenCalledTimes(2);
  });
});
