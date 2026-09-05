import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatementScheduleService } from '../statement-schedule.service';

const ACCOUNT_ID = 'acct-1';
const USER_ID = 'user-1';

function buildQueueDb(responses: any[]) {
  const execute = vi.fn();
  for (const r of responses) execute.mockResolvedValueOnce({ rows: r });
  return { execute };
}

function buildNotifications(alreadySent = false) {
  return {
    findByMetadata: vi.fn().mockResolvedValue(alreadySent),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
}

function importsRow(daysAgo: number, dayOfMonth?: number) {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  if (dayOfMonth) d.setUTCDate(dayOfMonth);
  return { created_at: d.toISOString() };
}

describe('StatementScheduleService.learnAccount', () => {
  it('infers monthly cadence + expectedDayOfMonth from ~monthly imports', async () => {
    const imports = [
      { created_at: '2025-10-05T00:00:00Z' },
      { created_at: '2025-11-05T00:00:00Z' },
      { created_at: '2025-12-05T00:00:00Z' },
    ];
    // getSchedule (existing check) -> [], getSatisfyingImports -> imports, insert
    const db = buildQueueDb([[], imports, []]);
    const notifications = buildNotifications();
    const svc = new StatementScheduleService(db, notifications as any);

    await svc.learnAccount(ACCOUNT_ID);

    // getSchedule + getSatisfyingImports + the upsert INSERT.
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('leaves enabled=false when fewer than 3 satisfying imports exist', async () => {
    const imports = [{ created_at: '2025-11-05T00:00:00Z' }];
    const db = buildQueueDb([[], imports]);
    const notifications = buildNotifications();
    const svc = new StatementScheduleService(db, notifications as any);

    await svc.learnAccount(ACCOUNT_ID);

    // No existing row -> no disable UPDATE issued, and definitely no INSERT.
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('never overwrites a manual schedule', async () => {
    const existingManual = [
      {
        id: 's1',
        account_id: ACCOUNT_ID,
        cadence: 'monthly',
        expected_day_of_month: 5,
        cadence_days: null,
        grace_days: 5,
        last_satisfied_at: '2025-12-05T00:00:00Z',
        snoozed_until: null,
        source: 'manual',
        enabled: true,
      },
    ];
    const db = buildQueueDb([existingManual]);
    const notifications = buildNotifications();
    const svc = new StatementScheduleService(db, notifications as any);

    await svc.learnAccount(ACCOUNT_ID);

    // Only the initial getSchedule lookup happens — learn bails out immediately.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('StatementScheduleService overdue detection', () => {
  function scheduleRow(overrides: Record<string, any> = {}) {
    return {
      id: 's1',
      account_id: ACCOUNT_ID,
      account_nickname: 'Amex Gold',
      cadence: 'monthly',
      expected_day_of_month: 5,
      cadence_days: null,
      grace_days: 5,
      last_satisfied_at: '2025-11-05T00:00:00Z',
      snoozed_until: null,
      source: 'learned',
      enabled: true,
      ...overrides,
    };
  }

  it('flags an account overdue past expected + grace and dispatches one consolidated notification', async () => {
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    const db = buildQueueDb([[scheduleRow()]]);
    const notifications = buildNotifications(false);
    const svc = new StatementScheduleService(db, notifications as any);

    await svc.checkAndAlertUser(USER_ID);

    expect(notifications.createAndDispatch).toHaveBeenCalledTimes(1);
    const call = notifications.createAndDispatch.mock.calls[0][0];
    expect(call.type).toBe('statement_overdue');
    expect(call.title).toContain('Amex Gold');
    vi.useRealTimers();
  });

  it('excludes not-yet-due and snoozed accounts', async () => {
    vi.setSystemTime(new Date('2025-12-10T00:00:00Z')); // before Dec expected+grace
    const db = buildQueueDb([[scheduleRow()]]);
    const notifications = buildNotifications(false);
    const svc = new StatementScheduleService(db, notifications as any);

    await svc.checkAndAlertUser(USER_ID);

    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not double-emit when a matching notification already exists today (dedup)', async () => {
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    const db = buildQueueDb([[scheduleRow()]]);
    const notifications = buildNotifications(true); // already sent today
    const svc = new StatementScheduleService(db, notifications as any);

    await svc.checkAndAlertUser(USER_ID);

    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
