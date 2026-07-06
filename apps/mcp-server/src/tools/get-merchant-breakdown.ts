import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetMerchantBreakdown(server: McpServer) {
  server.tool(
    'get_merchant_breakdown',
    'Top merchants/vendors by spend for a date range, optionally filtered to a category (or its parent). Answers "who did I pay the most" and "break <category> down by vendor". Uses cleaned merchant names only.',
    {
      from: z.string().describe('Start date (YYYY-MM-DD)'),
      to: z.string().describe('End date (YYYY-MM-DD)'),
      category: z
        .string()
        .optional()
        .describe('Filter to a category name (matches the category or its parent)'),
      limit: z.number().min(1).max(50).default(15).describe('Max merchants to return'),
    },
    async (params) => {
      const userId = await getUserId();

      // Cleaned merchant label only — never the raw description (keeps raw transaction
      // text on the NAS, per the aggregates-only cloud boundary).
      const merchantExpr = `COALESCE(t.normalized_merchant_name, t.merchant_name, 'Other')`;

      const conditions = [
        't.is_split_parent = false',
        't.deleted_at IS NULL',
        't.is_credit = false',
        't.date >= $1',
        't.date <= $2',
      ];
      const values: any[] = [params.from, params.to];

      conditions.push(`t.user_id = $${values.length + 1}`);
      values.push(userId);

      if (params.category) {
        conditions.push(
          `(c.name ILIKE $${values.length + 1} OR parent.name ILIKE $${values.length + 1})`,
        );
        values.push(`%${params.category}%`);
      }

      const limitPlaceholder = `$${values.length + 1}`;
      values.push(params.limit);

      const rows = await query(
        `SELECT
           ${merchantExpr} AS merchant,
           COALESCE(c.name, 'Uncategorized') AS category,
           SUM(t.amount_cents) AS total_cents,
           COUNT(*) AS txn_count
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN categories parent ON c.parent_id = parent.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY ${merchantExpr}, c.name
         ORDER BY total_cents DESC
         LIMIT ${limitPlaceholder}`,
        values,
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No data.' }] };
      }

      const total = rows.reduce((s, r) => s + Number(r.total_cents), 0);
      const lines = rows.map(
        (r) =>
          `${r.merchant} (${r.category}): $${(Number(r.total_cents) / 100).toFixed(2)} (${r.txn_count} txns)`,
      );

      const text = [
        lines.join('\n'),
        '',
        `Total (top ${rows.length}): $${(total / 100).toFixed(2)}`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
