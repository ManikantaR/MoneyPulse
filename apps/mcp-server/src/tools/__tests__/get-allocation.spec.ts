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
    // No suitability settings saved -> refuses to guess a target rather than
    // fabricating a comparison (12.4 gate).
    expect(text).toContain('No target allocation on file');
  });

  it('computes target-vs-actual drift per asset class (12.4) against a synthetic policy fixture', async () => {
    // Synthetic portfolio: AAA (us_equity) 100 x $200 = $20,000; BBB (bonds) 50 x
    // $400 = $20,000 -> 50/50 actual. Target policy: us_equity 70%, bonds 30%.
    // Hand-calc: us_equity drift = 50 - 70 = -20pp; bonds drift = 50 - 30 = +20pp.
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
      if (sql.includes('FROM suitability_settings')) {
        return [
          {
            version: 3,
            target_allocation: [
              { assetClass: 'us_equity', targetPercent: 70 },
              { assetClass: 'bonds', targetPercent: 30 },
            ],
            ticker_asset_class_map: { AAA: 'us_equity', BBB: 'bonds' },
          },
        ];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text;

    expect(text).toContain('policy version 3');
    expect(text).toContain('us_equity: target 70.0%, actual 50.0% (drift -20.0pp)');
    expect(text).toContain('bonds: target 30.0%, actual 50.0% (drift +20.0pp)');
  });

  it('flags unmapped tickers with a dataCaveat instead of silently dropping them', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_holdings')) {
        return [{ ticker: 'ZZZ', share_count: '10', as_of: '2026-07-01' }];
      }
      if (sql.includes('FROM security_prices')) {
        return [{ ticker: 'ZZZ', price_date: '2026-07-01', close_cents: 100000 }];
      }
      if (sql.includes('FROM suitability_settings')) {
        return [
          {
            version: 1,
            target_allocation: [{ assetClass: 'us_equity', targetPercent: 100 }],
            ticker_asset_class_map: {}, // ZZZ intentionally unmapped
          },
        ];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({});
    const text = result.content[0].text;

    expect(text).toContain('dataCaveat');
    expect(text).toContain('no ticker→asset-class mapping');
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
