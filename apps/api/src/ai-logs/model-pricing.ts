/**
 * Hand-maintained LLM pricing table used to turn logged token counts into an
 * estimated dollar cost, computed at *query time* (not write time) so prices
 * can be corrected retroactively without touching `ai_prompt_logs` rows.
 *
 * Units: cents per 1,000,000 (1M) tokens, split input vs output, because most
 * vendors price them differently. Update this file by hand whenever a vendor
 * changes pricing — there is no live pricing fetch by design.
 *
 * Local models (Ollama) are intentionally NOT listed here: `costCentsFor`
 * treats any model missing from this table as free ($0) rather than erroring,
 * which is exactly right for local/self-hosted inference (nothing left the
 * box, no vendor invoice) and also fails safe for any model we simply haven't
 * priced yet.
 *
 * Sources: vendor list-price pages as of the last time this file was edited.
 * Prices are USD cents per 1M tokens.
 */
export interface ModelPrice {
  /** Cents per 1,000,000 input tokens. */
  inputCentsPer1M: number;
  /** Cents per 1,000,000 output tokens. */
  outputCentsPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // ── Anthropic (Claude) ──────────────────────────────────────
  'claude-opus-4-8': { inputCentsPer1M: 1_500, outputCentsPer1M: 7_500 },
  'claude-opus-4': { inputCentsPer1M: 1_500, outputCentsPer1M: 7_500 },
  'claude-sonnet-4': { inputCentsPer1M: 300, outputCentsPer1M: 1_500 },
  'claude-3-5-sonnet-latest': { inputCentsPer1M: 300, outputCentsPer1M: 1_500 },
  'claude-3-5-haiku-latest': { inputCentsPer1M: 80, outputCentsPer1M: 400 },

  // ── OpenAI ───────────────────────────────────────────────────
  'gpt-4o': { inputCentsPer1M: 250, outputCentsPer1M: 1_000 },
  'gpt-4o-mini': { inputCentsPer1M: 15, outputCentsPer1M: 60 },
  'gpt-4.1': { inputCentsPer1M: 200, outputCentsPer1M: 800 },
  'gpt-4.1-mini': { inputCentsPer1M: 40, outputCentsPer1M: 160 },

  // ── Google (Gemini) ──────────────────────────────────────────
  'gemini-3.5-flash': { inputCentsPer1M: 7.5, outputCentsPer1M: 30 },
  'gemini-1.5-flash': { inputCentsPer1M: 7.5, outputCentsPer1M: 30 },
  'gemini-1.5-pro': { inputCentsPer1M: 125, outputCentsPer1M: 500 },
};

/**
 * Estimated cost in cents for a single call, given the model name and the
 * (already-logged) token counts. Returns 0 for any model not present in
 * {@link MODEL_PRICING} — this covers local/Ollama models by design, and
 * fails safe (never throws / never shows a bogus number) for any cloud model
 * that hasn't been priced here yet.
 */
export function costCentsFor(
  model: string | null | undefined,
  tokenCountIn: number | null | undefined,
  tokenCountOut: number | null | undefined,
): number {
  if (!model) return 0;
  const price = MODEL_PRICING[model];
  if (!price) return 0;

  const tokensIn = tokenCountIn ?? 0;
  const tokensOut = tokenCountOut ?? 0;

  const inputCost = (tokensIn / 1_000_000) * price.inputCentsPer1M;
  const outputCost = (tokensOut / 1_000_000) * price.outputCentsPer1M;

  return inputCost + outputCost;
}
