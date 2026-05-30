import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, eq, isNull, and } from 'drizzle-orm';

/**
 * Normalizes raw bank transaction merchant names into clean display names.
 *
 * Pipeline:
 *   1. User-defined aliases (merchant_aliases table) — highest priority
 *   2. Rule-based cleanup (strip prefixes, suffixes, city/state, card network junk)
 *   3. Title-case formatting
 *
 * Powers: recurring bill detection, anomaly alerts, receipt matching, subscription manager.
 */
@Injectable()
export class MerchantNormalizerService {
  private readonly logger = new Logger(MerchantNormalizerService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Normalize a single merchant name or transaction description.
   * Checks user aliases first, then applies rule-based cleanup.
   */
  async normalize(
    raw: string | null,
    description: string,
    userId?: string,
  ): Promise<string> {
    const input = (raw || description || '').trim();
    if (!input) return '';

    // 1. Check user-defined aliases
    if (userId) {
      const alias = await this.findAlias(input, userId);
      if (alias) return alias;
    }

    // 2. Check global aliases (userId IS NULL)
    const globalAlias = await this.findAlias(input);
    if (globalAlias) return globalAlias;

    // 3. Rule-based cleanup
    return this.ruleBasedNormalize(input);
  }

  /**
   * Synchronous rule-based normalization (no DB lookup).
   * Use this for bulk operations where alias lookup is done separately.
   */
  ruleBasedNormalize(raw: string): string {
    let name = raw.trim();

    // Strip common card network / POS prefixes
    const prefixes = [
      /^SQ \*/i,
      /^TST \*/i,
      /^SP \*/i,
      /^PAYPAL \*/i,
      /^VENMO \*/i,
      /^ZELLE \*/i,
      /^CASH APP\*/i,
      /^CKE\*/i,
      /^CHK\*/i,
      /^POS /i,
      /^PURCHASE /i,
      /^DEBIT CARD /i,
      /^ACH /i,
      /^RECURRING /i,
      /^AUTOPAY /i,
      /^ONLINE /i,
      /^INTERNET /i,
      /^CHECKCARD /i,
      /^HLU\*/i,            // Hulu prefix
      /^AMZN\*/i,           // Amazon prefix
      /^APPL\*/i,           // Apple prefix
      /^DES:\w+ /i,         // BoA DES: prefix (e.g., DES:PAYROLL)
      /^SAMPAY /i,          // Samsung Pay prefix
    ];
    for (const prefix of prefixes) {
      name = name.replace(prefix, '');
    }

    // Strip trailing location patterns (city, state, zip, country)
    // "WHOLE FOODS MARKET RICHMOND VA" → "WHOLE FOODS MARKET"
    // "TARGET T-1234 GLEN ALLEN VA 23060" → "TARGET"
    name = name
      // State abbreviation at end (2 uppercase letters)
      .replace(/\s+[A-Z]{2}\s*\d{0,5}\s*$/, '')
      // City + State at end
      .replace(/\s+(GLEN ALLEN|RICHMOND|MIDLOTHIAN|SHORT PUMP|MECHANICSVILLE|HENRICO)\s+[A-Z]{2}\s*$/i, '')
      // Generic city,state pattern: "CITY ST" or "CITY, ST"
      .replace(/,?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s+[A-Z]{2}\s*$/, '')
      // Country codes
      .replace(/\s+US\s*$/, '');

    // Strip store/location numbers
    // "TARGET T-1234" → "TARGET", "COSTCO WHSE #1234" → "COSTCO WHSE"
    name = name
      .replace(/\s+[T#]-?\d{3,}.*$/i, '')
      .replace(/\s+#\d+\s*$/i, '')
      .replace(/\s+STORE\s*#?\d+\s*$/i, '')
      .replace(/\s+WHSE\s*#?\d*\s*$/i, '');

    // Strip transaction reference IDs
    // "COSTAR GROUP DES:PAYROLL ID:38760..." → "COSTAR GROUP PAYROLL"
    name = name.replace(/\s+ID:\S+/gi, '');

    // Strip trailing URLs
    name = name.replace(/\s+\S+\.(com|net|org|io)(\/\S*)?\s*$/i, '');

    // Strip "CREDIT", "DEBIT", "PAYMENT" suffixes that are transaction types not merchant names
    name = name
      .replace(/\s+(CREDIT|DEBIT|PAYMENT|PURCHASE|WITHDRAWAL|DEPOSIT|REFUND)\s*$/i, '');

    // Collapse whitespace and trim
    name = name.replace(/\s+/g, ' ').trim();

    // Title case
    if (name === name.toUpperCase() && name.length > 2) {
      name = name
        .toLowerCase()
        .split(' ')
        .map((w) => {
          // Keep short words (a, an, the, of, etc.) lowercase unless first word
          if (w.length <= 2) return w;
          return w.charAt(0).toUpperCase() + w.slice(1);
        })
        .join(' ');
      // Always capitalize first character
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }

    // Known brand name corrections (post title-case)
    const brandFixes: Record<string, string> = {
      'costco': 'Costco',
      'walmart': 'Walmart',
      'amazon': 'Amazon',
      'target': 'Target',
      'netflix': 'Netflix',
      'spotify': 'Spotify',
      'hulu': 'Hulu',
      'apple': 'Apple',
      'google': 'Google',
      'uber': 'Uber',
      'lyft': 'Lyft',
      'starbucks': 'Starbucks',
      'dunkin': "Dunkin'",
      'chick-fil-a': 'Chick-fil-A',
      'mcdonalds': "McDonald's",
      "mcdonald's": "McDonald's",
      'chipotle': 'Chipotle',
      'whole foods': 'Whole Foods',
      'trader joe': "Trader Joe's",
      'aldi': 'ALDI',
      'costco whse': 'Costco',
      'aws': 'AWS',
      'amazon web services': 'AWS',
    };

    const lower = name.toLowerCase();
    for (const [key, brand] of Object.entries(brandFixes)) {
      if (lower === key || lower.startsWith(key + ' ')) {
        name = brand;
        break;
      }
    }

    return name || raw.trim();
  }

  /**
   * Look up a user or global alias for the given raw merchant string.
   */
  private async findAlias(
    raw: string,
    userId?: string,
  ): Promise<string | null> {
    const rawLower = raw.toLowerCase();
    const userCondition = userId
      ? eq(schema.merchantAliases.userId, userId)
      : isNull(schema.merchantAliases.userId);

    const aliases = await this.db
      .select()
      .from(schema.merchantAliases)
      .where(userCondition);

    for (const alias of aliases) {
      const pattern = alias.pattern.toLowerCase();
      const matchType = alias.matchType || 'contains';

      let matched = false;
      if (matchType === 'exact') {
        matched = rawLower === pattern;
      } else if (matchType === 'startsWith') {
        matched = rawLower.startsWith(pattern);
      } else if (matchType === 'contains') {
        matched = rawLower.includes(pattern);
      } else if (matchType === 'regex') {
        try {
          matched = new RegExp(alias.pattern, 'i').test(raw);
        } catch {
          // Invalid regex — skip
        }
      }

      if (matched) return alias.displayName;
    }

    return null;
  }

  /**
   * Backfill normalized_merchant_name for all transactions that don't have one.
   * Uses rule-based normalization only (no async alias lookup for performance).
   * Returns count of updated rows.
   */
  async backfillAll(): Promise<{ updated: number; total: number }> {
    const rows = await this.db.execute(sql`
      SELECT id, merchant_name, description
      FROM ${schema.transactions}
      WHERE normalized_merchant_name IS NULL
        AND deleted_at IS NULL
    `);

    const txns = (rows.rows ?? rows) as Array<{
      id: string;
      merchant_name: string | null;
      description: string;
    }>;

    let updated = 0;
    for (const txn of txns) {
      const normalized = this.ruleBasedNormalize(
        txn.merchant_name || txn.description,
      );
      await this.db
        .update(schema.transactions)
        .set({ normalizedMerchantName: normalized })
        .where(eq(schema.transactions.id, txn.id));
      updated++;
    }

    return { updated, total: txns.length };
  }
}
