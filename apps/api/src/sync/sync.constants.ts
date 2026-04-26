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
  /\b(?:\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}|\d{10,18})\b/g, // card/account-like numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /(?:\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})/g, // phone
];

export const SYNC_MAX_ATTEMPTS = 8;
