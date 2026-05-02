import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query } from '../db.js';

export function registerGetAccountBalances(server: McpServer) {
  server.tool(
    'get_account_balances',
    'Get current balance for all bank and credit card accounts.',
    {},
    async () => {
      const rows = await query(
        `SELECT
           a.nickname,
           a.institution,
           a.account_type,
           a.starting_balance_cents,
           a.credit_limit_cents,
           a.starting_balance_cents + COALESCE(SUM(
             CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
           ), 0) AS balance_cents
         FROM accounts a
         LEFT JOIN transactions t
           ON a.id = t.account_id
           AND t.is_split_parent = false
           AND t.deleted_at IS NULL
         WHERE a.deleted_at IS NULL
         GROUP BY a.id, a.nickname, a.institution, a.account_type,
                  a.starting_balance_cents, a.credit_limit_cents
         ORDER BY a.nickname`,
      );

      const lines = rows.map((r) => {
        const balance = Number(r.balance_cents);
        const line = `${r.nickname} (${r.institution}, ${r.account_type}): $${(balance / 100).toFixed(2)}`;
        if (r.credit_limit_cents) {
          const limit = Number(r.credit_limit_cents);
          const util =
            limit > 0 ? ((Math.abs(balance) / limit) * 100).toFixed(0) : '0';
          return `${line} (limit: $${(limit / 100).toFixed(2)}, ${util}% used)`;
        }
        return line;
      });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') || 'No accounts.' }],
      };
    },
  );
}
