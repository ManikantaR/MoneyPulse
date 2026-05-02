import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query } from '../db.js';

export function registerGetBudgetStatus(server: McpServer) {
  server.tool(
    'get_budget_status',
    'Get current budget status: budget amount, spent so far, and percentage used for each category.',
    {},
    async () => {
      const rows = await query(
        `SELECT
           c.name AS category,
           b.amount_cents AS budget_cents,
           b.period,
           COALESCE(spent.total, 0) AS spent_cents
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT SUM(t.amount_cents) AS total
           FROM transactions t
           WHERE t.category_id = b.category_id
             AND t.is_credit = false
             AND t.is_split_parent = false
             AND t.deleted_at IS NULL
             AND t.date >= CASE
               WHEN b.period = 'monthly' THEN date_trunc('month', CURRENT_DATE)
               WHEN b.period = 'weekly' THEN date_trunc('week', CURRENT_DATE)
               ELSE date_trunc('month', CURRENT_DATE)
             END
         ) spent ON true
         WHERE b.deleted_at IS NULL
         ORDER BY c.name`,
      );

      const lines = rows.map((r) => {
        const budget = Number(r.budget_cents);
        const spent = Number(r.spent_cents);
        const pct = budget > 0 ? ((spent / budget) * 100).toFixed(0) : '0';
        const status =
          spent > budget
            ? '🔴 OVER'
            : spent > budget * 0.8
              ? '🟡 WARNING'
              : '🟢 OK';
        return `${status} ${r.category}: $${(spent / 100).toFixed(2)} / $${(budget / 100).toFixed(2)} (${pct}%) [${r.period}]`;
      });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') || 'No budgets configured.' }],
      };
    },
  );
}
