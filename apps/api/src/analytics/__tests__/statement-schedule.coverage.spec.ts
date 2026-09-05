/**
 * Import Pipeline Radar Phase 3 — accounts x months coverage grid.
 * Verifies cell-status derivation (received / missing / empty / na) from
 * seeded file_uploads + statement_schedule rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatementScheduleService } from '../statement-schedule.service';

const ACCOUNT_ID = 'acct-1';

function buildDb(scheduleRows: any[], uploadRows: any[]) {
  const execute = vi.fn();
  execute.mockResolvedValueOnce({ rows: scheduleRows }); // getSchedule
  execute.mockResolvedValueOnce({ rows: uploadRows }); // file_uploads select
  return { execute };
}

function scheduleRow(overrides: Partial<any> = {}) {
  return {
    id: 's1',
    account_id: ACCOUNT_ID,
    cadence: 'monthly',
    expected_day_of_month: 5,
    cadence_days: null,
    grace_days: 5,
    last_satisfied_at: '2026-01-05T00:00:00Z',
    snoozed_until: null,
    source: 'learned',
    enabled: true,
    ...overrides,
  };
}

describe('StatementScheduleService.getCoverageForAccount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('marks a month with a completed, rows-imported upload as received', async () => {
    // Fix "now" so the fixed 3-month window (Jan/Feb/Mar 2026) is deterministic.
    vi.setSystemTime(new Date('2026-03-10T00:00:00Z'));
    const uploads = [
      { id: 'u-jan', status: 'completed', rows_imported: 42, created_at: '2026-01-05T00:00:00Z' },
    ];
    const db = buildDb([scheduleRow()], uploads);
    const svc = new StatementScheduleService(db, {} as any);

    const result = await svc.getCoverageForAccount(ACCOUNT_ID, 'Checking', '1234', 3);

    const jan = result.cells.find((c) => c.month === '2026-01');
    expect(jan?.status).toBe('received');
    expect(jan?.uploadId).toBe('u-jan');
    vi.useRealTimers();
  });

  it('marks a completed upload with zero rows imported as empty', async () => {
    vi.setSystemTime(new Date('2026-03-10T00:00:00Z'));
    const uploads = [
      { id: 'u-feb', status: 'completed', rows_imported: 0, created_at: '2026-02-05T00:00:00Z' },
    ];
    const db = buildDb([scheduleRow()], uploads);
    const svc = new StatementScheduleService(db, {} as any);

    const result = await svc.getCoverageForAccount(ACCOUNT_ID, 'Checking', '1234', 3);

    const feb = result.cells.find((c) => c.month === '2026-02');
    expect(feb?.status).toBe('empty');
    expect(feb?.uploadId).toBe('u-feb');
    vi.useRealTimers();
  });

  it('marks a past month with no upload and an enabled schedule past grace as missing', async () => {
    vi.setSystemTime(new Date('2026-03-10T00:00:00Z'));
    const db = buildDb([scheduleRow()], []); // no uploads at all
    const svc = new StatementScheduleService(db, {} as any);

    const result = await svc.getCoverageForAccount(ACCOUNT_ID, 'Checking', '1234', 3);

    const jan = result.cells.find((c) => c.month === '2026-01');
    const feb = result.cells.find((c) => c.month === '2026-02');
    expect(jan?.status).toBe('missing');
    expect(feb?.status).toBe('missing');
    vi.useRealTimers();
  });

  it('marks all months na when there is no schedule for the account', async () => {
    vi.setSystemTime(new Date('2026-03-10T00:00:00Z'));
    const db = buildDb([], []); // no schedule row
    const svc = new StatementScheduleService(db, {} as any);

    const result = await svc.getCoverageForAccount(ACCOUNT_ID, 'Checking', '1234', 3);

    expect(result.cells.every((c) => c.status === 'na')).toBe(true);
    vi.useRealTimers();
  });
});
