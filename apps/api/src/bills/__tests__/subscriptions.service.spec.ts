import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillsService } from '../bills.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { Test } from '@nestjs/testing';

const userId = 'user-uuid-1';

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    userId,
    merchantPattern: 'Netflix',
    normalizedName: 'Netflix',
    categoryId: null,
    expectedAmountCents: 1599,
    amountTolerancePercent: 15,
    frequency: 'monthly' as const,
    nextExpectedDate: new Date('2024-03-01'),
    lastSeenDate: new Date('2024-02-01'),
    lastAmountCents: 1599,
    isActive: true,
    isConfirmed: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-02-01'),
    ...overrides,
  };
}

describe('BillsService.getSubscriptions', () => {
  let service: BillsService;
  let billsToReturn: ReturnType<typeof makeBill>[];

  beforeEach(async () => {
    billsToReturn = [];

    const mockDb: any = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn(async () => billsToReturn),
      limit: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        {
          provide: NotificationsService,
          useValue: {
            findByMetadata: vi.fn().mockResolvedValue(false),
            createAndDispatch: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(BillsService);
  });

  // ── Annualization math ────────────────────────────────────

  it('monthly × 12 = annual cost', async () => {
    billsToReturn = [makeBill({ frequency: 'monthly', expectedAmountCents: 1599 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.annualCostCents).toBe(1599 * 12); // 19188
  });

  it('weekly × 52 = annual cost', async () => {
    billsToReturn = [makeBill({ frequency: 'weekly', expectedAmountCents: 500 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.annualCostCents).toBe(500 * 52); // 26000
  });

  it('biweekly × 26 = annual cost', async () => {
    billsToReturn = [makeBill({ frequency: 'biweekly', expectedAmountCents: 800 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.annualCostCents).toBe(800 * 26); // 20800
  });

  it('quarterly × 4 = annual cost', async () => {
    billsToReturn = [makeBill({ frequency: 'quarterly', expectedAmountCents: 3000 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.annualCostCents).toBe(3000 * 4); // 12000
  });

  it('semi_annual × 2 = annual cost', async () => {
    billsToReturn = [makeBill({ frequency: 'semi_annual', expectedAmountCents: 5000 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.annualCostCents).toBe(5000 * 2); // 10000
  });

  it('annual × 1 = annual cost', async () => {
    billsToReturn = [makeBill({ frequency: 'annual', expectedAmountCents: 9900 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.annualCostCents).toBe(9900 * 1); // 9900
  });

  // ── Price increase detection ──────────────────────────────

  it('priceIncreased = false when lastAmountCents equals expectedAmountCents', async () => {
    billsToReturn = [makeBill({ expectedAmountCents: 1599, lastAmountCents: 1599, amountTolerancePercent: 15 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.priceIncreased).toBe(false);
  });

  it('priceIncreased = false when within tolerance upper bound', async () => {
    // 1599 * 1.15 = 1838.85, ceil = 1839; 1839 is still within tolerance
    billsToReturn = [makeBill({ expectedAmountCents: 1599, lastAmountCents: 1839, amountTolerancePercent: 15 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.priceIncreased).toBe(false);
  });

  it('priceIncreased = true when lastAmountCents exceeds tolerance upper bound', async () => {
    // 1840 > ceil(1599 * 1.15) = 1839
    billsToReturn = [makeBill({ expectedAmountCents: 1599, lastAmountCents: 1840, amountTolerancePercent: 15 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.priceIncreased).toBe(true);
  });

  it('priceIncreased = false when lastAmountCents is null', async () => {
    billsToReturn = [makeBill({ lastAmountCents: null })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.priceIncreased).toBe(false);
  });

  // ── Shape and name ────────────────────────────────────────

  it('uses normalizedName as the subscription name', async () => {
    billsToReturn = [makeBill({ normalizedName: 'Netflix', merchantPattern: 'NETFLIX.COM' })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.name).toBe('Netflix');
  });

  it('falls back to merchantPattern when normalizedName is null', async () => {
    billsToReturn = [makeBill({ normalizedName: null, merchantPattern: 'HULU.COM' })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.name).toBe('HULU.COM');
  });

  it('returns empty array when no active bills exist', async () => {
    billsToReturn = [];
    const result = await service.getSubscriptions(userId);
    expect(result).toHaveLength(0);
  });

  it('sets amountCents to expectedAmountCents', async () => {
    billsToReturn = [makeBill({ expectedAmountCents: 2499 })];
    const [sub] = await service.getSubscriptions(userId);
    expect(sub.amountCents).toBe(2499);
  });
});
