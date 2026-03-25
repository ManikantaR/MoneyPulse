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
