/**
 * One-time migration script to encrypt existing plaintext PII data.
 *
 * Columns encrypted:
 *   - accounts.last_four
 *   - transactions.original_description
 *   - user_settings.ha_webhook_url
 *   - user_settings.notification_email
 *   - ai_prompt_logs.input_text
 *   - ai_prompt_logs.output_text
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex64> DATABASE_URL=<pg_url> npx tsx db/scripts/encrypt-existing-data.ts
 *
 * Safe to run multiple times — skips already-encrypted values.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

// Inline crypto to avoid import path issues
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string');
  }
  return Buffer.from(hex, 'hex');
}

function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function isEncrypted(value: string): boolean {
  if (!value || !value.includes(':')) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  console.log('Starting PII encryption migration...\n');

  // 1. accounts.last_four
  const accounts = await db.execute(sql`SELECT id, last_four FROM accounts WHERE last_four IS NOT NULL`);
  const accountRows = (accounts as any).rows ?? accounts;
  let encrypted = 0;
  for (const row of accountRows) {
    if (isEncrypted(row.last_four)) continue;
    const enc = encryptField(row.last_four);
    await db.execute(sql`UPDATE accounts SET last_four = ${enc} WHERE id = ${row.id}`);
    encrypted++;
  }
  console.log(`accounts.last_four: ${encrypted}/${accountRows.length} encrypted`);

  // 2. transactions.original_description
  const txnCount = await db.execute(sql`SELECT COUNT(*)::int AS total FROM transactions WHERE original_description IS NOT NULL`);
  const total = ((txnCount as any).rows ?? txnCount)[0]?.total ?? 0;
  console.log(`transactions.original_description: ${total} rows to check...`);
  const BATCH = 500;
  let offset = 0;
  let txnEncrypted = 0;
  while (offset < total) {
    const batch = await db.execute(
      sql`SELECT id, original_description FROM transactions WHERE original_description IS NOT NULL ORDER BY id LIMIT ${BATCH} OFFSET ${offset}`,
    );
    const batchRows = (batch as any).rows ?? batch;
    for (const row of batchRows) {
      if (isEncrypted(row.original_description)) continue;
      const enc = encryptField(row.original_description);
      await db.execute(sql`UPDATE transactions SET original_description = ${enc} WHERE id = ${row.id}`);
      txnEncrypted++;
    }
    offset += BATCH;
    if (offset % 5000 === 0) console.log(`  ...processed ${offset}/${total}`);
  }
  console.log(`transactions.original_description: ${txnEncrypted}/${total} encrypted`);

  // 3. user_settings.ha_webhook_url + notification_email
  const settings = await db.execute(sql`SELECT user_id, ha_webhook_url, notification_email FROM user_settings`);
  const settingsRows = (settings as any).rows ?? settings;
  let settingsEncrypted = 0;
  for (const row of settingsRows) {
    const updates: string[] = [];
    let newWebhook = row.ha_webhook_url;
    let newEmail = row.notification_email;
    if (row.ha_webhook_url && !isEncrypted(row.ha_webhook_url)) {
      newWebhook = encryptField(row.ha_webhook_url);
      updates.push('ha_webhook_url');
    }
    if (row.notification_email && !isEncrypted(row.notification_email)) {
      newEmail = encryptField(row.notification_email);
      updates.push('notification_email');
    }
    if (updates.length > 0) {
      await db.execute(
        sql`UPDATE user_settings SET ha_webhook_url = ${newWebhook}, notification_email = ${newEmail} WHERE user_id = ${row.user_id}`,
      );
      settingsEncrypted++;
    }
  }
  console.log(`user_settings: ${settingsEncrypted}/${settingsRows.length} rows encrypted`);

  // 4. ai_prompt_logs.input_text + output_text
  const aiLogs = await db.execute(sql`SELECT id, input_text, output_text FROM ai_prompt_logs`);
  const aiRows = (aiLogs as any).rows ?? aiLogs;
  let aiEncrypted = 0;
  for (const row of aiRows) {
    let newInput = row.input_text;
    let newOutput = row.output_text;
    let changed = false;
    if (row.input_text && !isEncrypted(row.input_text)) {
      newInput = encryptField(row.input_text);
      changed = true;
    }
    if (row.output_text && !isEncrypted(row.output_text)) {
      newOutput = encryptField(row.output_text);
      changed = true;
    }
    if (changed) {
      await db.execute(
        sql`UPDATE ai_prompt_logs SET input_text = ${newInput}, output_text = ${newOutput} WHERE id = ${row.id}`,
      );
      aiEncrypted++;
    }
  }
  console.log(`ai_prompt_logs: ${aiEncrypted}/${aiRows.length} rows encrypted`);

  console.log('\nEncryption migration complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
