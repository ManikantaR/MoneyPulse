import { describe, it, expect } from 'vitest';
import {
  toAdvisorTools,
  AGGREGATE_TOOL_ALLOWLIST,
  McpClientService,
} from '../mcp-client.service';

const ALL_TOOLS = [
  { name: 'get_account_balances', description: 'a', inputSchema: { type: 'object' } },
  { name: 'get_spending_summary', description: 'b', inputSchema: { type: 'object' } },
  { name: 'get_category_breakdown', description: 'c', inputSchema: { type: 'object' } },
  { name: 'get_budget_status', description: 'd', inputSchema: { type: 'object' } },
  { name: 'get_recurring_expenses', description: 'e', inputSchema: { type: 'object' } },
  { name: 'get_merchant_breakdown', description: 'g', inputSchema: { type: 'object' } },
  { name: 'get_cashflow_summary', description: 'h', inputSchema: { type: 'object' } },
  { name: 'get_income_breakdown', description: 'i', inputSchema: { type: 'object' } },
  { name: 'get_net_worth', description: 'j', inputSchema: { type: 'object' } },
  { name: 'get_upcoming_bills', description: 'k', inputSchema: { type: 'object' } },
  { name: 'get_subscriptions', description: 'l', inputSchema: { type: 'object' } },
  { name: 'get_cashflow_forecast', description: 'm', inputSchema: { type: 'object' } },
  { name: 'get_category_trend', description: 'n', inputSchema: { type: 'object' } },
  { name: 'get_budget_history', description: 'o', inputSchema: { type: 'object' } },
  { name: 'get_recent_anomalies', description: 'p', inputSchema: { type: 'object' } },
  { name: 'get_loan_status', description: 'q', inputSchema: { type: 'object' } },
  { name: 'compare_periods', description: 'f', inputSchema: { type: 'object' } },
  { name: 'get_market_context', description: 'r', inputSchema: { type: 'object' } },
  { name: 'get_transactions', description: 'ROW-LEVEL', inputSchema: { type: 'object' } },
  { name: 'search_transactions', description: 'ROW-LEVEL', inputSchema: { type: 'object' } },
];

describe('MCP advisor tool boundary (aggregates-only)', () => {
  it('exposes exactly the aggregate tools and excludes the 2 row-level tools', () => {
    const out = toAdvisorTools(ALL_TOOLS);
    const names = out.map((t) => t.name).sort();
    expect(names).toEqual([...AGGREGATE_TOOL_ALLOWLIST].sort());
    expect(names).not.toContain('get_transactions');
    expect(names).not.toContain('search_transactions');
  });

  it('maps inputSchema → input_schema for Anthropic', () => {
    const out = toAdvisorTools([ALL_TOOLS[0]]);
    expect(out[0]).toMatchObject({
      name: 'get_account_balances',
      description: 'a',
      input_schema: { type: 'object' },
    });
  });

  it('callTool rejects a non-allowlisted (row-level) tool before connecting', async () => {
    const svc = new McpClientService({ get: () => undefined } as any);
    await expect(
      svc.callTool('user-1', 'get_transactions', {}),
    ).rejects.toThrow(/not an allowed advisor tool/);
    await expect(
      svc.callTool('user-1', 'search_transactions', {}),
    ).rejects.toThrow(/not an allowed advisor tool/);
  });
});
