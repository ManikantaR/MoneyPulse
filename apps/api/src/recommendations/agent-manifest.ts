/**
 * 12.1 — lightweight agent manifests. A typed constant, not a runtime: each advisory
 * agent (Cash Manager, Investment Coach, Savings Coach, ...) declares what it is
 * allowed to touch. The `AgentRunnerService` enforces the tool allowlist + privacy
 * class centrally so no individual agent implementation has to be trusted to police
 * itself.
 */

export type PrivacyClass = 'aggregates_cloud_ok' | 'local_only';

export interface AgentManifest {
  id: string;
  version: string;
  /** Human-readable cadence description, e.g. "monthly" or "on-demand". Not parsed. */
  schedule: string;
  /** Exhaustive list of MCP tool names this agent may call. */
  toolAllowlist: readonly string[];
  privacyClass: PrivacyClass;
  outputTypes: readonly string[];
  /** Feature flag key gating this agent; the runner must check it before running. */
  featureFlag: string;
}

/** Raised when an agent run calls a tool outside its manifest's allowlist. */
export class AgentManifestViolationError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly toolName: string,
  ) {
    super(
      `Agent "${agentId}" called tool "${toolName}" outside its manifest tool allowlist`,
    );
    this.name = 'AgentManifestViolationError';
  }
}

/** Frozen at import time — manifests are constants, not mutable config. */
export function defineAgentManifest(manifest: AgentManifest): AgentManifest {
  return Object.freeze({ ...manifest, toolAllowlist: Object.freeze([...manifest.toolAllowlist]) });
}
