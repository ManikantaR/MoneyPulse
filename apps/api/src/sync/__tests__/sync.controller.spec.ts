import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncController } from '../sync.controller';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeController(opts: {
  dbRows?: Record<string, unknown>[];
  dbExecuteMap?: Record<string, unknown>;
  deliverPendingResult?: number;
  outboxEnqueueSpy?: ReturnType<typeof vi.fn>;
} = {}) {
  const deliverPending = vi.fn().mockResolvedValue(opts.deliverPendingResult ?? 0);
  const outboxEnqueueSpy = opts.outboxEnqueueSpy ?? vi.fn().mockResolvedValue(undefined);

  const mockDb = {
    execute: vi.fn().mockImplementation(async () => ({ rows: opts.dbRows ?? [] })),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const controller = new SyncController(
    mockDb as any,
    { deliverPending } as any,
    { enqueue: outboxEnqueueSpy } as any,
    { toAliasId: vi.fn().mockImplementation((t: string, id: string) => `alias-${t}-${id}`) } as any,
  );

  return { controller, mockDb, deliverPending, outboxEnqueueSpy };
}

// ── GET /sync/status ──────────────────────────────────────────────────────────

describe('SyncController — GET /sync/status', () => {
  it('returns green health when no dead letters, no pending, and secrets configured', async () => {
    const { controller, mockDb } = makeController();
    process.env.FIREBASE_SYNC_ENDPOINT = 'https://example.com';
    process.env.ALIAS_SECRET = 'secret';
    process.env.SYNC_SIGNING_SECRET = 'signsecret';

    mockDb.execute
      .mockResolvedValueOnce({ rows: [] }) // counts query
      .mockResolvedValueOnce({ rows: [] }) // lastDelivered
      .mockResolvedValueOnce({ rows: [] }); // lastError

    const res = await controller.status();
    expect(res.data.health).toBe('green');
    expect(res.data.counts.dead_letter).toBe(0);
    expect(res.data.pendingTotal).toBe(0);

    delete process.env.FIREBASE_SYNC_ENDPOINT;
    delete process.env.ALIAS_SECRET;
    delete process.env.SYNC_SIGNING_SECRET;
  });

  it('returns red health when there are dead-letter events', async () => {
    const { controller, mockDb } = makeController();
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ status: 'dead_letter', count: 3 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await controller.status();
    expect(res.data.health).toBe('red');
    expect(res.data.counts.dead_letter).toBe(3);
  });

  it('returns yellow health when events are pending but no dead letters', async () => {
    const { controller, mockDb } = makeController();
    process.env.FIREBASE_SYNC_ENDPOINT = 'https://example.com';
    process.env.ALIAS_SECRET = 'secret';
    process.env.SYNC_SIGNING_SECRET = 'signsecret';

    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ status: 'pending', count: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await controller.status();
    expect(res.data.health).toBe('yellow');
    expect(res.data.pendingTotal).toBe(5);

    delete process.env.FIREBASE_SYNC_ENDPOINT;
    delete process.env.ALIAS_SECRET;
    delete process.env.SYNC_SIGNING_SECRET;
  });

  it('exposes config flags as booleans, never as values', async () => {
    const { controller, mockDb } = makeController();
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    process.env.FIREBASE_SYNC_ENDPOINT = 'https://secret-endpoint.example.com';

    const res = await controller.status();
    expect(typeof res.data.config.firebaseEndpointSet).toBe('boolean');
    expect(res.data.config.firebaseEndpointSet).toBe(true);
    // Value must not appear in the response
    expect(JSON.stringify(res)).not.toContain('secret-endpoint');

    delete process.env.FIREBASE_SYNC_ENDPOINT;
  });
});

// ── POST /sync/trigger ────────────────────────────────────────────────────────

describe('SyncController — POST /sync/trigger', () => {
  it('calls deliverPending and returns processed count', async () => {
    const { controller, deliverPending } = makeController({ deliverPendingResult: 7 });
    const res = await controller.trigger();
    expect(deliverPending).toHaveBeenCalledOnce();
    expect(res.data.processed).toBe(7);
  });
});

// ── POST /sync/backfill ───────────────────────────────────────────────────────

describe('SyncController — POST /sync/backfill', () => {
  it('enqueues one event per transaction returned by DB', async () => {
    const outboxEnqueueSpy = vi.fn().mockResolvedValue(undefined);
    const { controller, mockDb } = makeController({ outboxEnqueueSpy });

    mockDb.execute.mockResolvedValue({
      rows: [
        {
          id: 'txn-1',
          account_id: 'acc-1',
          user_id: 'user-1',
          amount_cents: 1000,
          date: '2026-01-15',
          is_credit: false,
          category_id: null,
          tags: null,
        },
        {
          id: 'txn-2',
          account_id: 'acc-1',
          user_id: 'user-1',
          amount_cents: 2000,
          date: '2026-01-16',
          is_credit: true,
          category_id: 'cat-1',
          tags: ['groceries'],
        },
      ],
    });

    const res = await controller.backfill({});
    expect(outboxEnqueueSpy).toHaveBeenCalledTimes(2);
    expect(res.data.enqueued).toBe(2);
    expect(res.data.errors).toBe(0);
  });

  it('returns enqueued=0 when all transactions already have outbox rows', async () => {
    const { controller, mockDb, outboxEnqueueSpy } = makeController();
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await controller.backfill({});
    expect(outboxEnqueueSpy).not.toHaveBeenCalled();
    expect(res.data.enqueued).toBe(0);
  });

  it('increments errors when outbox enqueue throws and continues', async () => {
    const outboxEnqueueSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValue(undefined);
    const { controller, mockDb } = makeController({ outboxEnqueueSpy });

    mockDb.execute.mockResolvedValue({
      rows: [
        { id: 't1', account_id: 'a1', user_id: 'u1', amount_cents: 100, date: '2026-01-01', is_credit: false, category_id: null, tags: null },
        { id: 't2', account_id: 'a1', user_id: 'u1', amount_cents: 200, date: '2026-01-02', is_credit: false, category_id: null, tags: null },
      ],
    });

    const res = await controller.backfill({});
    expect(res.data.enqueued).toBe(1);
    expect(res.data.errors).toBe(1);
  });
});

// ── POST /sync/replay ─────────────────────────────────────────────────────────

describe('SyncController — POST /sync/replay', () => {
  it('replays all dead-letter events when no eventIds provided', async () => {
    const { controller, mockDb } = makeController();
    mockDb.returning.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

    const res = await controller.replay({});
    expect(res.data.replayed).toBe(2);
  });

  it('replays only the specified eventIds', async () => {
    const { controller, mockDb } = makeController();
    mockDb.returning.mockResolvedValue([{ id: 'e1' }]);

    const res = await controller.replay({ eventIds: ['e1'] });
    expect(res.data.replayed).toBe(1);
  });

  it('returns 0 when no dead-letter events exist', async () => {
    const { controller, mockDb } = makeController();
    mockDb.returning.mockResolvedValue([]);

    const res = await controller.replay({});
    expect(res.data.replayed).toBe(0);
  });
});

// ── GET /sync/events ──────────────────────────────────────────────────────────

describe('SyncController — GET /sync/events', () => {
  it('returns paginated events with total and page info', async () => {
    const { controller, mockDb } = makeController();
    const fakeEvent = { id: 'ev-1', event_type: 'transaction.projected.v1', status: 'delivered' };

    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 42 }] })
      .mockResolvedValueOnce({ rows: [fakeEvent] });

    const res = await controller.events({ status: undefined, eventType: undefined, page: 1, limit: 25 });
    expect(res.total).toBe(42);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(25);
    expect(res.totalPages).toBe(2);
    expect(res.data).toEqual([fakeEvent]);
  });

  it('calculates totalPages correctly', async () => {
    const { controller, mockDb } = makeController();
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 100 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await controller.events({ status: undefined, eventType: undefined, page: 2, limit: 25 });
    expect(res.totalPages).toBe(4);
    expect(res.page).toBe(2);
  });
});

// ── POST /sync/backfill — isTransfer ─────────────────────────────────────────

describe('SyncController — backfill/replay includes isTransfer', () => {
  it('includes isTransfer: true when the category has is_transfer=true', async () => {
    const outboxEnqueueSpy = vi.fn().mockResolvedValue(undefined);
    const { controller, mockDb } = makeController({ outboxEnqueueSpy });

    const row = {
      id: 'txn-1',
      account_id: 'acc-1',
      user_id: 'user-1',
      amount_cents: 10000,
      date: '2025-01-15T00:00:00Z',
      is_credit: true,
      category_id: 'cat-transfer',
      tags: null,
      is_transfer: true,
    };
    mockDb.execute.mockResolvedValue({ rows: [row] });

    await controller.backfill({ force: true, userId: 'user-1' });

    expect(outboxEnqueueSpy).toHaveBeenCalledOnce();
    const payload = outboxEnqueueSpy.mock.calls[0][0].payload;
    expect(payload.isTransfer).toBe(true);
    expect(payload.isCredit).toBe(true);
  });

  it('includes isTransfer: false when the category has is_transfer=false', async () => {
    const outboxEnqueueSpy = vi.fn().mockResolvedValue(undefined);
    const { controller, mockDb } = makeController({ outboxEnqueueSpy });

    const row = {
      id: 'txn-2',
      account_id: 'acc-1',
      user_id: 'user-1',
      amount_cents: 5000,
      date: '2025-01-16T00:00:00Z',
      is_credit: false,
      category_id: 'cat-grocery',
      tags: [],
      is_transfer: false,
    };
    mockDb.execute.mockResolvedValue({ rows: [row] });

    await controller.backfill({ force: true, userId: 'user-1' });

    const payload = outboxEnqueueSpy.mock.calls[0][0].payload;
    expect(payload.isTransfer).toBe(false);
  });

  it('includes isTransfer: false when category_id is null (COALESCE default)', async () => {
    const outboxEnqueueSpy = vi.fn().mockResolvedValue(undefined);
    const { controller, mockDb } = makeController({ outboxEnqueueSpy });

    const row = {
      id: 'txn-3',
      account_id: 'acc-1',
      user_id: 'user-1',
      amount_cents: 3000,
      date: '2025-01-17T00:00:00Z',
      is_credit: false,
      category_id: null,
      tags: [],
      is_transfer: false,
    };
    mockDb.execute.mockResolvedValue({ rows: [row] });

    await controller.backfill({ force: true, userId: 'user-1' });

    const payload = outboxEnqueueSpy.mock.calls[0][0].payload;
    expect(payload.isTransfer).toBe(false);
    expect(payload.categoryId).toBeNull();
  });
});
