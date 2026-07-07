import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

/** Rough monthly-equivalent multiplier by frequency. */
const MONTHLY: Record<string, number> = {
  weekly: 4.345,
  biweekly: 2.173,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
  annual: 1 / 12,
};

export function registerGetSubscriptions(server: McpServer) {
  server.tool(
    'get_subscriptions',
    'Active recurring subscriptions/bills with their amount, cadence, and any price change vs the usual amount. Answers "what am I subscribed to" and "did any subscription change price".',
    {},
    async () => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT normalized_name, expected_amount_cents, last_amount_cents,
                amount_tolerance_percent, frequency
         FROM recurring_bills
         WHERE user_id = $1 AND is_active = true
         ORDER BY expected_amount_cents DESC`,
        [userId],
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active subscriptions tracked.' }] };
      }

      const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
      let monthlyTotal = 0;
      const lines = rows.map((r) => {
        const expected = Number(r.expected_amount_cents);
        const freq = String(r.frequency || 'monthly');
        monthlyTotal += expected * (MONTHLY[freq] ?? 1);

        let change = '';
        const last = r.last_amount_cents == null ? null : Number(r.last_amount_cents);
        const tol = Number(r.amount_tolerance_percent ?? 0);
        if (last != null && Math.abs(last - expected) > (expected * tol) / 100) {
          const diff = last - expected;
          change = ` — ${diff > 0 ? 'up' : 'down'} ${dollars(diff)} (last charge ${dollars(last)})`;
        }
        return `${r.normalized_name} (${freq}): ${dollars(expected)}${change}`;
      });

      const text = [
        lines.join('\n'),
        '',
        `~${dollars(Math.round(monthlyTotal))}/month across ${rows.length} subscription${rows.length === 1 ? '' : 's'}.`,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
