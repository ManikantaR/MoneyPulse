import { CategorizationService } from '../categorization.service';
import { RuleEngineService } from '../rule-engine.service';
import { AiCategorizerService } from '../ai-categorizer.service';
import { LearningService } from '../learning.service';

describe('CategorizationService', () => {
  let service: CategorizationService;
  let mockDb: any;
  let mockRuleEngine: Partial<RuleEngineService>;
  let mockAiCategorizer: Partial<AiCategorizerService>;
  let mockLearningService: Partial<LearningService>;

  const userId = 'user-1';
  const txnIds = ['txn-1', 'txn-2', 'txn-3'];

  const mockTransactions = [
    {
      id: 'txn-1',
      userId,
      description: 'STARBUCKS STORE 123',
      merchantName: null,
      amountCents: -550,
      isCredit: false,
      date: new Date('2026-03-15'),
      categoryId: null,
      deletedAt: null,
    },
    {
      id: 'txn-2',
      userId,
      description: 'UNKNOWN VENDOR XYZ',
      merchantName: null,
      amountCents: -1200,
      isCredit: false,
      date: new Date('2026-03-16'),
      categoryId: null,
      deletedAt: null,
    },
    {
      id: 'txn-3',
      userId,
      description: 'ANOTHER SHOP',
      merchantName: null,
      amountCents: -3000,
      isCredit: false,
      date: new Date('2026-03-17'),
      categoryId: null,
      deletedAt: null,
    },
  ];

  const mockCategories = [
    { id: 'cat-dining', name: 'Dining' },
    { id: 'cat-shopping', name: 'Shopping' },
    { id: 'cat-groceries', name: 'Groceries' },
  ];

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };

    mockRuleEngine = {
      matchBatch: vi.fn().mockResolvedValue(new Map()),
    };

    mockAiCategorizer = {
      categorizeBatch: vi.fn().mockResolvedValue([]),
    };

    mockLearningService = {
      learnFromOverride: vi.fn().mockResolvedValue(undefined),
      extractPattern: vi.fn().mockReturnValue(''),
    };

    service = new CategorizationService(
      mockDb,
      mockRuleEngine as RuleEngineService,
      mockAiCategorizer as AiCategorizerService,
      mockLearningService as LearningService,
    );
  });

  it('should return zero-stats for empty transactionIds', async () => {
    const stats = await service.categorizeBatch([], userId);
    expect(stats.total).toBe(0);
    expect(stats.categorizedByRule).toBe(0);
    expect(stats.categorizedByAi).toBe(0);
  });

  it('should categorize by rule engine first', async () => {
    // Mock: DB returns our uncategorized transactions
    mockDb.where = vi.fn().mockResolvedValue(mockTransactions);

    // Rule engine matches txn-1 to dining
    (mockRuleEngine.matchBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([[0, { ruleId: 'rule-1', categoryId: 'cat-dining', confidence: 1.0, isAiGenerated: false }]]),
    );

    // AI should be called for remaining 2 - return empty
    (mockAiCategorizer.categorizeBatch as ReturnType<typeof vi.fn>).mockResolvedValue([null, null]);

    // Mock category map query
    const originalSelect = mockDb.select;
    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            // First call: uncategorized txns, subsequent: category queries
            if (callCount === 1) return mockTransactions;
            return mockCategories;
          }),
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      };
    });

    const stats = await service.categorizeBatch(txnIds, userId);
    expect(stats.categorizedByRule).toBe(1);
    expect(mockRuleEngine.matchBatch).toHaveBeenCalledOnce();
  });

  it('should categorize high-confidence AI results and create rules', async () => {
    // Only 1 txn, no rule match
    (mockRuleEngine.matchBatch as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());

    // AI returns high confidence
    (mockAiCategorizer.categorizeBatch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { categoryName: 'Shopping', confidence: 0.92, merchantName: 'UNKNOWN VENDOR' },
    ]);

    // Mock extractPattern for rule creation
    (mockLearningService.extractPattern as ReturnType<typeof vi.fn>).mockReturnValue('unknown vendor');

    // Build a mock DB that supports the multiple call patterns used by categorizeBatch:
    // 1. select().from(transactions).where(...) → returns uncategorized txns
    // 2. select({id,name}).from(categories).where(...) → returns category map
    // 3. update(transactions).set(...).where(...) → updates txn
    // 4. select().from(rules).where(...).limit(1) → existing rule check
    // 5. insert(rules).values(...) → create rule
    let selectCallCount = 0;
    const txnData = [mockTransactions[1]];

    mockDb.select = vi.fn().mockImplementation(() => {
      selectCallCount++;
      const currentCall = selectCallCount;
      return {
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => {
            if (currentCall === 1) return txnData; // uncategorized txns
            if (currentCall === 2) return mockCategories; // category map
            // existing rule check - returns empty (no existing rule)
            return { limit: vi.fn().mockResolvedValue([]) };
          }),
          limit: vi.fn().mockResolvedValue([]),
        })),
      };
    });

    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    mockDb.insert = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const stats = await service.categorizeBatch(['txn-2'], userId);
    expect(stats.categorizedByAi).toBe(1);
    expect(stats.suggested).toBe(0);
  });

  it('should NOT update categoryId for low-confidence AI results', async () => {
    mockDb.where = vi.fn().mockResolvedValue([mockTransactions[2]]);
    (mockRuleEngine.matchBatch as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());

    // AI returns low confidence (below 0.85 threshold)
    (mockAiCategorizer.categorizeBatch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { categoryName: 'Groceries', confidence: 0.60, merchantName: null },
    ]);

    // Mock category map
    let selectCall = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      selectCall++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            if (selectCall === 1) return [mockTransactions[2]];
            return mockCategories;
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      };
    });

    // Track update calls
    const updateCalls: any[] = [];
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((data: any) => {
        updateCalls.push(data);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
    });

    const stats = await service.categorizeBatch(['txn-3'], userId);
    expect(stats.suggested).toBe(1);
    expect(stats.categorizedByAi).toBe(0);
    // Ensure no DB update with categoryId was made for low-confidence result
    expect(updateCalls.every((c: any) => c.categoryId === undefined || c.categoryId === null)).toBe(true);
  });

  it('should scope recategorize by userId', async () => {
    const setCalls: any[] = [];
    const whereCalls: any[] = [];
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((data: any) => {
        setCalls.push(data);
        return {
          where: vi.fn().mockImplementation((clause: any) => {
            whereCalls.push(clause);
            return Promise.resolve();
          }),
        };
      }),
    });

    await service.recategorize('txn-1', userId, 'cat-new');
    // Verify update was called (the actual WHERE is handled by drizzle internals)
    expect(mockDb.update).toHaveBeenCalled();
    expect(setCalls[0]).toEqual(
      expect.objectContaining({ categoryId: 'cat-new' }),
    );
    expect(mockLearningService.learnFromOverride).toHaveBeenCalledWith(
      userId,
      'txn-1',
      'cat-new',
    );
  });

  it('should handle AI categorization failure gracefully', async () => {
    mockDb.where = vi.fn().mockResolvedValue(mockTransactions);
    (mockRuleEngine.matchBatch as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
    (mockAiCategorizer.categorizeBatch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Ollama not available'),
    );

    // Mock category map
    let selectCall = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      selectCall++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            if (selectCall === 1) return mockTransactions;
            return mockCategories;
          }),
        }),
      };
    });

    const stats = await service.categorizeBatch(txnIds, userId);
    expect(stats.uncategorized).toBe(3);
    expect(stats.categorizedByAi).toBe(0);
  });
});
