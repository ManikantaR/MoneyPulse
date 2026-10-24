/**
 * Shared bank-statement header-row detection.
 *
 * Both the CSV ingestion path (which strips preamble lines from raw text)
 * and the Excel ingestion path (which scans worksheet rows) need to answer
 * the same question: "does this row look like the real column-header row
 * for one of our supported bank export formats?" This module is the single
 * source of truth for that signature so the two paths can't drift apart.
 */

/** Column names that, alongside a "date" column, identify a real header row. */
export const BANK_HEADER_SIGNATURE_TOKENS = [
  'description',
  'amount',
  'reference number',
  'running bal.',
  'payee',
  'posted date',
];

/**
 * True if the given lowercase, whitespace-joined row text looks like a bank
 * statement header row: it mentions "date" plus at least one other known
 * column name. Case-insensitive; callers should lowercase their input.
 */
export function looksLikeHeaderRowText(lowerText: string): boolean {
  const hasDate = lowerText.includes('date');
  const hasKnown = BANK_HEADER_SIGNATURE_TOKENS.some((h) =>
    lowerText.includes(h),
  );
  return hasDate && hasKnown;
}

/** Same check, taking an array of (already stringified) cell values. */
export function looksLikeHeaderRowCells(cells: string[]): boolean {
  return looksLikeHeaderRowText(cells.join(' ').toLowerCase());
}
