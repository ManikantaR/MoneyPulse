import { Injectable, Logger, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AccountFreshnessService } from '../analytics/account-freshness.service';
import * as path from 'node:path';

/**
 * Tools from the MCP server that return **aggregates only** and are therefore safe
 * to expose to the cloud model (per the AI-advisor "aggregates-only to cloud" rule,
 * epic #36). `get_transactions` and `search_transactions` return raw transaction
 * rows and are intentionally excluded — they stay local-only.
 */
export const AGGREGATE_TOOL_ALLOWLIST = new Set([
  'get_account_balances',
  'get_spending_summary',
  'get_category_breakdown',
  'get_budget_status',
  'get_recurring_expenses',
  'get_merchant_breakdown',
  'get_cashflow_summary',
  'get_income_breakdown',
  'get_net_worth',
  'get_upcoming_bills',
  'get_subscriptions',
  'get_cashflow_forecast',
  'get_category_trend',
  'get_budget_history',
  'get_recent_anomalies',
  'get_loan_status',
  'compare_periods',
  'get_market_context', // public EIA/FRED data, no user PII — safe for the cloud advisor
  'get_savings_rate',
  'get_cash_runway',
  'get_subscription_total',
  'get_yoy_comparison',
  'get_portfolio_value', // holdings x latest EOD close, aggregate only
  'get_allocation', // percent-of-portfolio by ticker, aggregate only
  // get_earned_apy is intentionally excluded: its evidence cites individual interest
  // transactions (date/amount/description) — row-level data, same as get_transactions.
  'get_rate_watchlist', // user-entered advertised rates + auto-populated Treasury rows, no PII
  'get_monthly_close', // frozen aggregate close totals/ratios/target-status/freshness, no row-level data
  'get_financial_health', // ratio/target/trend rollup across recent closes, aggregate only
  'get_car_affordability', // user-entered TCO inputs + gross income figure + public gas price, no row-level data
]);

/** Anthropic tool definition shape (name + description + JSON schema). */
export interface AdvisorToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

/** Response from a tool call, optionally including a caveat about data freshness. */
export interface ToolCallResult {
  text: string;
  dataCaveat?: string;
}

/**
 * Filter raw MCP tools down to the aggregate allowlist and map them to Anthropic tool
 * defs. Pure + exported so the aggregates-only boundary is unit-testable without a
 * live MCP connection.
 */
export function toAdvisorTools(
  mcpTools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
): AdvisorToolDef[] {
  return mcpTools
    .filter((t) => AGGREGATE_TOOL_ALLOWLIST.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: (t.inputSchema as Record<string, any>) ?? {
        type: 'object',
        properties: {},
      },
    }));
}

/**
 * Connects to the MoneyPulse MCP server (the read-only financial semantic layer) as
 * a client and exposes its **aggregate** tools to the advisor. One stdio connection
 * is spawned per user and scoped via `MONEYPULSE_USER_ID`, so a tool call can never
 * span accounts.
 */
@Injectable()
export class McpClientService implements OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, Promise<Client>>();

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(AccountFreshnessService)
    private readonly freshnessService?: AccountFreshnessService,
  ) {}

  private serverCommand(): { command: string; args: string[] } {
    const command = this.config.get<string>('MCP_SERVER_CMD') || 'node';
    const rawArgs = this.config.get<string>('MCP_SERVER_ARGS');
    if (rawArgs) {
      return { command, args: rawArgs.split(' ').filter(Boolean) };
    }
    // Default: run the built MCP server over stdio. Resolvable in the monorepo and
    // overridable via env in the deployed container.
    const entry =
      this.config.get<string>('MCP_SERVER_ENTRY') ||
      path.resolve(process.cwd(), '../mcp-server/dist/index.js');
    return { command, args: [entry, '--stdio'] };
  }

  /** Lazily spawn + connect a user-scoped MCP client, cached per user. */
  private getClient(userId: string): Promise<Client> {
    let existing = this.clients.get(userId);
    if (existing) return existing;

    const connect = (async () => {
      const { command, args } = this.serverCommand();
      const transport = new StdioClientTransport({
        command,
        args,
        env: {
          ...(process.env as Record<string, string>),
          MONEYPULSE_USER_ID: userId,
        },
      });
      const client = new Client({ name: 'moneypulse-advisor', version: '1.0.0' });
      await client.connect(transport);
      this.logger.log(`MCP client connected (user ${userId})`);
      return client;
    })();

    // Cache the promise; drop it on failure so the next call retries.
    connect.catch((err) => {
      this.logger.error(`MCP connect failed: ${err.message}`);
      this.clients.delete(userId);
    });
    this.clients.set(userId, connect);
    return connect;
  }

  /** Aggregate MCP tools mapped to Anthropic tool definitions (row-level tools excluded). */
  async listAdvisorTools(userId: string): Promise<AdvisorToolDef[]> {
    const client = await this.getClient(userId);
    const { tools } = await client.listTools();
    return toAdvisorTools(tools);
  }

  /**
   * Call an aggregate tool and return its text content with optional data freshness caveat.
   * Rejects any name not on the allowlist — defense in depth so a hallucinated/row-level
   * tool can never run.
   *
   * If the tool touches stale accounts, includes a dataCaveat in the result.
   */
  async callTool(
    userId: string,
    name: string,
    args: Record<string, any>,
  ): Promise<ToolCallResult> {
    if (!AGGREGATE_TOOL_ALLOWLIST.has(name)) {
      throw new Error(`Tool "${name}" is not an allowed advisor tool.`);
    }
    const client = await this.getClient(userId);
    const result: any = await client.callTool({ name, arguments: args ?? {} });
    const blocks = Array.isArray(result?.content) ? result.content : [];
    const text = blocks
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    // Check if this tool might involve stale accounts and add caveat if needed
    let dataCaveat: string | undefined;
    try {
      dataCaveat = await this.checkAndBuildDataCaveat(userId, name, args);
    } catch (err: any) {
      this.logger.warn(`Failed to compute data caveat: ${err.message}`);
    }

    return {
      text: text || '(no data)',
      dataCaveat,
    };
  }

  /**
   * Check if a tool call involves stale accounts and build an appropriate caveat.
   * Returns undefined if all accounts are fresh or if freshness service is unavailable.
   * Fetches freshness data once (not twice) to avoid redundant DB fanout.
   *
   * NOTE on args scoping: The caveat is emitted globally (across all user accounts)
   * rather than scoped to the specific accounts named in args. This is intentional:
   * data freshness is a user-level property, and even queries scoped to fresh accounts
   * should warn if OTHER accounts are stale and may affect cross-account analysis
   * (e.g., net-worth, cashflow forecasts). Per Phase-11 Architecture Principle 1,
   * freshness concerns are local-first and holistic.
   */
  private async checkAndBuildDataCaveat(
    userId: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<string | undefined> {
    if (!this.freshnessService) {
      return undefined;
    }

    // Only certain tools benefit from freshness caveats
    const toolsNeedingFreshnessCheck = new Set([
      'get_spending_summary',
      'get_category_breakdown',
      'get_income_breakdown',
      'get_merchant_breakdown',
      'get_budget_status',
      'get_cashflow_summary',
      'compare_periods',
      'get_savings_rate',
      'get_cash_runway',
      'get_subscription_total',
      'get_yoy_comparison',
    ]);

    if (!toolsNeedingFreshnessCheck.has(toolName)) {
      return undefined;
    }

    try {
      // Fetch freshness data once; getAccountFreshness already scans all accounts
      const freshness = await this.freshnessService.getAccountFreshness(userId);
      const staleAccounts = freshness.accounts.filter(
        (acc) => acc.status === 'stale',
      );

      if (staleAccounts.length === 0) {
        return undefined;
      }

      // Build caveat message
      const accountList = staleAccounts
        .map(
          (acc) =>
            `${acc.nickname} (no data since ${acc.lastTransactionDate?.toISOString().split('T')[0] || 'unknown'})`,
        )
        .join('; ');

      return `⚠️ Data freshness note: ${accountList}. Figures may be incomplete.`;
    } catch (err: any) {
      this.logger.debug(
        `Error building freshness caveat: ${err.message}`,
      );
      return undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const [userId, p] of this.clients) {
      try {
        const client = await p;
        await client.close();
      } catch (err: any) {
        this.logger.warn(`MCP close failed (user ${userId}): ${err.message}`);
      }
    }
    this.clients.clear();
  }
}
