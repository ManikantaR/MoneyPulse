import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

// Mirrors @moneypulse/shared INTEREST_CREDIT_PATTERNS (12.3) — kept as a literal here
// so the MCP server (a separate deploy artifact, per the #104 pattern) doesn't need a
// workspace-package build step at runtime.
const INTEREST_PATTERNS = ['INTEREST PAID', 'INTEREST PAYMENT', 'DIVIDEND'];

interface InterestTxnRow {
  date: string;
  amount_cents: string;
  description: string;
}

interface AccountRow {
  id: string;
  nickname: string;
  account_type: string;
}

/**
 * Effective APY a user is actually earning per checking/savings account: trailing
 * 12-month interest-credit total ÷ average balance over the same window (reusing
 * account_balance_snapshots — the 11.x balance-snapshot service's own storage — rather
 * than reinventing average-balance math).
 */
export function registerGetEarnedApy(server: McpServer) {
  server.tool(
    'get_earned_apy',
    'Effective APY actually earned on each checking/savings account: trailing 12-month interest/dividend credits divided by average balance over that window. Cites every interest transaction and the balance snapshots used.',
    {
      accountId: z.string().uuid().optional().describe('Limit to one account. Omit for all checking/savings accounts.'),
    },
    async (params) => {
      const userId = await getUserId();

      const accounts = await query<AccountRow>(
        `SELECT id, nickname, account_type FROM accounts
         WHERE user_id = $1 AND deleted_at IS NULL AND account_type IN ('checking', 'savings')
           ${params.accountId ? 'AND id = $2' : ''}`,
        params.accountId ? [userId, params.accountId] : [userId],
      );

      if (accounts.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No checking/savings accounts found.' }],
        };
      }

      const likeClauses = INTEREST_PATTERNS.map((_, i) => `t.description ILIKE $${i + 3}`).join(
        ' OR ',
      );
      const likeParams = INTEREST_PATTERNS.map((p) => `%${p}%`);

      const lines: string[] = [];
      for (const acct of accounts) {
        const interestRows = await query<InterestTxnRow>(
          `SELECT t.date::text, t.amount_cents::text, t.description
           FROM transactions t
           WHERE t.account_id = $1
             AND t.user_id = $2
             AND t.deleted_at IS NULL
             AND t.is_split_parent = false
             AND t.is_credit = true
             AND t.date >= CURRENT_DATE - INTERVAL '12 months'
             AND (${likeClauses})
           ORDER BY t.date ASC`,
          [acct.id, userId, ...likeParams],
        );
        const interestCents = interestRows.reduce((sum, r) => sum + Number(r.amount_cents), 0);

        const snapshotRows = await query<{ snapshot_date: string; balance_cents: string }>(
          `SELECT snapshot_date::text, balance_cents::text
           FROM account_balance_snapshots
           WHERE account_id = $1 AND snapshot_date >= CURRENT_DATE - INTERVAL '12 months'
           ORDER BY snapshot_date ASC`,
          [acct.id],
        );

        const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

        if (snapshotRows.length === 0) {
          lines.push(
            `${acct.nickname}: no balance-snapshot history in the trailing 12 months — cannot compute an average-balance basis. ` +
              `Interest credits found: ${interestRows.length} totaling ${dollars(interestCents)}.`,
          );
          continue;
        }

        const avgBalanceCents =
          snapshotRows.reduce((sum, r) => sum + Number(r.balance_cents), 0) / snapshotRows.length;

        if (avgBalanceCents <= 0) {
          lines.push(`${acct.nickname}: average balance was zero or negative — cannot compute an APY.`);
          continue;
        }

        const apyPercent = (interestCents / avgBalanceCents) * 100;

        const citations = interestRows
          .map((r) => `${r.date}: ${dollars(Number(r.amount_cents))} (${r.description})`)
          .join('; ');
        const snapshotBasis = `${snapshotRows.length} snapshots from ${snapshotRows[0].snapshot_date} to ${snapshotRows[snapshotRows.length - 1].snapshot_date}, avg balance ${dollars(avgBalanceCents)}`;

        lines.push(
          `${acct.nickname} (${acct.account_type}): earned APY ~${apyPercent.toFixed(2)}% ` +
            `[trailing 12mo interest: ${dollars(interestCents)}; balance basis: ${snapshotBasis}]` +
            (interestRows.length > 0 ? `\n  Interest transactions used: ${citations}` : '\n  No interest transactions found in the trailing 12 months.'),
        );
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] };
    },
  );
}
