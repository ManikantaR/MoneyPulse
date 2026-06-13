import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BalanceSnapshotService } from '../balance-snapshot.service';

const mockDb = {
  execute: vi.fn(),
};

function makeService() {
  return new BalanceSnapshotService(mockDb as any);
}

describe('BalanceSnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [] });
  });

  describe('snapshotForUser', () => {
    it('executes a single upsert for the given user', async () => {
      const svc = makeService();
      await svc.snapshotForUser('user-1');
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('does not throw when execute succeeds', async () => {
      const svc = makeService();
      await expect(svc.snapshotForUser('user-1')).resolves.toBeUndefined();
    });

    it('is idempotent — calling twice executes two upserts without error', async () => {
      const svc = makeService();
      await svc.snapshotForUser('user-1');
      await svc.snapshotForUser('user-1');
      // Two separate SQL executions; idempotency is guaranteed by ON CONFLICT DO UPDATE
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('snapshotAll', () => {
    it('executes a single upsert across all accounts', async () => {
      const svc = makeService();
      await svc.snapshotAll();
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('does not throw', async () => {
      const svc = makeService();
      await expect(svc.snapshotAll()).resolves.toBeUndefined();
    });
  });

  describe('backfill', () => {
    it('executes a single upsert for the given account', async () => {
      const svc = makeService();
      await svc.backfill('acct-1');
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — calling twice does not throw', async () => {
      const svc = makeService();
      await svc.backfill('acct-1');
      await svc.backfill('acct-1');
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('history', () => {
    it('returns mapped BalanceHistoryPoint[] from raw rows', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [
          { snapshot_date: '2025-06-30', total_cents: '150000' },
          { snapshot_date: '2025-07-31', total_cents: '175000' },
        ],
      });
      const svc = makeService();
      const result = await svc.history('user-1', {});
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2025-06-30', balanceCents: 150000 });
      expect(result[1]).toEqual({ date: '2025-07-31', balanceCents: 175000 });
    });

    it('returns empty array when no snapshots exist', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      const svc = makeService();
      const result = await svc.history('user-1', {});
      expect(result).toEqual([]);
    });

    it('passes accountId filter when provided', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      const svc = makeService();
      await svc.history('user-1', { accountId: 'acct-abc' });
      const callArg = mockDb.execute.mock.calls[0][0];
      // The SQL object should contain the accountId somewhere in its query string
      expect(JSON.stringify(callArg)).toContain('acct-abc');
    });

    it('passes from/to date filters when provided', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      const svc = makeService();
      await svc.history('user-1', { from: '2025-01-01', to: '2025-06-30' });
      const callArg = mockDb.execute.mock.calls[0][0];
      expect(JSON.stringify(callArg)).toContain('2025-01-01');
      expect(JSON.stringify(callArg)).toContain('2025-06-30');
    });

    it('handles null rows gracefully (returns empty array)', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: null });
      const svc = makeService();
      const result = await svc.history('user-1', {});
      expect(result).toEqual([]);
    });

    it('converts total_cents string to number', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ snapshot_date: '2025-07-01', total_cents: '9999999' }],
      });
      const svc = makeService();
      const result = await svc.history('user-1', {});
      expect(typeof result[0]!.balanceCents).toBe('number');
      expect(result[0]!.balanceCents).toBe(9999999);
    });
  });
});
