import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, eq, isNull, and } from 'drizzle-orm';
import { OllamaHealthService } from './ollama-health.service';

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
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly ollamaTimeoutMs: number;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly config: ConfigService,
    private readonly ollamaHealth: OllamaHealthService,
  ) {
    this.ollamaUrl = this.config.get<string>('OLLAMA_URL') ?? 'http://localhost:11434';
    this.ollamaModel = this.config.get<string>('OLLAMA_MODEL') ?? 'llama3.2:3b';
    this.ollamaTimeoutMs = parseInt(
      this.config.get<string>('OLLAMA_TIMEOUT_MS') ?? '120000',
      10,
    );
  }

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
   *
   * Pipeline (case-insensitive throughout):
   *   1. Processor prefixes (Py *, SQ *, PAYPAL *, etc.)
   *   2. Domain TLD cleanup ("Netflix.Com" → "Netflix")
   *   3. Phone numbers
   *   4. Card network junk (W+ Amex)
   *   5. Store/location numbers
   *   6. Transaction reference IDs
   *   7. Transaction type suffixes
   *   8. Trailing cleanup loop: junk words → known-city+state → standalone state
   *   9. Collapse whitespace + title-case
   */
  ruleBasedNormalize(raw: string): string {
    let name = raw.trim();
    if (!name) return name;

    // 1. Strip processor prefixes (case-insensitive)
    const prefixes = [
      /^(py|pp|ppl)\s*\*\s*/i,    // Py *Merchant, PP *Merchant
      /^sq\s*\*/i,
      /^tst\s*\*/i,
      /^sp\s*\*/i,
      /^paypal\s*\*/i,
      /^venmo\s*\*/i,
      /^zelle\s*\*/i,
      /^cash\s*app\s*\*/i,
      /^cke\s*\*/i,
      /^chk\s*\*/i,
      /^hlu\s*\*/i,
      /^amzn\s*\*/i,
      /^appl\s*\*/i,
      /^des:\w+\s+/i,
      /^sampay\s+/i,
      /^pos\s+/i,
      /^purchase\s+/i,
      /^debit\s*card\s+/i,
      /^ach\s+/i,
      /^recurring\s+/i,
      /^autopay\s+/i,
      /^online\s+/i,
      /^internet\s+/i,
      /^checkcard\s+/i,
    ];
    for (const prefix of prefixes) {
      name = name.replace(prefix, '');
    }

    // 2. Domain TLD cleanup — keep brand, strip .com/.net/etc. (anywhere in string)
    // "Netflix.Com" → "Netflix", "Walmart.com/shop" → "Walmart"
    name = name.replace(/\b(\S+?)\.(com|net|org|io|co)\b(\/\S*)?/gi, '$1');

    // 3. Phone numbers
    name = name.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '');

    // 4. Card network junk (only in W+ context to avoid nuking AMEX merchant names)
    name = name.replace(/\bw\+\s*amex\b/gi, '');

    // 5. Store/location numbers
    name = name
      .replace(/\s+[T#]-?\d{3,}.*$/i, '')
      .replace(/\s+#\d+\s*$/i, '')
      .replace(/\s+store\s*#?\d+\s*$/i, '')
      .replace(/\s+whse\s*#?\d*\s*$/i, '');

    // 6. Transaction reference IDs
    name = name.replace(/\s+id:\S+/gi, '');

    // 7. Transaction type suffixes
    name = name.replace(/\s+(credit|debit|payment|purchase|withdrawal|deposit|refund)\s*$/i, '');

    // 8. Trailing cleanup loop — repeat until stable
    // Order: junk words → known-city+state → standalone state → country
    let prev: string;
    do {
      prev = name;

      // Trailing legal/junk words (but not "co" in "Costco" — \b protects it)
      name = name.replace(/\s+\b(null|usa|llc|inc|corp)\b\s*$/gi, '');
      name = name.replace(/\s+\bco\b\s*$/gi, '');

      // Known city + state (case-insensitive, extended list)
      name = name.replace(
        /\s+\b(glen allen|richmond|midlothian|short pump|mechanicsville|henrico|los gatos|bentonville|cupertino|redmond|san jose|seattle|mountain view|new york|san francisco|los angeles|chicago|dallas|austin|houston|phoenix|atlanta|denver|nashville|portland)\b\s+[a-z]{2}\s*\d{0,5}\s*$/i,
        '',
      );

      // Standalone 2-letter state abbreviation at end (with optional zip)
      name = name.replace(/\s+[a-z]{2}\s*\d{0,5}\s*$/i, '');

      // Country code
      name = name.replace(/\s+us\s*$/i, '');

      name = name.trim();
    } while (name !== prev);

    // 9. Collapse whitespace
    name = name.replace(/\s+/g, ' ').trim();

    // 10. Title-case
    // If entirely UPPERCASE: lowercase then capitalize each word
    // If mixed: only capitalize words that are all-lowercase (preserve acronyms like AT&T, HBO)
    if (name.length > 0) {
      if (name === name.toUpperCase() && name.length > 2) {
        name = name
          .toLowerCase()
          .split(' ')
          .map((w, i) => {
            if (i > 0 && w.length <= 2) return w;
            return w.charAt(0).toUpperCase() + w.slice(1);
          })
          .join(' ');
        name = name.charAt(0).toUpperCase() + name.slice(1);
      } else {
        // Mixed-case: capitalize any word that is fully lowercase
        name = name
          .split(' ')
          .map((w, i) => {
            if (!w) return w;
            if (w === w.toLowerCase()) {
              // Skip short connecting words unless first
              if (i > 0 && w.length <= 2) return w;
              return w.charAt(0).toUpperCase() + w.slice(1);
            }
            return w; // preserve existing capitalization (acronyms, Title-case)
          })
          .join(' ');
        if (name.length > 0) {
          name = name.charAt(0).toUpperCase() + name.slice(1);
        }
      }
    }

    return name || raw.trim();
  }

  /**
   * Synchronous alias matching against a pre-loaded alias list.
   * Used by backfillAll for performance (avoids N+1 DB queries).
   */
  private matchAlias(
    raw: string,
    allAliases: any[],
    userId?: string,
  ): string | null {
    const rawLower = raw.toLowerCase();
    const filtered = userId
      ? allAliases.filter((a: any) => a.userId === userId)
      : allAliases.filter((a: any) => a.userId === null);

    for (const alias of filtered) {
      const pattern = alias.pattern.toLowerCase();
      const matchType = alias.matchType || 'contains';
      let matched = false;
      if (matchType === 'exact') matched = rawLower === pattern;
      else if (matchType === 'startsWith') matched = rawLower.startsWith(pattern);
      else if (matchType === 'contains') matched = rawLower.includes(pattern);
      else if (matchType === 'regex') {
        try { matched = new RegExp(alias.pattern, 'i').test(raw); } catch { /* skip */ }
      }
      if (matched) return alias.displayName;
    }
    return null;
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
   * Self-learning: create a user-scoped or global alias from a raw merchant string → display name.
   * Pass userId=null to create a global alias (applies to all users).
   * Skips if an identical alias already exists.
   */
  async learnAlias(
    userId: string | null,
    rawPattern: string,
    displayName: string,
    matchType: 'exact' | 'startsWith' | 'contains' = 'contains',
  ): Promise<boolean> {
    if (!rawPattern || !displayName) return false;

    // Check if an alias already exists for this pattern + user
    const existing = await this.db
      .select()
      .from(schema.merchantAliases)
      .where(
        and(
          userId === null
            ? isNull(schema.merchantAliases.userId)
            : eq(schema.merchantAliases.userId, userId),
          eq(schema.merchantAliases.pattern, rawPattern.toLowerCase()),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Update display name if different
      if (existing[0].displayName !== displayName) {
        await this.db
          .update(schema.merchantAliases)
          .set({ displayName })
          .where(eq(schema.merchantAliases.id, existing[0].id));
        this.logger.log(`Updated merchant alias: "${rawPattern}" → "${displayName}"`);
      }
      return false;
    }

    await this.db.insert(schema.merchantAliases).values({
      userId,
      pattern: rawPattern.toLowerCase(),
      matchType,
      displayName,
    });

    const scope = userId ? `user ${userId}` : 'global';
    this.logger.log(`Learned merchant alias: "${rawPattern}" → "${displayName}" (${scope})`);
    return true;
  }

  /**
   * Heuristic: returns true when a rule-based result looks like it still needs AI cleanup.
   * Criteria: unchanged from raw, contains digits, or more than 3 tokens.
   */
  isMessyResult(raw: string, normalized: string): boolean {
    const n = normalized.trim();
    if (n.toLowerCase() === raw.toLowerCase().trim()) return true;
    if (/\d/.test(n)) return true;
    if (n.split(/\s+/).length > 3) return true;
    return false;
  }

  /**
   * AI-powered merchant normalization via Ollama.
   * Sends a batch of raw descriptors to Ollama and returns a Map<raw, cleanName>.
   * Returns an empty map if Ollama is unavailable or the response cannot be parsed.
   * This is a direct call — the caller is responsible for health-gating and retry logic.
   */
  async aiNormalizeBatch(rawNames: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!rawNames.length) return result;

    const prompt = `For each raw bank transaction descriptor below, return the clean consumer-facing merchant or brand name. Strip store numbers, phone numbers, city/state, legal suffixes (Inc, LLC, Corp), and processor prefixes. Return ONLY a JSON object mapping each raw descriptor to its clean name. If you are unsure, repeat the raw descriptor unchanged.

${rawNames.map((n, i) => `${i + 1}. "${n}"`).join('\n')}

Respond ONLY with valid JSON like: {"raw descriptor 1": "Clean Name", "raw descriptor 2": "Clean Name"}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.ollamaTimeoutMs);

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          options: { temperature: 0.05, num_predict: 1000 },
        }),
      });

      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

      const data = (await response.json()) as { response: string };
      const jsonMatch = data.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object in Ollama response');

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
      for (const [raw, clean] of Object.entries(parsed)) {
        const cleanTrimmed = (clean ?? '').trim();
        if (raw && cleanTrimmed && cleanTrimmed.toLowerCase() !== raw.toLowerCase().trim()) {
          result.set(raw, cleanTrimmed);
        }
      }
      this.logger.log(`AI merchant normalization: ${result.size}/${rawNames.length} cleaned`);
    } catch (err: any) {
      this.logger.warn(`AI merchant normalization failed: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    return result;
  }

  /**
   * Backfill normalized_merchant_name for all transactions.
   * When force=false (default), only fills NULL values.
   * When force=true, re-normalizes ALL transactions (useful after adding new aliases).
   * Returns messyRaws: raw strings whose rule-based result still looks noisy (candidates for AI).
   */
  async backfillAll(force = false): Promise<{ updated: number; total: number; messyRaws: string[] }> {
    const whereClause = force
      ? sql`deleted_at IS NULL`
      : sql`normalized_merchant_name IS NULL AND deleted_at IS NULL`;

    const rows = await this.db.execute(sql`
      SELECT id, user_id, merchant_name, description
      FROM ${schema.transactions}
      WHERE ${whereClause}
    `);

    const txns = (rows.rows ?? rows) as Array<{
      id: string;
      user_id: string;
      merchant_name: string | null;
      description: string;
    }>;

    // Pre-load all aliases once for performance
    const allAliases = await this.db.select().from(schema.merchantAliases);

    let updated = 0;
    const messyRawSet = new Set<string>();

    for (const txn of txns) {
      const raw = txn.merchant_name || txn.description;
      // Check aliases (user-specific first, then global)
      const normalized = this.matchAlias(raw, allAliases, txn.user_id)
        ?? this.matchAlias(raw, allAliases)
        ?? this.ruleBasedNormalize(raw);
      await this.db
        .update(schema.transactions)
        .set({ normalizedMerchantName: normalized })
        .where(eq(schema.transactions.id, txn.id));
      updated++;

      // Collect messy results for AI enrichment (only when no alias resolved it)
      const aliasHit = this.matchAlias(raw, allAliases, txn.user_id) ?? this.matchAlias(raw, allAliases);
      if (!aliasHit && this.isMessyResult(raw, normalized)) {
        messyRawSet.add(raw);
      }
    }

    return { updated, total: txns.length, messyRaws: [...messyRawSet] };
  }
}
