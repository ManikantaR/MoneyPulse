import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query, getUserId } from '../db.js';

const HOLDINGS_STALE_DAYS = Number(process.env.HOLDINGS_STALE_DAYS) || 90;

interface HoldingRow {
  ticker: string;
  share_count: string;
  as_of: string;
}

interface PriceRow {
  ticker: string;
  price_date: string;
  close_cents: number;
}

interface SuitabilitySettingsRow {
  version: number;
  target_allocation: Array<{ assetClass: string; targetPercent: number }> | null;
  ticker_asset_class_map: Record<string, string> | null;
}

/**
 * Portfolio allocation: percent of total market value by ticker, plus (12.4) percent
 * by asset class vs the user's target allocation with drift, when suitability
 * settings with a target allocation have been saved. If no target allocation is on
 * file, the tool still returns ticker-level actuals and says so explicitly rather
 * than fabricating a comparison (fail-closed, per the Phase 12 suitability gate).
 */
export function registerGetAllocation(server: McpServer) {
  server.tool(
    'get_allocation',
    'Portfolio allocation: percent of total market value held in each ticker. Answers "how diversified am I" and "what percent of my portfolio is X".',
    {},
    async () => {
      const userId = await getUserId();

      const holdings = await query<HoldingRow>(
        `SELECT DISTINCT ON (h.investment_account_id, h.ticker)
           h.ticker, h.share_count::text AS share_count, h.as_of::text AS as_of
         FROM investment_holdings h
         JOIN investment_accounts ia ON ia.id = h.investment_account_id
         WHERE ia.user_id = $1 AND ia.deleted_at IS NULL
         ORDER BY h.investment_account_id, h.ticker, h.as_of DESC, h.created_at DESC`,
        [userId],
      );

      if (holdings.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No investment holdings declared yet.' }],
        };
      }

      const tickers = Array.from(new Set(holdings.map((h) => h.ticker)));
      const prices = await query<PriceRow>(
        `SELECT DISTINCT ON (ticker) ticker, price_date::text AS price_date, close_cents
         FROM security_prices
         WHERE ticker = ANY($1)
         ORDER BY ticker, price_date DESC`,
        [tickers],
      );
      const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));

      // Sum market value per ticker (a ticker can appear across multiple accounts).
      const valueByTicker = new Map<string, number>();
      let staleFound = false;
      let missingPriceFound = false;
      const now = Date.now();

      for (const h of holdings) {
        if (now - new Date(h.as_of).getTime() > HOLDINGS_STALE_DAYS * 24 * 3600_000) {
          staleFound = true;
        }
        const price = priceByTicker.get(h.ticker);
        if (!price) {
          missingPriceFound = true;
          continue;
        }
        const value = Number(h.share_count) * price.close_cents;
        valueByTicker.set(h.ticker, (valueByTicker.get(h.ticker) ?? 0) + value);
      }

      const totalCents = Array.from(valueByTicker.values()).reduce((a, b) => a + b, 0);
      if (totalCents === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No priced holdings yet — cannot compute allocation.',
            },
          ],
        };
      }

      const lines: string[] = [];
      const sorted = Array.from(valueByTicker.entries()).sort((a, b) => b[1] - a[1]);
      for (const [ticker, valueCents] of sorted) {
        const pct = (valueCents / totalCents) * 100;
        lines.push(`${ticker}: ${pct.toFixed(2)}% ($${(valueCents / 100).toFixed(2)})`);
      }
      // 12.4: compare against the user's target allocation (latest saved version), if any.
      const [policy] = await query<SuitabilitySettingsRow>(
        `SELECT version, target_allocation, ticker_asset_class_map
         FROM suitability_settings
         WHERE user_id = $1
         ORDER BY version DESC
         LIMIT 1`,
        [userId],
      );

      const targets = policy?.target_allocation ?? [];
      if (!policy || targets.length === 0) {
        lines.push(
          '(No target allocation on file — save one in Settings to see target-vs-actual drift. ' +
            'Refusing to guess a target rather than fabricating a comparison.)',
        );
      } else {
        const tickerToClass = policy.ticker_asset_class_map ?? {};
        const valueByClass = new Map<string, number>();
        let unmappedCents = 0;
        for (const [ticker, valueCents] of valueByTicker.entries()) {
          const assetClass = tickerToClass[ticker];
          if (!assetClass) {
            unmappedCents += valueCents;
            continue;
          }
          valueByClass.set(assetClass, (valueByClass.get(assetClass) ?? 0) + valueCents);
        }

        lines.push('', `Target allocation (policy version ${policy.version}):`);
        for (const { assetClass, targetPercent } of targets) {
          const actualCents = valueByClass.get(assetClass) ?? 0;
          const actualPercent = (actualCents / totalCents) * 100;
          const driftPct = actualPercent - targetPercent;
          const sign = driftPct >= 0 ? '+' : '';
          lines.push(
            `${assetClass}: target ${targetPercent.toFixed(1)}%, actual ${actualPercent.toFixed(
              1,
            )}% (drift ${sign}${driftPct.toFixed(1)}pp)`,
          );
        }
        if (unmappedCents > 0) {
          const unmappedPct = (unmappedCents / totalCents) * 100;
          lines.push(
            `dataCaveat: ${unmappedPct.toFixed(1)}% of holdings have no ticker→asset-class mapping in suitability settings and are excluded from the target comparison.`,
          );
        }
      }

      if (staleFound) {
        lines.push(
          `dataCaveat: one or more holdings are older than ${HOLDINGS_STALE_DAYS} days — allocation may not reflect current reality.`,
        );
      }
      if (missingPriceFound) {
        lines.push(
          `dataCaveat: no price data yet for one or more held tickers — those holdings are excluded from this breakdown.`,
        );
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
