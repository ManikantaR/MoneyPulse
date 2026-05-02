import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

export function registerComparePeriods(server: McpServer) {
  server.tool(
    'compare_periods',
    'Compare spending between two date ranges. Shows per-category and total differences.',
    {
      period1_from: z.string().describe('First period start date (YYYY-MM-DD)'),
      period1_to: z.string().describe('First period end date (YYYY-MM-DD)'),
      period2_from: z.string().describe('Second period start date (YYYY-MM-DD)'),
      period2_to: z.string().describe('Second period end date (YYYY-MM-DD)'),
    },
    async (params) => {
      const getSummary = async (from: string, to: string) =>
        query(
          `SELECT
             COALESCE(c.name, 'Uncategorized') AS category,
             SUM(t.amount_cents) AS total_cents
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           WHERE t.is_split_parent = false
             AND t.deleted_at IS NULL
             AND t.is_credit = false
             AND t.date >= $1 AND t.date <= $2
           GROUP BY c.name`,
          [from, to],
        );

      const [p1, p2] = await Promise.all([
        getSummary(params.period1_from, params.period1_to),
        getSummary(params.period2_from, params.period2_to),
      ]);

      const p1Map = new Map(p1.map((r) => [r.category, Number(r.total_cents)]));
      const p2Map = new Map(p2.map((r) => [r.category, Number(r.total_cents)]));
      const allCategories = new Set([...p1Map.keys(), ...p2Map.keys()]);

      let totalP1 = 0;
      let totalP2 = 0;
      const lines: string[] = [
        `Period 1: ${params.period1_from} to ${params.period1_to}`,
        `Period 2: ${params.period2_from} to ${params.period2_to}`,
        '',
        'Category | Period 1 | Period 2 | Change',
        '---------|----------|----------|-------',
      ];

      for (const cat of [...allCategories].sort()) {
        const v1 = p1Map.get(cat) ?? 0;
        const v2 = p2Map.get(cat) ?? 0;
        totalP1 += v1;
        totalP2 += v2;
        const diff = v2 - v1;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        lines.push(
          `${cat} | $${(v1 / 100).toFixed(2)} | $${(v2 / 100).toFixed(2)} | ${arrow} $${(Math.abs(diff) / 100).toFixed(2)}`,
        );
      }

      const totalDiff = totalP2 - totalP1;
      const arrow = totalDiff > 0 ? '↑' : totalDiff < 0 ? '↓' : '→';
      lines.push(
        `\nTOTAL | $${(totalP1 / 100).toFixed(2)} | $${(totalP2 / 100).toFixed(2)} | ${arrow} $${(Math.abs(totalDiff) / 100).toFixed(2)}`,
      );

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
