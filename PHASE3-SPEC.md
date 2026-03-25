# Phase 3: AI-Powered Categorization — Implementation Spec

**Dependencies**: Phase 2 (transactions, accounts, ingestion pipeline)

## Decisions Summary

| # | Decision | Choice |
|---|----------|--------|
| 1 | Seed rules | 60+ merchant→category mappings (researched) |
| 2 | Ollama batch size | 20 (configurable via `OLLAMA_BATCH_SIZE` env) |
| 3 | Ollama model | `llama3.2:3b` (classification-optimized, ~2GB RAM) |
| 4 | Auto-rule confidence | ≥ 0.85 → auto-assign + create rule |
| 5 | Cloud AI | PII-stripped, user opt-in (default OFF) |
| 6 | Category depth | Unlimited (recursive CTE) |
| 7 | Learning loop | User override → auto-create categorization rule |

---

## File Inventory

### Backend (apps/api/)

| # | File | Purpose |
|---|------|---------|
| 1 | `src/categorization/categorization.module.ts` | Module wiring |
| 2 | `src/categorization/rule-engine.service.ts` | Pattern-matching rule engine |
| 3 | `src/categorization/ai-categorizer.service.ts` | Ollama + cloud AI integration |
| 4 | `src/categorization/pii-sanitizer.ts` | Strip PII before cloud AI calls |
| 5 | `src/categorization/learning.service.ts` | Auto-rule creation from overrides |
| 6 | `src/categorization/categorization.service.ts` | Orchestration: rules → AI → user review |
| 7 | `src/categories/categories.module.ts` | Category module |
| 8 | `src/categories/categories.service.ts` | Category tree CRUD |
| 9 | `src/categories/categories.controller.ts` | Category REST endpoints |
| 10 | `src/categories/rules.controller.ts` | Categorization rules REST endpoints |

### Shared Package

| # | File | Purpose |
|---|------|---------|
| 11 | `packages/shared/src/constants/seed-rules.ts` | 60+ default merchant→category rules |

### Tests

| # | File | Purpose |
|---|------|---------|
| 12 | `apps/api/src/categorization/__tests__/rule-engine.service.spec.ts` | Rule engine unit tests |
| 13 | `apps/api/src/categorization/__tests__/pii-sanitizer.spec.ts` | PII stripping tests |
| 14 | `apps/api/src/categorization/__tests__/learning.service.spec.ts` | Learning loop tests |
| 15 | `apps/api/src/categories/__tests__/categories.service.spec.ts` | Category tree tests |

---

## New Dependencies

```bash
cd apps/api && pnpm add node-fetch@3
# node-fetch for Ollama HTTP calls (or use native fetch in Node 22)
# Actually Node 22 has native fetch — no new deps needed for Ollama
```

No new dependencies required — Node 22 has native `fetch`.

---

## 1. Seed Rules (60+ Merchant→Category Mappings)

### `packages/shared/src/constants/seed-rules.ts`

```typescript
/**
 * Default merchant-to-category rules.
 * Pattern matches against transaction description (case-insensitive).
 * Organized by category for readability.
 *
 * match_type: 'contains' | 'starts_with' | 'exact' | 'regex'
 * field: 'description' | 'merchant_name'
 */
export interface SeedRule {
  pattern: string;
  matchType: 'contains' | 'starts_with' | 'exact' | 'regex';
  field: 'description' | 'merchant_name';
  categoryName: string;   // resolved to category_id at seed time
  priority: number;       // lower = higher priority
}

export const SEED_RULES: SeedRule[] = [
  // ── Income ─────────────────────────────────────────────────
  { pattern: 'payroll', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'direct dep', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'salary', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'interest paid', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'dividend', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },

  // ── Groceries ──────────────────────────────────────────────
  { pattern: 'whole foods', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'trader joe', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'kroger', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'safeway', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'publix', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'aldi', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'costco', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'walmart', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 25 },
  { pattern: 'h-e-b', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'wegmans', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'sprouts', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'food lion', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },

  // ── Dining ─────────────────────────────────────────────────
  { pattern: 'starbucks', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'chipotle', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'mcdonald', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'uber eats', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'doordash', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'grubhub', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'panera', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'chick-fil-a', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'subway', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'dominos', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'pizza hut', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'taco bell', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'wendys', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'dunkin', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'panda express', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'five guys', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },

  // ── Gas/Auto ───────────────────────────────────────────────
  { pattern: 'shell oil', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'exxon', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'chevron', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'bp ', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'marathon petro', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'sunoco', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'speedway', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'autozone', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'jiffy lube', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },

  // ── Shopping ───────────────────────────────────────────────
  { pattern: 'amazon', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 25 },
  { pattern: 'target', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 25 },
  { pattern: 'best buy', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'home depot', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'lowes', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'ikea', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'etsy', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'ebay', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },

  // ── Travel ─────────────────────────────────────────────────
  { pattern: 'delta air', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'united air', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'american air', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'southwest', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'marriott', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'hilton', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'airbnb', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'uber trip', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'lyft', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },

  // ── Entertainment ──────────────────────────────────────────
  { pattern: 'amc theater', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },
  { pattern: 'regal cinema', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },
  { pattern: 'ticketmaster', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },
  { pattern: 'stubhub', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },

  // ── Subscriptions ──────────────────────────────────────────
  { pattern: 'netflix', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'spotify', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'hulu', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'disney+', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'apple.com/bill', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'amazon prime', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 15 },
  { pattern: 'youtube premium', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'hbo max', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'max.com', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'paramount+', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'chatgpt', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },

  // ── Utilities ──────────────────────────────────────────────
  { pattern: 'at&t', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'verizon', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 't-mobile', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'comcast', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'xfinity', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'duke energy', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'water utility', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'electric', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 30 },

  // ── Healthcare ─────────────────────────────────────────────
  { pattern: 'cvs', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },
  { pattern: 'walgreens', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },
  { pattern: 'pharmacy', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 25 },
  { pattern: 'medical', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 25 },
  { pattern: 'dental', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 25 },
  { pattern: 'kaiser', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },

  // ── Housing ────────────────────────────────────────────────
  { pattern: 'mortgage', matchType: 'contains', field: 'description', categoryName: 'Housing', priority: 20 },
  { pattern: 'rent payment', matchType: 'contains', field: 'description', categoryName: 'Housing', priority: 20 },
  { pattern: 'hoa', matchType: 'contains', field: 'description', categoryName: 'Housing', priority: 25 },

  // ── Insurance ──────────────────────────────────────────────
  { pattern: 'geico', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'state farm', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'allstate', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'progressive', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'insurance', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 30 },

  // ── Transfers (low priority — generic) ─────────────────────
  { pattern: 'transfer', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 50 },
  { pattern: 'zelle', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'venmo', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'cash app', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'paypal', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
];
```

---

## 2. Rule Engine Service

### `src/categorization/rule-engine.service.ts`

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';

interface MatchedRule {
  ruleId: string;
  categoryId: string;
  confidence: number;
  isAiGenerated: boolean;
}

@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Match a transaction against all active rules (priority-ordered, first match wins).
   *
   * @param description - Transaction description (lowercased)
   * @param merchantName - Merchant name (lowercased, optional)
   * @param userId - Owner user ID (rules are per-user + global)
   * @returns Matched rule or null
   */
  async matchTransaction(
    description: string,
    merchantName: string | null,
    userId: string,
  ): Promise<MatchedRule | null> {
    // Fetch all active rules ordered by priority (lower = first)
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          // Global rules (userId IS NULL) + user-specific rules
          // We fetch all and filter in app for simplicity
          isNull(schema.categorizationRules.deletedAt),
        ),
      )
      .orderBy(asc(schema.categorizationRules.priority));

    // Filter to global + this user's rules
    const applicableRules = rules.filter(
      (r: any) => r.userId === null || r.userId === userId,
    );

    for (const rule of applicableRules) {
      const fieldValue = rule.field === 'merchant_name'
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
   * Match a batch of transactions. Returns a map of index → matched rule.
   */
  async matchBatch(
    transactions: Array<{ description: string; merchantName: string | null }>,
    userId: string,
  ): Promise<Map<number, MatchedRule>> {
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(isNull(schema.categorizationRules.deletedAt))
      .orderBy(asc(schema.categorizationRules.priority));

    const applicableRules = rules.filter(
      (r: any) => r.userId === null || r.userId === userId,
    );

    const results = new Map<number, MatchedRule>();

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      for (const rule of applicableRules) {
        const fieldValue = rule.field === 'merchant_name'
          ? (txn.merchantName || '').toLowerCase()
          : txn.description.toLowerCase();

        if (this.matchRule(fieldValue, rule.pattern, rule.matchType)) {
          results.set(i, {
            ruleId: rule.id,
            categoryId: rule.categoryId,
            confidence: rule.confidence ?? 1.0,
            isAiGenerated: rule.isAiGenerated ?? false,
          });
          break; // first match wins
        }
      }
    }

    return results;
  }

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
          return new RegExp(pattern, 'i').test(fieldValue);
        } catch {
          this.logger.warn(`Invalid regex pattern: ${pattern}`);
          return false;
        }
      default:
        return false;
    }
  }
}
```

---

## 3. PII Sanitizer

### `src/categorization/pii-sanitizer.ts`

```typescript
/**
 * PII Sanitizer — strips personally identifiable information before cloud AI calls.
 *
 * Patterns detected and replaced:
 * - Account numbers (8-18 digits)
 * - Routing numbers (9 digits)
 * - SSNs (XXX-XX-XXXX)
 * - Credit card numbers (13-19 digits, possibly spaced/dashed)
 * - Email addresses
 * - Phone numbers
 * - Common name patterns followed by identifiers
 */

const PII_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // SSN: 123-45-6789
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },

  // Credit card: 4 groups of 4 digits
  { regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CARD]' },

  // Account numbers: 8-18 consecutive digits
  { regex: /\b\d{8,18}\b/g, replacement: '[ACCT]' },

  // Routing number: exactly 9 digits (common US format)
  { regex: /\b\d{9}\b/g, replacement: '[ROUTING]' },

  // Email
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' },

  // US Phone: (123) 456-7890 or 123-456-7890
  { regex: /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, replacement: '[PHONE]' },
];

export interface SanitizedTransaction {
  date: string;
  description: string;      // sanitized
  amountCents: number;
  isCredit: boolean;
  merchantName: string | null;  // sanitized
}

/**
 * Sanitize a single description string.
 */
export function sanitizeText(text: string): string {
  let result = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

/**
 * Sanitize a transaction for cloud AI.
 * Strips PII from description and merchant name.
 * Only sends: date, sanitized description, amount, isCredit, sanitized merchant.
 */
export function sanitizeForCloudAI(txn: {
  date: string;
  description: string;
  amountCents: number;
  isCredit: boolean;
  merchantName: string | null;
}): SanitizedTransaction {
  return {
    date: txn.date,
    description: sanitizeText(txn.description),
    amountCents: txn.amountCents,
    isCredit: txn.isCredit,
    merchantName: txn.merchantName ? sanitizeText(txn.merchantName) : null,
  };
}
```

---

## 4. AI Categorizer Service

### `src/categorization/ai-categorizer.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeForCloudAI } from './pii-sanitizer';

interface AiCategorizationResult {
  categoryName: string;
  confidence: number;
  merchantName: string | null;
}

interface AiBatchResult {
  results: Array<AiCategorizationResult | null>;
}

@Injectable()
export class AiCategorizerService {
  private readonly logger = new Logger(AiCategorizerService.name);
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly batchSize: number;

  constructor(private readonly config: ConfigService) {
    this.ollamaUrl = this.config.get<string>('OLLAMA_URL') || 'http://localhost:11434';
    this.ollamaModel = this.config.get<string>('OLLAMA_MODEL') || 'llama3.2:3b';
    this.batchSize = parseInt(this.config.get<string>('OLLAMA_BATCH_SIZE') || '20', 10);
  }

  /**
   * Categorize a batch of uncategorized transactions using Ollama (local).
   *
   * @param transactions - Array of { description, amountCents, isCredit, date }
   * @param categories - Available category names
   * @returns Array of categorization results (null if Ollama can't determine)
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

    // Process in configured batch size
    for (let i = 0; i < transactions.length; i += this.batchSize) {
      const batch = transactions.slice(i, i + this.batchSize);
      const batchResults = await this.processBatch(batch, categories);
      results.push(...batchResults);
    }

    return results;
  }

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
            temperature: 0.1,      // Low temperature for deterministic classification
            num_predict: 2000,     // Enough for batch JSON response
          },
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Ollama request failed: ${response.status}`);
        return batch.map(() => null);
      }

      const data = await response.json() as { response: string };
      return this.parseResponse(data.response, batch.length);
    } catch (err: any) {
      this.logger.error(`Ollama error: ${err.message}`);
      return batch.map(() => null);
    }
  }

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

  private parseResponse(
    responseText: string,
    expectedCount: number,
  ): Array<AiCategorizationResult | null> {
    try {
      // Extract JSON array from response (may have surrounding text)
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

      // Map back to expected order
      const results: Array<AiCategorizationResult | null> = Array(expectedCount).fill(null);
      for (const item of parsed) {
        const idx = item.index - 1; // 1-based to 0-based
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
   * Placeholder — implement when cloud provider chosen.
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
    // Sanitize PII before sending to cloud
    const sanitized = transactions.map(sanitizeForCloudAI);

    this.logger.log(`Cloud AI categorization for ${sanitized.length} transactions`);
    // TODO: Implement cloud AI call (OpenAI/Anthropic) when provider chosen
    // For now, return nulls
    return sanitized.map(() => null);
  }
}
```

---

## 5. Learning Service

### `src/categorization/learning.service.ts`

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * When a user manually overrides a transaction's category,
   * auto-create a categorization rule from the merchant/description pattern.
   *
   * Logic:
   * 1. Extract dominant keyword from description (first 2-3 significant words)
   * 2. Check if a similar rule already exists (avoid duplicates)
   * 3. Create rule with 'contains' match, medium priority
   */
  async learnFromOverride(
    userId: string,
    transactionId: string,
    newCategoryId: string,
  ): Promise<void> {
    // Fetch the transaction
    const [txn] = await this.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, transactionId))
      .limit(1);

    if (!txn) return;

    const pattern = this.extractPattern(txn.description);
    if (!pattern || pattern.length < 3) return; // Too short to be useful

    // Check if a rule with this pattern already exists for this user
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
      // Update existing rule's category if it changed
      if (existingRules[0].categoryId !== newCategoryId) {
        await this.db
          .update(schema.categorizationRules)
          .set({ categoryId: newCategoryId, updatedAt: new Date() })
          .where(eq(schema.categorizationRules.id, existingRules[0].id));
        this.logger.log(`Updated rule: "${pattern}" → category ${newCategoryId}`);
      }
      return;
    }

    // Create new rule
    await this.db
      .insert(schema.categorizationRules)
      .values({
        userId,
        pattern,
        matchType: 'contains',
        field: 'description',
        categoryId: newCategoryId,
        priority: 40, // Medium priority — user-created overrides are important but below manual-specific
        isAiGenerated: false,
        confidence: 1.0,
      });

    this.logger.log(`Created rule: "${pattern}" → category ${newCategoryId}`);
  }

  /**
   * Learn from bulk categorization — find common prefix among descriptions.
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

    // Find common prefix among descriptions
    const descriptions = txns
      .map((t: any) => t.description.toLowerCase().trim())
      .filter(Boolean);

    const commonPrefix = this.findCommonPrefix(descriptions);
    if (commonPrefix && commonPrefix.length >= 4) {
      // Check for existing rule
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
        await this.db
          .insert(schema.categorizationRules)
          .values({
            userId,
            pattern: commonPrefix,
            matchType: 'starts_with',
            field: 'description',
            categoryId,
            priority: 35,
            isAiGenerated: false,
            confidence: 1.0,
          });
        this.logger.log(`Created bulk rule: starts_with "${commonPrefix}" → category ${categoryId}`);
      }
    }
  }

  /**
   * Extract the most significant pattern from a description.
   * Removes common suffixes like store numbers, reference codes.
   *
   * "WHOLE FOODS MARKET #10234" → "whole foods market"
   * "STARBUCKS STORE 12345"     → "starbucks"
   * "AMAZON.COM*M44KL2"         → "amazon.com"
   */
  extractPattern(description: string): string {
    let cleaned = description.toLowerCase().trim();

    // Remove common suffixes: store numbers, reference codes
    cleaned = cleaned
      .replace(/\s*#\d+/g, '')           // #12345
      .replace(/\s*\*\w+/g, '')          // *M44KL2
      .replace(/\s+\d{4,}$/g, '')        // trailing long numbers
      .replace(/\s+store\s*\d*/gi, '')   // "STORE 123"
      .replace(/\s+\d{2,}$/g, '')        // trailing 2+ digit numbers
      .trim();

    // Take first 3 significant words
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length > 3) {
      return words.slice(0, 3).join(' ');
    }

    return cleaned;
  }

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

    // Trim to word boundary
    const lastSpace = prefix.lastIndexOf(' ');
    if (lastSpace > 0) prefix = prefix.slice(0, lastSpace);

    return prefix.trim() || null;
  }
}
```

---

## 6. Categorization Service (Orchestrator)

### `src/categorization/categorization.service.ts`

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
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
   * Categorize a batch of newly imported transactions.
   * Called by the ingestion processor after insert.
   *
   * Flow:
   * 1. Rule engine (pattern match) — fast, first-match wins
   * 2. Ollama (local AI) — for remaining uncategorized
   * 3. Cloud AI (if user enabled) — for still uncategorized
   * 4. Mark remaining as uncategorized
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

    // Fetch transactions
    const transactions = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.categoryId),
          isNull(schema.transactions.deletedAt),
        ),
      );

    const uncategorized = transactions.filter(
      (t: any) => transactionIds.includes(t.id) && !t.categoryId,
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

    for (let i = 0; i < uncategorized.length; i++) {
      const match = ruleMatches.get(i);
      if (match) {
        await this.db
          .update(schema.transactions)
          .set({
            categoryId: match.categoryId,
            updatedAt: new Date(),
          })
          .where(eq(schema.transactions.id, uncategorized[i].id));
        stats.categorizedByRule++;
      } else {
        stillUncategorized.push(uncategorized[i]);
      }
    }

    if (stillUncategorized.length === 0) return stats;

    // ── Step 2: Ollama (Local AI) ──
    try {
      const categories = await this.getActiveCategoryNames();
      const aiResults = await this.aiCategorizer.categorizeBatch(
        stillUncategorized.map((t: any) => ({
          date: t.date?.toISOString?.()?.split('T')[0] ?? t.date,
          description: t.description,
          amountCents: t.amountCents,
          isCredit: t.isCredit,
          merchantName: t.merchantName,
        })),
        categories,
      );

      const remainingAfterAi: any[] = [];

      for (let i = 0; i < stillUncategorized.length; i++) {
        const result = aiResults[i];
        if (result && result.confidence >= this.AI_AUTO_THRESHOLD) {
          // Auto-assign + create rule
          const categoryId = await this.resolveCategoryName(result.categoryName);
          if (categoryId) {
            await this.db
              .update(schema.transactions)
              .set({
                categoryId,
                merchantName: result.merchantName || stillUncategorized[i].merchantName,
                updatedAt: new Date(),
              })
              .where(eq(schema.transactions.id, stillUncategorized[i].id));

            // Create AI-generated rule
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
          // Low confidence — mark as suggested (category stored but flagged)
          const categoryId = await this.resolveCategoryName(result.categoryName);
          if (categoryId) {
            // Store suggested category in a way the UI can show
            await this.db
              .update(schema.transactions)
              .set({
                categoryId,
                // NOTE: In future, add a 'suggested' boolean column
                // For now, just assign with low confidence — user can override
                updatedAt: new Date(),
              })
              .where(eq(schema.transactions.id, stillUncategorized[i].id));
            stats.suggested++;
          } else {
            remainingAfterAi.push(stillUncategorized[i]);
          }
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
   * Recategorize a single transaction (user override) + learn.
   */
  async recategorize(
    transactionId: string,
    userId: string,
    newCategoryId: string,
  ): Promise<void> {
    await this.db
      .update(schema.transactions)
      .set({ categoryId: newCategoryId, updatedAt: new Date() })
      .where(eq(schema.transactions.id, transactionId));

    // Learn from override
    await this.learningService.learnFromOverride(userId, transactionId, newCategoryId);
  }

  private async getActiveCategoryNames(): Promise<string[]> {
    const categories = await this.db
      .select({ name: schema.categories.name })
      .from(schema.categories);
    return categories.map((c: any) => c.name);
  }

  private async resolveCategoryName(name: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.name, name))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  private async createAiRule(
    userId: string,
    description: string,
    categoryId: string,
    confidence: number,
  ): Promise<void> {
    const pattern = this.learningService.extractPattern(description);
    if (!pattern || pattern.length < 3) return;

    // Check if rule already exists
    const existing = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          eq(schema.categorizationRules.pattern, pattern),
          isNull(schema.categorizationRules.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) return;

    await this.db
      .insert(schema.categorizationRules)
      .values({
        userId,
        pattern,
        matchType: 'contains',
        field: 'description',
        categoryId,
        priority: 45, // Lower priority than user-created rules
        isAiGenerated: true,
        confidence,
      });
  }
}
```

---

## 7. Category Service (Tree CRUD)

### `src/categories/categories.service.ts`

```typescript
import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, isNull, asc, sql } from 'drizzle-orm';
import type { CreateCategoryInput, UpdateCategoryInput } from '@moneypulse/shared';

@Injectable()
export class CategoriesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Get all categories as a flat list (excludes soft-deleted).
   */
  async findAll() {
    return this.db
      .select()
      .from(schema.categories)
      .where(isNull(schema.categories.deletedAt))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  }

  /**
   * Get category tree as nested structure (recursive CTE).
   */
  async findTree() {
    const rows = await this.db.execute(sql`
      WITH RECURSIVE cat_tree AS (
        SELECT id, name, icon, color, parent_id, sort_order, 0 AS depth
        FROM ${schema.categories}
        WHERE parent_id IS NULL AND deleted_at IS NULL
        UNION ALL
        SELECT c.id, c.name, c.icon, c.color, c.parent_id, c.sort_order, ct.depth + 1
        FROM ${schema.categories} c
        JOIN cat_tree ct ON c.parent_id = ct.id
        WHERE c.deleted_at IS NULL
      )
      SELECT * FROM cat_tree
      ORDER BY depth, sort_order, name
    `);
    return rows.rows ?? rows;
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: CreateCategoryInput) {
    if (input.parentId) {
      const parent = await this.findById(input.parentId);
      if (!parent) throw new NotFoundException('Parent category not found');
    }

    const rows = await this.db
      .insert(schema.categories)
      .values({
        name: input.name,
        icon: input.icon,
        color: input.color,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return rows[0];
  }

  async update(id: string, input: UpdateCategoryInput) {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Category not found');

    // Prevent setting self as parent
    if (input.parentId === id) {
      throw new ConflictException('Category cannot be its own parent');
    }

    // Prevent circular parent reference
    if (input.parentId) {
      const descendants = await this.getDescendantIds(id);
      if (descendants.includes(input.parentId)) {
        throw new BadRequestException('Cannot set parent to a descendant');
      }
    }

    const rows = await this.db
      .update(schema.categories)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.categories.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Soft-delete a category and all its descendants.
   */
  async softDelete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException('Category not found');

    await this.db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM ${schema.categories} WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM ${schema.categories} c
        JOIN descendants d ON c.parent_id = d.id
      )
      UPDATE ${schema.categories}
      SET deleted_at = NOW()
      WHERE id IN (SELECT id FROM descendants)
    `);
  }

  /**
   * Reorder categories within the same parent.
   */
  async reorder(items: { id: string; sortOrder: number }[]) {
    for (const item of items) {
      await this.db
        .update(schema.categories)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(eq(schema.categories.id, item.id));
    }
  }

  /**
   * Get all descendants of a category (recursive CTE).
   */
  async getDescendantIds(categoryId: string): Promise<string[]> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM categories WHERE parent_id = ${categoryId}
        UNION ALL
        SELECT c.id FROM categories c
        INNER JOIN descendants d ON c.parent_id = d.id
      )
      SELECT id FROM descendants
    `);
    return result.rows.map((r: any) => r.id);
  }
}
```

### `src/categories/categories.controller.ts`

```typescript
import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createCategorySchema, updateCategorySchema } from '@moneypulse/shared';
import type { CreateCategoryInput, UpdateCategoryInput } from '@moneypulse/shared';

@ApiTags('Categories')
@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all categories (flat list)' })
  async findAll() {
    const data = await this.categoriesService.findAll();
    return { data };
  }

  @Get('tree')
  @ApiOperation({ summary: 'Get categories as tree (recursive CTE)' })
  async findTree() {
    const data = await this.categoriesService.findTree();
    return { data };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create category' })
  async create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
  ) {
    const category = await this.categoriesService.create(body);
    return { data: category };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update category' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    const category = await this.categoriesService.update(id, body);
    return { data: category };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete category (+ descendants)' })
  async remove(@Param('id') id: string) {
    await this.categoriesService.softDelete(id);
    return { data: { deleted: true } };
  }

  @Post('reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reorder categories' })
  async reorder(@Body() body: { items: { id: string; sortOrder: number }[] }) {
    await this.categoriesService.reorder(body.items);
    return { data: { reordered: true } };
  }

  @Get(':id/descendants')
  @ApiOperation({ summary: 'Get all descendant category IDs (recursive)' })
  async descendants(@Param('id') id: string) {
    const ids = await this.categoriesService.getDescendantIds(id);
    return { data: ids };
  }
}
```

### `src/categories/rules.controller.ts`

```typescript
import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, asc } from 'drizzle-orm';
import type { AuthTokenPayload } from '@moneypulse/shared';

@ApiTags('Categorization Rules')
@Controller('categorization-rules')
@UseGuards(JwtAuthGuard)
export class RulesController {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  @Get()
  @ApiOperation({ summary: 'List all categorization rules' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const rules = await this.db
      .select()
      .from(schema.categorizationRules)
      .where(
        and(
          isNull(schema.categorizationRules.deletedAt),
          // Show global + user's rules
        ),
      )
      .orderBy(asc(schema.categorizationRules.priority));
    return { data: rules };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create categorization rule' })
  async create(
    @Body() body: {
      pattern: string;
      matchType: string;
      field: string;
      categoryId: string;
      priority?: number;
    },
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const rows = await this.db
      .insert(schema.categorizationRules)
      .values({
        userId: user.sub,
        pattern: body.pattern,
        matchType: body.matchType,
        field: body.field,
        categoryId: body.categoryId,
        priority: body.priority ?? 30,
        isAiGenerated: false,
        confidence: 1.0,
      })
      .returning();
    return { data: rows[0] };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update rule' })
  async update(@Param('id') id: string, @Body() body: any) {
    const rows = await this.db
      .update(schema.categorizationRules)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.categorizationRules.id, id))
      .returning();
    return { data: rows[0] };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete rule' })
  async remove(@Param('id') id: string) {
    await this.db
      .update(schema.categorizationRules)
      .set({ deletedAt: new Date() })
      .where(eq(schema.categorizationRules.id, id));
    return { data: { deleted: true } };
  }
}
```

---

## 8. Modules

### `src/categories/categories.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { RulesController } from './rules.controller';

@Module({
  controllers: [CategoriesController, RulesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
```

### `src/categorization/categorization.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { AiCategorizerService } from './ai-categorizer.service';
import { LearningService } from './learning.service';
import { CategorizationService } from './categorization.service';

@Module({
  providers: [
    RuleEngineService,
    AiCategorizerService,
    LearningService,
    CategorizationService,
  ],
  exports: [CategorizationService, RuleEngineService, LearningService],
})
export class CategorizationModule {}
```

### `src/app.module.ts` — MODIFY: Add imports

```typescript
import { CategoriesModule } from './categories/categories.module';
import { CategorizationModule } from './categorization/categorization.module';

// In imports array, add:
CategoriesModule,
CategorizationModule,
```

---

## 9. Integration with Ingestion Pipeline

### Modify `src/jobs/ingestion.processor.ts` — ADD categorization step

After inserting transactions, add:

```typescript
// After: await this.insertTransactions(...)

// Categorize new transactions
if (dedupResult.newTransactions.length > 0) {
  try {
    const insertedIds = await this.getInsertedTransactionIds(accountId, uploadId);
    const categorizationStats = await this.categorizationService.categorizeBatch(
      insertedIds,
      userId,
    );
    this.logger.log(
      `Categorization: ${categorizationStats.categorizedByRule} by rules, ` +
      `${categorizationStats.categorizedByAi} by AI, ` +
      `${categorizationStats.uncategorized} uncategorized`,
    );
  } catch (err: any) {
    this.logger.warn(`Categorization failed (transactions still imported): ${err.message}`);
  }
}
```

Add helper method:

```typescript
private async getInsertedTransactionIds(accountId: string, sourceFileId: string): Promise<string[]> {
  const rows = await this.db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.accountId, accountId),
        eq(schema.transactions.sourceFileId, sourceFileId),
      ),
    );
  return rows.map((r: any) => r.id);
}
```

---

## 10. Seed Rules Migration

### `db/seeds/seed-rules.ts`

```typescript
import { SEED_RULES } from '@moneypulse/shared';

/**
 * Seed default categorization rules.
 * Run after initial migration that creates categories.
 *
 * Usage: npx tsx db/seeds/seed-rules.ts
 */
export async function seedRules(db: any, schema: any) {
  // Get category name → id map
  const categories = await db.select().from(schema.categories);
  const categoryMap = new Map(categories.map((c: any) => [c.name, c.id]));

  const rulesToInsert = SEED_RULES
    .filter((rule) => categoryMap.has(rule.categoryName))
    .map((rule) => ({
      userId: null, // Global rules
      pattern: rule.pattern,
      matchType: rule.matchType,
      field: rule.field,
      categoryId: categoryMap.get(rule.categoryName),
      priority: rule.priority,
      isAiGenerated: false,
      confidence: 1.0,
    }));

  if (rulesToInsert.length > 0) {
    await db.insert(schema.categorizationRules).values(rulesToInsert);
  }

  console.log(`Seeded ${rulesToInsert.length} categorization rules`);
}
```

---

## 11. Unit Tests

### `apps/api/src/categorization/__tests__/rule-engine.service.spec.ts`

```typescript
import { RuleEngineService } from '../rule-engine.service';

describe('RuleEngineService', () => {
  let service: RuleEngineService;
  let mockDb: any;

  const mockRules = [
    { id: '1', userId: null, pattern: 'starbucks', matchType: 'contains', field: 'description', categoryId: 'cat-dining', priority: 20, confidence: 1.0, isAiGenerated: false, deletedAt: null },
    { id: '2', userId: null, pattern: 'amazon', matchType: 'contains', field: 'description', categoryId: 'cat-shopping', priority: 25, confidence: 1.0, isAiGenerated: false, deletedAt: null },
    { id: '3', userId: 'user-1', pattern: 'whole foods', matchType: 'contains', field: 'description', categoryId: 'cat-grocery', priority: 20, confidence: 1.0, isAiGenerated: false, deletedAt: null },
    { id: '4', userId: null, pattern: '^payroll', matchType: 'regex', field: 'description', categoryId: 'cat-income', priority: 10, confidence: 1.0, isAiGenerated: false, deletedAt: null },
  ];

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(mockRules),
    };
    service = new RuleEngineService(mockDb);
    (service as any).db = mockDb;
  });

  it('should match "contains" rule', async () => {
    const result = await service.matchTransaction('starbucks store 12345', null, 'user-1');
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-dining');
  });

  it('should match regex rule', async () => {
    const result = await service.matchTransaction('payroll direct deposit', null, 'user-1');
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-income');
  });

  it('should respect priority (lower number = higher priority)', async () => {
    // "payroll" (priority 10) should match before "starbucks" (priority 20)
    const result = await service.matchTransaction('payroll at starbucks', null, 'user-1');
    expect(result!.categoryId).toBe('cat-income');
  });

  it('should return null for no match', async () => {
    const result = await service.matchTransaction('xyz unknown merchant', null, 'user-1');
    expect(result).toBeNull();
  });

  it('should include user-specific rules', async () => {
    const result = await service.matchTransaction('whole foods market', null, 'user-1');
    expect(result).not.toBeNull();
    expect(result!.categoryId).toBe('cat-grocery');
  });
});
```

### `apps/api/src/categorization/__tests__/pii-sanitizer.spec.ts`

```typescript
import { sanitizeText, sanitizeForCloudAI } from '../pii-sanitizer';

describe('PII Sanitizer', () => {
  it('should strip SSN', () => {
    expect(sanitizeText('REF 123-45-6789 PAYMENT')).toBe('REF [SSN] PAYMENT');
  });

  it('should strip credit card numbers', () => {
    expect(sanitizeText('CARD 4111 1111 1111 1111')).toBe('CARD [CARD]');
    expect(sanitizeText('CARD 4111-1111-1111-1111')).toBe('CARD [CARD]');
  });

  it('should strip email addresses', () => {
    expect(sanitizeText('FROM user@example.com')).toBe('FROM [EMAIL]');
  });

  it('should strip phone numbers', () => {
    expect(sanitizeText('CALL (555) 123-4567')).toBe('CALL [PHONE]');
    expect(sanitizeText('CALL 555-123-4567')).toBe('CALL [PHONE]');
  });

  it('should strip long account numbers', () => {
    expect(sanitizeText('ACCT 123456789012')).toBe('ACCT [ACCT]');
  });

  it('should not strip short numbers (amounts, store numbers)', () => {
    expect(sanitizeText('STARBUCKS STORE 12345 $5.75')).toBe('STARBUCKS STORE 12345 $5.75');
  });

  it('should sanitize transaction for cloud AI', () => {
    const result = sanitizeForCloudAI({
      date: '2026-03-15',
      description: 'PAYMENT FROM 123-45-6789',
      amountCents: 5000,
      isCredit: true,
      merchantName: 'ACCT 1234567890123',
    });
    expect(result.description).toBe('PAYMENT FROM [SSN]');
    expect(result.merchantName).toBe('ACCT [ACCT]');
    expect(result.amountCents).toBe(5000); // unchanged
  });
});
```

### `apps/api/src/categorization/__tests__/learning.service.spec.ts`

```typescript
import { LearningService } from '../learning.service';

describe('LearningService', () => {
  let service: LearningService;

  beforeEach(() => {
    service = new LearningService({} as any);
  });

  describe('extractPattern', () => {
    it('should remove store numbers', () => {
      expect(service.extractPattern('WHOLE FOODS MARKET #10234')).toBe('whole foods market');
    });

    it('should remove reference codes', () => {
      expect(service.extractPattern('AMAZON.COM*M44KL2')).toBe('amazon.com');
    });

    it('should remove trailing long numbers', () => {
      expect(service.extractPattern('STARBUCKS STORE 12345')).toBe('starbucks');
    });

    it('should limit to 3 words', () => {
      expect(service.extractPattern('VERY LONG MERCHANT NAME HERE TODAY')).toBe('very long merchant');
    });

    it('should handle simple descriptions', () => {
      expect(service.extractPattern('NETFLIX')).toBe('netflix');
    });
  });
});
```

---

## Implementation Order

```
Step 1:  Create seed-rules.ts in shared package
Step 2:  Create PII sanitizer + tests
Step 3:  Create rule engine service + tests
Step 4:  Create AI categorizer service
Step 5:  Create learning service + tests
Step 6:  Create categorization service (orchestrator)
Step 7:  Create categories service (tree CRUD) + tests
Step 8:  Create categories controller
Step 9:  Create rules controller
Step 10: Create categorization + categories modules
Step 11: Update app.module.ts — add modules
Step 12: Modify ingestion processor — add categorization step post-import
Step 13: Create seed-rules migration runner
Step 14: Run seed rules
Step 15: Build + verify API starts
Step 16: Run unit tests
Step 17: Manual test: upload CSV → verify rules categorize known merchants
Step 18: Manual test: Ollama categorizes unknown merchants (if Ollama available)
Step 19: Manual test: override category → verify rule auto-created
Step 20: Git commit
```

---

## API Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/categories` | JWT | List categories (flat) |
| `GET` | `/api/categories/tree` | JWT | Get category tree |
| `POST` | `/api/categories` | JWT | Create category |
| `PATCH` | `/api/categories/:id` | JWT | Update category |
| `DELETE` | `/api/categories/:id` | JWT | Delete category |
| `GET` | `/api/categories/:id/descendants` | JWT | Get descendant IDs |
| `GET` | `/api/categorization-rules` | JWT | List rules |
| `POST` | `/api/categorization-rules` | JWT | Create rule |
| `PATCH` | `/api/categorization-rules/:id` | JWT | Update rule |
| `DELETE` | `/api/categorization-rules/:id` | JWT | Soft delete rule |

---

## Categorization Flow Diagram

```
CSV Upload Complete (transactions inserted in DB)
        │
        ▼
╔═══════════════════════════════════════╗
║          CATEGORIZATION PIPELINE       ║
╠═══════════════════════════════════════╣
║                                        ║
║  1. Rule Engine (fast, pattern match)  ║
║     → 60+ seed rules + user rules      ║
║     → First match wins (priority order) ║
║     → Result: "Categorized"            ║
║                                        ║
║  2. Ollama (local AI, batch of 20)     ║
║     → Only uncategorized from step 1   ║
║     → confidence ≥ 0.85 → auto-assign  ║
║       + auto-create rule               ║
║     → confidence < 0.85 → "suggested"  ║
║                                        ║
║  3. Cloud AI (if enabled, PII-stripped) ║
║     → Only remaining uncategorized     ║
║     → Returns suggestions              ║
║                                        ║
║  4. Remaining → "Uncategorized"        ║
║     → User assigns in UI               ║
║     → Override auto-creates rule       ║
║                                        ║
╚═══════════════════════════════════════╝

User Override (in transaction grid):
  PATCH /api/transactions/:id { categoryId: "..." }
        │
        ▼
  Learning Service:
    1. Extract pattern from description
    2. Create/update categorization rule
    3. Future imports match automatically
```
