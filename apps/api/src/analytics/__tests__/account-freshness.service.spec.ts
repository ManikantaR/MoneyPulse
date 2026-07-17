import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AccountFreshnessService } from '../account-freshness.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

describe('AccountFreshnessService', () => {
  let service: AccountFreshnessService;
  let mockDb: any;

  const TEST_USER_ID = 'test-user-id';
  const TEST_ACCOUNT_ID = 'test-account-id';

  beforeEach(async () => {
    // Create a more sophisticated mock that can handle method chaining
    const whereChain = {
      where: vi.fn(),
    };
    const fromChain = {
      from: vi.fn().mockReturnValue(whereChain),
    };

    mockDb = {
      select: vi.fn().mockReturnValue(fromChain),
      execute: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountFreshnessService,
        {
          provide: DATABASE_CONNECTION,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<AccountFreshnessService>(AccountFreshnessService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAccountFreshness', () => {
    it('should correctly identify fresh and stale accounts', async () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const staleTxnDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago

      // Setup chaining for userSettings query
      const userSettingsWhere = vi.fn().mockResolvedValue([
        { freshnessThresholdDays: 14 },
      ]);
      mockDb.select().from = vi.fn().mockReturnValue({
        where: userSettingsWhere,
      });

      // Setup chaining for accounts query
      const accountsWhere = vi.fn().mockResolvedValue([
        {
          id: 'acc-1',
          nickname: 'Chase Checking',
          institution: 'chase',
          isDormant: false,
          expectedImportCadenceDays: null,
        },
        {
          id: 'acc-2',
          nickname: 'Old Savings',
          institution: 'chase',
          isDormant: false,
          expectedImportCadenceDays: null,
        },
      ]);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First call for user settings
          return {
            from: () => ({
              where: userSettingsWhere,
            }),
          };
        } else {
          // Second call for accounts
          return {
            from: () => ({
              where: accountsWhere,
            }),
          };
        }
      });

      // Mock execute calls for transaction/import queries
      mockDb.execute
        // acc-1 transaction date (fresh)
        .mockResolvedValueOnce({
          rows: [{ date: recentDate.toISOString() }],
        })
        // acc-1 import date
        .mockResolvedValueOnce({
          rows: [{ updated_at: now.toISOString() }],
        })
        // acc-2 transaction date (stale)
        .mockResolvedValueOnce({
          rows: [{ date: staleTxnDate.toISOString() }],
        })
        // acc-2 import date
        .mockResolvedValueOnce({
          rows: [{ updated_at: staleTxnDate.toISOString() }],
        });

      const result = await service.getAccountFreshness(TEST_USER_ID);

      expect(result.accounts).toHaveLength(2);
      expect(result.accounts[0].status).toBe('fresh');
      expect(result.accounts[1].status).toBe('stale');
      expect(result.coverage.freshAccounts).toBe(1);
      expect(result.coverage.staleAccounts).toBe(1);
      expect(result.coverage.activeAccounts).toBe(2);
    });
  });
});
