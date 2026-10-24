import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImportVisibilityDetector } from '../import-visibility.detector';

function buildDb(alarmRows: any[] = []) {
  const insertValues = vi.fn();
  const updateSet = vi.fn();
  return {
    _insertValues: insertValues,
    _updateSet: updateSet,
    select: vi.fn(function (this: any) {
      return this;
    }),
    from: vi.fn(function (this: any) {
      return this;
    }),
    where: vi.fn(function (this: any) {
      return this;
    }),
    limit: vi.fn(() => Promise.resolve(alarmRows)),
    insert: vi.fn(function (this: any) {
      return { values: (v: any) => insertValues(v) };
    }),
    update: vi.fn(function (this: any) {
      return { set: (v: any) => ({ where: () => updateSet(v) }) };
    }),
  };
}

function makeDeps(alarmRows: any[] = [], statementsDue = false) {
  const db = buildDb(alarmRows);
  const watcherAgentService = { listAllAgents: vi.fn() } as any;
  const notificationsService = {
    findByMetadata: vi.fn().mockResolvedValue(false),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  } as any;
  const statementScheduleService = {
    findDueOrOverdue: vi.fn().mockResolvedValue(statementsDue ? [{ accountId: 'a1' }] : []),
  } as any;
  const detector = new ImportVisibilityDetector(
    db as any,
    watcherAgentService,
    notificationsService,
    statementScheduleService,
  );
  return { db, notificationsService, detector };
}

const BASE_AGENT = {
  userId: 'user-1',
  agentId: 'agent-1',
  lastDiagnostics: { downloadsReadable: true, nasMountPresent: true, deadLetterDepth: 0 },
};

describe('ImportVisibilityDetector — watcher_silent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  });

  it('does not open watcher_silent before 24h with no statement due', async () => {
    const { notificationsService, detector } = makeDeps([], false);
    const agent = { ...BASE_AGENT, lastSeenAt: new Date('2026-10-19T12:00:00Z') }; // 12h ago

    await detector.evaluateAgent(agent, new Date());

    expect(notificationsService.createAndDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_silent' }),
    );
  });

  it('opens watcher_silent after 24h with no statement due', async () => {
    const { notificationsService, detector } = makeDeps([], false);
    const agent = { ...BASE_AGENT, lastSeenAt: new Date('2026-10-18T23:00:00Z') }; // 25h ago

    await detector.evaluateAgent(agent, new Date());

    expect(notificationsService.createAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_silent', userId: 'user-1' }),
    );
  });

  it('opens watcher_silent after only 2h when a statement is due', async () => {
    const { notificationsService, detector } = makeDeps([], true);
    const agent = { ...BASE_AGENT, lastSeenAt: new Date('2026-10-19T21:30:00Z') }; // 2.5h ago

    await detector.evaluateAgent(agent, new Date());

    expect(notificationsService.createAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_silent' }),
    );
  });

  it('does not open watcher_silent at 1.5h even when a statement is due', async () => {
    const { notificationsService, detector } = makeDeps([], true);
    const agent = { ...BASE_AGENT, lastSeenAt: new Date('2026-10-19T22:30:00Z') }; // 1.5h ago

    await detector.evaluateAgent(agent, new Date());

    expect(notificationsService.createAndDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_silent' }),
    );
  });
});

describe('ImportVisibilityDetector — watcher_unhealthy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  });

  it('opens watcher_unhealthy once the red probe persists > 1h', async () => {
    const { notificationsService, detector } = makeDeps([], false);
    const agent = {
      ...BASE_AGENT,
      lastSeenAt: new Date('2026-10-19T22:30:00Z'), // 1.5h ago
      lastDiagnostics: { downloadsReadable: false, nasMountPresent: true, deadLetterDepth: 0 },
    };

    await detector.evaluateAgent(agent, new Date());

    expect(notificationsService.createAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_unhealthy' }),
    );
  });

  it('does not open watcher_unhealthy before 1h', async () => {
    const { notificationsService, detector } = makeDeps([], false);
    const agent = {
      ...BASE_AGENT,
      lastSeenAt: new Date('2026-10-19T23:30:00Z'), // 30m ago
      lastDiagnostics: { downloadsReadable: false, nasMountPresent: true, deadLetterDepth: 0 },
    };

    await detector.evaluateAgent(agent, new Date());

    expect(notificationsService.createAndDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_unhealthy' }),
    );
  });

  it('auto-resolves an open episode on a fresh healthy heartbeat, with no notification', async () => {
    const openAlarm = { id: 'alarm-1', severity: 'warning' };
    const { db, notificationsService, detector } = makeDeps([openAlarm], false);
    const agent = {
      ...BASE_AGENT,
      lastSeenAt: new Date('2026-10-20T00:00:00Z'),
      lastDiagnostics: { downloadsReadable: true, nasMountPresent: true, deadLetterDepth: 0 },
    };

    await detector.evaluateAgent(agent, new Date());

    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedAt: expect.any(Date) }),
    );
    expect(notificationsService.createAndDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'watcher_unhealthy' }),
    );
  });
});
