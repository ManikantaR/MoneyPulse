import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query, getUserId } from '../db.js';

export function registerGetYoyComparison(server: McpServer) {
  server.tool(
    'get_yoy_comparison',
    'Compares this calendar month to the same month one year ago, per category. Gracefully reports "only N months of history" instead of erroring when fewer than 12 months of data exist. Answers "how does this month compare to last year".',
    {},
    async () => {
      const userId = await getUserId();

      const [{ min_date: minDate } = { min_date: null }] = await query(
        `SELECT MIN(t.date)::text AS min_date
         FROM transactions t
         WHERE t.is_split_parent = false AND t.deleted_at IS NULL AND t.user_id = $1`,
        [userId],
      );

      const monthsOfHistory = minDate
        ? Math.floor((Date.now() - new Date(minDate as string).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
        : 0;

      if (!minDate || monthsOfHistory < 12) {
        return {
          content: [{
            type: 'text' as const,
            text: `Only ${monthsOfHistory} month${monthsOfHistory === 1 ? '' : 's'} of transaction history available; year-over-year comparison needs 12 months.`,
          }],
        };
      }

      const rows = await query(
        `SELECT
           COALESCE(c.name, 'Uncategorized') AS category,
           SUM(CASE WHEN date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE) THEN t.amount_cents ELSE 0 END) AS this_month_cents,
           SUM(CASE WHEN date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE) - INTERVAL '1 year' THEN t.amount_cents ELSE 0 END) AS last_year_cents
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND t.is_credit = false
           AND COALESCE(c.is_transfer, false) = false
           AND t.user_id = $1
           AND (
             date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE)
             OR date_trunc('month', t.date) = date_trunc('month', CURRENT_DATE) - INTERVAL '1 year'
           )
         GROUP BY c.name
         HAVING SUM(t.amount_cents) > 0
         ORDER BY this_month_cents DESC`,
        [userId],
      );

      const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`;
      let totalThis = 0;
      let totalLast = 0;
      const lines = rows.map((r) => {
        const thisMonth = Number(r.this_month_cents);
        const lastYear = Number(r.last_year_cents);
        totalThis += thisMonth;
        totalLast += lastYear;
        const diff = thisMonth - lastYear;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        return `${r.category}: ${dollars(thisMonth)} vs ${dollars(lastYear)} last year (${arrow} ${dollars(diff)})`;
      });
      const totalDiff = totalThis - totalLast;
      const arrow = totalDiff > 0 ? '↑' : totalDiff < 0 ? '↓' : '→';

      const text = [
        `This month vs same month last year, by category:`,
        lines.length ? lines.join('\n') : '(no spend in either period)',
        '',
        `TOTAL: ${dollars(totalThis)} vs ${dollars(totalLast)} last year (${arrow} ${dollars(totalDiff)})`,
      ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
