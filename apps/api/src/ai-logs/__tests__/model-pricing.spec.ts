import { describe, it, expect } from 'vitest';
import { costCentsFor, MODEL_PRICING } from '../model-pricing';

describe('costCentsFor', () => {
  it('computes cost from known input/output token counts against a real priced model', () => {
    // 1,000,000 input + 1,000,000 output tokens costs exactly the table's per-1M rates.
    const price = MODEL_PRICING['gpt-4o'];
    const cost = costCentsFor('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(price.inputCentsPer1M + price.outputCentsPer1M, 6);
  });

  it('scales linearly with token counts below 1M', () => {
    const price = MODEL_PRICING['claude-3-5-haiku-latest'];
    const cost = costCentsFor('claude-3-5-haiku-latest', 500_000, 250_000);
    const expected =
      (500_000 / 1_000_000) * price.inputCentsPer1M +
      (250_000 / 1_000_000) * price.outputCentsPer1M;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('returns 0 for a local/Ollama model not present in the price table', () => {
    expect(costCentsFor('llama3.2:3b', 5000, 2000)).toBe(0);
    expect(costCentsFor('nomic-embed-text', 1200, 0)).toBe(0);
  });

  it('returns 0 for an unmapped/unknown cloud model rather than throwing', () => {
    expect(costCentsFor('some-future-model-nobody-priced-yet', 1000, 1000)).toBe(0);
  });

  it('returns 0 for null/undefined model or missing token counts', () => {
    expect(costCentsFor(null, 1000, 1000)).toBe(0);
    expect(costCentsFor(undefined, 1000, 1000)).toBe(0);
    expect(costCentsFor('gpt-4o', null, null)).toBe(0);
    expect(costCentsFor('gpt-4o', undefined, undefined)).toBe(0);
  });
});
