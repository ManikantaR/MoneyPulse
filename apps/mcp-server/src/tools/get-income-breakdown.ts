import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetIncomeBreakdown(server: McpServer) {
  server.tool(
    'get_income_breakdown',
    'Income (money received) grouped by category/source for a date range. Use for "what were my income sources" or "how much did I earn". Excludes transfers between your own accounts.',
    {
      from: z.string().describe('Start date (YYYY-MM-DD)'),
      to: z.string().describe('End date (YYYY-MM-DD)'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT
           COALESCE(c.name, 'Uncategorized') AS category,
           SUM(t.amount_cents) AS total_cents,
           COUNT(*) AS txn_count
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_credit = true
           AND t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND COALESCE(c.is_transfer, false) = false
           AND t.user_id = $3
           AND t.date >= $1
           AND t.date <= $2
         GROUP BY c.name
         ORDER BY total_cents DESC`,
        [params.from, params.to, userId],
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No income recorded in this period.' }] };
      }

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const total = rows.reduce((s, r) => s + Number(r.total_cents), 0);
      const lines = rows.map(
        (r) => `${r.category}: ${dollars(Number(r.total_cents))} (${r.txn_count} txns)`,
      );

      const text = [lines.join('\n'), '', `Total income: ${dollars(total)}`].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
