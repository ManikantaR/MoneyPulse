import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

/**
 * 13.7 — the ratio/target/trend rollup across recent monthly closes. Aggregate-only:
 * ratio percentages, target statuses and net-worth/savings-rate trend lines, never
 * row-level transactions or account identifiers.
 */
export function registerGetFinancialHealth(server: McpServer) {
  server.tool(
    'get_financial_health',
    'Trend of savings/investing/debt-paydown/wealth-building rates, expense ratio, and target status across recent monthly closes. Answers "how is my financial health trending" and "am I hitting my targets".',
    {
      months: z
        .number()
        .min(1)
        .max(24)
        .default(6)
        .describe('How many trailing closed months to include'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT * FROM monthly_financial_snapshots
         WHERE monthly_financial_snapshots.user_id = $1
         ORDER BY snapshot_month DESC
         LIMIT $2`,
        [userId, params.months],
      );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No monthly closes available yet.' }] };
      }

      const pct = (bps: number | null) => (bps === null || bps === undefined ? 'n/a' : `${(Number(bps) / 100).toFixed(1)}%`);
      const dollars = (c: number) => `$${(Number(c) / 100).toFixed(2)}`;

      const ordered = [...rows].reverse(); // oldest → newest
      const lines = ordered.map((r: any) => {
        const month = new Date(r.snapshot_month).toISOString().slice(0, 7);
        const freshness = r.freshness ?? {};
        const caveat = freshness.isComplete ? '' : ' [incomplete]';
        return `${month}${caveat}: savings ${pct(r.savings_rate_bps)}, investing ${pct(r.investing_rate_bps)}, debt-paydown ${pct(r.debt_paydown_rate_bps)}, wealth-building ${pct(r.wealth_building_rate_bps)}, expense-ratio ${pct(r.expense_ratio_bps)}, net worth ${dollars(r.net_worth_cents)}`;
      });

      const latest = rows[0] as any;
      const latestTargets = latest.target_status ?? {};
      const incompleteCount = rows.filter((r: any) => !(r.freshness ?? {}).isComplete).length;

      const text = [
        `Financial health — trailing ${rows.length} month(s):`,
        lines.join('\n'),
        '',
        `Latest (${new Date(latest.snapshot_month).toISOString().slice(0, 7)}) target status: ${JSON.stringify(latestTargets)}`,
        incompleteCount > 0
          ? `Note: ${incompleteCount} of ${rows.length} month(s) in this window are flagged incomplete (missing/stale data) — treat their ratios as provisional.`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
