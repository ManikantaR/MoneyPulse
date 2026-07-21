import { Injectable, Logger } from '@nestjs/common';
import { AGGREGATE_TOOL_ALLOWLIST } from '../advisor/mcp-client.service';
import { AgentManifest, AgentManifestViolationError } from './agent-manifest';

/** A tool call function the runner wraps with allowlist enforcement — usually
 * `McpClientService.callTool` bound to a userId. */
export type ToolCaller = (toolName: string, input: unknown) => Promise<unknown>;

export interface AgentRunResult<T> {
  ok: boolean;
  agentId: string;
  result?: T;
  error?: Error;
}

/**
 * 12.1 — the agent runner. Extends the 11.9 `AdvisorReviewService`/digest-service
 * pattern (fixed prompt/tool-use loop driven by a schedule) with centralized
 * manifest enforcement: every tool call an agent makes is checked against its
 * manifest's `toolAllowlist` before it's allowed through, and `aggregates_cloud_ok`
 * agents are additionally checked against the app-wide aggregate-tool allowlist at
 * validation time. A violation is a run failure — logged, never silently ignored —
 * not a warning the agent can shrug off.
 */
@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  /**
   * Validate a manifest's internal consistency: `aggregates_cloud_ok` agents may only
   * declare tools that are themselves on the app-wide aggregates-only allowlist (the
   * privacy boundary is the agent boundary — #36 / Phase 12 principle 1). `local_only`
   * agents have no such restriction (and must never be run through a cloud provider —
   * enforced by the caller, not here).
   */
  validateManifest(manifest: AgentManifest): void {
    if (manifest.privacyClass !== 'aggregates_cloud_ok') return;
    const disallowed = manifest.toolAllowlist.filter(
      (tool) => !AGGREGATE_TOOL_ALLOWLIST.has(tool),
    );
    if (disallowed.length > 0) {
      throw new Error(
        `Agent manifest "${manifest.id}" declares aggregates_cloud_ok but allowlists ` +
          `non-aggregate tool(s): ${disallowed.join(', ')}`,
      );
    }
  }

  /**
   * Wrap a `toolCaller` so any tool call outside `manifest.toolAllowlist` throws
   * before reaching the real implementation.
   */
  private guard(manifest: AgentManifest, toolCaller: ToolCaller): ToolCaller {
    return async (toolName: string, input: unknown) => {
      if (!manifest.toolAllowlist.includes(toolName)) {
        throw new AgentManifestViolationError(manifest.id, toolName);
      }
      return toolCaller(toolName, input);
    };
  }

  /**
   * Run an agent's work function with a manifest-guarded tool caller. Any
   * `AgentManifestViolationError` (or other error) thrown by `work` is caught,
   * logged as a run failure, and returned as `{ok: false, error}` rather than
   * propagated — callers (schedulers) should check `.ok` rather than try/catch.
   */
  async runAgent<T>(
    manifest: AgentManifest,
    toolCaller: ToolCaller,
    work: (guardedCallTool: ToolCaller) => Promise<T>,
  ): Promise<AgentRunResult<T>> {
    this.validateManifest(manifest);
    const guarded = this.guard(manifest, toolCaller);
    try {
      const result = await work(guarded);
      return { ok: true, agentId: manifest.id, result };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `Agent run failure [${manifest.id} v${manifest.version}]: ${error.message}`,
      );
      return { ok: false, agentId: manifest.id, error };
    }
  }
}
