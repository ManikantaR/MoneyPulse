import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

/**
 * 13.7 — aggregate monthly-close summary. Reads only the frozen aggregate columns on
 * `monthly_financial_snapshots` (income/expense/savings/net-worth totals + ratio bps +
 * target status + freshness flags) — never raw transactions, merchant names, or
 * account numbers. Safe for the aggregates-only cloud advisor allowlist.
 */
export function registerGetMonthlyClose(server: McpServer) {
  server.tool(
    'get_monthly_close',
    'Aggregate monthly-close summary for a given month (or the most recent close if omitted): income, expenses, savings/investment/debt-paydown amounts, assets/liabilities/net worth, ratio percentages, target status, and freshness (whether the close is complete). Answers "what did my close for month X look like".',
    {
      month: z
        .string()
        .regex(/^\d{4}-\d{2}(-\d{2})?$/)
        .optional()
        .describe('Month as YYYY-MM (or YYYY-MM-DD). Defaults to the most recent close.'),
    },
    async (params) => {
      const userId = await getUserId();
      const dollars = (c: number) => `$${(Number(c) / 100).toFixed(2)}`;
      const pct = (bps: number | null) => (bps === null || bps === undefined ? 'n/a' : `${(Number(bps) / 100).toFixed(1)}%`);

      const rows = params.month
        ? await query(
            `SELECT * FROM monthly_financial_snapshots
             WHERE monthly_financial_snapshots.user_id = $1 AND snapshot_month = date_trunc('month', $2::date)
             LIMIT 1`,
            [userId, params.month.length === 7 ? `${params.month}-01` : params.month],
          )
        : await query(
            `SELECT * FROM monthly_financial_snapshots
             WHERE monthly_financial_snapshots.user_id = $1
             ORDER BY snapshot_month DESC
             LIMIT 1`,
            [userId],
          );

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No monthly close found for that month.' }] };
      }

      const r = rows[0] as any;
      const month = new Date(r.snapshot_month).toISOString().slice(0, 7);
      const freshness = r.freshness ?? {};
      const targetStatus = r.target_status ?? {};

      const text = [
        `Monthly close — ${month} (${r.status}${r.is_edited ? ', edited' : ''}):`,
        `  Take-home income: ${dollars(r.take_home_income_cents)}`,
        `  Expenses: ${dollars(r.expense_cents)} (fixed ${dollars(r.fixed_expense_cents)}, variable ${dollars(r.variable_expense_cents)})`,
        `  Cash savings: ${dollars(r.cash_savings_cents)}`,
        `  Investment contribution: ${dollars(r.investment_contribution_cents)}`,
        `  Debt principal paid: ${dollars(r.debt_principal_paid_cents)} (extra: ${dollars(r.extra_debt_principal_paid_cents)})`,
        `  Total assets: ${dollars(r.total_asset_cents)} (liquid ${dollars(r.liquid_asset_cents)}, investment ${dollars(r.investment_asset_cents)}, manual ${dollars(r.manual_asset_cents)})`,
        `  Total liabilities: ${dollars(r.total_liability_cents)} (credit card ${dollars(r.credit_card_liability_cents)}, loans ${dollars(r.loan_liability_cents)})`,
        `  Net worth: ${dollars(r.net_worth_cents)}`,
        `  Savings rate: ${pct(r.savings_rate_bps)}, Investing rate: ${pct(r.investing_rate_bps)}, Debt-paydown rate: ${pct(r.debt_paydown_rate_bps)}, Wealth-building rate: ${pct(r.wealth_building_rate_bps)}`,
        `  Expense ratio: ${pct(r.expense_ratio_bps)}, Liquid/net-worth ratio: ${pct(r.liquid_net_worth_ratio_bps)}, Debt/asset ratio: ${pct(r.debt_asset_ratio_bps)}`,
        `  Target status: ${JSON.stringify(targetStatus)}`,
        `  Close complete: ${freshness.isComplete ? 'yes' : 'NO — missing/stale data present'}`,
        freshness.isComplete
          ? undefined
          : `  Freshness gaps: missing manual assets [${(freshness.missingManualAssets ?? []).join(', ')}], stale accounts [${(freshness.staleAccounts ?? []).length}], unverified loans [${(freshness.unverifiedLoans ?? []).join(', ')}], missing investment prices [${(freshness.missingInvestmentPrices ?? []).join(', ')}]`,
      ]
        .filter(Boolean)
        .join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
