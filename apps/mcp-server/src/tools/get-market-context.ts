import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query } from '../db.js';

interface MetricRow {
  metric_key: string;
  region: string;
  unit: string;
  period_date: string;
  value: string;
  fetched_at: string;
}

/** market_metrics is global (not user-scoped) — public EIA/FRED data, safe for the
 * cloud advisor per the aggregates-only rule (11.6 spec / epic #36). */
export function registerGetMarketContext(server: McpServer) {
  server.tool(
    'get_market_context',
    'Latest public market data (gas prices, electricity rates, mortgage rate, CPI, fed funds rate) with 4-week and 12-month deltas. Answers "how do rates/prices compare to recent history".',
    {
      metricKey: z
        .string()
        .optional()
        .describe(
          'One of: gas_retail_regular, electricity_residential, mortgage_30y, cpi_all_urban, fed_funds_rate. Omit for all series.',
        ),
    },
    async (params) => {
      const rows = await query<MetricRow>(
        `SELECT metric_key, region, unit, period_date::text, value::text, fetched_at::text
         FROM market_metrics
         ${params.metricKey ? 'WHERE metric_key = $1' : ''}
         ORDER BY metric_key, region, period_date DESC`,
        params.metricKey ? [params.metricKey] : [],
      );

      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No market data available yet (EIA/FRED keys may not be configured, or the daily refresh has not run).',
            },
          ],
        };
      }

      // Group by (metric_key, region); rows are already DESC by period_date within each group.
      const groups = new Map<string, MetricRow[]>();
      for (const r of rows) {
        const k = `${r.metric_key}::${r.region}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }

      const lines: string[] = [];
      for (const series of groups.values()) {
        const latest = series[0];
        const latestDate = new Date(latest.period_date);
        const latestValue = Number(latest.value);

        const wk4 = series.find(
          (r) => latestDate.getTime() - new Date(r.period_date).getTime() >= 26 * 24 * 3600_000,
        );
        const mo12 = series.find(
          (r) => latestDate.getTime() - new Date(r.period_date).getTime() >= 350 * 24 * 3600_000,
        );

        const fmtDelta = (from?: MetricRow) =>
          from ? `${(latestValue - Number(from.value)) >= 0 ? '+' : ''}${(latestValue - Number(from.value)).toFixed(2)}` : 'n/a';

        lines.push(
          `${latest.metric_key} (${latest.region}): ${latestValue} ${latest.unit} as of ${latest.period_date} ` +
            `[4wk: ${fmtDelta(wk4)}, 12mo: ${fmtDelta(mo12)}] (fetched ${latest.fetched_at})`,
        );
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
