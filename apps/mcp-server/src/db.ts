import pg from 'pg';

// Prefer a single DATABASE_URL (the API passes its own env down when it spawns us over
// stdio), falling back to discrete DB_* vars for standalone/dev use.
const pool = new pg.Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, max: 5 }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'moneypulse',
        user: process.env.DB_USER || 'moneypulse',
        password: process.env.DB_PASSWORD!,
        max: 5,
      },
);

export async function query<T = any>(
  text: string,
  params?: any[],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(
  text: string,
  params?: any[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

let cachedUserId: string | null = null;

/**
 * The user whose data the MCP tools operate on. Set MONEYPULSE_USER_ID to pin it
 * explicitly; otherwise the sole user in the DB is used. Throws if the DB has
 * multiple users and none is pinned, so tools never silently span accounts.
 */
export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const envId = process.env.MONEYPULSE_USER_ID;
  if (envId) {
    cachedUserId = envId;
    return cachedUserId;
  }

  const rows = await query<{ id: string }>('SELECT id FROM users LIMIT 2');
  if (rows.length === 0) {
    throw new Error('No users found. Set MONEYPULSE_USER_ID to scope the MCP server.');
  }
  if (rows.length > 1) {
    throw new Error(
      'Multiple users found. Set MONEYPULSE_USER_ID to scope the MCP server to one user.',
    );
  }
  cachedUserId = rows[0].id;
  return cachedUserId;
}

export async function close(): Promise<void> {
  await pool.end();
}
