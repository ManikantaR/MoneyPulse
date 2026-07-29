import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';
import { calculateCarAffordability } from '../lib/car-affordability.js';

const PAY_PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semi_monthly: 24,
  monthly: 12,
};

/** Resolve gross monthly income the same way `BudgetPlanService.budgetPlan` does:
 *  most recent paycheck profile (as of today), gross pay smoothed to a monthly
 *  figure via its pay frequency. Returns null (never 0) when no profile exists yet,
 *  so the affordability rule can fail closed instead of falsely passing. */
async function resolveGrossMonthlyIncomeCents(userId: string): Promise<number | null> {
  const row = await query<{ gross_pay_cents: string; pay_frequency: string }>(
    `SELECT gross_pay_cents, pay_frequency
     FROM paycheck_profiles
     WHERE user_id = $1 AND deleted_at IS NULL AND effective_date <= CURRENT_DATE
     ORDER BY effective_date DESC
     LIMIT 1`,
    [userId],
  );
  if (row.length === 0) return null;
  const periodsPerYear = PAY_PERIODS_PER_YEAR[row[0].pay_frequency] ?? 12;
  return Math.round((Number(row[0].gross_pay_cents) * periodsPerYear) / 12);
}

/** Latest EIA regular-gasoline retail price, in cents/gallon. Null (never a fake
 *  default) when the market-data refresh hasn't populated it yet — the caller must
 *  supply `gas_price_dollars_per_gallon` explicitly in that case. */
async function resolveGasPriceCentsPerGallon(): Promise<number | null> {
  const row = await query<{ value: string }>(
    `SELECT value::text AS value
     FROM market_metrics
     WHERE metric_key = 'gas_retail_regular'
     ORDER BY period_date DESC
     LIMIT 1`,
  );
  if (row.length === 0) return null;
  return Math.round(Number(row[0].value) * 100);
}

export function registerGetCarAffordability(server: McpServer) {
  server.tool(
    'get_car_affordability',
    'Evaluates whether a car purchase clears the 20/4/10 affordability rule (≥20% down, ≤4yr loan, total monthly vehicle cost ≤10% of gross monthly income), a full total-cost-of-ownership breakdown (financing + insurance + maintenance + fuel − resale), and an optional buy-vs-lease comparison. All price/insurance/maintenance/mileage/MPG figures are user-entered — this tool does not look up or guess a car\'s price. Gross income is pulled from the user\'s paycheck profile; gas price defaults to the latest tracked EIA price unless overridden.',
    {
      price_dollars: z.number().positive().describe('Purchase price of the vehicle, in dollars'),
      down_payment_dollars: z.number().min(0).describe('Cash down payment, in dollars'),
      loan_term_months: z.number().int().positive().describe('Loan term in months'),
      loan_apr_percent: z
        .number()
        .min(0)
        .describe('Loan APR as a percent (e.g. 6.5 for 6.5%) — no current auto-loan rate feed exists yet, so this must be user-entered'),
      insurance_amount_dollars: z.number().min(0).describe('Estimated insurance cost, in dollars'),
      insurance_frequency: z.enum(['annual', 'monthly']).default('annual'),
      maintenance_amount_dollars: z.number().min(0).describe('Estimated maintenance cost, in dollars'),
      maintenance_frequency: z.enum(['annual', 'monthly']).default('annual'),
      annual_mileage: z.number().min(0).describe('Expected miles driven per year'),
      mpg: z.number().min(0).describe('Expected miles per gallon'),
      gas_price_dollars_per_gallon: z
        .number()
        .positive()
        .optional()
        .describe('Overrides the latest tracked EIA gas price ($/gal), if provided'),
      ownership_years: z.number().positive().describe('Holding period to compute total cost of ownership over'),
      estimated_resale_value_dollars: z
        .number()
        .min(0)
        .describe('Estimated resale/trade-in value at the end of the ownership period, in dollars'),
      lease_monthly_payment_dollars: z
        .number()
        .min(0)
        .optional()
        .describe('Lease monthly payment, in dollars — omit to skip the buy-vs-lease comparison'),
      lease_due_at_signing_dollars: z.number().min(0).optional().describe('Lease due-at-signing cash, in dollars'),
      lease_term_months: z.number().int().positive().optional().describe('Lease term in months'),
    },
    async (params) => {
      const userId = await getUserId();
      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const toCents = (d: number) => Math.round(d * 100);

      const grossMonthlyIncomeCents = await resolveGrossMonthlyIncomeCents(userId);
      const gasPriceCentsPerGallon =
        params.gas_price_dollars_per_gallon != null
          ? toCents(params.gas_price_dollars_per_gallon)
          : await resolveGasPriceCentsPerGallon();

      if (gasPriceCentsPerGallon === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No gas price is available yet (EIA market data hasn\'t been fetched) — pass gas_price_dollars_per_gallon explicitly to run this calculation.',
            },
          ],
        };
      }

      const leaseFieldsGiven = [
        params.lease_monthly_payment_dollars,
        params.lease_due_at_signing_dollars,
        params.lease_term_months,
      ].filter((v) => v != null).length;
      const hasLease = leaseFieldsGiven === 3;
      const partialLease = leaseFieldsGiven > 0 && leaseFieldsGiven < 3;

      const result = calculateCarAffordability({
        priceCents: toCents(params.price_dollars),
        downPaymentCents: toCents(params.down_payment_dollars),
        loanTermMonths: params.loan_term_months,
        loanAprBps: Math.round(params.loan_apr_percent * 100),
        grossMonthlyIncomeCents: grossMonthlyIncomeCents ?? 0,
        insurance: {
          amountCents: toCents(params.insurance_amount_dollars),
          frequency: params.insurance_frequency,
        },
        maintenance: {
          amountCents: toCents(params.maintenance_amount_dollars),
          frequency: params.maintenance_frequency,
        },
        annualMileage: params.annual_mileage,
        mpg: params.mpg,
        gasPriceCentsPerGallon,
        ownershipYears: params.ownership_years,
        estimatedResaleValueCents: toCents(params.estimated_resale_value_dollars),
        lease: hasLease
          ? {
              monthlyPaymentCents: toCents(params.lease_monthly_payment_dollars!),
              dueAtSigningCents: toCents(params.lease_due_at_signing_dollars!),
              termMonths: params.lease_term_months!,
            }
          : undefined,
      });

      const { rule204010, tco, buyVsLease } = result;

      const lines: string[] = [];

      lines.push('20/4/10 rule:');
      lines.push(
        `  Down payment: ${dollars(toCents(params.down_payment_dollars))} of ${dollars(toCents(params.price_dollars))} = ${(rule204010.downPaymentPercent * 100).toFixed(1)}% (need ≥20%, i.e. ≥${dollars(rule204010.downPaymentRequiredCents)}) — ${rule204010.downPaymentPassed ? 'PASS' : 'FAIL'}`,
      );
      lines.push(
        `  Loan term: ${rule204010.loanTermMonths} months (need ≤${rule204010.maxLoanTermMonths}) — ${rule204010.loanTermPassed ? 'PASS' : 'FAIL'}`,
      );
      if (grossMonthlyIncomeCents === null) {
        lines.push(
          '  Monthly vehicle cost vs. income: no paycheck profile on file — cannot verify the 10% test, treated as FAIL',
        );
      } else {
        const totalMonthly =
          tco.monthlyLoanPaymentCents +
          tco.monthlyInsuranceCents +
          tco.monthlyMaintenanceCents +
          tco.monthlyFuelCents;
        lines.push(
          `  Monthly vehicle cost: ${dollars(totalMonthly)} (loan ${dollars(tco.monthlyLoanPaymentCents)} + insurance ${dollars(tco.monthlyInsuranceCents)} + maintenance ${dollars(tco.monthlyMaintenanceCents)} + fuel ${dollars(tco.monthlyFuelCents)}) = ${((rule204010.monthlyCostPercent ?? 0) * 100).toFixed(1)}% of ${dollars(grossMonthlyIncomeCents)} gross monthly income (need ≤10%, i.e. ≤${dollars(rule204010.maxMonthlyCostCents!)}) — ${rule204010.monthlyCostPassed ? 'PASS' : 'FAIL'}`,
        );
      }
      lines.push(`  Overall: ${rule204010.passed ? 'PASSES the 20/4/10 rule' : 'FAILS the 20/4/10 rule'}`);

      lines.push('');
      lines.push(`Total cost of ownership over ${params.ownership_years} year(s):`);
      lines.push(`  Financing cash out (down payment + loan payments): ${dollars(tco.totalFinancingCashOutCents)}`);
      lines.push(`    of which loan interest: ${dollars(tco.ownershipLoanInterestCents)}`);
      lines.push(`  Insurance: ${dollars(tco.totalInsuranceCents)}`);
      lines.push(`  Maintenance: ${dollars(tco.totalMaintenanceCents)}`);
      lines.push(`  Fuel: ${dollars(tco.totalFuelCents)} (at ${(gasPriceCentsPerGallon / 100).toFixed(2)}/gal)`);
      lines.push(`  Less estimated resale value: -${dollars(tco.estimatedResaleValueCents)}`);
      lines.push(`  Total cost of ownership: ${dollars(tco.totalCostOfOwnershipCents)}`);

      if (buyVsLease) {
        lines.push('');
        lines.push(`Buy vs. lease over ${buyVsLease.comparisonMonths} months:`);
        lines.push(`  Buy total cash cost (net of resale): ${dollars(buyVsLease.buyTotalCostCents)}`);
        lines.push(`  Lease total cash cost: ${dollars(buyVsLease.leaseTotalCostCents)}`);
        lines.push(
          `  ${buyVsLease.cheaperOption === 'tie' ? 'Buying and leasing cost the same' : `${buyVsLease.cheaperOption === 'buy' ? 'Buying' : 'Leasing'} is cheaper by ${dollars(Math.abs(buyVsLease.costDifferenceCents))}`}`,
        );
      } else if (partialLease) {
        lines.push('');
        lines.push(
          'Buy vs. lease comparison skipped: lease_monthly_payment_dollars, lease_due_at_signing_dollars, and lease_term_months must all be provided together.',
        );
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
