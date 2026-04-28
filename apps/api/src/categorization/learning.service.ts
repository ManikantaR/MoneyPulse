import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';

/**
 * Learning service that auto-creates categorization rules from user behavior.
 * When a user manually overrides a transaction's category, a new rule is
 * created (or updated) so future imports automatically match.
 */
@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Learn from a single user category override.
   * Extracts a pattern from the transaction description and creates/updates
   * a categorization rule for this user.
   *
   * @param userId - The user who overrode the category
   * @param transactionId - The transaction whose category was changed
   * @param newCategoryId - The new category assigned by the user
   */
  async learnFromOverride(
    userId: string,
    transactionId: string,
    newCategoryId: string,
  ): Promise<void> {
    const [txn] = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          eq(schema.transactions.userId, userId),
        ),
      )
      .limit(1);

    if (!txn) return;

    const pattern = this.extractPattern(txn.description);
    if (!pattern || pattern.length < 3) return;

    // Also create a merchant-name rule for fuzzy matching (e.g. "Wm Supercenter")
    const merchantPattern = txn.merchantName
      ? txn.merchantName.toLowerCase().trim()
      : null;

    const existingRules = await this.db
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

    if (existingRules.length > 0) {
      if (existingRules[0].categoryId !== newCategoryId) {
        await this.db
          .update(schema.categorizationRules)
          .set({ categoryId: newCategoryId, updatedAt: new Date() })
          .where(eq(schema.categorizationRules.id, existingRules[0].id));
        this.logger.log(
          `Updated rule: "${pattern}" → category ${newCategoryId}`,
        );
      }
    } else {
      await this.db.insert(schema.categorizationRules).values({
        userId,
        pattern,
        matchType: 'contains',
        field: 'description',
        categoryId: newCategoryId,
        priority: 40,
        isAiGenerated: false,
        confidence: 1.0,
      });
      this.logger.log(`Created rule: "${pattern}" → category ${newCategoryId}`);
    }

    // Retroactively apply the new pattern to existing uncategorized transactions
    await this.applyPatternRetroactively(userId, pattern, 'contains', 'description', newCategoryId);
    if (merchantPattern && merchantPattern.length >= 3 && merchantPattern !== pattern) {
      await this.applyPatternRetroactively(userId, merchantPattern, 'contains', 'merchant', newCategoryId);
    }

    // Create a separate merchant_name rule if different from description pattern
    if (merchantPattern && merchantPattern.length >= 3 && merchantPattern !== pattern) {
      const existingMerchantRule = await this.db
        .select()
        .from(schema.categorizationRules)
        .where(
          and(
            eq(schema.categorizationRules.userId, userId),
            eq(schema.categorizationRules.pattern, merchantPattern),
            eq(schema.categorizationRules.field, 'merchant'),
            isNull(schema.categorizationRules.deletedAt),
          ),
        )
        .limit(1);

      if (existingMerchantRule.length === 0) {
        await this.db.insert(schema.categorizationRules).values({
          userId,
          pattern: merchantPattern,
          matchType: 'contains',
          field: 'merchant',
          categoryId: newCategoryId,
          priority: 45,
          isAiGenerated: false,
          confidence: 1.0,
        });
        this.logger.log(
          `Created merchant rule: "${merchantPattern}" → category ${newCategoryId}`,
        );
      }
    }
  }

  /**
   * Learn from a bulk categorization action.
   * Finds the common prefix among the selected transaction descriptions
   * and creates a `starts_with` rule if the prefix is long enough (>= 4 chars).
   *
   * @param userId - The user performing bulk categorization
   * @param transactionIds - Array of transaction IDs being categorized together
   * @param categoryId - The category assigned to all selected transactions
   */
  async learnFromBulk(
    userId: string,
    transactionIds: string[],
    categoryId: string,
  ): Promise<void> {
    if (transactionIds.length < 2) return;

    const txns = await this.db
      .select({ description: schema.transactions.description })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          inArray(schema.transactions.id, transactionIds),
        ),
      );

    const descriptions = txns
      .map((t: any) => t.description.toLowerCase().trim())
      .filter(Boolean);

    const commonPrefix = this.findCommonPrefix(descriptions);
    if (commonPrefix && commonPrefix.length >= 4) {
      const existing = await this.db
        .select()
        .from(schema.categorizationRules)
        .where(
          and(
            eq(schema.categorizationRules.userId, userId),
            eq(schema.categorizationRules.pattern, commonPrefix),
            isNull(schema.categorizationRules.deletedAt),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await this.db.insert(schema.categorizationRules).values({
          userId,
          pattern: commonPrefix,
          matchType: 'starts_with',
          field: 'description',
          categoryId,
          priority: 35,
          isAiGenerated: false,
          confidence: 1.0,
        });
        this.logger.log(
          `Created bulk rule: starts_with "${commonPrefix}" → category ${categoryId}`,
        );
      }
    }
  }

  /**
   * Extract the most significant pattern from a transaction description.
   * Removes common noise: store numbers, reference codes, trailing digits.
   * Limits output to 3 significant words.
   *
   * @example
   * extractPattern('WHOLE FOODS MARKET #10234') // 'whole foods market'
   * extractPattern('AMAZON.COM*M44KL2')         // 'amazon.com'
   * extractPattern('STARBUCKS STORE 12345')      // 'starbucks'
   *
   * @param description - Raw transaction description
   * @returns Cleaned, lowercased pattern string
   */
  extractPattern(description: string): string {
    let cleaned = description.toLowerCase().trim();

    cleaned = cleaned
      .replace(/\s*#\d+/g, '')
      .replace(/\s*\*\w+/g, '')
      .replace(/\s+\d{4,}$/g, '')
      .replace(/\s+store\s*\d*/gi, '')
      .replace(/\s+\d{2,}$/g, '')
      .trim();

    const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length > 3) {
      return words.slice(0, 3).join(' ');
    }

    return cleaned;
  }

  /**
   * Apply a newly-learned pattern to all uncategorized transactions for the user.
   * Runs in the background after rule creation so new categorizations are immediately visible.
   */
  private async applyPatternRetroactively(
    userId: string,
    pattern: string,
    matchType: string,
    field: string,
    categoryId: string,
  ): Promise<void> {
    try {
      const uncategorized = await this.db
        .select({
          id: schema.transactions.id,
          description: schema.transactions.description,
          merchantName: schema.transactions.merchantName,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, userId),
            isNull(schema.transactions.categoryId),
            isNull(schema.transactions.deletedAt),
          ),
        );

      const lowerPattern = pattern.toLowerCase();
      const toUpdate: string[] = [];

      for (const txn of uncategorized) {
        const fieldValue = field === 'merchant'
          ? (txn.merchantName ?? '').toLowerCase()
          : txn.description.toLowerCase();

        const matches = matchType === 'starts_with'
          ? fieldValue.startsWith(lowerPattern)
          : fieldValue.includes(lowerPattern);

        if (matches) toUpdate.push(txn.id);
      }

      if (toUpdate.length > 0) {
        await this.db
          .update(schema.transactions)
          .set({ categoryId, updatedAt: new Date() })
          .where(and(
            eq(schema.transactions.userId, userId),
            inArray(schema.transactions.id, toUpdate),
          ));
        this.logger.log(
          `Retroactively categorized ${toUpdate.length} transactions with pattern "${pattern}" → category ${categoryId}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Retroactive categorization failed: ${(err as Error).message}`);
    }
  }

  /**
   * Find the longest common prefix among an array of strings,
   * trimmed to a word boundary.
   *
   * @param strings - Array of lowercased description strings
   * @returns The common prefix or `null` if none exists
   */
  private findCommonPrefix(strings: string[]): string | null {
    if (strings.length === 0) return null;
    if (strings.length === 1) return strings[0];

    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (!strings[i].startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1);
      }
      if (prefix.length === 0) return null;
    }

    const lastSpace = prefix.lastIndexOf(' ');
    if (lastSpace > 0) prefix = prefix.slice(0, lastSpace);

    return prefix.trim() || null;
  }
}
