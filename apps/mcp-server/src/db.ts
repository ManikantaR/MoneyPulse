import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'moneypulse',
  user: process.env.DB_USER || 'moneypulse',
  password: process.env.DB_PASSWORD!,
  max: 5,
});

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

export async function close(): Promise<void> {
  await pool.end();
}
