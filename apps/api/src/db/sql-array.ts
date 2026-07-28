import { sql, type SQL } from 'drizzle-orm';

/**
 * Build a genuine Postgres array literal for use with `ANY(...)`/`ALL(...)`, e.g.
 * `WHERE ticker = ANY(${sqlArray(tickers, 'text')})`.
 *
 * Never interpolate a raw JS array directly into a `sql` template tag for use with
 * `ANY(...)` (e.g. `ANY(${myJsArray})`) — drizzle's `sql` tag renders a bare array
 * as a parenthesized list `($1, $2, ...)`, not a real Postgres array. Postgres
 * accepts that as `ANY(...)` only in the degenerate single-element case and
 * rejects it with "op ANY/ALL (array) requires array on right side" once there
 * are 2+ elements (see #202, #206).
 */
export function sqlArray(values: readonly (string | number)[], pgType: 'uuid' | 'text'): SQL {
  if (values.length === 0) {
    return sql`ARRAY[]::${sql.raw(pgType)}[]`;
  }
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}::${sql.raw(pgType)}`),
    sql`, `,
  )}]`;
}
