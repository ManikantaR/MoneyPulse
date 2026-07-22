import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const getUserIdMock = vi.fn().mockResolvedValue('user-1');

vi.mock('../../db.js', () => ({
  query: (...args: any[]) => queryMock(...args),
  getUserId: () => getUserIdMock(),
}));

// Import after mocking so the tool picks up the mocked db module.
const { registerGetPortfolioValue } = await import('../get-portfolio-value.js');

function makeServer() {
  let handler: (params: any) => Promise<any>;
  const server = {
    tool: (_name: string, _desc: string, _schema: any, fn: any) => {
      handler = fn;
    },
  } as any;
  registerGetPortfolioValue(server);
  return (params: any = {}) => handler(params);
}

describe('get_portfolio_value', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('sums shares x latest close within one EOD close of the hand-calculated expectation', async () => {
    // 100 shares of a synthetic VTI-like ticker declared as-of 2026-07-01, with a
    // recorded EOD close near that date — matches the 12.2 acceptance scenario.
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_holdings')) {
        return [
          {
            investment_account_id: 'acc-1',
            nickname: 'Brokerage',
            ticker: 'VTI',
            share_count: '100',
            as_of: '2026-07-01',
          },
        ];
      }
      if (sql.includes('FROM security_prices')) {
        return [{ ticker: 'VTI', price_date: '2026-07-01', close_cents: 25000, source: 'stooq' }];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text;

    expect(text).toContain('Total portfolio value: $25000.00'); // 100 shares x $250.00
    expect(text).toContain('2026-07-01'); // price date surfaced
    expect(text).not.toContain('dataCaveat');
  });

  it('serves the last known price with its visible date during a provider outage — never a silent current claim', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_holdings')) {
        return [
          {
            investment_account_id: 'acc-1',
            nickname: 'Brokerage',
            ticker: 'VTI',
            share_count: '100',
            as_of: '2026-07-15',
          },
        ];
      }
      if (sql.includes('FROM security_prices')) {
        // Stale price — last refresh succeeded weeks ago, then the provider went down.
        return [{ ticker: 'VTI', price_date: '2026-06-20', close_cents: 24000, source: 'stooq' }];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text;

    expect(text).toContain('close on 2026-06-20'); // real (stale) date visibly attached
    expect(text).toContain('Total portfolio value: $24000.00');
  });

  it('surfaces a dataCaveat when holdings are older than the staleness threshold', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_holdings')) {
        return [
          {
            investment_account_id: 'acc-1',
            nickname: 'Brokerage',
            ticker: 'VTI',
            share_count: '100',
            as_of: '2020-01-01', // far older than the 90-day default threshold
          },
        ];
      }
      if (sql.includes('FROM security_prices')) {
        return [{ ticker: 'VTI', price_date: '2020-01-01', close_cents: 20000, source: 'stooq' }];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text;

    expect(text).toContain('dataCaveat');
    expect(text).toContain('older than');
  });

  it('reports no holdings declared when the user has none', async () => {
    queryMock.mockResolvedValue([]);
    const call = makeServer();
    const result = await call({});
    expect(result.content[0].text).toContain('No investment holdings declared yet.');
  });
});
