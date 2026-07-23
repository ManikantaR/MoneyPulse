import { SavingsCoachResult } from './savings-coach-calculator';

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Build the user-facing narration purely from a `SavingsCoachResult` — no LLM call.
 * Every dollar figure here is traceable to the ranked items / evidence, so an 11.9
 * numeric spot-check against this text always passes for a correctly-computed result.
 *
 * Only merchant names/category labels/dollar amounts appear here — never an account
 * number, lastFour, or routing number (see recommendation-evidence.ts).
 */
export function buildSavingsCoachNarration(result: SavingsCoachResult): string {
  if (!result.shouldRecommend || result.items.length === 0) {
    return 'No material savings actions found this month.';
  }

  const lines: string[] = [`Found ${result.items.length} savings action${result.items.length === 1 ? '' : 's'} this month:`];

  result.items.forEach((item, i) => {
    lines.push(
      `${i + 1}. ${item.label} — an estimated ${dollars(item.minCentsPerMonth)}-${dollars(item.maxCentsPerMonth)}/mo.`,
    );
  });

  lines.push(
    `Estimated impact: ${dollars(result.impact.minCentsPerYear)}-${dollars(result.impact.maxCentsPerYear)}/yr (${result.impact.basis})`,
  );

  return lines.join('\n');
}
