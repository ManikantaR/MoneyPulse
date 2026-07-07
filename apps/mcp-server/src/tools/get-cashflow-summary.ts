import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetCashflowSummary(server: McpServer) {
  server.tool(
    'get_cashflow_summary',
    'Money in vs money out for a date range: total income, total expenses, net cash flow, and savings rate. Excludes transfers between your own accounts.',
    {
      from: z.string().describe('Start date (YYYY-MM-DD)'),
      to: z.string().describe('End date (YYYY-MM-DD)'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT
           COALESCE(SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
           COALESCE(SUM(CASE WHEN NOT t.is_credit THEN t.amount_cents ELSE 0 END), 0) AS expense_cents
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND COALESCE(c.is_transfer, false) = false
           AND t.user_id = $3
           AND t.date >= $1
           AND t.date <= $2`,
        [params.from, params.to, userId],
      );

      const income = Number(rows[0]?.income_cents ?? 0);
      const expense = Number(rows[0]?.expense_cents ?? 0);
      const net = income - expense;
      const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
      const savingsRate =
        income > 0 ? `${((net / income) * 100).toFixed(1)}% of income` : 'n/a (no income in range)';

      const text = [
        `Income: ${dollars(income)}`,
        `Expenses: ${dollars(expense)}`,
        `Net cash flow: ${net >= 0 ? '+' : '-'}${dollars(net)} (${net >= 0 ? 'surplus' : 'deficit'})`,
        `Savings rate: ${savingsRate}`,
        `(${params.from} to ${params.to}; transfers between your own accounts excluded.)`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
