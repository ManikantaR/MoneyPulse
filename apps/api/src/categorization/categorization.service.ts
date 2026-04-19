import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { RuleEngineService } from './rule-engine.service';
import { AiCategorizerService } from './ai-categorizer.service';
import { LearningService } from './learning.service';

interface CategorizationStats {
  total: number;
  categorizedByRule: number;
  categorizedByAi: number;
  suggested: number;
  uncategorized: number;
}

/**
 * Orchestrator service for the categorization pipeline.
 * Runs transactions through: Rule Engine → Ollama (local AI) → Cloud AI (if enabled).
 * High-confidence AI results auto-assign categories and create rules for future matches.
 */
@Injectable()
export class CategorizationService {
  private readonly logger = new Logger(CategorizationService.name);
  private readonly AI_AUTO_THRESHOLD = 0.85;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly ruleEngine: RuleEngineService,
    private readonly aiCategorizer: AiCategorizerService,
    private readonly learningService: LearningService,
  ) {}

  /**
   * Categorize a batch of newly imported transactions through the full pipeline.
   * Called by the ingestion processor after inserting transactions.
   *
   * Flow:
   * 1. Rule engine (pattern match) — fast, first-match wins
   * 2. Ollama (local AI) — for remaining uncategorized
   * 3. Cloud AI (if user enabled) — placeholder for future
   * 4. Mark remaining as uncategorized
   *
   * @param transactionIds - IDs of newly imported transactions to categorize
   * @param userId - Owner user ID
   * @returns Statistics on how many were categorized by each method
   */
  async categorizeBatch(
    transactionIds: string[],
    userId: string,
  ): Promise<CategorizationStats> {
    const stats: CategorizationStats = {
      total: transactionIds.length,
      categorizedByRule: 0,
      categorizedByAi: 0,
      suggested: 0,
      uncategorized: 0,
    };

    if (transactionIds.length === 0) return stats;

    const uncategorized = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.categoryId),
          isNull(schema.transactions.deletedAt),
          inArray(schema.transactions.id, transactionIds),
        ),
      );

    if (uncategorized.length === 0) return stats;

    // ── Step 1: Rule Engine ──
    const ruleMatches = await this.ruleEngine.matchBatch(
      uncategorized.map((t: any) => ({
        description: t.description,
        merchantName: t.merchantName,
      })),
      userId,
    );

    const stillUncategorized: any[] = [];

    // Group rule matches by categoryId for batched DB updates
    const categorizedByCategoryId = new Map<string, string[]>();

    for (let i = 0; i < uncategorized.length; i++) {
      const match = ruleMatches.get(i);
      if (match) {
        const txId = uncategorized[i].id as string;
        const categoryId = match.categoryId as string;
        const existing = categorizedByCategoryId.get(categoryId);
        if (existing) {
          existing.push(txId);
        } else {
          categorizedByCategoryId.set(categoryId, [txId]);
        }
        stats.categorizedByRule++;
      } else {
        stillUncategorized.push(uncategorized[i]);
      }
    }

    // Batch-update all rule-matched transactions (grouped by categoryId)
    if (categorizedByCategoryId.size > 0) {
      for (const [categoryId, ids] of categorizedByCategoryId.entries()) {
        await this.db
          .update(schema.transactions)
          .set({ categoryId, updatedAt: new Date() })
          .where(inArray(schema.transactions.id, ids));
      }
    }

    if (stillUncategorized.length === 0) return stats;

    // ── Step 2: Ollama (Local AI) ──
    try {
      const categoryMap = await this.getActiveCategoryMap();
      const categoryNames = Array.from(categoryMap.keys());
      const aiResults = await this.aiCategorizer.categorizeBatch(
        stillUncategorized.map((t: any) => ({
          date: t.date?.toISOString?.()?.split('T')[0] ?? t.date,
          description: t.description,
          amountCents: t.amountCents,
          isCredit: t.isCredit,
          merchantName: t.merchantName,
        })),
        categoryNames,
      );

      const remainingAfterAi: any[] = [];

      for (let i = 0; i < stillUncategorized.length; i++) {
        const result = aiResults[i];
        if (result && result.confidence >= this.AI_AUTO_THRESHOLD) {
          const categoryId = categoryMap.get(result.categoryName) ?? null;
          if (categoryId) {
            await this.db
              .update(schema.transactions)
              .set({
                categoryId,
                merchantName:
                  result.merchantName || stillUncategorized[i].merchantName,
                updatedAt: new Date(),
              })
              .where(eq(schema.transactions.id, stillUncategorized[i].id));

            await this.createAiRule(
              userId,
              stillUncategorized[i].description,
              categoryId,
              result.confidence,
            );

            stats.categorizedByAi++;
          } else {
            remainingAfterAi.push(stillUncategorized[i]);
          }
        } else if (result) {
          // Low-confidence: mark as suggested but do NOT update categoryId
          stats.suggested++;
          remainingAfterAi.push(stillUncategorized[i]);
        } else {
          remainingAfterAi.push(stillUncategorized[i]);
        }
      }

      stats.uncategorized = remainingAfterAi.length;
    } catch (err: any) {
      this.logger.warn(`AI categorization failed: ${err.message}`);
      stats.uncategorized = stillUncategorized.length;
    }

    return stats;
  }

  /**
   * Recategorize a single transaction (user override) and learn from it.
   * Updates the transaction's category and creates/updates a rule for future matches.
   *
   * @param transactionId - The transaction to recategorize
   * @param userId - The user performing the override
   * @param newCategoryId - The new category to assign
   */
  async recategorize(
    transactionId: string,
    userId: string,
    newCategoryId: string,
  ): Promise<void> {
    await this.db
      .update(schema.transactions)
      .set({ categoryId: newCategoryId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          eq(schema.transactions.userId, userId),
        ),
      );

    await this.learningService.learnFromOverride(
      userId,
      transactionId,
      newCategoryId,
    );
  }

  /**
   * Get all active (non-deleted) categories as a name→id map.
   *
   * @returns Map of category name → category ID
   */
  private async getActiveCategoryMap(): Promise<Map<string, string>> {
    const categories = await this.db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(isNull(schema.categories.deletedAt));
    return new Map(categories.map((c: any) => [c.name, c.id]));
  }

  /**
   * Create an AI-generated categorization rule from a transaction description.
   * Skips creation if a rule with the same pattern already exists.
   *
   * @param userId - Rule owner
   * @param description - Raw transaction description to extract pattern from
   * @param categoryId - Category the AI assigned
   * @param confidence - The AI's confidence score (0.0–1.0)
   */
  private async createAiRule(
    userId: string,
    description: string,
    categoryId: string,
    confidence: number,
  ): Promise<void> {
    const pattern = this.learningService.extractPattern(description);
    if (!pattern || pattern.length < 3) return;

    const existing = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          eq(schema.categorizationRules.userId, userId),
          eq(schema.categorizationRules.pattern, pattern),
          isNull(schema.categorizationRules.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) return;

    await this.db.insert(schema.categorizationRules).values({
      userId,
      pattern,
      matchType: 'contains',
      field: 'description',
      categoryId,
      priority: 45,
      isAiGenerated: true,
      confidence,
    });
  }

  /**
   * Fast categorization pass — rule engine only, no AI.
   * Returns IDs of transactions still uncategorized (for background AI queue).
   */
  async categorizeByRulesOnly(
    transactionIds: string[],
    userId: string,
  ): Promise<{ categorizedByRule: number; uncategorizedIds: string[] }> {
    if (transactionIds.length === 0)
      return { categorizedByRule: 0, uncategorizedIds: [] };

    const uncategorized = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.categoryId),
          isNull(schema.transactions.deletedAt),
          inArray(schema.transactions.id, transactionIds),
        ),
      );

    if (uncategorized.length === 0)
      return { categorizedByRule: 0, uncategorizedIds: [] };

    const ruleMatches = await this.ruleEngine.matchBatch(
      uncategorized.map((t: any) => ({
        description: t.description,
        merchantName: t.merchantName,
      })),
      userId,
    );

    const categorizedByCategoryId = new Map<string, string[]>();
    const stillUncategorizedIds: string[] = [];
    let ruleCount = 0;

    for (let i = 0; i < uncategorized.length; i++) {
      const match = ruleMatches.get(i);
      if (match) {
        const txId = uncategorized[i].id as string;
        const existing = categorizedByCategoryId.get(match.categoryId);
        if (existing) existing.push(txId);
        else categorizedByCategoryId.set(match.categoryId, [txId]);
        ruleCount++;
      } else {
        stillUncategorizedIds.push(uncategorized[i].id);
      }
    }

    for (const [categoryId, ids] of categorizedByCategoryId.entries()) {
      await this.db
        .update(schema.transactions)
        .set({ categoryId, updatedAt: new Date() })
        .where(inArray(schema.transactions.id, ids));
    }

    return { categorizedByRule: ruleCount, uncategorizedIds: stillUncategorizedIds };
  }
}
