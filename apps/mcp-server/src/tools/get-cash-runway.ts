import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query, getUserId } from '../db.js';

export function registerGetCashRunway(server: McpServer) {
  server.tool(
    'get_cash_runway',
    'Cash runway — liquid (checking + savings) balances divided by the trailing 3-month average monthly expenses, in months. Answers "how long would my savings last" and "what\'s my runway".',
    {},
    async () => {
      const userId = await getUserId();

      const liquidRows = await query(
        `SELECT COALESCE(SUM(
           a.starting_balance_cents + COALESCE(sub.net, 0)
         ), 0) AS liquid_cents
         FROM accounts a
         LEFT JOIN LATERAL (
           SELECT SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END) AS net
           FROM transactions t
           WHERE t.account_id = a.id AND t.is_split_parent = false AND t.deleted_at IS NULL
         ) sub ON true
         WHERE a.deleted_at IS NULL
           AND a.account_type IN ('checking', 'savings')
           AND a.user_id = $1`,
        [userId],
      );
      const liquidCents = Number(liquidRows[0]?.liquid_cents ?? 0);

      const expenseRows = await query(
        `SELECT COALESCE(SUM(t.amount_cents), 0) AS total_cents
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND t.is_credit = false
           AND COALESCE(c.is_transfer, false) = false
           AND t.user_id = $1
           AND t.date >= date_trunc('month', CURRENT_DATE) - INTERVAL '3 months'
           AND t.date < date_trunc('month', CURRENT_DATE)`,
        [userId],
      );
      const trailingExpenseCents = Number(expenseRows[0]?.total_cents ?? 0);
      const avgMonthlyExpenseCents = Math.round(trailingExpenseCents / 3);

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      if (avgMonthlyExpenseCents <= 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `Liquid balance: ${dollars(liquidCents)}. No trailing expense history to compute a runway estimate.`,
          }],
        };
      }
      const months = liquidCents / avgMonthlyExpenseCents;
      const text = [
        `Liquid balance: ${dollars(liquidCents)}`,
        `Trailing 3-month avg expenses: ${dollars(avgMonthlyExpenseCents)}/month`,
        `Cash runway: ~${months.toFixed(1)} months`,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
