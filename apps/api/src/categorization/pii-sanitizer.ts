/**
 * PII Sanitizer — strips personally identifiable information before cloud AI calls.
 *
 * Patterns detected and replaced (order matters — most specific first):
 * - SSNs (XXX-XX-XXXX)
 * - Credit card numbers (13–16 digits, grouped in 4s with optional separators; also Amex 15-digit 4-6-5)
 * - Email addresses
 * - Phone numbers ((123) 456-7890 or 123-456-7890)
 * - Routing numbers (exactly 9 digits)
 * - Account numbers (10–18 consecutive digits, generic catch-all)
 */

const PII_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // SSN: 123-45-6789 (most specific dashed format)
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },

  // Credit card: 4×4 (Visa/MC 16-digit) or 4-6-5 (Amex 15-digit) with optional separators
  {
    regex: /\b(?:\d{4}[\s-]?\d{6}[\s-]?\d{5}|\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/g,
    replacement: '[CARD]',
  },

  // Email (before digit-only patterns to avoid partial matches)
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },

  // US Phone: (123) 456-7890 or 123-456-7890 (requires at least one separator)
  {
    regex: /(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})/g,
    replacement: '[PHONE]',
  },

  // Routing number: exactly 9 digits (must come before generic account pattern)
  { regex: /\b\d{9}\b/g, replacement: '[ROUTING]' },

  // Account numbers: 10-18 consecutive digits (generic catch-all; raised minimum to 10 to avoid routing/phone overlap)
  { regex: /\b\d{10,18}\b/g, replacement: '[ACCT]' },
  {
    regex: /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl|Cir|Pkwy)\.?\b/g,
    replacement: '[ADDRESS]',
  },
];

/**
 * Detect which PII types are present in a text string (without modifying it).
 * Returns an array of placeholder names like `['SSN', 'CARD', 'EMAIL']`.
 */
export function detectPiiTypes(text: string): string[] {
  const found: string[] = [];
  for (const { regex, replacement } of PII_PATTERNS) {
    // Reset regex state for global patterns
    regex.lastIndex = 0;
    if (regex.test(text)) {
      found.push(replacement.replace(/[\[\]]/g, ''));
    }
    regex.lastIndex = 0;
  }
  return found;
}

export interface SanitizedTransaction {
  date: string;
  description: string;
  amountCents: number;
  isCredit: boolean;
  merchantName: string | null;
}

/**
 * Sanitize a single text string by replacing PII patterns with safe placeholders.
 *
 * @param text - The input text potentially containing PII
 * @returns The text with PII replaced by placeholders like `[SSN]`, `[CARD]`, `[EMAIL]`, etc.
 */
export function sanitizeText(text: string): string {
  let result = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

/**
 * Sanitize a transaction object for cloud AI consumption.
 * Strips PII from description and merchant name while preserving
 * non-sensitive fields (date, amount, isCredit) unchanged.
 *
 * @param txn - The transaction data to sanitize
 * @returns A new object with PII-stripped description and merchantName
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
