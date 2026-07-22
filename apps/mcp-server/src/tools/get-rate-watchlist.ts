import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query, getUserId } from '../db.js';

interface WatchlistRow {
  institution: string;
  product_type: string;
  apy_bps: string;
  term_months: string | null;
  notes: string | null;
  source: string;
  updated_at: string;
}

// Mirrors @moneypulse/shared DEFAULT_WATCHLIST_STALE_DAYS (12.3). See get-earned-apy.ts
// for why this is a literal rather than an import.
const DEFAULT_WATCHLIST_STALE_DAYS = 45;

/** User-maintained candidate parking spots (never scraped) plus Treasury-sourced rows
 *  auto-populated by the market-data refresh. Flags rows past the staleness window. */
export function registerGetRateWatchlist(server: McpServer) {
  server.tool(
    'get_rate_watchlist',
    'The user\'s rate watchlist — candidate parking spots (HYSA/CD/MMF/Treasury) with advertised APY, term, and source. Flags entries whose rate hasn\'t been confirmed recently (stale).',
    {},
    async () => {
      const userId = await getUserId();
      const staleDays = Number(process.env.WATCHLIST_STALE_DAYS) || DEFAULT_WATCHLIST_STALE_DAYS;

      const rows = await query<WatchlistRow>(
        `SELECT institution, product_type, apy_bps::text, term_months::text, notes, source, updated_at::text
         FROM rate_watchlist
         WHERE user_id = $1
         ORDER BY apy_bps DESC`,
        [userId],
      );

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No rate-watchlist entries yet.' }],
        };
      }

      const lines = rows.map((r) => {
        const ageDays = Math.floor(
          (Date.now() - new Date(r.updated_at).getTime()) / (24 * 3600_000),
        );
        const stale = ageDays >= staleDays;
        const apyPercent = (Number(r.apy_bps) / 100).toFixed(2);
        const term = r.term_months ? `${r.term_months}mo term` : 'no fixed term';
        return (
          `${r.institution} — ${r.product_type} @ ${apyPercent}% APY, ${term} ` +
          `(source: ${r.source}, updated ${ageDays}d ago${stale ? ' — STALE, confirm rate before relying on it' : ''})`
        );
      });

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
