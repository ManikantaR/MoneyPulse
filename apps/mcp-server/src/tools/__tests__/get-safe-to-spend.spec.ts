import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const getUserIdMock = vi.fn().mockResolvedValue('user-1');

vi.mock('../../db.js', () => ({
  query: (...args: any[]) => queryMock(...args),
  getUserId: () => getUserIdMock(),
}));

const { registerGetSafeToSpend } = await import('../get-safe-to-spend.js');

function makeServer() {
  let handler: (params: any) => Promise<any>;
  const server = {
    tool: (_name: string, _desc: string, _schema: any, fn: any) => {
      handler = fn;
    },
  } as any;
  registerGetSafeToSpend(server);
  return (params: any = {}) => handler(params);
}

describe('get_safe_to_spend', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('subtracts a recurring bill and goal reservation from a synthetic flat-balance projection', async () => {
    // Synthetic: $1,000 starting liquid balance, zero average daily net (flat trend),
    // one $200 monthly bill due in 10 days -> floor should be $800, then minus a
    // $100 goal reservation -> safe-to-spend $700.
    const today = new Date();
    const billDate = new Date(today);
    billDate.setDate(billDate.getDate() + 10);
    const billDateStr = billDate.toISOString().slice(0, 10);

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM accounts a')) {
        return [{ liquid_cents: '100000' }];
      }
      if (sql.includes('FROM recurring_bills')) {
        return [
          {
            expected_amount_cents: '20000',
            frequency: 'monthly',
            next_expected_date: billDateStr,
          },
        ];
      }
      if (sql.includes('net_90d')) {
        return [{ net_90d: '0' }];
      }
      return [];
    });

    const call = makeServer();
    const result = await call({ horizonDays: 30, goalContributionsCents: 10000 });
    const text = result.content[0].text;

    expect(text).toContain('Current liquid balance (checking/savings): $1000.00');
    expect(text).toContain('Minimum projected balance over 30d: $800.00');
    expect(text).toContain('Reserved for savings goals: $100.00');
    expect(text).toContain('Safe to spend (30d horizon): $700.00');
  });

  it('clamps safe-to-spend at zero when the projected floor is negative', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM accounts a')) return [{ liquid_cents: '5000' }];
      if (sql.includes('FROM recurring_bills')) return [];
      if (sql.includes('net_90d')) return [{ net_90d: '-18000' }]; // -$2/day avg trend over 90d
      return [];
    });

    const call = makeServer();
    const result = await call({ horizonDays: 30, goalContributionsCents: 0 });
    const text = result.content[0].text;

    expect(text).toContain('Safe to spend (30d horizon): $0.00');
    expect(text).toContain('shortfall, not a safe-to-spend amount');
  });

  it('computes over a 30-day horizon with zero goal contributions', async () => {
    // Note: the test harness invokes the tool's handler directly, bypassing the
    // real MCP SDK's zod default-application, so horizonDays/goalContributionsCents
    // are passed explicitly here rather than relying on the schema defaults.
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM accounts a')) return [{ liquid_cents: '10000' }];
      if (sql.includes('FROM recurring_bills')) return [];
      if (sql.includes('net_90d')) return [{ net_90d: '0' }];
      return [];
    });

    const call = makeServer();
    const result = await call({ horizonDays: 30, goalContributionsCents: 0 });
    const text = result.content[0].text;

    expect(text).toContain('over 30d');
    expect(text).toContain('Reserved for savings goals: $0.00');
  });
});
