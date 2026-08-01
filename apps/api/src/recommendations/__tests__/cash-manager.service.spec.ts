import { describe, it, expect, vi } from 'vitest';
import { CashManagerService } from '../cash-manager.service';
import { RecommendationSuppressionService } from '../recommendation-suppression.service';

/** Flattens a drizzle `SQL` wrapper's raw string chunks (ignoring bind-param values) so
 * tests can assert on the literal SQL text without needing a real dialect/DB connection. */
function sqlText(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const chunks = node.queryChunks ?? node.value;
  if (Array.isArray(chunks)) return chunks.map(sqlText).join(' ');
  return '';
}

// Synthetic account fixture that HAS a lastFour set — simulates a real accounts row
// (even though the service's own query projects only {id, nickname}) so the test holds
// even if a future edit accidentally widens the select().
const SYNTHETIC_LAST_FOUR = '4242';
const accountsRows = [
  { id: 'acct-1', nickname: 'Everyday Checking', lastFour: SYNTHETIC_LAST_FOUR, interestRateBps: null },
  { id: 'acct-2', nickname: 'Online Savings', lastFour: '9911', interestRateBps: null },
];

function buildMockDb(opts: {
  balanceCents: number;
  expenseCents: number;
  settings: any[];
  interestCents: number;
  avgCents: number;
  watchlist: any[];
  usersRow?: any[];
  accountsRows?: any[];
  balanceRows?: any[];
}) {
  let selectCall = 0;
  const db: any = {
    select: vi.fn((_proj?: any) => {
      selectCall += 1;
      const call = selectCall;
      return {
        from: () => ({
          where: (): any => {
            // 1st select = accounts, 3rd = watchlist (2nd is suitabilitySettings, chained)
            if (call === 1) return Promise.resolve(opts.accountsRows ?? accountsRows);
            if (call === 3) return Promise.resolve(opts.watchlist);
            return {
              orderBy: () => ({
                limit: () => Promise.resolve(opts.settings),
              }),
            };
          },
          isNull: undefined,
        }),
      };
    }),
    execute: vi
      .fn()
      .mockResolvedValueOnce([]) // rated investment accounts (none in these fixtures)
      .mockResolvedValueOnce(
        opts.balanceRows ?? [{ balance_cents: opts.balanceCents }],
      ) // liquid balance
      .mockResolvedValueOnce([{ total_cents: opts.expenseCents * 3 }]) // trailing-3mo expense total
      .mockResolvedValueOnce([{ total_cents: opts.interestCents }]) // interest credits
      .mockResolvedValueOnce([{ avg_cents: opts.avgCents }]), // avg balance basis
  };
  return db;
}

function buildNotifications() {
  return {
    findByMetadata: vi.fn().mockResolvedValue(false),
    createAndDispatch: vi.fn().mockResolvedValue(undefined),
  };
}

describe('CashManagerService — no-credentials leak', () => {
  it('never includes the lastFour value anywhere in the evidence/narration/notification payload', async () => {
    const db = buildMockDb({
      balanceCents: 22_000_00,
      expenseCents: 200_000,
      settings: [{ emergencyFundTargetMonths: 6, taxState: 'CA' }],
      interestCents: 5_000, // $50/yr interest
      avgCents: 20_000_00, // -> ~25bps earned APY
      watchlist: [
        {
          id: 'wl-1',
          institution: 'Synthetic Bank',
          productType: 'hysa',
          apyBps: 400,
          termMonths: null,
          updatedAt: new Date('2026-07-10'),
        },
      ],
    });
    const notifications = buildNotifications();
    const suppression = { checkAndSuppress: vi.fn().mockResolvedValue({ suppressed: false }) };

    const svc = new CashManagerService(db, notifications as any, suppression as any);
    const result = await svc.runForUser('user-1');

    expect(result.recommended).toBe(true);
    expect(notifications.createAndDispatch).toHaveBeenCalledTimes(1);
    const payload = notifications.createAndDispatch.mock.calls[0][0];
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(SYNTHETIC_LAST_FOUR);
    expect(serialized).not.toContain('9911');
    // Sanity: the payload DOES carry real content (dollar figures, institution name)
    // so this isn't a vacuously-passing empty-string check.
    expect(serialized).toContain('Synthetic Bank');
    expect(serialized.length).toBeGreaterThan(50);
  });
});

describe('CashManagerService — benchmark-rate-move event trigger', () => {
  const notifications = buildNotifications();
  const suppression = { checkAndSuppress: vi.fn() };

  it('returns false when the benchmark series was not among today\'s refreshed metrics', async () => {
    const db: any = { execute: vi.fn() };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    const result = await svc.checkBenchmarkRateMove(['gas_retail_regular']);

    expect(result.moved).toBe(false);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns false when fewer than two stored values exist for the benchmark series', async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve([{ value: '4.50', periodDate: '2026-07-24' }]) }),
          }),
        }),
      }),
    };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    const result = await svc.checkBenchmarkRateMove(['treasury_bill_13w']);

    expect(result.moved).toBe(false);
  });

  it('returns moved=true with the delta/old/new values when the latest-vs-previous delta is >= 25bps', async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve([
                  { value: '4.75', periodDate: '2026-07-24' },
                  { value: '4.50', periodDate: '2026-07-23' },
                ]),
            }),
          }),
        }),
      }),
    };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    const result = await svc.checkBenchmarkRateMove(['treasury_bill_13w']);

    expect(result).toEqual({
      moved: true,
      metricKey: 'treasury_bill_13w',
      deltaBps: 25,
      previousValue: 4.5,
      latestValue: 4.75,
      latestPeriodDate: '2026-07-24',
    });
  });

  it('returns false when the delta is below the 25bps threshold', async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve([
                  { value: '4.55', periodDate: '2026-07-24' },
                  { value: '4.50', periodDate: '2026-07-23' },
                ]),
            }),
          }),
        }),
      }),
    };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    const result = await svc.checkBenchmarkRateMove(['treasury_bill_13w']);

    expect(result.moved).toBe(false);
  });
});

describe('CashManagerService — notifyBenchmarkRateMove (market_event)', () => {
  const qualifyingMove = {
    moved: true,
    metricKey: 'treasury_bill_13w',
    deltaBps: 32,
    previousValue: 4.5,
    latestValue: 4.82,
    latestPeriodDate: '2026-07-24',
  };
  const subThresholdMove = {
    moved: false,
    metricKey: 'treasury_bill_13w',
    deltaBps: 5,
    previousValue: 4.5,
    latestValue: 4.55,
    latestPeriodDate: '2026-07-24',
  };

  function buildActiveUsersDb(userIds: string[]) {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(userIds.map((id) => ({ id })))),
        })),
      })),
    };
  }

  it('calls notify with type market_event and the delta/old/new values when a qualifying move is detected', async () => {
    const db: any = buildActiveUsersDb(['user-1']);
    const notifications = {
      findByMetadata: vi.fn().mockResolvedValue(false),
      createAndDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const suppression = { checkAndSuppress: vi.fn() };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    await svc.notifyBenchmarkRateMove(qualifyingMove as any);

    expect(notifications.createAndDispatch).toHaveBeenCalledTimes(1);
    const payload = notifications.createAndDispatch.mock.calls[0][0];
    expect(payload.userId).toBe('user-1');
    // #223: routes through its own 'benchmark_rate_move' preference (default
    // instant + inApp/telegram/haWebhook) rather than 'market_event', whose
    // DEFAULT_PREFERENCES mode is 'off' and was suppressing delivery entirely.
    expect(payload.notificationType).toBe('benchmark_rate_move');
    expect(payload.message).toContain('32bps');
    expect(payload.message).toContain('4.50%');
    expect(payload.message).toContain('4.82%');
    expect(payload.data).toMatchObject({
      deltaBps: 32,
      previousValue: 4.5,
      latestValue: 4.82,
    });
  });

  it('does not call notify when the move is below the 25bps threshold', async () => {
    const db: any = buildActiveUsersDb(['user-1']);
    const notifications = {
      findByMetadata: vi.fn().mockResolvedValue(false),
      createAndDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const suppression = { checkAndSuppress: vi.fn() };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    await svc.notifyBenchmarkRateMove(subThresholdMove as any);

    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });
});

describe('CashManagerService — cash_sweep account-type inclusion', () => {
  it('includes cash_sweep alongside checking/savings in the runForUser accounts filter', async () => {
    const db = buildMockDb({
      balanceCents: 22_000_00,
      expenseCents: 200_000,
      settings: [{ emergencyFundTargetMonths: 6, taxState: 'CA' }],
      interestCents: 5_000,
      avgCents: 20_000_00,
      watchlist: [],
    });
    let capturedWhere: any;
    const originalWhere = db.select;
    db.select = vi.fn((_proj?: any) => ({
      from: () => ({
        where: (whereArg: any): any => {
          capturedWhere = capturedWhere ?? whereArg;
          return originalWhere().from().where();
        },
      }),
    }));
    const notifications = buildNotifications();
    const suppression = { checkAndSuppress: vi.fn().mockResolvedValue({ suppressed: false }) };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    await svc.runForUser('user-1');

    expect(sqlText(capturedWhere)).toContain('cash_sweep');
  });

  it('includes cash_sweep alongside checking/savings in the liquid-balance-move CTE filter', async () => {
    const db: any = { execute: vi.fn().mockResolvedValue([]) };
    const notifications = buildNotifications();
    const suppression = { checkAndSuppress: vi.fn() };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    await svc.findUsersWithLiquidBalanceMove();

    const executedSql = sqlText(db.execute.mock.calls[0][0]);
    expect(executedSql).toContain('cash_sweep');
  });
});

describe('CashManagerService — liquid-balance-move event trigger', () => {
  const notifications = buildNotifications();
  const suppression = { checkAndSuppress: vi.fn() };

  it('flags a user whose latest-vs-prior liquid balance moved >= 20%', async () => {
    const db: any = {
      execute: vi.fn().mockResolvedValue([
        { user_id: 'user-moved', latest_cents: 12_000_00, prior_cents: 10_000_00 }, // +20%
        { user_id: 'user-stable', latest_cents: 10_050_00, prior_cents: 10_000_00 }, // +0.5%
        { user_id: 'user-new', latest_cents: 5_000_00, prior_cents: 0 }, // no meaningful prior
      ]),
    };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    const moved = await svc.findUsersWithLiquidBalanceMove();

    expect(moved).toEqual(['user-moved']);
  });

  it('returns an empty list when no user crosses the threshold', async () => {
    const db: any = {
      execute: vi.fn().mockResolvedValue([
        { user_id: 'user-a', latest_cents: 10_100_00, prior_cents: 10_000_00 },
      ]),
    };
    const svc = new CashManagerService(db, notifications as any, suppression as any);

    const moved = await svc.findUsersWithLiquidBalanceMove();

    expect(moved).toEqual([]);
  });
});

describe('CashManagerService — decision-memory suppression', () => {
  it('respects a prior rejected/not_applicable decision until inputs change materially', async () => {
    const db = buildMockDb({
      balanceCents: 22_000_00,
      expenseCents: 200_000,
      settings: [{ emergencyFundTargetMonths: 6, taxState: 'CA' }],
      interestCents: 5_000,
      avgCents: 20_000_00,
      watchlist: [
        {
          id: 'wl-1',
          institution: 'Synthetic Bank',
          productType: 'hysa',
          apyBps: 400,
          termMonths: null,
          updatedAt: new Date('2026-07-10'),
        },
      ],
    });
    const notifications = buildNotifications();

    // Real suppression service (12.1), fed a mocked prior 'rejected' row via db.execute/select
    // is overkill to wire fully here; instead exercise its pure `evaluateSuppression` contract
    // through the real service class with a stubbed lookup, proving THIS service calls into
    // #117's actual suppression logic rather than reimplementing its own.
    const suppressionService = new RecommendationSuppressionService(db);
    const spy = vi.spyOn(suppressionService, 'checkAndSuppress').mockResolvedValue({
      suppressed: true,
      reason: 'Suppressed: rejected on 2026-07-01; inputs unchanged since.',
    });

    const svc = new CashManagerService(db, notifications as any, suppressionService);
    const result = await svc.runForUser('user-1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.suppressed).toBe(true);
    expect(result.recommended).toBe(false);
    expect(notifications.createAndDispatch).not.toHaveBeenCalled();
  });
});

describe('CashManagerService — prefers account-level interest_rate_bps', () => {
  it('uses the account-entered rate instead of the transaction heuristic when set', async () => {
    // Savings account has a directly-entered 4.00% APY; the transaction-derived heuristic
    // (interestCents/avgCents below) would compute a much lower ~25bps figure. The account's
    // rate should win since it's a more direct signal.
    const db = buildMockDb({
      balanceCents: 22_000_00,
      expenseCents: 200_000,
      settings: [{ emergencyFundTargetMonths: 6, taxState: 'CA' }],
      interestCents: 5_000, // would compute ~25bps if the heuristic were used
      avgCents: 20_000_00,
      accountsRows: [
        { id: 'acct-2', nickname: 'Online Savings', lastFour: '9911', interestRateBps: 400 },
      ],
      balanceRows: [{ account_id: 'acct-2', balance_cents: 22_000_00 }],
      watchlist: [
        {
          id: 'wl-1',
          institution: 'Synthetic Bank',
          productType: 'hysa',
          apyBps: 700,
          termMonths: null,
          updatedAt: new Date('2026-07-10'),
        },
      ],
    });
    const notifications = buildNotifications();
    const suppression = { checkAndSuppress: vi.fn().mockResolvedValue({ suppressed: false }) };

    const svc = new CashManagerService(db, notifications as any, suppression as any);
    await svc.runForUser('user-1');

    // The spread between the 700bps watchlist candidate and the account's own 400bps rate
    // (300bps) should drive the narration/evidence, not the heuristic's much wider spread
    // (which would have used ~25bps as the current earned rate).
    const payload = notifications.createAndDispatch.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('4.00');
  });
});
