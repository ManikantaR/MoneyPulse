import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetSavingsRate(server: McpServer) {
  server.tool(
    'get_savings_rate',
    'Monthly savings rate — (income - expenses) / income — for the current month plus a trailing series. Answers "what\'s my savings rate" and "how is my savings rate trending".',
    {
      months: z.number().min(1).max(60).default(12).describe('How many trailing months to include'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT
           to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
           SUM(CASE WHEN t.is_credit = true THEN t.amount_cents ELSE 0 END) AS income_cents,
           SUM(CASE WHEN t.is_credit = false THEN t.amount_cents ELSE 0 END) AS expense_cents
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND COALESCE(c.is_transfer, false) = false
           AND t.user_id = $1
           AND t.date >= date_trunc('month', CURRENT_DATE) - ($2 - 1 || ' months')::interval
         GROUP BY date_trunc('month', t.date)
         ORDER BY month ASC`,
        [userId, params.months],
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No transaction history available to compute savings rate.' }] };
      }

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const lines = rows.map((r) => {
        const income = Number(r.income_cents);
        const expense = Number(r.expense_cents);
        const rate = income > 0 ? ((income - expense) / income) * 100 : null;
        return `${r.month}: ${rate === null ? 'n/a (no income)' : `${rate.toFixed(1)}%`} (income ${dollars(income)}, expenses ${dollars(expense)})`;
      });

      const latest = rows[rows.length - 1];
      const latestIncome = Number(latest.income_cents);
      const latestRate = latestIncome > 0
        ? `${(((latestIncome - Number(latest.expense_cents)) / latestIncome) * 100).toFixed(1)}%`
        : 'n/a (no income this month)';

      const text = [
        `Current month (${latest.month}) savings rate: ${latestRate}`,
        '',
        `Trailing ${rows.length}-month series:`,
        lines.join('\n'),
      ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
