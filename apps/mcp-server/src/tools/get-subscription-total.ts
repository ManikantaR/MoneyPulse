import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

export function registerGetSubscriptionTotal(server: McpServer) {
  server.tool(
    'get_subscription_total',
    'Monthly recurring subscription/bill total (normalized to a monthly-equivalent) plus a 12-month spend trend. Answers "how much do I spend on subscriptions" and "is my subscription spend growing".',
    {},
    async () => {
      const userId = await getUserId();
      const bills = await query(
        `SELECT normalized_name, expected_amount_cents, frequency
         FROM recurring_bills
         WHERE user_id = $1 AND is_active = true`,
        [userId],
      );

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const monthlyTotalCents = Math.round(
        bills.reduce((sum, b) => {
          const mult = MONTHLY[String(b.frequency ?? 'monthly')] ?? 1;
          return sum + Number(b.expected_amount_cents) * mult;
        }, 0),
      );

      if (bills.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No active subscriptions tracked.' }] };
      }

      const names = bills.map((b) => b.normalized_name as string);
      const trendRows = await query(
        `SELECT to_char(date_trunc('month', t.date), 'YYYY-MM') AS month, SUM(t.amount_cents) AS total_cents
         FROM transactions t
         WHERE t.user_id = $1
           AND t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND t.is_credit = false
           AND t.normalized_merchant_name = ANY($2)
           AND t.date >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
         GROUP BY date_trunc('month', t.date)
         ORDER BY month ASC`,
        [userId, names],
      );

      const trendLines = trendRows.map((r) => `${r.month}: ${dollars(Number(r.total_cents))}`);
      const text = [
        `Monthly subscription total: ~${dollars(monthlyTotalCents)}/month across ${bills.length} active subscription${bills.length === 1 ? '' : 's'}.`,
        '',
        trendLines.length ? '12-month trend:' : '',
        trendLines.join('\n'),
      ].filter(Boolean).join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
