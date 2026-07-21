import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunnerService } from '../agent-runner.service';
import { AgentManifestViolationError, defineAgentManifest } from '../agent-manifest';

const CASH_MANAGER_MANIFEST = defineAgentManifest({
  id: 'cash-manager',
  version: '1',
  schedule: 'monthly',
  toolAllowlist: ['get_account_balances', 'get_market_context'],
  privacyClass: 'aggregates_cloud_ok',
  outputTypes: ['recommendation'],
  featureFlag: 'advisor_cash_manager',
});

describe('AgentRunnerService', () => {
  let runner: AgentRunnerService;
  let toolCaller: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runner = new AgentRunnerService();
    toolCaller = vi.fn().mockResolvedValue({ text: 'ok' });
    errorSpy = vi.spyOn((runner as any).logger, 'error').mockImplementation(() => {});
  });

  it('allows tool calls within the manifest allowlist', async () => {
    const result = await runner.runAgent(CASH_MANAGER_MANIFEST, toolCaller, async (callTool) => {
      return callTool('get_account_balances', {});
    });

    expect(result.ok).toBe(true);
    expect(toolCaller).toHaveBeenCalledWith('get_account_balances', {});
  });

  it('is a run failure (logged, not thrown) when an agent calls a tool outside its manifest allowlist', async () => {
    const result = await runner.runAgent(CASH_MANAGER_MANIFEST, toolCaller, async (callTool) => {
      return callTool('get_transactions', {}); // not in the manifest — raw data, never allowed
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(AgentManifestViolationError);
    // The underlying tool implementation must never actually be invoked.
    expect(toolCaller).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('cash-manager');
  });

  it('rejects a manifest at validation time if an aggregates_cloud_ok agent allowlists a non-aggregate tool', () => {
    const badManifest = defineAgentManifest({
      id: 'bad-agent',
      version: '1',
      schedule: 'monthly',
      toolAllowlist: ['get_transactions'], // raw data — not on AGGREGATE_TOOL_ALLOWLIST
      privacyClass: 'aggregates_cloud_ok',
      outputTypes: ['recommendation'],
      featureFlag: 'advisor_bad_agent',
    });

    expect(() => runner.validateManifest(badManifest)).toThrow(/aggregates_cloud_ok/);
  });

  it('does not enforce the aggregate allowlist for local_only agents', () => {
    const localManifest = defineAgentManifest({
      id: 'local-agent',
      version: '1',
      schedule: 'monthly',
      toolAllowlist: ['get_transactions', 'search_transactions'],
      privacyClass: 'local_only',
      outputTypes: ['insight'],
      featureFlag: 'advisor_local_agent',
    });

    expect(() => runner.validateManifest(localManifest)).not.toThrow();
  });

  it('logs and reports failure for any other error the work function throws', async () => {
    const result = await runner.runAgent(CASH_MANAGER_MANIFEST, toolCaller, async () => {
      throw new Error('boom');
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('boom');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
