import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetCashflowForecast(server: McpServer) {
  server.tool(
    'get_cashflow_forecast',
    'Short-term cash-flow outlook: current liquid balance (checking/savings), bills due in the window, a conservative "safe to spend", and a projected balance based on recent trend (flags a low-balance date). Answers "will I make it to payday" / "how much is safe to spend".',
    {
      days: z.number().min(7).max(120).default(30).describe('Forecast horizon in days'),
    },
    async (params) => {
      const userId = await getUserId();
      const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
      const signed = (c: number) => `${c < 0 ? '-' : '+'}${dollars(c)}`;

      // 1) Liquid balance across checking/savings accounts.
      const liquidRows = await query(
        `SELECT COALESCE(SUM(a.starting_balance_cents + COALESCE(tx.net, 0)), 0) AS liquid_cents
         FROM accounts a
         LEFT JOIN (
           SELECT account_id,
                  SUM(CASE WHEN is_credit THEN amount_cents ELSE -amount_cents END) AS net
           FROM transactions
           WHERE deleted_at IS NULL AND is_split_parent = false
           GROUP BY account_id
         ) tx ON tx.account_id = a.id
         WHERE a.user_id = $1 AND a.deleted_at IS NULL
           AND a.account_type IN ('checking', 'savings')`,
        [userId],
      );
      const liquid = Number(liquidRows[0]?.liquid_cents ?? 0);

      // 2) Bills due within the window.
      const billRows = await query(
        `SELECT COALESCE(SUM(expected_amount_cents), 0) AS bills_cents, COUNT(*) AS bill_count
         FROM recurring_bills
         WHERE user_id = $2 AND is_active = true AND next_expected_date IS NOT NULL
           AND next_expected_date >= NOW()
           AND next_expected_date < NOW() + make_interval(days => $1)`,
        [params.days, userId],
      );
      const bills = Number(billRows[0]?.bills_cents ?? 0);
      const billCount = Number(billRows[0]?.bill_count ?? 0);

      // 3) Average daily net cash flow over the last 90 days (excludes transfers).
      const netRows = await query(
        `SELECT COALESCE(SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END), 0) AS net_90d
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.is_split_parent = false
           AND COALESCE(c.is_transfer, false) = false
           AND t.date >= CURRENT_DATE - interval '90 days'`,
        [userId],
      );
      const avgDailyNet = Math.round(Number(netRows[0]?.net_90d ?? 0) / 90);

      const projected = liquid + avgDailyNet * params.days;
      const safeToSpend = liquid - bills;

      const lines = [
        `Liquid balance (checking/savings): ${dollars(liquid)}`,
        `Bills due in next ${params.days}d: ${dollars(bills)} across ${billCount} bill${billCount === 1 ? '' : 's'}`,
        `Safe to spend now (after those bills): ${signed(safeToSpend)}`,
        `Avg daily net cash flow (last 90d): ${signed(avgDailyNet)}/day`,
        `Projected liquid balance in ${params.days}d: ${dollars(projected)}`,
      ];

      // Low-balance warning if the trend runs the liquid balance negative.
      if (avgDailyNet < 0) {
        const daysToZero = Math.floor(liquid / -avgDailyNet);
        if (daysToZero <= params.days) {
          const d = new Date();
          d.setDate(d.getDate() + daysToZero);
          lines.push(
            `⚠ On the current trend, liquid balance dips below $0 around ${d.toISOString().slice(0, 10)} (~${daysToZero} days).`,
          );
        }
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
