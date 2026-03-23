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

  for (const cat of DEFAULT_CATEGORIES) {
    await db
      .insert(categories)
      .values({
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        parentId: cat.parentId,
        sortOrder: cat.sortOrder,
      })
      .onConflictDoNothing();
  }

  console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories`);

  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
