import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LoansService } from '../loans.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { NotificationsService } from '../../notifications/notifications.service';

describe('LoansService — loan balance snapshots', () => {
  let service: LoansService;
  let mockDb: any;

  const loan = {
    id: 'loan-1',
    userId: 'user-1',
    name: 'Mortgage',
    loanType: 'mortgage',
    lenderPattern: 'wells fargo',
    extraPrincipalPattern: null,
    originalBalanceCents: 300_000_00,
    aprBps: 500, // 5%
    scheduledPaymentCents: 1_600_00,
    startDate: '2020-01-01',
    deletedAt: null,
  };

  beforeEach(async () => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([loan]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
  });

  describe('getBalanceForMonth', () => {
    it('uses the manual_statement balance when one exists for the month, and reports its source', async () => {
      mockDb.limit
        .mockResolvedValueOnce([loan]) // requireOwnedLoan
        .mockResolvedValueOnce([
          {
            snapshotMonth: '2026-06-01',
            balanceCents: 275_000_00,
            source: 'manual_statement',
            verifiedAt: null,
            notes: 'June statement',
          },
        ]); // manual lookup

      const result = await service.getBalanceForMonth('loan-1', 'user-1', '2026-06-01');

      expect(result).toEqual({
        snapshotMonth: '2026-06-01',
        balanceCents: 275_000_00,
        source: 'manual_statement',
        verifiedAt: null,
        notes: 'June statement',
      });
    });

    it('falls back to the amortized estimate when no manual statement exists for the month', async () => {
      mockDb.limit
        .mockResolvedValueOnce([loan]) // requireOwnedLoan
        .mockResolvedValueOnce([]); // no manual_statement row
      // No extraPrincipalPattern on this loan, so no transactions query is made.

      const result = await service.getBalanceForMonth('loan-1', 'user-1', '2026-06-01');

      expect(result.source).toBe('amortized');
      expect(result.balanceCents).toBeGreaterThan(0);
      expect(result.balanceCents).toBeLessThan(loan.originalBalanceCents);
    });

    it('throws NotFoundException for a loan the user does not own', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(
        service.getBalanceForMonth('loan-x', 'user-1', '2026-06-01'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsertBalanceSnapshot', () => {
    it('always writes source=manual_statement regardless of amortized data', async () => {
      mockDb.limit.mockResolvedValueOnce([loan]); // requireOwnedLoan
      mockDb.returning.mockResolvedValueOnce([
        { loanId: 'loan-1', snapshotMonth: '2026-06-01', balanceCents: 275_000_00, source: 'manual_statement' },
      ]);

      const result = await service.upsertBalanceSnapshot('loan-1', 'user-1', '2026-06-01', {
        balanceCents: 275_000_00,
        source: 'manual_statement',
      });

      const values = mockDb.values.mock.calls.at(-1)[0];
      expect(values.source).toBe('manual_statement');
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
      expect(result.balanceCents).toBe(275_000_00);
    });
  });
});
