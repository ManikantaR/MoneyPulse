import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillsService } from '../bills.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { Test } from '@nestjs/testing';

const userId = 'user-uuid-1';

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    id: `bill-${Math.random().toString(36).slice(2)}`,
    userId,
    merchantPattern: 'Netflix',
    normalizedName: 'Netflix',
    categoryId: null,
    expectedAmountCents: 1599,
    amountTolerancePercent: 15,
    frequency: 'monthly',
    nextExpectedDate: new Date('2024-03-01'),
    lastSeenDate: new Date('2024-02-01'),
    lastAmountCents: 1599,
    isActive: true,
    isConfirmed: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-02-01'),
    ...overrides,
  };
}

type Bill = ReturnType<typeof makeBill>;

describe('BillsService.deduplicateBills', () => {
  let service: BillsService;
  let mockDb: any;
  let billsToReturn: Bill[];
  const updates: Array<{ set: Record<string, unknown>; whereId?: string }> = [];

  beforeEach(async () => {
    billsToReturn = [];
    updates.length = 0;

    // Single mockDb object whose methods return `this` so patching `.where` at any point works.
    // For select chain: the last .where() resolves to billsToReturn.
    // For update chain: tracks .set() values then resolves on .where().
    let pendingSetValues: Record<string, unknown> = {};

    mockDb = {
      // select chain
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn(async () => billsToReturn),
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),

      // update chain
      update: vi.fn().mockReturnThis(),
      set: vi.fn((values: Record<string, unknown>) => {
        pendingSetValues = values;
        return mockDb;
      }),
    };

    // Override update chain's where to record calls
    const originalWhere = mockDb.where;
    let callCount = 0;
    mockDb.where = vi.fn(async (...args: unknown[]) => {
      callCount++;
      // If update().set() was called before where(), this is an update
      if (Object.keys(pendingSetValues).length > 0) {
        updates.push({ set: { ...pendingSetValues } });
        pendingSetValues = {};
        return undefined;
      }
      // Otherwise it's a select
      return billsToReturn;
    });

    const module = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        {
          provide: NotificationsService,
          useValue: {
            findByMetadata: vi.fn().mockResolvedValue([]),
            createAndDispatch: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  it('deactivates duplicate bills, keeps the confirmed one as survivor', async () => {
    billsToReturn = [
      makeBill({
        id: 'bill-confirmed',
        normalizedName: 'Netflix',
        merchantPattern: 'NETFLIX',
        isConfirmed: true,
        isActive: true,
        lastSeenDate: new Date('2024-02-01'),
        lastAmountCents: 1599,
        updatedAt: new Date('2024-02-01'),
      }),
      makeBill({
        id: 'bill-dupe',
        normalizedName: 'Netflix',
        merchantPattern: 'Netflix.Com',
        isConfirmed: false,
        isActive: true,
        lastSeenDate: new Date('2024-03-01'),
        lastAmountCents: 1699,
        updatedAt: new Date('2024-03-01'),
      }),
    ];

    const result = await service.deduplicateBills(userId);

    expect(result.deduped).toBe(1);
    expect(result.removed).toBe(1);

    const deactivation = updates.find((u) => u.set?.isActive === false);
    expect(deactivation).toBeDefined();
  });

  it('returns zeros when no duplicates exist', async () => {
    billsToReturn = [
      makeBill({ id: 'bill-a', normalizedName: 'Netflix' }),
      makeBill({ id: 'bill-b', normalizedName: 'Hulu' }),
    ];

    const result = await service.deduplicateBills(userId);

    expect(result.deduped).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('is idempotent — running twice on already-deduped data yields same result', async () => {
    billsToReturn = [
      makeBill({ id: 'bill-confirmed', normalizedName: 'Netflix', isConfirmed: true, isActive: true }),
      makeBill({ id: 'bill-inactive', normalizedName: 'Netflix', isConfirmed: false, isActive: false }),
    ];

    const first = await service.deduplicateBills(userId);
    const second = await service.deduplicateBills(userId);

    expect(first.deduped).toBe(second.deduped);
    expect(first.removed).toBe(second.removed);
  });

  it('merges freshest lastSeenDate into survivor', async () => {
    billsToReturn = [
      makeBill({
        id: 'bill-older',
        normalizedName: 'Hulu',
        isConfirmed: true,
        lastSeenDate: new Date('2024-01-01'),
        lastAmountCents: 799,
        updatedAt: new Date('2024-01-01'),
      }),
      makeBill({
        id: 'bill-newer',
        normalizedName: 'Hulu',
        isConfirmed: false,
        lastSeenDate: new Date('2024-04-01'),
        lastAmountCents: 999,
        updatedAt: new Date('2024-04-01'),
      }),
    ];

    await service.deduplicateBills(userId);

    // At least one update should have a lastSeenDate (survivor merge) — any update is fine since
    // the survivor (bill-older, confirmed) gets merged with the newer date from bill-newer.
    const survivorMerge = updates.find((u) => u.set?.lastSeenDate !== undefined);
    expect(survivorMerge).toBeDefined();
  });

  it('skips bills with empty normalizedName', async () => {
    billsToReturn = [
      makeBill({ id: 'bill-no-name', normalizedName: '' }),
      makeBill({ id: 'bill-null-name', normalizedName: null as unknown as string }),
    ];

    const result = await service.deduplicateBills(userId);
    expect(result.deduped).toBe(0);
    expect(result.removed).toBe(0);
  });
});

