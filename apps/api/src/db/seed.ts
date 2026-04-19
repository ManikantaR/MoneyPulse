import { drizzle } from 'drizzle-orm/postgres-js';
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

  // Pass 1: insert top-level categories (no parentName)
  const parents = DEFAULT_CATEGORIES.filter((c) => !c.parentName);
  for (const cat of parents) {
    const rows = await db
      .insert(categories)
      .values({
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        parentId: null,
        sortOrder: cat.sortOrder,
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) nameToId.set(cat.name, rows[0].id);
  }

  // If some parents already existed (conflict), fetch them to resolve names
  if (nameToId.size < parents.length) {
    const existing = await db.select().from(categories);
    for (const row of existing) {
      if (!nameToId.has(row.name)) nameToId.set(row.name, row.id);
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
    await db
      .insert(categories)
      .values({
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        parentId,
        sortOrder: cat.sortOrder,
      })
      .onConflictDoNothing();
  }

  console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories (${parents.length} parents, ${children.length} children)`);

  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
