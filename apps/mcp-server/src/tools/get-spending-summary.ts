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
        content: [{ type: 'text' as const, text: lines.join('\n') || 'No spending data.' }],
      };
    },
  );
}
