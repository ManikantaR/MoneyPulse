import type {
  ParsedTransaction,
  FileUploadError,
  Institution,
} from '@moneypulse/shared';

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: FileUploadError[];
}

export interface BankParser {
  /** Institution this parser handles */
  institution: Institution;

  /**
   * Check if this parser can handle the given CSV headers.
   * Returns true if headers match the expected pattern.
   */
  canParse(headers: string[]): boolean;

  /**
   * Parse CSV rows into transactions.
   * @param rows - Array of row objects (header → value).
   * @param rowOffset - Starting row number for error reporting.
   */
  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult;
}

/**
 * Utility: Parse a date string in MM/DD/YYYY format to YYYY-MM-DD.
 */
export function parseDateMMDDYYYY(dateStr: string): string | null {
  const match = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const m = month.padStart(2, '0');
  const d = day.padStart(2, '0');
  const parsed = new Date(`${year}-${m}-${d}`);
  if (isNaN(parsed.getTime())) return null;
  return `${year}-${m}-${d}`;
}

/**
 * Utility: Parse a dollar amount string to cents (integer).
 * Handles: "1,234.56", "-85.23", "$1,234.56", "(85.23)" for negative.
 */
export function parseAmountToCents(amountStr: string): number | null {
  if (!amountStr || !amountStr.trim()) return null;
  let cleaned = amountStr.trim().replace(/[$,]/g, '');

  // Handle parentheses for negative: (85.23) → -85.23
  const parenMatch = cleaned.match(/^\((.+)\)$/);
  if (parenMatch) {
    cleaned = '-' + parenMatch[1];
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

/**
 * Utility: Normalize a description for hashing/matching.
 * Lowercase, collapse whitespace, strip trailing reference numbers.
 */
export function normalizeDescription(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract a clean, human-readable merchant name from a raw bank description.
 *
 * Handles patterns like:
 *   "AMERICAN EXPRESS DES:ACH PMT ID:A6916 …"  → "American Express"
 *   "Zelle payment to Patricia M. Walker …"     → "Zelle Patricia M. Walker"
 *   "WM SUPERCENTER #1523 804-360-1234"         → "WM Supercenter"
 *   "CHASE CREDIT CRD DES:AUTOPAY …"            → "Chase Credit Card"
 *   "DOMINION ENERGY DES:BILLPAY …"             → "Dominion Energy"
 *   "BANK OF AMERICA CREDIT CARD Bill Payment"  → "Bank Of America"
 */
export function extractMerchantName(desc: string): string {
  let d = desc.trim();

  // Strip known BofA ACH patterns: "MERCHANT DES:TYPE ID:XXX INDN:NAME CO ID:XXX PPD/WEB"
  const achMatch = d.match(/^(.+?)\s+DES:/i);
  if (achMatch) {
    d = achMatch[1].trim();
  }

  // Zelle: "Zelle payment to NAME for MEMO; Conf# XXX"
  const zelleMatch = d.match(/^Zelle\s+payment\s+to\s+(.+?)(?:\s+for\s+|;\s*Conf)/i);
  if (zelleMatch) {
    return titleCase(`Zelle ${zelleMatch[1].trim()}`);
  }

  // "BANK OF AMERICA CREDIT CARD Bill Payment" → "Bank Of America"
  if (/^BANK OF AMERICA CREDIT CARD/i.test(d)) {
    return 'Bank Of America';
  }

  // Strip store numbers: "#1234", "# 1234"
  d = d.replace(/#\s*\d+/g, '').trim();

  // Strip trailing phone numbers: "804-360-1234"
  d = d.replace(/\s+\d{3}[-.]?\d{3}[-.]?\d{4}\s*$/g, '').trim();

  // Strip trailing reference/transaction IDs: long hex strings, etc.
  d = d.replace(/\s+[A-Z0-9]{10,}$/g, '').trim();

  // Strip trailing "AUTOPAY", "PAYMENT", "BILLPAY", "EPAY", "ACH PMT"
  d = d.replace(/\s+(AUTOPAY|PAYMENT|BILLPAY|EPAY|ACH PMT|Bill Payment)\s*$/gi, '').trim();

  // "CHASE CREDIT CRD" → "Chase Credit Card"
  d = d.replace(/\bCRD\b/gi, 'Card');

  // Collapse multiple spaces
  d = d.replace(/\s+/g, ' ').trim();

  return titleCase(d);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
