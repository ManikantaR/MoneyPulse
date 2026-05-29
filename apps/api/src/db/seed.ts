import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { categories } from './schema';
import { DEFAULT_CATEGORIES } from '@moneypulse/shared';

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = postgres(connectionString);
  const db = drizzle(client);

  console.log('Seeding default categories...');

  // Two-pass insert: parents first, then children (to resolve parentName → parentId)
  const nameToId = new Map<string, string>();

  // Fetch existing categories first so we can skip duplicates
  const existing = await db.select().from(categories);
  const existingKeys = new Set(
    existing.map((c: any) => `${c.name}::${c.parentId ?? 'ROOT'}`),
  );
  for (const row of existing) {
    nameToId.set((row as any).name, (row as any).id);
  }

  let inserted = 0;
  let skipped = 0;

  // Pass 1: insert top-level categories (no parentName)
  const parents = DEFAULT_CATEGORIES.filter((c) => !c.parentName);
  for (const cat of parents) {
    const key = `${cat.name}::ROOT`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    const rows = await db
      .insert(categories)
      .values({
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        parentId: null,
        sortOrder: cat.sortOrder,
        isTransfer: cat.isTransfer ?? false,
      })
      .returning();
    if (rows[0]) {
      nameToId.set(cat.name, rows[0].id);
      inserted++;
    }
  }

  // Pass 2: insert child categories (resolve parentName)
  const children = DEFAULT_CATEGORIES.filter((c) => !!c.parentName);
  for (const cat of children) {
    const parentId = nameToId.get(cat.parentName!);
    if (!parentId) {
      console.warn(`Skipping "${cat.name}": parent "${cat.parentName}" not found`);
      continue;
    }
    const key = `${cat.name}::${parentId}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    const rows = await db
      .insert(categories)
      .values({
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        parentId,
        sortOrder: cat.sortOrder,
        isTransfer: cat.isTransfer ?? false,
      })
      .returning();
    if (rows[0]) {
      nameToId.set(cat.name, rows[0].id);
      inserted++;
    }
  }

  // Pass 3: update is_transfer flag on existing categories that need it
  const transferNames = DEFAULT_CATEGORIES
    .filter((c) => c.isTransfer)
    .map((c) => c.name);
  let updated = 0;
  if (transferNames.length > 0) {
    for (const name of transferNames) {
      const result = await db.execute(
        sql`UPDATE categories SET is_transfer = true WHERE name = ${name} AND is_transfer = false`,
      );
      const count = (result as any).rowCount ?? (result as any).length ?? 0;
      updated += count;
    }
  }

  console.log(
    `Seed complete: ${inserted} inserted, ${skipped} already existed, ${updated} updated is_transfer (${DEFAULT_CATEGORIES.length} total defined)`,
  );

  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
