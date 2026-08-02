import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MonthlyCloseService } from '../monthly-close.service';
import { DATABASE_CONNECTION } from '../../db/db.module';
import { ManualAssetsService } from '../manual-assets.service';
import { InvestmentsService } from '../../investments/investments.service';
import { LoansService } from '../../loans/loans.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** A chainable query-builder stub: every fluent method returns itself, and it's
 *  awaitable (via `.then`) resolving to `result` — matches how the service calls
 *  Drizzle both with and without a trailing `.limit()`. */
function makeChain(result: any[]) {
  const chain: any = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => Promise.resolve(result);
  chain.then = (resolve: any) => resolve(result);
  return chain;
}

describe('MonthlyCloseService', () => {
  let service: MonthlyCloseService;
  let mockDb: any;
  let notificationsService: { createAndDispatch: any };
  let investmentsService: { getPortfolioValue: any; getPortfolioValueAsOf: any };

  const draftRow = { id: 'snap-1', userId: 'user-1', snapshotMonth: '2026-06-01', status: 'draft' };

  beforeEach(async () => {
    mockDb = {
      select: vi.fn(() => makeChain([])),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([draftRow]),
    };

    notificationsService = { createAndDispatch: vi.fn().mockResolvedValue({}) };
    investmentsService = {
      getPortfolioValue: vi.fn().mockResolvedValue({ totalCents: 0, holdings: [], staleFound: false, missingPriceFound: false }),
      getPortfolioValueAsOf: vi.fn().mockResolvedValue({ totalCents: 0, holdings: [], staleFound: false, missingPriceFound: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyCloseService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: ManualAssetsService, useValue: { findAll: vi.fn().mockResolvedValue([]) } },
        { provide: InvestmentsService, useValue: investmentsService },
        { provide: LoansService, useValue: { getBalanceForMonth: vi.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<MonthlyCloseService>(MonthlyCloseService);
  });

  describe('gatherInputs + draft — end-to-end against an empty fixture', () => {
    it('produces a calculable, all-zero close and persists it', async () => {
      const input = await service.gatherInputs('user-1', '2026-06');
      expect(input.month).toBe('2026-06-01');
      expect(input.takeHomeIncomeCents).toBe(0);
      expect(input.transactions).toEqual([]);
      expect(input.freshness).toEqual({
        missingManualAssets: [],
        staleAccounts: [],
        unverifiedLoans: [],
        missingInvestmentPrices: [],
      });

      const saved = await service.draft('user-1', '2026-06');
      expect(saved).toEqual(draftRow);
      // No existing row (select resolves []) -> insert path, not update.
      expect(mockDb.insert).toHaveBeenCalledWith(expect.anything());
    });

    it('flags missingInvestmentPrices instead of silently zeroing the total when a held ticker has no price for the month (#213)', async () => {
      (investmentsService.getPortfolioValueAsOf as any).mockResolvedValue({
        totalCents: 0,
        holdings: [
          {
            investmentAccountId: 'acct-inv',
            ticker: 'VTI',
            shareCount: '10',
            asOf: '2026-06-30',
            isStale: false,
            priceDate: null,
            closeCents: null,
            marketValueCents: null,
          },
        ],
        staleFound: false,
        missingPriceFound: true,
        staleDays: 10,
      });

      const input = await service.gatherInputs('user-1', '2026-06');
      expect(input.investmentAssetCents).toBe(0);
      expect(input.freshness.missingInvestmentPrices).toEqual(['VTI']);
    });
  });

  describe('lifecycle', () => {
    it('recalculate throws NotFoundException when no close exists yet', async () => {
      await expect(service.recalculate('user-1', '2026-06')).rejects.toThrow(NotFoundException);
    });

    it('patch on a confirmed close stamps edited_at + is_edited', async () => {
      mockDb.select = vi.fn(() => makeChain([{ ...draftRow, status: 'confirmed' }]));
      await service.patch('user-1', '2026-06', { notes: 'Adjusted' });

      const setArg = mockDb.set.mock.calls.at(-1)[0];
      expect(setArg.isEdited).toBe(true);
      expect(setArg.editedAt).toBeInstanceOf(Date);
      expect(setArg.notes).toBe('Adjusted');
    });

    it('patch on a draft close does not stamp the audit fields', async () => {
      mockDb.select = vi.fn(() => makeChain([{ ...draftRow, status: 'draft' }]));
      await service.patch('user-1', '2026-06', { notes: 'wip' });

      const setArg = mockDb.set.mock.calls.at(-1)[0];
      expect(setArg.isEdited).toBeUndefined();
      expect(setArg.editedAt).toBeUndefined();
    });

    it('confirm sets status=confirmed + confirmedAt', async () => {
      mockDb.select = vi.fn(() => makeChain([draftRow]));
      await service.confirm('user-1', '2026-06');
      const setArg = mockDb.set.mock.calls.at(-1)[0];
      expect(setArg.status).toBe('confirmed');
      expect(setArg.confirmedAt).toBeInstanceOf(Date);
    });

    it('reopen sets status back to draft', async () => {
      mockDb.select = vi.fn(() => makeChain([{ ...draftRow, status: 'confirmed' }]));
      await service.reopen('user-1', '2026-06');
      const setArg = mockDb.set.mock.calls.at(-1)[0];
      expect(setArg.status).toBe('draft');
    });

    it('confirm on a missing close throws NotFoundException', async () => {
      await expect(service.confirm('user-1', '2026-06')).rejects.toThrow(NotFoundException);
    });
  });

  describe('auto-draft guards confirmed closes', () => {
    it('does not overwrite a close that is already confirmed', async () => {
      mockDb.select = vi.fn(() => makeChain([{ ...draftRow, status: 'confirmed' }]));
      const drafted = await (service as any).draftUnlessConfirmed('user-1', '2026-06-01');
      expect(drafted).toBe(false);
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('drafts a close that does not exist yet', async () => {
      mockDb.select = vi.fn(() => makeChain([]));
      const drafted = await (service as any).draftUnlessConfirmed('user-1', '2026-06-01');
      expect(drafted).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('freshness nudge cap (decision #3)', () => {
    it('skips the nudge when the close is complete', async () => {
      mockDb.select = vi.fn(() => makeChain([{ ...draftRow, freshness: { isComplete: true } }]));
      const sent = await (service as any).maybeNudgeFreshness('user-1', '2026-06-01');
      expect(sent).toBe(false);
      expect(notificationsService.createAndDispatch).not.toHaveBeenCalled();
    });

    it('sends a nudge when incomplete and no recent nudge exists', async () => {
      mockDb.select = vi.fn(() =>
        makeChain([{ ...draftRow, freshness: { isComplete: false, missingManualAssets: ['Home'], staleAccounts: [], unverifiedLoans: [] } }]),
      );
      mockDb.execute = vi.fn().mockResolvedValue({ rows: [{ last_at: null }] });
      const sent = await (service as any).maybeNudgeFreshness('user-1', '2026-06-01');
      expect(sent).toBe(true);
      expect(notificationsService.createAndDispatch).toHaveBeenCalledTimes(1);
    });

    it('suppresses a second nudge within the 2-month cooldown', async () => {
      mockDb.select = vi.fn(() =>
        makeChain([{ ...draftRow, freshness: { isComplete: false, missingManualAssets: ['Home'], staleAccounts: [], unverifiedLoans: [] } }]),
      );
      const recentNudge = new Date(Date.now() - 20 * 24 * 3600_000).toISOString(); // 20 days ago
      mockDb.execute = vi.fn().mockResolvedValue({ rows: [{ last_at: recentNudge }] });
      const sent = await (service as any).maybeNudgeFreshness('user-1', '2026-06-01');
      expect(sent).toBe(false);
      expect(notificationsService.createAndDispatch).not.toHaveBeenCalled();
    });
  });

  describe('runAutoDraftForUser nudge targeting (#231)', () => {
    it('first-run backfill sends at most one freshness nudge, and it targets targetMonth — never an older backfilled month', async () => {
      // No prior closes -> first-run backfill path.
      (service as any).findAll = vi.fn().mockResolvedValue([]);
      // Activity goes back far enough to trigger a multi-month backfill.
      (service as any).earliestActivityMonth = vi.fn().mockResolvedValue('2026-04-01');
      (service as any).draftUnlessConfirmed = vi.fn().mockResolvedValue(true);
      (service as any).findRow = vi.fn().mockResolvedValue(null);
      const nudgeSpy = vi.spyOn(service as any, 'maybeNudgeFreshness').mockResolvedValue(true);

      const targetMonth = '2026-06-01';
      await (service as any).runAutoDraftForUser('user-1', targetMonth);

      expect(nudgeSpy).toHaveBeenCalledTimes(1);
      expect(nudgeSpy).toHaveBeenCalledWith('user-1', targetMonth);
    });

    it('non-first-run still nudges only targetMonth (unchanged behavior)', async () => {
      (service as any).findAll = vi.fn().mockResolvedValue([draftRow]);
      (service as any).draftUnlessConfirmed = vi.fn().mockResolvedValue(false);
      (service as any).findRow = vi.fn().mockResolvedValue(draftRow);
      const nudgeSpy = vi.spyOn(service as any, 'maybeNudgeFreshness').mockResolvedValue(true);

      const targetMonth = '2026-06-01';
      await (service as any).runAutoDraftForUser('user-1', targetMonth);

      expect(nudgeSpy).toHaveBeenCalledTimes(1);
      expect(nudgeSpy).toHaveBeenCalledWith('user-1', targetMonth);
    });
  });
});
