import { defineAgentManifest } from './agent-manifest';

/**
 * 12.6 — Investment Coach agent manifest.
 *
 * `get_cash_runway` stands in for the "safe-to-spend" signal (#102's engine is not
 * itself exposed as a standalone MCP tool today — see `analytics/brief.service.ts`'s
 * `computeSafeToSpend`); it gives the coach the same trailing-runway aggregate the
 * Cash Manager already uses, without adding a new tool to `AGGREGATE_TOOL_ALLOWLIST`.
 * `get_earned_apy` and any row-level tool are deliberately excluded — this agent
 * consumes only the aggregate portfolio/allocation/savings-rate/market-context tools.
 */
export const INVESTMENT_COACH_AGENT_MANIFEST = defineAgentManifest({
  id: 'investment-coach',
  version: '1.0.0',
  schedule: 'monthly (after month-end facts settle) + on-demand from advisor chat',
  toolAllowlist: [
    'get_portfolio_value',
    'get_allocation',
    'get_savings_rate',
    'get_cash_runway',
    'get_market_context',
  ],
  privacyClass: 'aggregates_cloud_ok',
  outputTypes: ['recommendation'],
  featureFlag: 'agent_investment_coach',
});
