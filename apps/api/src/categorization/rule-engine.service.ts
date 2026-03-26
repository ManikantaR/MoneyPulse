import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { isNull, asc, eq, or, and } from 'drizzle-orm';

interface MatchedRule {
  ruleId: string;
  categoryId: string;
  confidence: number;
  isAiGenerated: boolean;
}

/**
 * Pattern-based rule engine for categorizing transactions.
 * Matches transaction descriptions/merchant names against stored rules
 * (global + user-specific) ordered by priority (lower = higher).
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);
  private readonly regexCache = new Map<string, RegExp>();

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Match a single transaction against all active rules (priority-ordered, first match wins).
   *
   * @param description - Transaction description (will be lowercased internally)
   * @param merchantName - Merchant name (lowercased, optional)
   * @param userId - Owner user ID (global rules + user-specific rules are evaluated)
   * @returns The first matched rule or `null` if no rule matches
   */
  async matchTransaction(
    description: string,
    merchantName: string | null,
    userId: string,
  ): Promise<MatchedRule | null> {
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          isNull(schema.categorizationRules.deletedAt),
          or(
            isNull(schema.categorizationRules.userId),
            eq(schema.categorizationRules.userId, userId),
          ),
        ),
      )
      .orderBy(asc(schema.categorizationRules.priority));

    for (const rule of rules) {
      const fieldValue =
        rule.field === 'merchant'
          ? (merchantName || '').toLowerCase()
          : description.toLowerCase();

      if (this.matchRule(fieldValue, rule.pattern, rule.matchType)) {
        return {
          ruleId: rule.id,
          categoryId: rule.categoryId,
          confidence: rule.confidence ?? 1.0,
          isAiGenerated: rule.isAiGenerated ?? false,
        };
      }
    }

    return null;
  }

  /**
   * Match a batch of transactions against all active rules.
   * Returns a map of transaction index → matched rule (only entries that matched).
   *
   * @param transactions - Array of transactions with description and merchantName
   * @param userId - Owner user ID for filtering applicable rules
   * @returns Map of index → matched rule for transactions that had a match
   */
  async matchBatch(
    transactions: Array<{ description: string; merchantName: string | null }>,
    userId: string,
  ): Promise<Map<number, MatchedRule>> {
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          isNull(schema.categorizationRules.deletedAt),
          or(
            isNull(schema.categorizationRules.userId),
            eq(schema.categorizationRules.userId, userId),
          ),
        ),
      )
      .orderBy(asc(schema.categorizationRules.priority));

    const results = new Map<number, MatchedRule>();

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      for (const rule of rules) {
        const fieldValue =
          rule.field === 'merchant'
            ? (txn.merchantName || '').toLowerCase()
            : txn.description.toLowerCase();

        if (this.matchRule(fieldValue, rule.pattern, rule.matchType)) {
          results.set(i, {
            ruleId: rule.id,
            categoryId: rule.categoryId,
            confidence: rule.confidence ?? 1.0,
            isAiGenerated: rule.isAiGenerated ?? false,
          });
          break;
        }
      }
    }

    return results;
  }

  /**
   * Test whether a field value matches a rule pattern using the specified match type.
   *
   * @param fieldValue - The lowercased field value to test
   * @param pattern - The rule pattern string
   * @param matchType - One of 'contains', 'starts_with', 'exact', 'regex'
   * @returns `true` if the field value matches the pattern
   */
  private matchRule(
    fieldValue: string,
    pattern: string,
    matchType: string,
  ): boolean {
    const lowerPattern = pattern.toLowerCase();

    switch (matchType) {
      case 'contains':
        return fieldValue.includes(lowerPattern);
      case 'starts_with':
        return fieldValue.startsWith(lowerPattern);
      case 'exact':
        return fieldValue === lowerPattern;
      case 'regex':
        try {
          let compiled = this.regexCache.get(pattern);
          if (!compiled) {
            compiled = new RegExp(pattern, 'i');
            this.regexCache.set(pattern, compiled);
          }
          return compiled.test(fieldValue);
        } catch {
          this.logger.warn(`Invalid regex pattern: ${pattern}`);
          return false;
        }
      default:
        return false;
    }
  }
}
