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
            type: 'text' as const,
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
