import { defineAgentManifest } from './agent-manifest';

/**
 * 12.7 — Savings Coach agent manifest. Composes the 11.5 watchdog detectors
 * (price-creep, fee, budget-pace) into one monthly dollar-ized recommendation.
 * Deliberately does NOT call any tool that surfaces row-level transaction data —
 * candidate detection already happened in `WatchdogDetectorService`; this agent only
 * reads back the aggregate `type`/`metadata` of those already-persisted notifications
 * plus budget rows, so its own tool surface stays aggregates-only.
 */
export const SAVINGS_COACH_AGENT_MANIFEST = defineAgentManifest({
  id: 'savings-coach',
  version: '1.0.0',
  schedule: 'monthly',
  toolAllowlist: ['get_recurring_expenses', 'get_subscriptions', 'get_budget_status'],
  privacyClass: 'aggregates_cloud_ok',
  outputTypes: ['recommendation'],
  featureFlag: 'agent_savings_coach',
});
