import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerSearchTransactions(server: McpServer) {
  server.tool(
    'search_transactions',
    'Search transactions by description or merchant name. Case-insensitive.',
    {
      query: z.string().min(1).describe('Search text (matches description and merchant_name)'),
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
        content: [{ type: 'text' as const, text: text || 'No matching transactions.' }],
      };
    },
  );
}
