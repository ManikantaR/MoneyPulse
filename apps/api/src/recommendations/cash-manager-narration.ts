import { CashPlacementResult } from './cash-placement-calculator';

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Build the user-facing narration text purely from a `CashPlacementResult` — no LLM
 * call, no extra data. This is what a future LLM-narration step should be checked
 * against with the 11.9 "numeric spot-check": every dollar figure that appears in
 * LLM-generated prose must also appear in the tool output it was narrated from. By
 * building the deterministic narration straight off the calculator result, every
 * number here is provably traceable to `evidence`/`options` — nothing is fabricated.
 *
 * Only nicknames/institution names/dollar amounts/account types appear here — never
 * an account number, lastFour, or routing number (see recommendation-evidence.ts).
 */
export function buildCashManagerNarration(result: CashPlacementResult): string {
  if (!result.shouldRecommend || result.options.length === 0) {
    return `Your movable cash (${dollars(result.movableCashCents)} after your ${dollars(result.bufferCents)} buffer) is already well placed — no option beats your current placement by enough to bother you.`;
  }

  const lines: string[] = [
    `You have ${dollars(result.movableCashCents)} in movable cash after keeping a ${dollars(result.bufferCents)} buffer aside.`,
  ];

  result.options.forEach((opt, i) => {
    const term = opt.termMonths ? `${opt.termMonths}-month ${opt.institution}` : opt.institution;
    lines.push(
      `${i + 1}. ${term} at ${(opt.apyBps / 100).toFixed(2)}% APY — an estimated ${dollars(opt.netAnnualBenefitCents)}/yr more than your current placement. ${opt.tradeoffs.join(' ')}`,
    );
  });

  lines.push(
    `Estimated impact: ${dollars(result.impact.minCentsPerYear)}-${dollars(result.impact.maxCentsPerYear)}/yr (${result.impact.basis})`,
  );

  return lines.join('\n');
}

/** Extract every distinct dollar figure (as raw cents-equivalent numbers) appearing in
 * a narration string, for the numeric spot-check test. Matches "$1,234.56" style. */
export function extractDollarFigures(text: string): number[] {
  const matches = text.match(/\$[\d,]+\.\d{2}/g) ?? [];
  return matches.map((m) => Math.round(parseFloat(m.replace(/[$,]/g, '')) * 100));
}
