/**
 * PII Sanitizer — strips personally identifiable information before cloud AI calls.
 *
 * Patterns detected and replaced:
 * - SSNs (XXX-XX-XXXX)
 * - Credit card numbers (13-19 digits, possibly spaced/dashed)
 * - Account numbers (8-18 digits)
 * - Routing numbers (9 digits)
 * - Email addresses
 * - Phone numbers
 */

const PII_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // SSN: 123-45-6789
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },

  // Credit card: 4 groups of 4 digits
  {
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[CARD]',
  },

  // Account numbers: 8-18 consecutive digits
  { regex: /\b\d{8,18}\b/g, replacement: '[ACCT]' },

  // Routing number: exactly 9 digits (common US format)
  { regex: /\b\d{9}\b/g, replacement: '[ROUTING]' },

  // Email
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },

  // US Phone: (123) 456-7890 or 123-456-7890
  { regex: /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, replacement: '[PHONE]' },
];

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
