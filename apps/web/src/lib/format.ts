/**
 * Format cents as dollar string: 12345 → "$123.45"
 */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(dollars);
}

/**
 * Format cents as compact: 123456 → "$1.2K"
 */
export function formatCentsCompact(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    compactDisplay: 'short',
  }).format(dollars);
}

/**
 * Format a date string for display: "2026-03-15" → "Mar 15, 2026"
 * Supports both YYYY-MM-DD and full ISO-8601 datetime strings.
 */
export function formatDate(dateStr: string): string {
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Format a date for short display: "2026-03-15" → "3/15"
 * Supports both YYYY-MM-DD and full ISO-8601 datetime strings.
 */
export function formatDateShort(dateStr: string): string {
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

/**
 * Format percentage: 0.856 → "85.6%"
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
