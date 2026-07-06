import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

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
      const userId = await getUserId();
      const conditions = [
        't.is_split_parent = false',
        't.deleted_at IS NULL',
        't.is_credit = false',
        `t.date >= $1`,
        `t.date <= $2`,
      ];
      const values: any[] = [params.from, params.to];

      conditions.push(`t.user_id = $${values.length + 1}`);
      values.push(userId);

      if (params.category) {
        conditions.push(`c.name ILIKE $${values.length + 1}`);
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

      const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

      const lines = rows.map((r) => {
        const parent = r.parent_category ? `${r.parent_category} > ` : '';
        return `${parent}${r.category}: ${dollars(Number(r.total_cents))} (${r.txn_count} txns, ${r.first_txn.toISOString().slice(0, 10)} – ${r.last_txn.toISOString().slice(0, 10)})`;
      });

      // Roll up per-parent subtotals so parent-level questions ("how much on auto?")
      // resolve to a single figure without the model having to add subcategories.
      // Top-level categories (no parent) count as their own group.
      const parentTotals = new Map<string, number>();
      let grandTotal = 0;
      for (const r of rows) {
        const cents = Number(r.total_cents);
        grandTotal += cents;
        const parent = (r.parent_category as string) || (r.category as string);
        parentTotals.set(parent, (parentTotals.get(parent) ?? 0) + cents);
      }
      const subtotalLines = [...parentTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([parent, cents]) => `${parent}: ${dollars(cents)}`);

      const text =
        rows.length === 0
          ? 'No data.'
          : [
              lines.join('\n'),
              '',
              'Totals by parent category:',
              subtotalLines.join('\n'),
              '',
              `Total: ${dollars(grandTotal)}`,
            ].join('\n');

      return {
        content: [{ type: 'text' as const, text }],
      };
    },
  );
}
