import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeForCloudAI } from './pii-sanitizer';

interface AiCategorizationResult {
  categoryName: string;
  confidence: number;
  merchantName: string | null;
}

/**
 * AI-powered transaction categorizer using Ollama (local LLM).
 * Sends batches of uncategorized transactions to a local LLM for classification.
 * Falls back gracefully (returns nulls) when Ollama is unavailable.
 */
@Injectable()
export class AiCategorizerService {
  private readonly logger = new Logger(AiCategorizerService.name);
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly batchSize: number;

  constructor(private readonly config: ConfigService) {
    this.ollamaUrl =
      this.config.get<string>('OLLAMA_URL') || 'http://localhost:11434';
    this.ollamaModel =
      this.config.get<string>('OLLAMA_MODEL') || 'llama3.2:3b';
    this.batchSize = parseInt(
      this.config.get<string>('OLLAMA_BATCH_SIZE') || '20',
      10,
    );
  }

  /**
   * Categorize a batch of uncategorized transactions using Ollama (local LLM).
   * Splits large batches into sub-batches of configurable size (default 20).
   *
   * @param transactions - Array of transaction data to categorize
   * @param categories - Available category names for classification
   * @returns Array of results (null if Ollama can't determine a category)
   */
  async categorizeBatch(
    transactions: Array<{
      date: string;
      description: string;
      amountCents: number;
      isCredit: boolean;
      merchantName: string | null;
    }>,
    categories: string[],
  ): Promise<Array<AiCategorizationResult | null>> {
    const results: Array<AiCategorizationResult | null> = [];

    for (let i = 0; i < transactions.length; i += this.batchSize) {
      const batch = transactions.slice(i, i + this.batchSize);
      const batchResults = await this.processBatch(batch, categories);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Process a single sub-batch through Ollama's generate API.
   *
   * @param batch - Sub-batch of transactions (up to `batchSize`)
   * @param categories - Available category names
   * @returns Array of results, null for entries Ollama failed to categorize
   */
  private async processBatch(
    batch: Array<{
      date: string;
      description: string;
      amountCents: number;
      isCredit: boolean;
      merchantName: string | null;
    }>,
    categories: string[],
  ): Promise<Array<AiCategorizationResult | null>> {
    const prompt = this.buildPrompt(batch, categories);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 2000,
          },
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Ollama request failed: ${response.status}`);
        return batch.map(() => null);
      }

      const data = (await response.json()) as { response: string };
      return this.parseResponse(data.response, batch.length);
    } catch (err: any) {
      this.logger.error(`Ollama error: ${err.message}`);
      return batch.map(() => null);
    }
  }

  /**
   * Build the LLM prompt for a batch of transactions.
   * Instructs the model to return a JSON array with category, confidence, and merchant.
   *
   * @param transactions - Transactions to include in the prompt
   * @param categories - Available category names
   * @returns Formatted prompt string
   */
  private buildPrompt(
    transactions: Array<{
      date: string;
      description: string;
      amountCents: number;
      isCredit: boolean;
      merchantName: string | null;
    }>,
    categories: string[],
  ): string {
    const txnList = transactions
      .map((t, i) => {
        const amount = (t.amountCents / 100).toFixed(2);
        const type = t.isCredit ? 'credit' : 'debit';
        return `${i + 1}. "${t.description}" $${amount} (${type}) on ${t.date}`;
      })
      .join('\n');

    return `You are a financial transaction categorizer. Categorize each transaction into EXACTLY one of these categories:
${categories.join(', ')}

For each transaction, respond with a JSON array. Each element must have:
- "index": the transaction number (1-based)
- "category": one of the categories listed above (exact match)
- "confidence": number 0.0 to 1.0 indicating certainty
- "merchant": the likely merchant name (cleaned up, e.g., "STARBUCKS STORE 12345" → "Starbucks")

Transactions:
${txnList}

Respond ONLY with a valid JSON array. No other text.`;
  }

  /**
   * Parse the raw LLM response text into structured categorization results.
   * Extracts a JSON array from potentially noisy output.
   *
   * @param responseText - Raw text response from Ollama
   * @param expectedCount - Expected number of results (matches input batch size)
   * @returns Array of parsed results, null for unparseable entries
   */
  private parseResponse(
    responseText: string,
    expectedCount: number,
  ): Array<AiCategorizationResult | null> {
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn('No JSON array found in Ollama response');
        return Array(expectedCount).fill(null);
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        index: number;
        category: string;
        confidence: number;
        merchant: string;
      }>;

      const results: Array<AiCategorizationResult | null> =
        Array(expectedCount).fill(null);
      for (const item of parsed) {
        const idx = item.index - 1;
        if (idx >= 0 && idx < expectedCount) {
          results[idx] = {
            categoryName: item.category,
            confidence: Math.min(1, Math.max(0, item.confidence)),
            merchantName: item.merchant || null,
          };
        }
      }

      return results;
    } catch (err: any) {
      this.logger.warn(`Failed to parse Ollama response: ${err.message}`);
      return Array(expectedCount).fill(null);
    }
  }

  /**
   * Cloud AI fallback (PII-stripped). Only called if user has enabled cloud AI.
   * Sanitizes all PII before sending data externally.
   *
   * @param transactions - Transactions to categorize via cloud
   * @param categories - Available category names
   * @returns Array of results (currently placeholder — returns all nulls)
   */
  async categorizeWithCloudAI(
    transactions: Array<{
      date: string;
      description: string;
      amountCents: number;
      isCredit: boolean;
      merchantName: string | null;
    }>,
    categories: string[],
  ): Promise<Array<AiCategorizationResult | null>> {
    const sanitized = transactions.map(sanitizeForCloudAI);
    this.logger.log(
      `Cloud AI categorization for ${sanitized.length} transactions`,
    );
    // TODO: Implement cloud AI call when provider chosen
    return sanitized.map(() => null);
  }
}
