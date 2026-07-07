import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetBudgetHistory(server: McpServer) {
  server.tool(
    'get_budget_history',
    'Per-category monthly budget vs actual spend over the last N months. Answers "am I over/under budget, and how were the last few months".',
    {
      months: z.number().min(1).max(12).default(3).describe('How many recent months'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT c.name AS category,
                b.amount_cents AS budget_cents,
                to_char(date_trunc('month', t.date), 'YYYY-MM') AS ym,
                COALESCE(SUM(t.amount_cents), 0) AS spent_cents
         FROM budgets b
         JOIN categories c ON b.category_id = c.id
         LEFT JOIN transactions t
           ON t.category_id = b.category_id AND t.user_id = b.user_id
           AND t.is_credit = false AND t.is_split_parent = false AND t.deleted_at IS NULL
           AND t.date >= date_trunc('month', CURRENT_DATE) - make_interval(months => $2 - 1)
         WHERE b.user_id = $1 AND b.deleted_at IS NULL AND b.period = 'monthly'
         GROUP BY c.name, b.amount_cents, ym
         ORDER BY c.name, ym`,
        [userId, params.months],
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No monthly budgets configured.' }] };
      }

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      // Group rows by category.
      const byCat = new Map<string, { budget: number; months: { ym: string; spent: number }[] }>();
      for (const r of rows) {
        const cat = r.category as string;
        if (!byCat.has(cat)) byCat.set(cat, { budget: Number(r.budget_cents), months: [] });
        if (r.ym) byCat.get(cat)!.months.push({ ym: r.ym, spent: Number(r.spent_cents) });
      }

      const blocks = [...byCat.entries()].map(([cat, { budget, months }]) => {
        const monthLines = months.map((m) => {
          const pct = budget > 0 ? Math.round((m.spent / budget) * 100) : 0;
          const flag = m.spent > budget ? ' ⚠ over' : '';
          return `  ${m.ym}: ${dollars(m.spent)} of ${dollars(budget)} (${pct}%)${flag}`;
        });
        return `${cat} — budget ${dollars(budget)}/mo:\n${monthLines.join('\n')}`;
      });

      return { content: [{ type: 'text' as const, text: blocks.join('\n\n') }] };
    },
  );
}
