# Phase 7: MCP Server — Implementation Spec

**Dependencies**: Phase 2 (transactions), Phase 5 (analytics), Phase 6 (budgets)

> **Tech Debt Note**: The MCP server currently operates at household level with no per-user data scoping. All tools query based on household context. Per-user filtering will be added as a follow-up once the full application is stable.

## Decisions Summary

| #   | Decision  | Choice                                                     |
| --- | --------- | ---------------------------------------------------------- |
| 1   | Transport | stdio (primary) + SSE/HTTP (secondary)                     |
| 2   | SDK       | `@modelcontextprotocol/sdk`                                |
| 3   | DB access | Direct PostgreSQL read-only connection (no API dependency) |
| 4   | Tools     | 8 query tools                                              |
| 5   | Filters   | Respects soft delete + split parent exclusion              |

---

## File Inventory

| #   | File                                                  | Purpose                          |
| --- | ----------------------------------------------------- | -------------------------------- |
| 1   | `apps/mcp-server/package.json`                        | Package manifest                 |
| 2   | `apps/mcp-server/tsconfig.json`                       | TypeScript config                |
| 3   | `apps/mcp-server/src/index.ts`                        | Server setup + tool registration |
| 4   | `apps/mcp-server/src/db.ts`                           | PostgreSQL read-only connection  |
| 5   | `apps/mcp-server/src/tools/get-transactions.ts`       | List/paginate transactions       |
| 6   | `apps/mcp-server/src/tools/search-transactions.ts`    | Full-text search                 |
| 7   | `apps/mcp-server/src/tools/get-spending-summary.ts`   | Period spending by category      |
| 8   | `apps/mcp-server/src/tools/get-budget-status.ts`      | Current budget status            |
| 9   | `apps/mcp-server/src/tools/get-account-balances.ts`   | Account balances                 |
| 10  | `apps/mcp-server/src/tools/get-category-breakdown.ts` | Category breakdown               |
| 11  | `apps/mcp-server/src/tools/compare-periods.ts`        | Compare two date ranges          |
| 12  | `apps/mcp-server/src/tools/get-recurring-expenses.ts` | Identify recurring transactions  |
| 13  | `apps/mcp-server/Dockerfile`                          | Container build                  |

---

## Dependencies

```json
{
  "name": "@moneypulse/mcp-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "start:stdio": "node dist/index.js --stdio",
    "start:sse": "node dist/index.js --sse",
    "dev": "tsx src/index.ts --stdio"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "pg": "^8.13.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

> **Note**: MCP SDK uses Zod v3 internally for tool schema definitions. This package is standalone and does NOT share the workspace's Zod v4 schemas.

---

## 1. Database Connection

### `apps/mcp-server/src/db.ts`

```typescript
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'moneypulse',
  user: process.env.DB_USER || 'moneypulse',
  password: process.env.DB_PASSWORD!,
  max: 5,
  // Read-only: no INSERT/UPDATE/DELETE
  // Enforced by query patterns, not DB role (for simplicity)
});

export async function query<T = any>(
  text: string,
  params?: any[],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(
  text: string,
  params?: any[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function close(): Promise<void> {
  await pool.end();
}
```

---

## 2. Server Entry Point

### `apps/mcp-server/src/index.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerGetTransactions } from './tools/get-transactions.js';
import { registerSearchTransactions } from './tools/search-transactions.js';
import { registerGetSpendingSummary } from './tools/get-spending-summary.js';
import { registerGetBudgetStatus } from './tools/get-budget-status.js';
import { registerGetAccountBalances } from './tools/get-account-balances.js';
import { registerGetCategoryBreakdown } from './tools/get-category-breakdown.js';
import { registerComparePeriods } from './tools/compare-periods.js';
import { registerGetRecurringExpenses } from './tools/get-recurring-expenses.js';
import { close } from './db.js';
import http from 'node:http';

const server = new McpServer({
  name: 'moneypulse',
  version: '1.0.0',
});

// Register all tools
registerGetTransactions(server);
registerSearchTransactions(server);
registerGetSpendingSummary(server);
registerGetBudgetStatus(server);
registerGetAccountBalances(server);
registerGetCategoryBreakdown(server);
registerComparePeriods(server);
registerGetRecurringExpenses(server);

// Transport selection
const mode = process.argv.includes('--sse') ? 'sse' : 'stdio';

if (mode === 'sse') {
  const PORT = Number(process.env.MCP_PORT) || 3100;
  let sseTransport: SSEServerTransport | null = null;

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/sse') {
      sseTransport = new SSEServerTransport('/messages', res);
      await server.connect(sseTransport);
    } else if (req.method === 'POST' && req.url === '/messages') {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.writeHead(400);
        res.end('No SSE connection');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  httpServer.listen(PORT, () => {
    console.error(`MCP SSE server listening on port ${PORT}`);
  });
} else {
  // stdio mode (default)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP stdio server running');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await close();
  process.exit(0);
});
```

---

## 3. MCP Tools

### Common SQL Fragments

All tools share these WHERE conditions:

```sql
-- Exclude split parents (use children)
AND is_split_parent = false
-- Exclude soft-deleted
AND deleted_at IS NULL
```

### `apps/mcp-server/src/tools/get-transactions.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetTransactions(server: McpServer) {
  server.tool(
    'get_transactions',
    'List recent transactions with optional filters. Returns date, description, amount, category, account.',
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe('Number of transactions to return'),
      offset: z.number().min(0).default(0).describe('Pagination offset'),
      account_id: z.string().uuid().optional().describe('Filter by account ID'),
      category_id: z
        .string()
        .uuid()
        .optional()
        .describe('Filter by category ID'),
      from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    },
    async (params) => {
      const conditions: string[] = [
        't.is_split_parent = false',
        't.deleted_at IS NULL',
      ];
      const values: any[] = [];
      let idx = 1;

      if (params.account_id) {
        conditions.push(`t.account_id = $${idx++}`);
        values.push(params.account_id);
      }
      if (params.category_id) {
        conditions.push(`t.category_id = $${idx++}`);
        values.push(params.category_id);
      }
      if (params.from) {
        conditions.push(`t.date >= $${idx++}`);
        values.push(params.from);
      }
      if (params.to) {
        conditions.push(`t.date <= $${idx++}`);
        values.push(params.to);
      }

      values.push(params.limit, params.offset);

      const rows = await query(
        `SELECT t.date, t.description, t.amount_cents, t.is_credit,
                c.name AS category, a.nickname AS account
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        values,
      );

      const text = rows
        .map(
          (r) =>
            `${r.date.toISOString().slice(0, 10)} | ${r.is_credit ? '+' : '-'}$${(r.amount_cents / 100).toFixed(2)} | ${r.description} | ${r.category || 'Uncategorized'} | ${r.account}`,
        )
        .join('\n');

      return {
        content: [{ type: 'text', text: text || 'No transactions found.' }],
      };
    },
  );
}
```

### `apps/mcp-server/src/tools/search-transactions.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerSearchTransactions(server: McpServer) {
  server.tool(
    'search_transactions',
    'Search transactions by description or merchant name. Case-insensitive.',
    {
      query: z
        .string()
        .min(1)
        .describe('Search text (matches description and merchant_name)'),
      limit: z.number().min(1).max(50).default(20).describe('Max results'),
    },
    async (params) => {
      const rows = await query(
        `SELECT t.date, t.description, t.merchant_name, t.amount_cents, t.is_credit,
                c.name AS category, a.nickname AS account
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND (t.description ILIKE $1 OR t.merchant_name ILIKE $1)
         ORDER BY t.date DESC
         LIMIT $2`,
        [`%${params.query}%`, params.limit],
      );

      const text = rows
        .map(
          (r) =>
            `${r.date.toISOString().slice(0, 10)} | ${r.is_credit ? '+' : '-'}$${(r.amount_cents / 100).toFixed(2)} | ${r.description} | ${r.merchant_name || ''} | ${r.category || 'Uncategorized'} | ${r.account}`,
        )
        .join('\n');

      return {
        content: [{ type: 'text', text: text || 'No matching transactions.' }],
      };
    },
  );
}
```

### `apps/mcp-server/src/tools/get-spending-summary.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetSpendingSummary(server: McpServer) {
  server.tool(
    'get_spending_summary',
    'Get total spending grouped by category for a date range.',
    {
      from: z.string().describe('Start date (YYYY-MM-DD)'),
      to: z.string().describe('End date (YYYY-MM-DD)'),
    },
    async (params) => {
      const rows = await query(
        `SELECT
           COALESCE(c.name, 'Uncategorized') AS category,
           SUM(t.amount_cents) AS total_cents,
           COUNT(*) AS txn_count
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND t.is_credit = false
           AND t.date >= $1
           AND t.date <= $2
         GROUP BY c.name
         ORDER BY total_cents DESC`,
        [params.from, params.to],
      );

      const total = rows.reduce((s, r) => s + Number(r.total_cents), 0);
      const lines = rows.map(
        (r) =>
          `${r.category}: $${(Number(r.total_cents) / 100).toFixed(2)} (${r.txn_count} txns, ${total > 0 ? ((Number(r.total_cents) / total) * 100).toFixed(1) : 0}%)`,
      );
      lines.push(`\nTotal: $${(total / 100).toFixed(2)}`);

      return {
        content: [
          { type: 'text', text: lines.join('\n') || 'No spending data.' },
        ],
      };
    },
  );
}
```

### `apps/mcp-server/src/tools/get-budget-status.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetBudgetStatus(server: McpServer) {
  server.tool(
    'get_budget_status',
    'Get current budget status: budget amount, spent so far, and percentage used for each category.',
    {},
    async () => {
      const rows = await query(
        `SELECT
           c.name AS category,
           b.amount_cents AS budget_cents,
           b.period,
           COALESCE(spent.total, 0) AS spent_cents
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT SUM(t.amount_cents) AS total
           FROM transactions t
           WHERE t.category_id = b.category_id
             AND t.is_credit = false
             AND t.is_split_parent = false
             AND t.deleted_at IS NULL
             AND t.date >= CASE
               WHEN b.period = 'monthly' THEN date_trunc('month', CURRENT_DATE)
               WHEN b.period = 'weekly' THEN date_trunc('week', CURRENT_DATE)
               ELSE date_trunc('month', CURRENT_DATE)
             END
         ) spent ON true
         WHERE b.deleted_at IS NULL
         ORDER BY c.name`,
      );

      const lines = rows.map((r) => {
        const budget = Number(r.budget_cents);
        const spent = Number(r.spent_cents);
        const pct = budget > 0 ? ((spent / budget) * 100).toFixed(0) : '0';
        const status =
          spent > budget
            ? '🔴 OVER'
            : spent > budget * 0.8
              ? '🟡 WARNING'
              : '🟢 OK';
        return `${status} ${r.category}: $${(spent / 100).toFixed(2)} / $${(budget / 100).toFixed(2)} (${pct}%) [${r.period}]`;
      });

      return {
        content: [
          { type: 'text', text: lines.join('\n') || 'No budgets configured.' },
        ],
      };
    },
  );
}
```

### `apps/mcp-server/src/tools/get-account-balances.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetAccountBalances(server: McpServer) {
  server.tool(
    'get_account_balances',
    'Get current balance for all bank and credit card accounts.',
    {},
    async () => {
      const rows = await query(
        `SELECT
           a.nickname,
           a.institution,
           a.account_type,
           a.starting_balance_cents,
           a.credit_limit_cents,
           a.starting_balance_cents + COALESCE(SUM(
             CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
           ), 0) AS balance_cents
         FROM accounts a
         LEFT JOIN transactions t
           ON a.id = t.account_id
           AND t.is_split_parent = false
           AND t.deleted_at IS NULL
         WHERE a.deleted_at IS NULL
         GROUP BY a.id, a.nickname, a.institution, a.account_type,
                  a.starting_balance_cents, a.credit_limit_cents
         ORDER BY a.nickname`,
      );

      const lines = rows.map((r) => {
        const balance = Number(r.balance_cents);
        const line = `${r.nickname} (${r.institution}, ${r.account_type}): $${(balance / 100).toFixed(2)}`;
        if (r.credit_limit_cents) {
          const limit = Number(r.credit_limit_cents);
          const util =
            limit > 0 ? ((Math.abs(balance) / limit) * 100).toFixed(0) : '0';
          return `${line} (limit: $${(limit / 100).toFixed(2)}, ${util}% used)`;
        }
        return line;
      });

      return {
        content: [{ type: 'text', text: lines.join('\n') || 'No accounts.' }],
      };
    },
  );
}
```

### `apps/mcp-server/src/tools/get-category-breakdown.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetCategoryBreakdown(server: McpServer) {
  server.tool(
    'get_category_breakdown',
    'Detailed spending breakdown by category with sub-categories and transaction counts.',
    {
      from: z.string().describe('Start date (YYYY-MM-DD)'),
      to: z.string().describe('End date (YYYY-MM-DD)'),
      category: z
        .string()
        .optional()
        .describe('Filter to a specific category name'),
    },
    async (params) => {
      const conditions = [
        't.is_split_parent = false',
        't.deleted_at IS NULL',
        't.is_credit = false',
        `t.date >= $1`,
        `t.date <= $2`,
      ];
      const values: any[] = [params.from, params.to];

      if (params.category) {
        conditions.push(`c.name ILIKE $3`);
        values.push(`%${params.category}%`);
      }

      const rows = await query(
        `SELECT
           COALESCE(c.name, 'Uncategorized') AS category,
           COALESCE(parent.name, '') AS parent_category,
           SUM(t.amount_cents) AS total_cents,
           COUNT(*) AS txn_count,
           MIN(t.date) AS first_txn,
           MAX(t.date) AS last_txn
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN categories parent ON c.parent_id = parent.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY c.name, parent.name
         ORDER BY total_cents DESC`,
        values,
      );

      const lines = rows.map((r) => {
        const parent = r.parent_category ? `${r.parent_category} > ` : '';
        return `${parent}${r.category}: $${(Number(r.total_cents) / 100).toFixed(2)} (${r.txn_count} txns, ${r.first_txn.toISOString().slice(0, 10)} – ${r.last_txn.toISOString().slice(0, 10)})`;
      });

      return {
        content: [{ type: 'text', text: lines.join('\n') || 'No data.' }],
      };
    },
  );
}
```

### `apps/mcp-server/src/tools/compare-periods.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerComparePeriods(server: McpServer) {
  server.tool(
    'compare_periods',
    'Compare spending between two date ranges. Shows per-category and total differences.',
    {
      period1_from: z.string().describe('First period start date (YYYY-MM-DD)'),
      period1_to: z.string().describe('First period end date (YYYY-MM-DD)'),
      period2_from: z
        .string()
        .describe('Second period start date (YYYY-MM-DD)'),
      period2_to: z.string().describe('Second period end date (YYYY-MM-DD)'),
    },
    async (params) => {
      const getSummary = async (from: string, to: string) =>
        query(
          `SELECT
             COALESCE(c.name, 'Uncategorized') AS category,
             SUM(t.amount_cents) AS total_cents
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.is_split_parent = false
             AND t.deleted_at IS NULL
             AND t.is_credit = false
             AND t.date >= $1 AND t.date <= $2
           GROUP BY c.name`,
          [from, to],
        );

      const [p1, p2] = await Promise.all([
        getSummary(params.period1_from, params.period1_to),
        getSummary(params.period2_from, params.period2_to),
      ]);

      const p1Map = new Map(p1.map((r) => [r.category, Number(r.total_cents)]));
      const p2Map = new Map(p2.map((r) => [r.category, Number(r.total_cents)]));
      const allCategories = new Set([...p1Map.keys(), ...p2Map.keys()]);

      let totalP1 = 0;
      let totalP2 = 0;
      const lines: string[] = [
        `Period 1: ${params.period1_from} to ${params.period1_to}`,
        `Period 2: ${params.period2_from} to ${params.period2_to}`,
        '',
        'Category | Period 1 | Period 2 | Change',
        '---------|----------|----------|-------',
      ];

      for (const cat of [...allCategories].sort()) {
        const v1 = p1Map.get(cat) ?? 0;
        const v2 = p2Map.get(cat) ?? 0;
        totalP1 += v1;
        totalP2 += v2;
        const diff = v2 - v1;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        lines.push(
          `${cat} | $${(v1 / 100).toFixed(2)} | $${(v2 / 100).toFixed(2)} | ${arrow} $${(Math.abs(diff) / 100).toFixed(2)}`,
        );
      }

      const totalDiff = totalP2 - totalP1;
      const arrow = totalDiff > 0 ? '↑' : totalDiff < 0 ? '↓' : '→';
      lines.push(
        `\nTOTAL | $${(totalP1 / 100).toFixed(2)} | $${(totalP2 / 100).toFixed(2)} | ${arrow} $${(Math.abs(totalDiff) / 100).toFixed(2)}`,
      );

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
```

### `apps/mcp-server/src/tools/get-recurring-expenses.ts`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetRecurringExpenses(server: McpServer) {
  server.tool(
    'get_recurring_expenses',
    'Identify recurring expenses by finding merchants/descriptions with 3+ transactions in the last 90 days.',
    {
      min_occurrences: z
        .number()
        .min(2)
        .default(3)
        .describe('Minimum occurrences to consider recurring'),
      days: z
        .number()
        .min(30)
        .max(365)
        .default(90)
        .describe('Lookback period in days'),
    },
    async (params) => {
      const rows = await query(
        `SELECT
           COALESCE(t.merchant_name, t.description) AS merchant,
           COUNT(*) AS occurrences,
           ROUND(AVG(t.amount_cents)) AS avg_amount_cents,
           SUM(t.amount_cents) AS total_cents,
           MIN(t.date) AS first_seen,
           MAX(t.date) AS last_seen,
           COALESCE(c.name, 'Uncategorized') AS category
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND t.is_credit = false
           AND t.date >= CURRENT_DATE - $1::int * INTERVAL '1 day'
         GROUP BY COALESCE(t.merchant_name, t.description), c.name
         HAVING COUNT(*) >= $2
         ORDER BY total_cents DESC`,
        [params.days, params.min_occurrences],
      );

      const lines = rows.map(
        (r) =>
          `${r.merchant} (${r.category}): ${r.occurrences}x in ${params.days}d, avg $${(Number(r.avg_amount_cents) / 100).toFixed(2)}, total $${(Number(r.total_cents) / 100).toFixed(2)} (${r.first_seen.toISOString().slice(0, 10)} – ${r.last_seen.toISOString().slice(0, 10)})`,
      );

      return {
        content: [
          {
            type: 'text',
            text:
              lines.length > 0
                ? `Found ${lines.length} recurring expenses:\n\n${lines.join('\n')}`
                : 'No recurring expenses found.',
          },
        ],
      };
    },
  );
}
```

---

## 4. TypeScript Config

### `apps/mcp-server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

---

## 5. Dockerfile

### `apps/mcp-server/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp-server/package.json apps/mcp-server/
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter @moneypulse/mcp-server

COPY apps/mcp-server/ apps/mcp-server/
RUN cd apps/mcp-server && pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/mcp-server/dist ./dist
COPY --from=build /app/apps/mcp-server/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3100
CMD ["node", "dist/index.js", "--sse"]
```

---

## 6. Claude Desktop / MCP Client Configuration

### stdio mode (local use):

```json
{
  "mcpServers": {
    "moneypulse": {
      "command": "node",
      "args": ["/path/to/MyMoney/apps/mcp-server/dist/index.js", "--stdio"],
      "env": {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "moneypulse",
        "DB_USER": "moneypulse",
        "DB_PASSWORD": "your_db_password_here"
      }
    }
  }
}
```

### SSE mode (Docker Compose service):

```yaml
# In docker-compose.yml
mcp-server:
  build:
    context: .
    dockerfile: apps/mcp-server/Dockerfile
  ports:
    - '3100:3100'
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - DB_NAME=moneypulse
    - DB_USER=moneypulse
    - DB_PASSWORD=${DB_PASSWORD}
    - MCP_PORT=3100
  depends_on:
    - postgres
```

---

## MCP Tools Summary

| Tool                     | Description                              | Parameters                                       |
| ------------------------ | ---------------------------------------- | ------------------------------------------------ |
| `get_transactions`       | List/paginate recent transactions        | limit, offset, account_id, category_id, from, to |
| `search_transactions`    | Full-text search by description/merchant | query, limit                                     |
| `get_spending_summary`   | Category totals for date range           | from, to                                         |
| `get_budget_status`      | Budget vs actual spend status            | (none)                                           |
| `get_account_balances`   | Current balance per account              | (none)                                           |
| `get_category_breakdown` | Detailed category breakdown              | from, to, category                               |
| `compare_periods`        | Compare two date ranges                  | period1_from/to, period2_from/to                 |
| `get_recurring_expenses` | Find recurring merchants                 | min_occurrences, days                            |

---

## Implementation Order

```
Step 1:  Create apps/mcp-server package.json + tsconfig.json
Step 2:  Install dependencies (pnpm install)
Step 3:  Create db.ts — PostgreSQL connection
Step 4:  Create index.ts — server setup with transport selection
Step 5:  Create get_transactions tool
Step 6:  Create search_transactions tool
Step 7:  Create get_spending_summary tool
Step 8:  Create get_budget_status tool
Step 9:  Create get_account_balances tool
Step 10: Create get_category_breakdown tool
Step 11: Create compare_periods tool
Step 12: Create get_recurring_expenses tool
Step 13: Create Dockerfile
Step 14: Add mcp-server to docker-compose.yml
Step 15: Build + test with MCP Inspector
Step 16: Test with Claude Desktop (stdio)
Step 17: Git commit
```
