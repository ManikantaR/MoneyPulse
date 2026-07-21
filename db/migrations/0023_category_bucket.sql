-- 11.11: Needs/Wants/Savings-Debt bucket on categories, for the (separate,
-- follow-up) 50/30/20 dashboard. Nullable — only a best-effort default is seeded
-- below for common category names; anything else is left NULL for the user to
-- classify via the existing categories CRUD.
DO $$ BEGIN
  CREATE TYPE "public"."category_bucket" AS ENUM ('needs', 'wants', 'savings_debt');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "bucket" "category_bucket";
--> statement-breakpoint
UPDATE "categories" SET "bucket" = 'needs'
WHERE "bucket" IS NULL
  AND name ILIKE ANY (ARRAY[
    'Groceries', 'Housing', 'Rent', 'Mortgage', 'Utilities', 'Insurance',
    'Healthcare', 'Medical', 'Childcare', 'Transportation', 'Auto Payment',
    'Gas', 'Fuel', 'Phone', 'Internet'
  ]);
--> statement-breakpoint
UPDATE "categories" SET "bucket" = 'wants'
WHERE "bucket" IS NULL
  AND name ILIKE ANY (ARRAY[
    'Dining', 'Restaurants', 'Entertainment', 'Shopping', 'Subscriptions',
    'Travel', 'Hobbies', 'Personal Care', 'Gifts'
  ]);
--> statement-breakpoint
UPDATE "categories" SET "bucket" = 'savings_debt'
WHERE "bucket" IS NULL
  AND name ILIKE ANY (ARRAY[
    'Savings', 'Retirement', '401k', 'IRA', 'Brokerage', 'Investments',
    'HYSA', 'Emergency Fund', 'Debt Payment', 'Loan Payment', 'Credit Card Payment'
  ]);
