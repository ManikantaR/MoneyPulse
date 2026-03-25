import { DedupService } from '../dedup.service';

describe('DedupService', () => {
  let service: DedupService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    service = new DedupService(mockDb);
    (service as any).db = mockDb;
  });

  it('should compute deterministic hash', () => {
    const hash1 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'WHOLE FOODS',
      amountCents: 8523,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    const hash2 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'WHOLE FOODS',
      amountCents: 8523,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different amounts', () => {
    const hash1 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 100,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    const hash2 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 200,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for credit vs debit', () => {
    const hash1 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 100,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    const hash2 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 100,
      isCredit: true,
      merchantName: null,
      runningBalanceCents: null,
    });
    expect(hash1).not.toBe(hash2);
  });

  it('should detect intra-batch duplicates', async () => {
    mockDb.where.mockResolvedValue([]); // no existing transactions

    const txn = {
      externalId: null,
      date: '2026-03-15',
      description: 'DUPLICATE',
      amountCents: 1000,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    };

    const result = await service.dedup('acc-1', [txn, { ...txn }]);
    expect(result.newTransactions).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
  });

  it('should skip transactions with existing hash', async () => {
    // Simulate existing hashes in DB
    const existingHash = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'EXISTING',
      amountCents: 500,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });

    // Override to return hash set (new method names)
    (service as any).getMatchingHashes = vi
      .fn()
      .mockResolvedValue(new Set([existingHash]));
    (service as any).getMatchingExternalIds = vi
      .fn()
      .mockResolvedValue(new Set());

    const txn = {
      externalId: null,
      date: '2026-03-15',
      description: 'EXISTING',
      amountCents: 500,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    };

    const result = await service.dedup('acc-1', [txn]);
    expect(result.newTransactions).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it('should skip transactions with matching external_id', async () => {
    (service as any).getMatchingHashes = vi.fn().mockResolvedValue(new Set());
    (service as any).getMatchingExternalIds = vi
      .fn()
      .mockResolvedValue(new Set(['REF-123']));

    const txn = {
      externalId: 'REF-123',
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 1000,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    };

    const result = await service.dedup('acc-1', [txn]);
    expect(result.newTransactions).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it('should return empty result for empty input', async () => {
    const result = await service.dedup('acc-1', []);
    expect(result.newTransactions).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });
});
