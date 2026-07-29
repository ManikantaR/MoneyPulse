import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';

/** Advance a date by one billing cycle, month-end aware. Mirrors ForecastService's addFrequency. */
function addFrequency(date: Date, frequency: BillFrequency): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly': {
      const originalDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, maxDay));
      break;
    }
    case 'quarterly': {
      const originalDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 3);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, maxDay));
      break;
    }
    case 'semi_annual': {
      const originalDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 6);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(originalDay, maxDay));
      break;
    }
    case 'annual':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Parse a date-only `YYYY-MM-DD` (or ISO timestamp) string as a *local* calendar date. */
function parseDateOnly(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * #40.1 — safe-to-spend across 30/60/90d horizons: the lowest projected combined
 * liquid balance within the window (already net of every recurring bill
 * occurrence, fast-forwarded across the horizon), minus any amount the user
 * wants reserved for savings goals. Aggregates-only: no row-level transactions
 * or account identifiers are exposed, matching epic #36's provenance rules.
 *
 * There is no dedicated `goals` table yet, so goal reservations are taken as a
 * caller-supplied total (`goalContributionsCents`) rather than looked up —
 * per #40's "minimal goal-amount input" fallback until a goals feature exists.
 */
export function registerGetSafeToSpend(server: McpServer) {
  server.tool(
    'get_safe_to_spend',
    'Safe-to-spend = minimum projected combined checking/savings balance over a 30/60/90-day horizon (already net of every recurring bill due in that window), minus any amount reserved for savings goals. Answers "how much can I safely spend" / "what\'s my safe-to-spend for the next 60 days".',
    {
      horizonDays: z
        .union([z.literal(30), z.literal(60), z.literal(90)])
        .default(30)
        .describe('Forecast horizon in days: 30, 60, or 90'),
      goalContributionsCents: z
        .number()
        .min(0)
        .default(0)
        .describe(
          'Total amount (in cents) already earmarked toward savings goals over the horizon; subtracted from the safe-to-spend figure',
        ),
    },
    async (params) => {
      const userId = await getUserId();
      const { horizonDays, goalContributionsCents } = params;
      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

      // 1) Current combined liquid balance (checking + savings).
      const balRows = await query(
        `SELECT COALESCE(SUM(a.starting_balance_cents + COALESCE(tx.net, 0)), 0) AS liquid_cents
         FROM accounts a
         LEFT JOIN (
           SELECT account_id,
                  SUM(CASE WHEN is_credit THEN amount_cents ELSE -amount_cents END) AS net
           FROM transactions
           WHERE deleted_at IS NULL AND is_split_parent = false
           GROUP BY account_id
         ) tx ON tx.account_id = a.id
         WHERE a.user_id = $1 AND a.deleted_at IS NULL
           AND a.account_type IN ('checking', 'savings')`,
        [userId],
      );
      const startCents = Number(balRows[0]?.liquid_cents ?? 0);

      // 2) Active + confirmed recurring bills, fast-forwarded across the horizon
      //    (a bill can occur more than once within a 90-day window).
      const billRows = await query(
        `SELECT expected_amount_cents, frequency, next_expected_date
         FROM recurring_bills
         WHERE user_id = $1 AND is_active = true AND is_confirmed = true
           AND next_expected_date IS NOT NULL`,
        [userId],
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + horizonDays);

      const billDeductions = new Map<string, number>();
      let billTotalCents = 0;
      for (const bill of billRows as Array<{
        expected_amount_cents: string;
        frequency: BillFrequency;
        next_expected_date: string;
      }>) {
        const amount = Number(bill.expected_amount_cents);
        let next = parseDateOnly(bill.next_expected_date);
        next.setHours(0, 0, 0, 0);
        while (next < today) {
          next = addFrequency(next, bill.frequency);
        }
        while (next <= horizon) {
          const key = toDateStr(next);
          billDeductions.set(key, (billDeductions.get(key) ?? 0) + amount);
          billTotalCents += amount;
          next = addFrequency(next, bill.frequency);
        }
      }

      // 3) Average daily net cash flow over the trailing 90 days (excl. transfers)
      //    as a proxy for scheduled inflows/ordinary spending.
      const netRows = await query(
        `SELECT COALESCE(SUM(CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END), 0) AS net_90d
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.is_split_parent = false
           AND COALESCE(c.is_transfer, false) = false
           AND t.date >= CURRENT_DATE - interval '90 days'`,
        [userId],
      );
      const avgDailyNet = Number(netRows[0]?.net_90d ?? 0) / 90;

      // 4) Day-by-day projection; track the minimum (the "floor" over the horizon).
      // A bill due exactly today must hit the floor immediately — the loop below
      // only walks d=1..horizonDays, so without this a same-day bill would be
      // counted in billTotalCents but never actually subtracted from the floor.
      let balance = startCents - (billDeductions.get(toDateStr(today)) ?? 0);
      balance = Math.round(balance);
      let minCents = balance;
      let minDate = toDateStr(today);
      for (let d = 1; d <= horizonDays; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        const dateStr = toDateStr(date);
        const billHit = billDeductions.get(dateStr) ?? 0;
        balance = Math.round(balance + avgDailyNet - billHit);
        if (balance < minCents) {
          minCents = balance;
          minDate = dateStr;
        }
      }

      const safeToSpendCents = Math.max(0, minCents - goalContributionsCents);

      const lines = [
        `Current liquid balance (checking/savings): ${dollars(startCents)}`,
        `Bills due in next ${horizonDays}d: ${dollars(billTotalCents)}`,
        `Minimum projected balance over ${horizonDays}d: ${dollars(minCents)} (around ${minDate})`,
        `Reserved for savings goals: ${dollars(goalContributionsCents)}`,
        `Safe to spend (${horizonDays}d horizon): ${dollars(safeToSpendCents)}`,
      ];
      if (minCents < 0) {
        lines.push(
          `⚠ Projected balance dips below $0 around ${minDate} even before goal reservations — this is a shortfall, not a safe-to-spend amount.`,
        );
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
