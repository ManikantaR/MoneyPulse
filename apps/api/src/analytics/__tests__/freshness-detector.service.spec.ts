import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FreshnessDetectorService } from '../freshness-detector.service';
import { AccountFreshnessService } from '../account-freshness.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

describe('FreshnessDetectorService', () => {
  let service: FreshnessDetectorService;
  let mockDb: any;
  let mockFreshnessService: any;

  const TEST_USER_ID = 'test-user-id';

  beforeEach(async () => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn(),
      execute: vi.fn(),
    };

    mockFreshnessService = {
      getAccountFreshness: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FreshnessDetectorService,
        {
          provide: DATABASE_CONNECTION,
          useValue: mockDb,
        },
        {
          provide: AccountFreshnessService,
          useValue: mockFreshnessService,
        },
      ],
    }).compile();

    service = module.get<FreshnessDetectorService>(FreshnessDetectorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectUserFreshness', () => {
    it('should create insight for stale account', async () => {
      const now = new Date();
      const staleTxnDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      mockFreshnessService.getAccountFreshness.mockResolvedValue({
        accounts: [
          {
            accountId: 'acc-1',
            nickname: 'Chase Checking',
            status: 'stale',
            lastTransactionDate: staleTxnDate,
            staleDays: 20,
          },
        ],
        coverage: {
          activeAccounts: 1,
          freshAccounts: 0,
          staleAccounts: 1,
        },
        overallCoverage: '0 of 1',
      });

      // No existing insight found
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      // Insert success
      mockDb.execute.mockResolvedValueOnce({ rows: [{ id: 'notification-id' }] });

      const insights = await service.detectUserFreshness(TEST_USER_ID);

      expect(insights).toHaveLength(1);
      expect(insights[0].accountId).toBe('acc-1');
      expect(insights[0].staleDays).toBe(20);
      expect(insights[0].message).toContain('Chase Checking');
    });

    it('should not create duplicate insights within a week', async () => {
      const now = new Date();
      const staleTxnDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      mockFreshnessService.getAccountFreshness.mockResolvedValue({
        accounts: [
          {
            accountId: 'acc-1',
            nickname: 'Chase Checking',
            status: 'stale',
            lastTransactionDate: staleTxnDate,
            staleDays: 20,
          },
        ],
        coverage: {
          activeAccounts: 1,
          freshAccounts: 0,
          staleAccounts: 1,
        },
        overallCoverage: '0 of 1',
      });

      // Existing insight found
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ id: 'existing-notification' }],
      });

      const insights = await service.detectUserFreshness(TEST_USER_ID);

      expect(insights).toHaveLength(0);
    });

    it('should skip fresh and dormant accounts', async () => {
      mockFreshnessService.getAccountFreshness.mockResolvedValue({
        accounts: [
          {
            accountId: 'acc-1',
            nickname: 'Chase Checking',
            status: 'fresh',
            lastTransactionDate: new Date(),
            staleDays: 5,
          },
          {
            accountId: 'acc-2',
            nickname: 'Old Savings',
            status: 'dormant',
            lastTransactionDate: null,
            staleDays: 0,
          },
        ],
        coverage: {
          activeAccounts: 1,
          freshAccounts: 1,
          staleAccounts: 0,
        },
        overallCoverage: '1 of 1',
      });

      const insights = await service.detectUserFreshness(TEST_USER_ID);

      expect(insights).toHaveLength(0);
    });
  });

  describe('detectAllFreshness', () => {
    it('should check freshness for all users', async () => {
      const now = new Date();
      const staleTxnDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      // Mock: Get all users
      mockDb.where = vi.fn().mockResolvedValueOnce([
        { id: 'user-1' },
        { id: 'user-2' },
      ]);

      mockFreshnessService.getAccountFreshness
        // User 1 has stale account
        .mockResolvedValueOnce({
          accounts: [
            {
              accountId: 'acc-1',
              nickname: 'Chase Checking',
              status: 'stale',
              lastTransactionDate: staleTxnDate,
              staleDays: 20,
            },
          ],
          coverage: { activeAccounts: 1, freshAccounts: 0, staleAccounts: 1 },
          overallCoverage: '0 of 1',
        })
        // User 2 has fresh accounts
        .mockResolvedValueOnce({
          accounts: [
            {
              accountId: 'acc-2',
              nickname: 'BOA Checking',
              status: 'fresh',
              lastTransactionDate: new Date(),
              staleDays: 0,
            },
          ],
          coverage: { activeAccounts: 1, freshAccounts: 1, staleAccounts: 0 },
          overallCoverage: '1 of 1',
        });

      // Mock: No existing insight for user-1
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      // Insert for user-1
      mockDb.execute.mockResolvedValueOnce({ rows: [{ id: 'notification-id' }] });

      const insights = await service.detectAllFreshness();

      expect(insights).toHaveLength(1);
      expect(insights[0].userId).toBe('user-1');
    });
  });
});
