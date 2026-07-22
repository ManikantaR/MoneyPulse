import { defineAgentManifest } from './agent-manifest';

/**
 * 12.5 — Cash Manager agent manifest. The first real advisory agent (12.1's runner +
 * manifest scaffold applied for real).
 *
 * `get_earned_apy` is deliberately NOT on this allowlist even though the deterministic
 * core consumes an earned-APY figure: per `mcp-client.service.ts`'s
 * `AGGREGATE_TOOL_ALLOWLIST` comment, that tool's own evidence cites individual
 * interest transactions (row-level data), so it can never be called by an
 * `aggregates_cloud_ok` agent. `CashManagerService` instead computes the earned-APY
 * *number* itself (reusing the same trailing-12mo/avg-balance logic) and passes only
 * the resulting basis-points figure into the calculator/evidence — never the
 * underlying transaction rows — so the aggregates-only boundary holds end to end.
 */
export const CASH_MANAGER_AGENT_MANIFEST = defineAgentManifest({
  id: 'cash-manager',
  version: '1.0.0',
  schedule: 'monthly + benchmark-rate-move(>=25bps) + liquid-balance-move(>=20%)',
  toolAllowlist: [
    'get_account_balances',
    'get_market_context',
    'get_rate_watchlist',
    'get_cash_runway',
  ],
  privacyClass: 'aggregates_cloud_ok',
  outputTypes: ['recommendation'],
  featureFlag: 'agent_cash_manager',
});
