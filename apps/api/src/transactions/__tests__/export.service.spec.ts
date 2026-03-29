import { ExportService } from '../export.service';

describe('ExportService', () => {
  let service: ExportService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    service = new ExportService(mockDb);
  });

  it('should export CSV with correct headers', async () => {
    mockDb.orderBy.mockResolvedValue([]);

    const csv = await service.exportCsv('user-1');

    expect(csv).toContain('Date,Description,Amount,Type,Category,Merchant,Account');
  });

  it('should format transactions as CSV rows', async () => {
    mockDb.orderBy.mockResolvedValue([
      {
        date: new Date('2026-01-15'),
        description: 'WHOLE FOODS MARKET',
        amountCents: 8523,
        isCredit: false,
        categoryName: 'Groceries',
        merchantName: 'Whole Foods',
        accountNickname: 'BofA Checking',
      },
      {
        date: new Date('2026-01-14'),
        description: 'PAYROLL DEPOSIT',
        amountCents: 320000,
        isCredit: true,
        categoryName: 'Income',
        merchantName: null,
        accountNickname: 'BofA Checking',
      },
    ]);

    const csv = await service.exportCsv('user-1');
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain('85.23');
    expect(lines[1]).toContain('Debit');
    expect(lines[1]).toContain('Groceries');
    expect(lines[2]).toContain('3200.00');
    expect(lines[2]).toContain('Credit');
  });

  it('should handle descriptions with commas and quotes', async () => {
    mockDb.orderBy.mockResolvedValue([
      {
        date: new Date('2026-01-15'),
        description: 'STORE "NAME", INC.',
        amountCents: 5000,
        isCredit: false,
        categoryName: null,
        merchantName: null,
        accountNickname: 'Chase',
      },
    ]);

    const csv = await service.exportCsv('user-1');
    // CSV should escape quotes by doubling them
    expect(csv).toContain('""NAME""');
  });

  it('should filter by date range when provided', async () => {
    mockDb.orderBy.mockResolvedValue([]);

    await service.exportCsv('user-1', '2026-01-01', '2026-01-31');

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
  });

  it('should handle null category and merchant gracefully', async () => {
    mockDb.orderBy.mockResolvedValue([
      {
        date: new Date('2026-01-15'),
        description: 'Unknown Transaction',
        amountCents: 1000,
        isCredit: false,
        categoryName: null,
        merchantName: null,
        accountNickname: null,
      },
    ]);

    const csv = await service.exportCsv('user-1');
    const lines = csv.split('\n');

    // Should not throw; nulls become empty strings
    expect(lines[1]).toContain('10.00');
    expect(lines[1]).toContain('Debit');
  });
});
