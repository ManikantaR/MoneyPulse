import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';
import { computeLoanState, projectPayoff, type ExtraPayment } from '../lib/amortization.js';

export function registerGetLoanStatus(server: McpServer) {
  server.tool(
    'get_loan_status',
    'Status of tracked loans (mortgage/auto): current balance, principal & interest paid, extra principal applied, and payoff date at the current pace. Optionally model adding extra $/month to see months and interest saved. Answers "how much do I owe", "when is it paid off", "what if I pay $X more".',
    {
      extra_monthly: z
        .number()
        .min(0)
        .optional()
        .describe('Extra dollars per month to model an accelerated payoff'),
    },
    async (params) => {
      const userId = await getUserId();
      const loans = await query(
        `SELECT name, loan_type, lender_pattern, extra_principal_pattern,
                original_balance_cents, apr_bps, scheduled_payment_cents,
                to_char(start_date, 'YYYY-MM-DD') AS start_date
         FROM loans
         WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL
         ORDER BY original_balance_cents DESC`,
        [userId],
      );

      if (loans.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No loans are being tracked yet.' }],
        };
      }

      const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
      const extraMonthlyCents =
        params.extra_monthly != null ? Math.round(params.extra_monthly * 100) : 0;

      const blocks: string[] = [];
      for (const loan of loans) {
        const inputs = {
          originalBalanceCents: Number(loan.original_balance_cents),
          aprBps: Number(loan.apr_bps),
          scheduledPaymentCents: Number(loan.scheduled_payment_cents),
          startDate: loan.start_date as string,
        };

        // Extra-principal payments detected from transactions (if a pattern is configured).
        let extras: ExtraPayment[] = [];
        if (loan.extra_principal_pattern) {
          const rows = await query(
            `SELECT to_char(t.date, 'YYYY-MM-DD') AS d, t.amount_cents
             FROM transactions t
             WHERE t.user_id = $3 AND t.is_credit = false AND t.is_split_parent = false
               AND t.deleted_at IS NULL
               AND (t.normalized_merchant_name ILIKE $1 OR t.merchant_name ILIKE $1)
               AND t.date >= $2::date`,
            [`%${loan.extra_principal_pattern}%`, inputs.startDate, userId],
          );
          extras = rows.map((r) => ({ date: r.d as string, amountCents: Number(r.amount_cents) }));
        }

        const state = computeLoanState(inputs, extras);
        const apr = (inputs.aprBps / 100).toFixed(3).replace(/\.?0+$/, '');
        const lines = [
          `${loan.name} (${loan.loan_type}, ${apr}% APR):`,
          `  Original balance: ${dollars(inputs.originalBalanceCents)} (from ${inputs.startDate})`,
          `  Current balance: ${dollars(state.currentBalanceCents)}`,
          `  Principal paid: ${dollars(state.principalPaidCents)}${state.extraPrincipalPaidCents > 0 ? ` (incl. ${dollars(state.extraPrincipalPaidCents)} extra principal)` : ''}`,
          `  Interest paid so far: ${dollars(state.interestPaidCents)}`,
        ];

        if (state.currentBalanceCents <= 0) {
          lines.push('  Status: paid off 🎉');
        } else if (!state.amortizes) {
          lines.push('  ⚠ The scheduled payment does not cover the monthly interest — balance is not decreasing.');
        } else {
          const base = projectPayoff(state.currentBalanceCents, inputs.aprBps, inputs.scheduledPaymentCents);
          lines.push(
            `  At ${dollars(inputs.scheduledPaymentCents)}/mo: paid off ~${base.payoffDate} (${base.monthsRemaining} months), ${dollars(base.remainingInterestCents)} interest remaining.`,
          );
          if (extraMonthlyCents > 0) {
            const accel = projectPayoff(
              state.currentBalanceCents,
              inputs.aprBps,
              inputs.scheduledPaymentCents + extraMonthlyCents,
            );
            if (accel.amortizes) {
              const monthsSaved = base.monthsRemaining - accel.monthsRemaining;
              const interestSaved = base.remainingInterestCents - accel.remainingInterestCents;
              lines.push(
                `  Adding ${dollars(extraMonthlyCents)}/mo → paid off ~${accel.payoffDate} (${monthsSaved} months sooner), saving ${dollars(interestSaved)} in interest.`,
              );
            }
          }
        }

        blocks.push(lines.join('\n'));
      }

      return { content: [{ type: 'text' as const, text: blocks.join('\n\n') }] };
    },
  );
}
