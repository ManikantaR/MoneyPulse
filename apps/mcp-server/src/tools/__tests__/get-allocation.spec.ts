import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const getUserIdMock = vi.fn().mockResolvedValue('user-1');

vi.mock('../../db.js', () => ({
  query: (...args: any[]) => queryMock(...args),
  getUserId: () => getUserIdMock(),
}));

const { registerGetAllocation } = await import('../get-allocation.js');

function makeServer() {
  let handler: (params: any) => Promise<any>;
  const server = {
    tool: (_name: string, _desc: string, _schema: any, fn: any) => {
      handler = fn;
    },
  } as any;
  registerGetAllocation(server);
  return (params: any = {}) => handler(params);
}

describe('get_allocation', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('matches a hand-calculated expectation for a synthetic multi-holding portfolio', async () => {
    // Synthetic two-holding portfolio: 100 x $200 = $20,000 (ticker A) and
    // 50 x $400 = $20,000 (ticker B) -> 50%/50% split, hand-calculated.
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_holdings')) {
        return [
          { ticker: 'AAA', share_count: '100', as_of: '2026-07-01' },
          { ticker: 'BBB', share_count: '50', as_of: '2026-07-01' },
        ];
      }
      if (sql.includes('FROM security_prices')) {
        return [
          { ticker: 'AAA', price_date: '2026-07-01', close_cents: 20000 },
          { ticker: 'BBB', price_date: '2026-07-01', close_cents: 40000 },
        ];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text;

    expect(text).toContain('AAA: 50.00%');
    expect(text).toContain('BBB: 50.00%');
    expect(text).toContain('#120'); // no target-allocation drift yet — TODO references the issue
  });

  it('surfaces a dataCaveat when holdings are stale', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_holdings')) {
        return [{ ticker: 'AAA', share_count: '100', as_of: '2020-01-01' }];
      }
      if (sql.includes('FROM security_prices')) {
        return [{ ticker: 'AAA', price_date: '2020-01-01', close_cents: 20000 }];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    expect(result.content[0].text).toContain('dataCaveat');
  });
});
