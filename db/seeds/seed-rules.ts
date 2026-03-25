import { SEED_RULES } from '@moneypulse/shared';

/**
 * Seed default categorization rules.
 * Run after initial migration that creates categories.
 *
 * Usage: npx tsx db/seeds/seed-rules.ts
 */
export async function seedRules(db: any, schema: any) {
  const categories = await db.select().from(schema.categories);
  const categoryMap = new Map(categories.map((c: any) => [c.name, c.id]));

  const rulesToInsert = SEED_RULES.filter((rule) =>
    categoryMap.has(rule.categoryName),
  ).map((rule) => ({
    userId: null,
    pattern: rule.pattern,
    matchType: rule.matchType,
    field: rule.field,
    categoryId: categoryMap.get(rule.categoryName),
    priority: rule.priority,
    isAiGenerated: false,
    confidence: 1.0,
  }));

  if (rulesToInsert.length > 0) {
    await db.insert(schema.categorizationRules).values(rulesToInsert);
  }

  console.log(`Seeded ${rulesToInsert.length} categorization rules`);
}
