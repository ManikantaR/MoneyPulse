import { describe, it, expect, vi } from 'vitest';

// Same fake-db pattern as rate-watchlist.service.spec.ts — mock drizzle-orm's
// eq/desc to plain predicate/identity helpers so the in-memory fake below can
// evaluate them, keeping this a true unit test of the service's own versioning
// logic rather than drizzle's SQL builder.
vi.mock('drizzle-orm', () => ({
  eq: (col: any, val: any) => (row: any) => row[col] === val,
  desc: (col: any) => col,
}));

vi.mock('../../db/schema', () => ({
  suitabilitySettings: {
    id: 'id',
    userId: 'userId',
    version: 'version',
  },
}));

const { SuitabilitySettingsService } = await import('../suitability-settings.service');

function asResult(arr: any[]) {
  const result: any = [...arr];
  result.orderBy = () => result;
  result.limit = (n: number) => asResult(result.slice(0, n));
  return result;
}

function makeFakeDb(seed: any[] = []) {
  const rows: any[] = [...seed];
  return {
    _rows: () => rows,
    select: () => ({
      from: () => ({
        where: (predFn: (r: any) => boolean) => {
          const filtered = rows.filter(predFn).sort((a, b) => b.version - a.version);
          return asResult(filtered);
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        const row = { id: `id-${rows.length + 1}`, createdAt: new Date(), ...v };
        rows.push(row);
        return { returning: () => [row] };
      },
    }),
  };
}

const baseInput = {
  emergencyFundTargetMonths: 6,
  liquidityHorizonMonths: null,
  riskTolerance: null,
  taxState: null,
  monthlyInvestingTargetCents: null,
  targetAllocation: [],
  tickerAssetClassMap: {},
  dcaDayOfMonth: null,
  dcaAmountCents: null,
} as any;

describe('SuitabilitySettingsService — versioning', () => {
  it('creates version 1 on first save', async () => {
    const db = makeFakeDb();
    const service = new SuitabilitySettingsService(db as any);

    const row = await service.createVersion('user-1', baseInput);

    expect(row.version).toBe(1);
    expect(db._rows()).toHaveLength(1);
  });

  it('updating a setting inserts a new version WITHOUT overwriting the old row', async () => {
    const db = makeFakeDb();
    const service = new SuitabilitySettingsService(db as any);

    const v1 = await service.createVersion('user-1', {
      ...baseInput,
      riskTolerance: 'conservative',
    });
    const v2 = await service.createVersion('user-1', {
      ...baseInput,
      riskTolerance: 'aggressive',
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    // Both rows persist — the old version's record is untouched.
    expect(db._rows()).toHaveLength(2);
    const oldRow = db._rows().find((r: any) => r.version === 1);
    expect(oldRow.riskTolerance).toBe('conservative');

    // getCurrent reflects only the latest version.
    const current = await service.getCurrent('user-1');
    expect(current?.version).toBe(2);
    expect(current?.riskTolerance).toBe('aggressive');

    // Full history still has both, most recent first.
    const history = await service.getHistory('user-1');
    expect(history.map((h) => h.version)).toEqual([2, 1]);
  });

  it('versions are scoped per-user', async () => {
    const db = makeFakeDb();
    const service = new SuitabilitySettingsService(db as any);

    await service.createVersion('user-1', baseInput);
    const otherUserFirst = await service.createVersion('user-2', baseInput);

    expect(otherUserFirst.version).toBe(1);
  });
});
