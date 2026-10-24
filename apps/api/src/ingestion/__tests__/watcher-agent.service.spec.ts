import { describe, it, expect, vi } from 'vitest';
import { WatcherAgentService } from '../watcher-agent.service';

function buildDb(existing: any[]) {
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
    limit: vi.fn(() => Promise.resolve(existing)),
    insert: vi.fn(function (this: any) {
      return { values: (v: any) => insertValues(v) };
    }),
    update: vi.fn(function (this: any) {
      return { set: (v: any) => ({ where: () => updateSet(v) }) };
    }),
  };
}

const HEARTBEAT = {
  schemaVersion: 1,
  agentId: 'agent-1',
  version: 'watcher@abc123',
  startedAt: '2026-10-18T09:00:00Z',
  sentAt: '2026-10-18T09:05:00Z',
  diagnostics: {
    downloadsReadable: true,
    nasMountPresent: true,
    deadLetterDepth: 0,
    retryQueueDepth: 0,
    quarantineDepth: 0,
    ignoredCount: 0,
    processPath: '~/Applications/BankWatcher.app',
    pythonVersion: '3.14.0',
  },
  inventory: [],
} as any;

describe('WatcherAgentService.recordHeartbeat', () => {
  it('creates a new watcher_agents row for a brand-new agentId', async () => {
    const db = buildDb([]);
    const service = new WatcherAgentService(db as any);

    const result = await service.recordHeartbeat('user-1', HEARTBEAT);

    expect(db.insert).toHaveBeenCalled();
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', agentId: 'agent-1' }),
    );
    expect(result).toEqual({ commands: [] });
  });

  it('updates lastSeenAt/diagnostics for a known agent owned by the same user', async () => {
    const existingRow = { id: 'row-1', userId: 'user-1', agentId: 'agent-1' };
    const db = buildDb([existingRow]);
    const service = new WatcherAgentService(db as any);

    await service.recordHeartbeat('user-1', HEARTBEAT);

    expect(db.update).toHaveBeenCalled();
    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'watcher@abc123' }),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('never reassigns an agentId already owned by a different user', async () => {
    const existingRow = { id: 'row-1', userId: 'user-OTHER', agentId: 'agent-1' };
    const db = buildDb([existingRow]);
    const service = new WatcherAgentService(db as any);

    const result = await service.recordHeartbeat('user-1', HEARTBEAT);

    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(result).toEqual({ commands: [] });
  });
});

describe('WatcherAgentService.isDiagnosticsUnhealthy', () => {
  it('is false for a fully healthy diagnostics snapshot', () => {
    expect(
      WatcherAgentService.isDiagnosticsUnhealthy({
        downloadsReadable: true,
        nasMountPresent: true,
        deadLetterDepth: 0,
      }),
    ).toBe(false);
  });

  it('is true when Downloads is unreadable', () => {
    expect(
      WatcherAgentService.isDiagnosticsUnhealthy({
        downloadsReadable: false,
        nasMountPresent: true,
        deadLetterDepth: 0,
      }),
    ).toBe(true);
  });

  it('is true when the dead-letter queue is non-empty', () => {
    expect(
      WatcherAgentService.isDiagnosticsUnhealthy({
        downloadsReadable: true,
        nasMountPresent: true,
        deadLetterDepth: 3,
      }),
    ).toBe(true);
  });

  it('is false when there is no diagnostics snapshot yet', () => {
    expect(WatcherAgentService.isDiagnosticsUnhealthy(undefined)).toBe(false);
  });
});
