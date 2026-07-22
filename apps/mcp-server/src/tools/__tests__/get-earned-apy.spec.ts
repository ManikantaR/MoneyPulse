import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const getUserIdMock = vi.fn().mockResolvedValue('user-1');

vi.mock('../../db.js', () => ({
  query: (...args: any[]) => queryMock(...args),
  getUserId: () => getUserIdMock(),
}));

const { registerGetEarnedApy } = await import('../get-earned-apy.js');

function makeServer() {
  let handler: (params: any) => Promise<any>;
  const server = {
    tool: (_name: string, _desc: string, _schema: any, fn: any) => {
      handler = fn;
    },
  } as any;
  registerGetEarnedApy(server);
  return (params: any = {}) => handler(params);
}

describe('get_earned_apy', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('matches a hand-calculated APY against a synthetic fixture ledger', async () => {
    // Synthetic savings account: two $2,000 monthly interest credits over the trailing
    // 12mo window ($4,000 total), average balance held flat at $100,000 across 3
    // month-end snapshots. Hand calc: 4000 / 100000 = 4.00% APY.
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM accounts')) {
        return [{ id: 'acc-1', nickname: 'Synthetic Savings', account_type: 'savings' }];
      }
      if (sql.includes('FROM transactions')) {
        return [
          { date: '2026-01-31', amount_cents: '200000', description: 'INTEREST PAID' },
          { date: '2026-06-30', amount_cents: '200000', description: 'INTEREST PAYMENT' },
        ];
      }
      if (sql.includes('FROM account_balance_snapshots')) {
        return [
          { snapshot_date: '2026-01-31', balance_cents: '10000000' },
          { snapshot_date: '2026-04-30', balance_cents: '10000000' },
          { snapshot_date: '2026-07-31', balance_cents: '10000000' },
        ];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text as string;

    expect(text).toContain('Synthetic Savings');
    expect(text).toContain('4.00%');
    // Evidence must cite the actual interest transactions (dates + amounts)...
    expect(text).toContain('2026-01-31');
    expect(text).toContain('$2000.00');
    // ...and state the balance basis (snapshots/dates averaged).
    expect(text).toContain('3 snapshots');
    expect(text).toContain('$100000.00');
  });

  it('reports no interest found rather than fabricating an APY', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM accounts')) {
        return [{ id: 'acc-2', nickname: 'Quiet Checking', account_type: 'checking' }];
      }
      if (sql.includes('FROM transactions')) return [];
      if (sql.includes('FROM account_balance_snapshots')) {
        return [{ snapshot_date: '2026-06-30', balance_cents: '500000' }];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text as string;

    expect(text).toContain('earned APY ~0.00%');
    expect(text).toContain('No interest transactions found');
  });

  it('returns a clear message when there are no checking/savings accounts', async () => {
    queryMock.mockImplementation(async () => []);
    const call = makeServer();
    const result = await call({});
    expect(result.content[0].text).toContain('No checking/savings accounts found');
  });
});
