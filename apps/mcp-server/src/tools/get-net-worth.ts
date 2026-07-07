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
      let cashAssets = 0;
      let liabilities = 0;
      for (const r of balRows) {
        const bal = Number(r.bal);
        if (bal >= 0) cashAssets += bal;
        else liabilities += bal; // negative
      }

      // Current investment/brokerage value = latest snapshot balance per active account.
      const investRows = await query(
        `SELECT COALESCE(SUM(latest.balance_cents), 0) AS invest_cents
         FROM investment_accounts ia
         JOIN LATERAL (
           SELECT balance_cents FROM investment_snapshots s
           WHERE s.investment_account_id = ia.id
           ORDER BY s.date DESC LIMIT 1
         ) latest ON true
         WHERE ia.user_id = $1 AND ia.deleted_at IS NULL`,
        [userId],
      );
      const investments = Number(investRows[0]?.invest_cents ?? 0);
      const assets = cashAssets + investments;
      const netWorth = assets + liabilities;

      // Investment value at each month-end (latest snapshot on/before month end).
      const investTrend = await query(
        `SELECT to_char(m, 'YYYY-MM') AS ym, COALESCE(SUM(sv.balance_cents), 0) AS invest_cents
         FROM generate_series(
                date_trunc('month', CURRENT_DATE) - make_interval(months => $2 - 1),
                date_trunc('month', CURRENT_DATE),
                interval '1 month'
              ) AS m
         LEFT JOIN investment_accounts ia ON ia.user_id = $1 AND ia.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT balance_cents FROM investment_snapshots s
           WHERE s.investment_account_id = ia.id AND s.date < (m + interval '1 month')
           ORDER BY s.date DESC LIMIT 1
         ) sv ON true
         GROUP BY m ORDER BY m`,
        [userId, params.months],
      );
      const investByMonth = new Map<string, number>(
        investTrend.map((r) => [r.ym as string, Number(r.invest_cents)]),
      );

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
        const cash = Number(r.net_worth_cents);
        const invest = investByMonth.get(label) ?? 0;
        return `${label}: ${signed(cash + invest)}`;
      });

      const assetLine =
        investments > 0
          ? `  Assets: ${dollars(assets)} (cash ${dollars(cashAssets)} + investments ${dollars(investments)})`
          : `  Assets: ${dollars(assets)}`;

      const text = [
        `Net worth: ${signed(netWorth)}`,
        assetLine,
        `  Liabilities: ${signed(liabilities)}`,
        '',
        `Month-end net worth (last ${recent.length} month${recent.length === 1 ? '' : 's'}, incl. investments):`,
        trendLines.length ? trendLines.join('\n') : '(not enough history)',
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
