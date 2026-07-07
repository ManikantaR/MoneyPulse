import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetNetWorth(server: McpServer) {
  server.tool(
    'get_net_worth',
    'Current net worth (assets minus liabilities across all accounts) plus a month-end trend over the last N months. Answers "what am I worth" and "how has my net worth changed".',
    {
      months: z
        .number()
        .min(1)
        .max(36)
        .default(6)
        .describe('How many recent months of trend to include'),
    },
    async (params) => {
      const userId = await getUserId();
      const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
      const signed = (c: number) => `${c < 0 ? '-' : ''}${dollars(c)}`;

      // Current per-account balances → assets vs liabilities.
      const balRows = await query(
        `SELECT
           a.starting_balance_cents
             + COALESCE(SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END), 0) AS bal
         FROM accounts a
         LEFT JOIN transactions t
           ON t.account_id = a.id AND t.deleted_at IS NULL AND t.is_split_parent = false
         WHERE a.user_id = $1 AND a.deleted_at IS NULL
         GROUP BY a.id, a.starting_balance_cents`,
        [userId],
      );
      let assets = 0;
      let liabilities = 0;
      for (const r of balRows) {
        const bal = Number(r.bal);
        if (bal >= 0) assets += bal;
        else liabilities += bal; // negative
      }
      const netWorth = assets + liabilities;

      // Month-end net worth = starting balances + cumulative signed transactions by month.
      const trendRows = await query(
        `WITH acct AS (
           SELECT id, starting_balance_cents FROM accounts
           WHERE user_id = $1 AND deleted_at IS NULL
         ),
         start_total AS (SELECT COALESCE(SUM(starting_balance_cents), 0) AS s FROM acct),
         monthly AS (
           SELECT date_trunc('month', t.date)::date AS m,
                  SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END) AS delta
           FROM transactions t
           JOIN acct ON acct.id = t.account_id
           WHERE t.deleted_at IS NULL AND t.is_split_parent = false
           GROUP BY 1
         )
         SELECT m,
                (SELECT s FROM start_total) + SUM(delta) OVER (ORDER BY m) AS net_worth_cents
         FROM monthly
         ORDER BY m`,
        [userId],
      );

      const recent = trendRows.slice(-params.months);
      const trendLines = recent.map((r) => {
        const label = new Date(r.m).toISOString().slice(0, 7); // YYYY-MM
        return `${label}: ${signed(Number(r.net_worth_cents))}`;
      });

      const text = [
        `Net worth: ${signed(netWorth)}`,
        `  Assets: ${dollars(assets)}`,
        `  Liabilities: ${signed(liabilities)}`,
        '',
        `Month-end net worth (last ${recent.length} month${recent.length === 1 ? '' : 's'}):`,
        trendLines.length ? trendLines.join('\n') : '(not enough history)',
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
