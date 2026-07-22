import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query, getUserId } from '../db.js';

/** Holdings older than this trigger a dataCaveat on any fact derived from them
 * (12.2 spec). Mirrors DEFAULT_HOLDINGS_STALE_DAYS in the API's investments module. */
const HOLDINGS_STALE_DAYS = Number(process.env.HOLDINGS_STALE_DAYS) || 90;

interface HoldingRow {
  investment_account_id: string;
  nickname: string;
  ticker: string;
  share_count: string;
  as_of: string;
}

interface PriceRow {
  ticker: string;
  price_date: string;
  close_cents: number;
  source: string;
}

/**
 * Portfolio market value: shares × latest close per holding, summed. Both the
 * price date and the holdings as-of date are always surfaced next to each other —
 * never silently mixing a stale price with fresh holdings or vice versa.
 */
export function registerGetPortfolioValue(server: McpServer) {
  server.tool(
    'get_portfolio_value',
    'Total investment portfolio market value (shares x latest EOD close, per holding and account), with the price date and holdings as-of date both shown. Answers "what is my portfolio worth".',
    {},
    async () => {
      const userId = await getUserId();

      const holdings = await query<HoldingRow>(
        `SELECT DISTINCT ON (h.investment_account_id, h.ticker)
           h.investment_account_id, ia.nickname, h.ticker, h.share_count::text AS share_count,
           h.as_of::text AS as_of
         FROM investment_holdings h
         JOIN investment_accounts ia ON ia.id = h.investment_account_id
         WHERE ia.user_id = $1 AND ia.deleted_at IS NULL
         ORDER BY h.investment_account_id, h.ticker, h.as_of DESC, h.created_at DESC`,
        [userId],
      );

      if (holdings.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No investment holdings declared yet.' },
          ],
        };
      }

      const tickers = Array.from(new Set(holdings.map((h) => h.ticker)));
      const prices = await query<PriceRow>(
        `SELECT DISTINCT ON (ticker) ticker, price_date::text AS price_date,
                close_cents, source
         FROM security_prices
         WHERE ticker = ANY($1)
         ORDER BY ticker, price_date DESC`,
        [tickers],
      );
      const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));

      const now = Date.now();
      let totalCents = 0;
      let staleFound = false;
      let missingPriceFound = false;
      const lines: string[] = [];

      for (const h of holdings) {
        const price = priceByTicker.get(h.ticker);
        const isStale =
          now - new Date(h.as_of).getTime() > HOLDINGS_STALE_DAYS * 24 * 3600_000;
        if (isStale) staleFound = true;

        if (!price) {
          missingPriceFound = true;
          lines.push(
            `${h.ticker} (${h.nickname}): ${h.share_count} shares as of ${h.as_of} — no price data yet`,
          );
          continue;
        }
        const marketValueCents = Math.round(Number(h.share_count) * price.close_cents);
        totalCents += marketValueCents;
        lines.push(
          `${h.ticker} (${h.nickname}): ${h.share_count} shares as of ${h.as_of} x ` +
            `$${(price.close_cents / 100).toFixed(2)} close on ${price.price_date} (${price.source}) ` +
            `= $${(marketValueCents / 100).toFixed(2)}`,
        );
      }

      lines.push(`Total portfolio value: $${(totalCents / 100).toFixed(2)}`);

      if (staleFound) {
        lines.push(
          `dataCaveat: one or more holdings are older than ${HOLDINGS_STALE_DAYS} days ` +
            `(declared share counts may no longer reflect reality) — please refresh them.`,
        );
      }
      if (missingPriceFound) {
        lines.push(
          `dataCaveat: no price data yet for one or more held tickers — those holdings are excluded from the total above.`,
        );
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
