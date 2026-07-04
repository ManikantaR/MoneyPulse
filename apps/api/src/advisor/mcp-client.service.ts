import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
  'compare_periods',
]);

/** Anthropic tool definition shape (name + description + JSON schema). */
export interface AdvisorToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
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

  constructor(private readonly config: ConfigService) {}

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
   * Call an aggregate tool and return its text content. Rejects any name not on the
   * allowlist — defense in depth so a hallucinated/row-level tool can never run.
   */
  async callTool(userId: string, name: string, args: Record<string, any>): Promise<string> {
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
    return text || '(no data)';
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
