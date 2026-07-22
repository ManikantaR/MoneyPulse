import { ContributionPlanResult } from './contribution-planner';

/**
 * 12.6 — Investment Coach narration. Pure, LLM-free rendering straight off a
 * `ContributionPlanResult` (same numeric-spot-check-safe pattern as 12.5's
 * `cash-manager-narration.ts`): every dollar figure traces back to `evidence`.
 *
 * Only dollar amounts, asset-class names, and percentages appear here — never an
 * account number, lastFour, or routing number (see recommendation-evidence.ts).
 */

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Standing disclaimer — must appear on every piece of output this agent produces
 * (recommendation narration AND timing-refusal replies alike). */
export const INVESTMENT_COACH_DISCLAIMER =
  'This is not personalized investment, legal, or tax advice. MoneyPulse never buys, sells, moves, or ' +
  'schedules any trade or transfer on your behalf — consider consulting a licensed financial advisor before acting.';

export function buildInvestmentCoachNarration(result: ContributionPlanResult): string {
  let body: string;
  switch (result.status) {
    case 'missing_setting':
      body = `I can't give you an investment recommendation yet — missing setting(s): ${result.missing.join(', ')}. Add these in Settings first.`;
      break;
    case 'fund_buffer_first':
      body =
        `Let's fund your emergency buffer first. You have ${dollars(result.currentEmergencyFundCents)} toward a ` +
        `${dollars(result.emergencyFundTargetCents)} target — a gap of ${dollars(result.gapCents)}. ` +
        `No investment recommendation until this buffer is fully funded.`;
      break;
    case 'no_surplus':
      body =
        `There's no investable surplus this month (${dollars(result.investableSurplusCents)} after goal contributions ` +
        `and your scheduled DCA) — nothing new to contribute right now.`;
      break;
    case 'recommend':
      body =
        `Contribute ~${dollars(result.contributionCents)} this month to ${result.destinationAssetClass} ` +
        `(currently ${result.currentPercent.toFixed(1)}% vs your ${result.targetPercent.toFixed(1)}% target, ` +
        `${result.driftPercentPoints.toFixed(1)}pp underweight). This directs new money only — we do not ` +
        `recommend selling any existing holding. Timing follows your existing DCA schedule` +
        (result.dcaDayOfMonth ? ` (day ${result.dcaDayOfMonth} of the month)` : '') +
        `; time-in-market beats timing-the-market, so this isn't tied to any market prediction.`;
      break;
  }
  return `${body}\n\n${INVESTMENT_COACH_DISCLAIMER}`;
}

/** Phrases that would constitute a market-direction PREDICTION — must never appear
 * in this agent's output, tested with a real word/phrase-based assertion (not just
 * eyeballing the text). Case-insensitive. */
export const PREDICTIVE_CLAIM_PATTERNS: RegExp[] = [
  /will\s+rise/i,
  /will\s+fall/i,
  /will\s+(go\s+)?(up|down)/i,
  /good\s+time\s+to\s+buy/i,
  /good\s+time\s+to\s+invest/i,
  /expect\s+the\s+market\s+to/i,
  /market\s+is\s+about\s+to/i,
  /prices?\s+(are|is)\s+going\s+to/i,
  /now\s+is\s+the\s+time/i,
];

export function containsPredictiveClaim(text: string): boolean {
  return PREDICTIVE_CLAIM_PATTERNS.some((p) => p.test(text));
}

/** Loose detector for a market-timing-style question from advisor chat (e.g. "is now
 * a good time to buy?" / "should I wait for a dip?"). Used by the on-demand trigger
 * to route to the refusal reply instead of (or in addition to) the plan narration. */
const TIMING_QUESTION_PATTERNS: RegExp[] = [
  /good\s+time\s+to\s+(buy|invest)/i,
  /wait\s+for\s+a\s+dip/i,
  /wait\s+for\s+the\s+market/i,
  /time\s+the\s+market/i,
  /should\s+i\s+(buy|invest)\s+now/i,
  /is\s+now\s+a\s+good\s+time/i,
];

export function looksLikeMarketTimingQuestion(message: string): boolean {
  return TIMING_QUESTION_PATTERNS.some((p) => p.test(message));
}

/**
 * 12.6's timing-refusal contract: given a question like "is now a good time to buy?"
 * or "should I wait for a dip?", the agent must EXPLICITLY decline to predict market
 * direction/timing and instead reframe around policy — time-in-market over
 * timing-the-market, the user's existing DCA schedule, and their current allocation
 * drift. It must never contain a predictive claim (see `containsPredictiveClaim`).
 *
 * `result` is an already-computed `ContributionPlanResult` so the reframing can cite
 * the user's actual drift/DCA facts rather than invent generic advice — but even when
 * no plan is available (e.g. missing settings), the refusal language itself is always
 * present.
 */
export function buildTimingRefusalNarration(result: ContributionPlanResult): string {
  const refusal =
    "I can't predict market direction or tell you whether now is a good or bad time to buy — no one can " +
    'do that reliably. What I can tell you is that time-in-market has historically mattered far more than ' +
    'timing-the-market, which is why your plan sticks to a regular contribution schedule regardless of ' +
    'short-term moves.';

  let policyNote: string;
  if (result.status === 'recommend') {
    policyNote =
      `Your current plan: contribute on your existing DCA schedule` +
      (result.dcaDayOfMonth ? ` (day ${result.dcaDayOfMonth} of the month)` : '') +
      ` and direct new money toward ${result.destinationAssetClass}, which is currently ` +
      `${result.driftPercentPoints.toFixed(1)}pp underweight vs your target allocation. Sticking to that ` +
      `schedule — rather than trying to guess a good entry point — is the recommendation.`;
  } else if (result.status === 'fund_buffer_first') {
    policyNote =
      `Right now your plan is to finish funding your emergency buffer (${dollars(result.gapCents)} to go) before ` +
      `any new investment — that timeline doesn't depend on market conditions either.`;
  } else if (result.status === 'no_surplus') {
    policyNote =
      "There's no investable surplus this month, so there's nothing to time either way — the next scheduled " +
      'contribution will follow your existing DCA policy once surplus is available.';
  } else {
    policyNote = 'Once your suitability settings are complete, this reframes around your DCA schedule and allocation drift instead of market timing.';
  }

  return `${refusal} ${policyNote}\n\n${INVESTMENT_COACH_DISCLAIMER}`;
}
