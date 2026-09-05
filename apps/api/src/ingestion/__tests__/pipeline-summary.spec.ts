/**
 * Import Pipeline Radar Phase 3 — pipeline summary counts (processed /
 * needsAttention / txnsImported) that feed the top-of-page summary cards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

import { IngestionService } from '../ingestion.service';

const USER_ID = 'user-1';

function buildDb(rows: any[]) {
  return {
    select: vi.fn(function (this: any) {
      return this;
    }),
    from: vi.fn(function (this: any) {
      return this;
    }),
    where: vi.fn(function (this: any) {
      return Promise.resolve(rows);
    }),
  };
}

function makeService(rows: any[]) {
  const db = buildDb(rows);
  const queue = {} as any;
  const config = { get: vi.fn() } as any;
  return new IngestionService(db, queue, config);
}

describe('IngestionService.getPipelineSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T00:00:00Z'));
  });

  it('counts needsAttention across exception statuses regardless of month', async () => {
    const rows = [
      { status: 'failed', rowsImported: 0, createdAt: '2026-01-01T00:00:00Z' },
      { status: 'stalled', rowsImported: 0, createdAt: '2026-03-01T00:00:00Z' },
      { status: 'empty', rowsImported: 0, createdAt: '2026-03-02T00:00:00Z' },
      { status: 'orphaned', rowsImported: 0, createdAt: '2026-03-03T00:00:00Z' },
      { status: 'completed', rowsImported: 10, createdAt: '2026-03-05T00:00:00Z' },
    ];
    const service = makeService(rows);

    const summary = await service.getPipelineSummary(USER_ID);

    expect(summary.needsAttention).toBe(4);
  });

  it('only counts this-month completed uploads toward processed/txnsImported', async () => {
    const rows = [
      { status: 'completed', rowsImported: 10, createdAt: '2026-02-01T00:00:00Z' }, // last month, excluded
      { status: 'completed', rowsImported: 25, createdAt: '2026-03-05T00:00:00Z' }, // this month
      { status: 'completed', rowsImported: 5, createdAt: '2026-03-06T00:00:00Z' }, // this month
      { status: 'failed', rowsImported: 0, createdAt: '2026-03-07T00:00:00Z' },
    ];
    const service = makeService(rows);

    const summary = await service.getPipelineSummary(USER_ID);

    expect(summary.processed).toBe(2);
    expect(summary.txnsImported).toBe(30);
  });
});
