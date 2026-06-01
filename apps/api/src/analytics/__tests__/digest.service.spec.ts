import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DigestService } from '../digest.service';

const mockDb = {
  execute: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([{ timezone: 'America/New_York', dailyDigestEnabled: true, weeklyDigestEnabled: true, monthlyDigestEnabled: true }]),
};

const mockConfig = { get: vi.fn((key: string, def: string) => def) };

const mockOllamaHealth = { isAvailable: vi.fn().mockResolvedValue(false) };

const mockNotifications = {
  findByMetadata: vi.fn().mockResolvedValue(false),
  createAndDispatch: vi.fn().mockResolvedValue({ id: 'notif-1' }),
};

function makeService() {
  return new DigestService(
    mockDb as any,
    mockConfig as any,
    mockOllamaHealth as any,
    mockNotifications as any,
  );
}

// DB returns for daily queries: spend, accounts, budgets
function setDailyDbResponses(
  spendCents = 8400,
  accounts = [{ nickname: 'Checking', balance_cents: 500000 }],
  budgets = [{ category_name: 'Groceries', budget_cents: 40000, spent_cents: 31200 }],
) {
  mockDb.execute
    .mockResolvedValueOnce({ rows: [{ total: spendCents }] }) // spend
    .mockResolvedValueOnce({ rows: accounts })               // accounts
    .mockResolvedValueOnce({ rows: budgets });               // budgets
}

function setWeeklyDbResponses(
  spendCents = 120000,
  cats = [{ category_name: 'Groceries', total: 45000 }],
  budgets = [{ category_name: 'Groceries', budget_cents: 40000, spent_cents: 31200 }],
) {
  mockDb.execute
    .mockResolvedValueOnce({ rows: [{ total_expense: spendCents, total_income: 0 }] })
    .mockResolvedValueOnce({ rows: cats })
    .mockResolvedValueOnce({ rows: budgets });
}

describe('DigestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset select chain for getUserSettings
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValue([{
      timezone: 'America/New_York',
      dailyDigestEnabled: true,
      weeklyDigestEnabled: true,
      monthlyDigestEnabled: true,
    }]);
  });

  describe('buildDigest - daily', () => {
    it('returns non-empty title, message, voiceSummary, and sections', async () => {
      setDailyDbResponses();
      const svc = makeService();
      const result = await svc.buildDigest('user-1', 'daily');

      expect(result.title).toBeTruthy();
      expect(result.message).toBeTruthy();
      expect(result.voiceSummary).toBeTruthy();
      expect(result.sections.length).toBeGreaterThan(0);
    });

    it('includes yesterday spend section', async () => {
      setDailyDbResponses(8400);
      const svc = makeService();
      const result = await svc.buildDigest('user-1', 'daily');

      const spendSection = result.sections.find((s) => s.label.includes('spending'));
      expect(spendSection).toBeDefined();
      expect(spendSection!.value).toContain('$84.00');
    });

    it('includes budget section when budget data present', async () => {
      setDailyDbResponses(8400, [], [{ category_name: 'Groceries', budget_cents: 40000, spent_cents: 31200 }]);
      const svc = makeService();
      const result = await svc.buildDigest('user-1', 'daily');

      const budgetSection = result.sections.find((s) => s.label.includes('budget'));
      expect(budgetSection).toBeDefined();
      expect(budgetSection!.value).toContain('78%');
    });

    it('uses template when Ollama is offline (default mock)', async () => {
      setDailyDbResponses();
      mockOllamaHealth.isAvailable.mockResolvedValue(false);
      const svc = makeService();
      const result = await svc.buildDigest('user-1', 'daily');

      expect(result.voiceSummary).not.toBe('');
    });
  });

  describe('buildDigest - weekly', () => {
    it('returns different structure from daily', async () => {
      setWeeklyDbResponses();
      const svc = makeService();
      const result = await svc.buildDigest('user-1', 'weekly');

      expect(result.title).toContain('Weekly');
      const weeklySection = result.sections.find((s) => s.label.includes('week'));
      expect(weeklySection).toBeDefined();
    });
  });

  describe('buildDigest - monthly', () => {
    it('returns monthly title', async () => {
      setWeeklyDbResponses(250000);
      const svc = makeService();
      const result = await svc.buildDigest('user-1', 'monthly');

      expect(result.title).toContain('Monthly');
    });
  });

  describe('deliver', () => {
    it('dispatches notification with dedupeKey', async () => {
      setDailyDbResponses();
      mockNotifications.findByMetadata.mockResolvedValue(false);
      const svc = makeService();
      const delivered = await svc.deliver('user-1', 'daily');

      expect(delivered).toBe(true);
      expect(mockNotifications.createAndDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'digest',
          dedupeKey: expect.stringContaining('digest_daily_user-1_'),
        }),
      );
    });

    it('skips dispatch when already delivered (idempotent)', async () => {
      mockNotifications.findByMetadata.mockResolvedValue(true);
      const svc = makeService();
      const delivered = await svc.deliver('user-1', 'daily');

      expect(delivered).toBe(false);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });

    it('includes voiceSummary in dispatch', async () => {
      setDailyDbResponses();
      mockNotifications.findByMetadata.mockResolvedValue(false);
      const svc = makeService();
      await svc.deliver('user-1', 'daily');

      const call = mockNotifications.createAndDispatch.mock.calls[0][0];
      expect(call.voiceSummary).toBeTruthy();
      expect(typeof call.voiceSummary).toBe('string');
    });

    it('returns false when user settings not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      const svc = makeService();
      const delivered = await svc.deliver('user-999', 'daily');

      expect(delivered).toBe(false);
      expect(mockNotifications.createAndDispatch).not.toHaveBeenCalled();
    });
  });

  describe('deliverAllEnabled', () => {
    it('delivers to all users with the period enabled', async () => {
      // First limit() call → list of user IDs from deliverAllEnabled
      // Subsequent limit() calls → getUserSettings for each user
      mockDb.limit
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]) // deliverAllEnabled select
        .mockResolvedValue([{ timezone: 'America/New_York' }]);       // getUserSettings per user

      setDailyDbResponses();
      setDailyDbResponses();
      mockNotifications.findByMetadata.mockResolvedValue(false);

      const svc = makeService();
      await svc.deliverAllEnabled('daily');

      expect(mockNotifications.createAndDispatch).toHaveBeenCalledTimes(2);
    });

    it('continues after one user delivery fails', async () => {
      mockDb.limit
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]) // deliverAllEnabled
        .mockResolvedValueOnce([{ timezone: 'America/New_York' }])   // u1 getUserSettings
        .mockResolvedValueOnce([{ timezone: 'America/New_York' }]);  // u2 getUserSettings

      mockNotifications.findByMetadata.mockResolvedValue(false);
      // u1: spend query throws; u2: succeed
      mockDb.execute
        .mockRejectedValueOnce(new Error('DB error for u1')) // u1 spend
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })    // u2 spend
        .mockResolvedValueOnce({ rows: [] })                 // u2 accounts
        .mockResolvedValueOnce({ rows: [] });                // u2 budgets

      const svc = makeService();
      await expect(svc.deliverAllEnabled('daily')).resolves.not.toThrow();
      // u2 should still dispatch
      expect(mockNotifications.createAndDispatch).toHaveBeenCalledTimes(1);
    });
  });
});
