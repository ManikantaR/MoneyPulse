import { RuleEngineService } from '../rule-engine.service';

describe('RuleEngineService', () => {
  let service: RuleEngineService;
  let mockDb: any;

  const mockRules = [
    {
      id: '1',
      userId: null,
      pattern: '^payroll',
      matchType: 'regex',
      field: 'description',
      categoryId: 'cat-income',
      priority: 10,
      confidence: 1.0,
      isAiGenerated: false,
      deletedAt: null,
    },
    {
      id: '2',
      userId: null,
      pattern: 'starbucks',
      matchType: 'contains',
      field: 'description',
      categoryId: 'cat-dining',
      priority: 20,
      confidence: 1.0,
      isAiGenerated: false,
      deletedAt: null,
    },
    {
      id: '3',
      userId: 'user-1',
      pattern: 'whole foods',
      matchType: 'contains',
      field: 'description',
      categoryId: 'cat-grocery',
      priority: 20,
      confidence: 1.0,
      isAiGenerated: false,
      deletedAt: null,
    },
    {
      id: '4',
      userId: null,
      pattern: 'amazon',
      matchType: 'contains',
      field: 'description',
      categoryId: 'cat-shopping',
      priority: 25,
      confidence: 1.0,
      isAiGenerated: false,
      deletedAt: null,
    },
  ];

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(mockRules),
    };
    service = new RuleEngineService(mockDb);
    (service as any).db = mockDb;
  });

  it('should match "contains" rule', async () => {
    const result = await service.matchTransaction(
      'starbucks store 12345',
      null,
      'user-1',
    );
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-dining');
  });

  it('should match regex rule', async () => {
    const result = await service.matchTransaction(
      'payroll direct deposit',
      null,
      'user-1',
    );
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-income');
  });

  it('should respect priority (lower number = higher priority)', async () => {
    const result = await service.matchTransaction(
      'payroll at starbucks',
      null,
      'user-1',
    );
    expect(result!.categoryId).toBe('cat-income');
  });

  it('should return null for no match', async () => {
    const result = await service.matchTransaction(
      'xyz unknown merchant',
      null,
      'user-1',
    );
    expect(result).toBeNull();
  });

  it('should include user-specific rules', async () => {
    const result = await service.matchTransaction(
      'whole foods market',
      null,
      'user-1',
    );
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-grocery');
  });

  it('should match batch of transactions', async () => {
    const results = await service.matchBatch(
      [
        { description: 'starbucks coffee', merchantName: null },
        { description: 'xyz unknown', merchantName: null },
        { description: 'amazon purchase', merchantName: null },
      ],
      'user-1',
    );
    expect(results.size).toBe(2);
    expect(results.get(0)!.categoryId).toBe('cat-dining');
    expect(results.has(1)).toBe(false);
    expect(results.get(2)!.categoryId).toBe('cat-shopping');
  });
});
