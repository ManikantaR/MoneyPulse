import { describe, it, expect, vi } from 'vitest';

// The service builds where-clauses with drizzle-orm's `eq`/`and`. Rather than stand
// up a real Postgres connection for a unit test, mock these to plain predicate
// functions so the in-memory fake db below can evaluate them directly — this keeps
// the test exercising the service's own staleness/upsert logic, not drizzle's SQL
// builder (which is exercised by the real migration + integration path instead).
vi.mock('drizzle-orm', () => ({
  eq: (col: any, val: any) => (row: any) => row[col] === val,
  and: (...preds: Array<(row: any) => boolean>) => (row: any) => preds.every((p) => p(row)),
  desc: (col: any) => col,
  isNull: (col: any) => (row: any) => row[col] == null,
}));

vi.mock('../../db/schema', () => ({
  rateWatchlist: {
    id: 'id',
    userId: 'userId',
    institution: 'institution',
    source: 'source',
  },
  marketMetrics: {
    metricKey: 'metricKey',
    periodDate: 'periodDate',
  },
  users: {
    id: 'id',
    deletedAt: 'deletedAt',
  },
}));

const { RateWatchlistService } = await import('../rate-watchlist.service');

/** Minimal in-memory drizzle-shaped fake so this test exercises the service's own
 *  logic (staleness math, upsert-by-institution) without a live DB. */
/** Wraps a plain array with chainable no-op `orderBy`/`limit` so it behaves like a
 *  drizzle query result whether or not the caller chains further. */
function asResult(arr: any[]) {
  const result: any = [...arr];
  result.orderBy = () => result;
  result.limit = (n: number) => asResult(arr.slice(0, n));
  return result;
}

function makeFakeDb(seed: any[] = []) {
  let rows = [...seed];
  return {
    _rows: () => rows,
    select: () => ({
      from: () => ({
        where: (predFn: (r: any) => boolean) => asResult(rows.filter(predFn)),
        orderBy: () => asResult(rows),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        const row = { id: `id-${rows.length + 1}`, updatedAt: new Date(), createdAt: new Date(), ...v };
        rows.push(row);
        return { returning: () => [row] };
      },
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (predFn: (r: any) => boolean) => {
          const idx = rows.findIndex(predFn);
          const returning = () => {
            if (idx === -1) return [];
            rows[idx] = { ...rows[idx], ...patch };
            return [rows[idx]];
          };
          return { returning };
        },
      }),
    }),
    delete: () => ({
      where: (predFn: (r: any) => boolean) => ({
        returning: () => {
          const idx = rows.findIndex(predFn);
          if (idx === -1) return [];
          const [removed] = rows.splice(idx, 1);
          return [removed];
        },
      }),
    }),
  };
}

function makeConfig(staleDays?: number) {
  return { get: (key: string) => (key === 'WATCHLIST_STALE_DAYS' ? String(staleDays) : undefined) } as any;
}

describe('RateWatchlistService', () => {
  const userId = 'user-1';

  it('CRUD: create, update, and delete a watchlist entry', async () => {
    const db = makeFakeDb();
    const service = new RateWatchlistService(db as any, makeConfig());

    const created = await service.create(userId, {
      institution: 'Example Online Bank',
      productType: 'hysa',
      apyBps: 410,
      termMonths: null,
      notes: 'promo rate',
    });
    expect(created.apyBps).toBe(410);
    expect(created.source).toBe('user');

    const updated = await service.update(userId, created.id, { apyBps: 425 });
    expect(updated.apyBps).toBe(425);

    await service.remove(userId, created.id);
    const all = await service.findAll(userId);
    expect(all).toHaveLength(0);
  });

  it('flags a row older than WATCHLIST_STALE_DAYS as stale', async () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 3600_000); // 60 days ago
    const freshDate = new Date(Date.now() - 5 * 24 * 3600_000); // 5 days ago
    const db = makeFakeDb([
      {
        id: 'w-stale',
        userId,
        institution: 'Old Rate Corp',
        productType: 'cd',
        apyBps: 380,
        termMonths: 12,
        notes: null,
        source: 'user',
        updatedAt: staleDate,
      },
      {
        id: 'w-fresh',
        userId,
        institution: 'Fresh Bank',
        productType: 'hysa',
        apyBps: 400,
        termMonths: null,
        notes: null,
        source: 'user',
        updatedAt: freshDate,
      },
    ]);
    const service = new RateWatchlistService(db as any, makeConfig(45));

    const all = await service.findAll(userId);
    const stale = all.find((r) => r.id === 'w-stale');
    const fresh = all.find((r) => r.id === 'w-fresh');

    expect(stale?.isStale).toBe(true);
    expect(fresh?.isStale).toBe(false);
  });

  it('uses WATCHLIST_STALE_DAYS env override', () => {
    const service = new RateWatchlistService(makeFakeDb() as any, makeConfig(10));
    expect(service.getStaleDays()).toBe(10);
  });

  it('falls back to the default staleness window when unset', () => {
    const service = new RateWatchlistService(makeFakeDb() as any, makeConfig());
    expect(service.getStaleDays()).toBe(45);
  });
});

describe('RateWatchlistService — syncTreasuryRowsForAllUsers', () => {
  it('syncs every active user and isolates one user\'s failure from the others', async () => {
    const activeUserIds = ['user-a', 'user-b', 'user-c'];
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(activeUserIds.map((id) => ({ id }))),
        }),
      }),
    };
    const service = new RateWatchlistService(db, makeConfig());
    const spy = vi
      .spyOn(service, 'syncTreasuryRows')
      .mockImplementationOnce(() => Promise.resolve({ synced: 4 }))
      .mockImplementationOnce(() => Promise.reject(new Error('synthetic failure')))
      .mockImplementationOnce(() => Promise.resolve({ synced: 4 }));

    const result = await service.syncTreasuryRowsForAllUsers();

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(activeUserIds);
    // Only the 2 users whose sync resolved are counted — the failed one is logged,
    // not re-thrown, so it never blocks the remaining users' syncs.
    expect(result.usersSynced).toBe(2);
  });

  it('is a no-op with usersSynced: 0 when there are no active users', async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    };
    const service = new RateWatchlistService(db, makeConfig());
    const spy = vi.spyOn(service, 'syncTreasuryRows');

    const result = await service.syncTreasuryRowsForAllUsers();

    expect(spy).not.toHaveBeenCalled();
    expect(result.usersSynced).toBe(0);
  });
});
