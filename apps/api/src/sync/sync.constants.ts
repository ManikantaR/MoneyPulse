export const SYNC_BANNED_FIELDS = new Set([
  'email',
  'accountNumber',
  'routingNumber',
  'lastFour',
  'originalDescriptionRaw',
  'promptText',
  'outputText',
]);

// Basic PII-oriented patterns for outbound policy checks.
export const SYNC_PII_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b(?:\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}|\d{10,18})\b/g, // full card/account-like numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})/g, // phone
  // Last-4 card/account references that banks embed in descriptions
  /\b(?:card|acct|account|ending|x{2,})\s*\d{4}\b/gi,
  /\bconfirmation\s*#?\s*\d+/gi, // confirmation codes
];

// Regex to strip card/account last-4 and confirmation codes from merchantName before sync
export const MERCHANT_NAME_STRIP_PATTERNS: RegExp[] = [
  /\bcard\s+\d{4}\b/gi,
  /\bacct\.?\s+\d{4}\b/gi,
  /\baccount\s+\d{4}\b/gi,
  /\bx{2,}\d{4}\b/gi,
  /\bending\s+\d{4}\b/gi,
  /\bconfirmation\s*#?\s*[\w\d]+/gi,
  /\b\d{9,}\b/g, // long digit sequences
];

export const SYNC_MAX_ATTEMPTS = 8;

/**
 * Strip bank-description PII from a raw merchantName before including it in
 * a sync outbox payload. Banks embed last-4 card digits, confirmation codes,
 * and reference numbers in the description they label as "merchant". This
 * returns null when nothing meaningful remains after stripping.
 */
export function sanitizeMerchantName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw;
  for (const pattern of MERCHANT_NAME_STRIP_PATTERNS) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/[#,]+$/, '').trim();
  return cleaned.length >= 2 ? cleaned : null;
}
