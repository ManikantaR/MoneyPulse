import { CategoriesService } from '../categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let mockDb: any;

  const mockCategories = [
    {
      id: 'cat-1',
      name: 'Income',
      icon: '💰',
      color: '#22c55e',
      parentId: null,
      sortOrder: 1,
      deletedAt: null,
    },
    {
      id: 'cat-2',
      name: 'Groceries',
      icon: '🛒',
      color: '#f97316',
      parentId: null,
      sortOrder: 2,
      deletedAt: null,
    },
    {
      id: 'cat-3',
      name: 'Organic',
      icon: '🌿',
      color: '#22c55e',
      parentId: 'cat-2',
      sortOrder: 1,
      deletedAt: null,
    },
  ];

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(mockCategories),
      limit: vi.fn().mockResolvedValue([mockCategories[0]]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          id: 'cat-new',
          name: 'Test',
          icon: '🧪',
          color: '#000000',
          parentId: null,
          sortOrder: 0,
        },
      ]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    service = new CategoriesService(mockDb);
    (service as any).db = mockDb;
  });

  it('should find all categories', async () => {
    const result = await service.findAll();
    expect(result).toEqual(mockCategories);
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('should find category by ID', async () => {
    const result = await service.findById('cat-1');
    expect(result).toEqual(mockCategories[0]);
  });

  it('should create a category', async () => {
    const result = await service.create({
      name: 'Test',
      icon: '🧪',
      color: '#000000',
    });
    expect(result).toBeDefined();
    expect(result.name).toBe('Test');
  });

  it('should prevent self-referencing parent', async () => {
    await expect(
      service.update('cat-1', { parentId: 'cat-1' }),
    ).rejects.toThrow('Category cannot be its own parent');
  });

  it('should soft delete via execute', async () => {
    await service.softDelete('cat-1');
    expect(mockDb.execute).toHaveBeenCalled();
  });

  describe('isTransfer', () => {
    it('creates a category with isTransfer=true when specified', async () => {
      mockDb.returning.mockResolvedValue([
        { id: 'cat-new', name: 'Transfers', icon: '🔄', color: '#6b7280', parentId: null, sortOrder: 0, isTransfer: true },
      ]);
      const result = await service.create({
        name: 'Transfers',
        icon: '🔄',
        color: '#6b7280',
        isTransfer: true,
      });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ isTransfer: true }),
      );
      expect(result.isTransfer).toBe(true);
    });

    it('defaults isTransfer to false when not specified', async () => {
      await service.create({ name: 'Groceries', icon: '🛒', color: '#f97316' });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ isTransfer: false }),
      );
    });

    it('findTree maps is_transfer from raw SQL result', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          { id: 'cat-1', name: 'Transfers', icon: '🔄', color: '#6b7280', parent_id: null, sort_order: 0, is_transfer: true, depth: 0 },
          { id: 'cat-2', name: 'Groceries', icon: '🛒', color: '#f97316', parent_id: null, sort_order: 1, is_transfer: false, depth: 0 },
        ],
      });
      const result = await service.findTree();
      const transfers = result.find((r: any) => r.name === 'Transfers');
      const groceries = result.find((r: any) => r.name === 'Groceries');
      expect(transfers?.isTransfer).toBe(true);
      expect(groceries?.isTransfer).toBe(false);
    });
  });
});
