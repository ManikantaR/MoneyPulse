import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetCategoryTrend(server: McpServer) {
  server.tool(
    'get_category_trend',
    'Month-by-month spending for a category (matches the category or its parent) over the last N months. Answers "is my <category> spending trending up/down".',
    {
      category: z.string().describe('Category name to trend (matches category or parent)'),
      months: z.number().min(2).max(24).default(6).describe('How many recent months'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT to_char(date_trunc('month', t.date), 'YYYY-MM') AS ym,
                SUM(t.amount_cents) AS total_cents
         FROM transactions t
         JOIN categories c ON t.category_id = c.id
         LEFT JOIN categories parent ON c.parent_id = parent.id
         WHERE t.user_id = $3 AND t.is_credit = false AND t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND (c.name ILIKE $1 OR parent.name ILIKE $1)
           AND t.date >= date_trunc('month', CURRENT_DATE) - make_interval(months => $2 - 1)
         GROUP BY 1
         ORDER BY 1`,
        [`%${params.category}%`, params.months, userId],
      );

      if (rows.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: `No spending found for "${params.category}" in the last ${params.months} months.` },
          ],
        };
      }

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const vals = rows.map((r) => Number(r.total_cents));
      const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      const first = vals[0];
      const last = vals[vals.length - 1];
      const delta = last - first;
      const direction =
        Math.abs(delta) < avg * 0.1 ? 'roughly flat' : delta > 0 ? 'trending up' : 'trending down';

      const lines = rows.map((r) => `${r.ym}: ${dollars(Number(r.total_cents))}`);
      const text = [
        `"${params.category}" spending by month:`,
        lines.join('\n'),
        '',
        `Average ${dollars(avg)}/month; ${direction} (${dollars(first)} → ${dollars(last)}).`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
