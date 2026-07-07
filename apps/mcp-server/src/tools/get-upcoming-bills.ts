import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetUpcomingBills(server: McpServer) {
  server.tool(
    'get_upcoming_bills',
    'Recurring bills due within the next N days. Answers "what bills are coming up" / "what\'s due soon".',
    {
      days: z.number().min(1).max(90).default(14).describe('Look-ahead window in days'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT normalized_name, expected_amount_cents, next_expected_date, frequency
         FROM recurring_bills
         WHERE user_id = $2
           AND is_active = true
           AND next_expected_date IS NOT NULL
           AND next_expected_date >= NOW()
           AND next_expected_date < NOW() + make_interval(days => $1)
         ORDER BY next_expected_date ASC`,
        [params.days, userId],
      );

      if (rows.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: `No bills due in the next ${params.days} days.` },
          ],
        };
      }

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const total = rows.reduce((s, r) => s + Number(r.expected_amount_cents), 0);
      const lines = rows.map((r) => {
        const due = new Date(r.next_expected_date).toISOString().slice(0, 10);
        return `${r.normalized_name} (${r.frequency}): ${dollars(Number(r.expected_amount_cents))} due ${due}`;
      });

      const text = [
        lines.join('\n'),
        '',
        `Total due in next ${params.days} days: ${dollars(total)}`,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
