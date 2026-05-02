import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerGetTransactions(server: McpServer) {
  server.tool(
    'get_transactions',
    'List recent transactions with optional filters. Returns date, description, amount, category, account.',
    {
      limit: z.number().min(1).max(100).default(20).describe('Number of transactions to return'),
      offset: z.number().min(0).default(0).describe('Pagination offset'),
      account_id: z.string().uuid().optional().describe('Filter by account ID'),
      category_id: z.string().uuid().optional().describe('Filter by category ID'),
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
        content: [{ type: 'text' as const, text: text || 'No transactions found.' }],
      };
    },
  );
}
