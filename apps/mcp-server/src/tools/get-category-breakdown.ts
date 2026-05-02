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
      category: z.string().optional().describe('Filter to a specific category name'),
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
        content: [{ type: 'text' as const, text: lines.join('\n') || 'No data.' }],
      };
    },
  );
}
