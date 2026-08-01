import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, vi } from 'vitest';
import { SetupProgressService } from '../setup-progress.service';
import { DATABASE_CONNECTION } from '../../db/db.module';

const TEST_USER_ID = 'test-user-id';

/**
 * Builds a chainable, awaitable query-result stub matching how the service
 * calls the mocked db: `select().from(x)`, `select().from(x).where(y)`, or
 * `select().from(x).innerJoin(y).where(z)`. Each resolves to `rows`.
 */
function makeChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

/**
 * Queries are issued (via Promise.all) in this fixed order inside the service:
 * accounts, fileUploads, paycheckProfiles, userSettings, advisorSettings,
 * suitabilitySettings, loans, loanBalanceSnapshots, investmentAccounts,
 * investmentHoldings, investmentSnapshots, manualAssets,
 * notificationPreferences, pushSubscriptions.
 */
function mockDbWith(rowsInOrder: unknown[][]) {
  let call = 0;
  return {
    select: vi.fn().mockImplementation(() => makeChain(rowsInOrder[call++] ?? [])),
  };
}

const emptyRows = () => Array.from({ length: 14 }, () => [] as unknown[]);

describe('SetupProgressService', () => {
  let service: SetupProgressService;

  async function build(mockDb: any) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupProgressService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
      ],
    }).compile();
    return module.get<SetupProgressService>(SetupProgressService);
  }

  it('is defined', async () => {
    service = await build(mockDbWith(emptyRows()));
    expect(service).toBeDefined();
  });

  it('returns 0% with no data, still listing the advisor step as server-config', async () => {
    service = await build(mockDbWith(emptyRows()));
    const result = await service.getSetupProgress(TEST_USER_ID);

    expect(result.completed).toBe(0);
    // 9 always-applicable user-data steps (accounts, import, paycheck, digest,
    // suitability, loans, investments, manual_assets, notifications); the three
    // conditional steps are excluded since the user has no loans/investments/cc.
    expect(result.total).toBe(9);
    expect(result.percent).toBe(0);

    const advisorStep = result.steps.find((s) => s.id === 'advisor');
    expect(advisorStep).toMatchObject({ kind: 'server-config', done: false });

    const loanBalances = result.steps.find((s) => s.id === 'loan_balances');
    expect(loanBalances?.done).toBe(false);
  });

  it('excludes loan_balances from the denominator unless the user has a loan, and includes it once they do', async () => {
    const rows = emptyRows();
    rows[6] = [{ id: 'loan-1' }]; // loans

    service = await build(mockDbWith(rows));
    const result = await service.getSetupProgress(TEST_USER_ID);

    // 9 base + loans-conditional loan_balances now applicable = 10
    expect(result.total).toBe(10);
    const loansStep = result.steps.find((s) => s.id === 'loans');
    expect(loansStep?.done).toBe(true);
    const loanBalancesStep = result.steps.find((s) => s.id === 'loan_balances');
    expect(loanBalancesStep?.done).toBe(false);
    expect(result.completed).toBe(1); // only `loans` is done
  });

  it('counts holdings only once the user has an investment account, and cc_fees only once they have a credit card', async () => {
    const rows = emptyRows();
    rows[8] = [{ id: 'inv-1' }]; // investmentAccounts
    rows[9] = [{ id: 'holding-1' }]; // investmentHoldings

    service = await build(mockDbWith(rows));
    const result = await service.getSetupProgress(TEST_USER_ID);

    const holdingsStep = result.steps.find((s) => s.id === 'holdings');
    expect(holdingsStep?.done).toBe(true);
    // 9 base + investments-conditional holdings = 10; cc_fees stays excluded (no cc account)
    expect(result.total).toBe(10);

    const ccFeesStep = result.steps.find((s) => s.id === 'cc_fees');
    expect(ccFeesStep?.done).toBe(false);
  });

  it('computes percent from user-data steps only, even when the server-config advisor step is configured', async () => {
    const rows = emptyRows();
    rows[0] = [{ id: 'acc-1', accountType: 'checking', annualFeeCents: null }]; // accounts
    rows[4] = [{ id: 1, apiKeyCiphertext: 'ciphertext' }]; // advisorSettings

    service = await build(mockDbWith(rows));
    const result = await service.getSetupProgress(TEST_USER_ID);

    const advisorStep = result.steps.find((s) => s.id === 'advisor');
    expect(advisorStep?.done).toBe(true);

    // Only `accounts` (1 of 9 always-applicable user-data steps) is done;
    // the configured advisor step must not inflate completed/total.
    expect(result.total).toBe(9);
    expect(result.completed).toBe(1);
    expect(result.percent).toBe(Math.round((1 / 9) * 100));
  });

  it('requires an accounts-level annual fee before cc_fees counts as done', async () => {
    const rows = emptyRows();
    rows[0] = [{ id: 'acc-1', accountType: 'credit_card', annualFeeCents: null }];

    service = await build(mockDbWith(rows));
    const result = await service.getSetupProgress(TEST_USER_ID);

    const ccFeesStep = result.steps.find((s) => s.id === 'cc_fees');
    expect(ccFeesStep?.done).toBe(false);
    // cc_fees is now applicable (user has a cc account) -> 10 total
    expect(result.total).toBe(10);

    rows[0] = [{ id: 'acc-1', accountType: 'credit_card', annualFeeCents: 9500 }];
    service = await build(mockDbWith(rows));
    const result2 = await service.getSetupProgress(TEST_USER_ID);
    const ccFeesStep2 = result2.steps.find((s) => s.id === 'cc_fees');
    expect(ccFeesStep2?.done).toBe(true);
  });

  describe('dismissedAt (#229, sub-issue 2/4)', () => {
    it('is null when the user has never dismissed the tracker', async () => {
      service = await build(mockDbWith(emptyRows()));
      const result = await service.getSetupProgress(TEST_USER_ID);

      expect(result.dismissedAt).toBeNull();
    });

    it('reflects the stored setupTrackerDismissedAt timestamp as an ISO string', async () => {
      const rows = emptyRows();
      const dismissedAt = new Date('2026-01-01T00:00:00.000Z');
      rows[3] = [{ setupTrackerDismissedAt: dismissedAt }]; // userSettings

      service = await build(mockDbWith(rows));
      const result = await service.getSetupProgress(TEST_USER_ID);

      expect(result.dismissedAt).toBe(dismissedAt.toISOString());
    });

    it('is null once the dismissal has been cleared (setupTrackerDismissedAt: null)', async () => {
      const rows = emptyRows();
      rows[3] = [{ setupTrackerDismissedAt: null }]; // userSettings

      service = await build(mockDbWith(rows));
      const result = await service.getSetupProgress(TEST_USER_ID);

      expect(result.dismissedAt).toBeNull();
    });
  });
});
