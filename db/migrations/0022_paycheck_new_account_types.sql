-- 11.11: New account types for 529 education savings, brokerage/index-fund accounts
-- (ties into #118 holdings & prices — this only adds the account_type value, holdings
-- tracking is out of scope here), and cash-sweep/interest-bearing settlement funds
-- (distinct from a plain savings account).
--
-- NOTE: this repo's migrator (drizzle-orm's `migrate()`) runs ALL pending migration
-- files inside a single wrapping transaction, and `ALTER TYPE ... ADD VALUE` is not
-- safe to rely on inside any transaction block that a migration runner controls (in
-- older Postgres it's outright forbidden in a transaction block at all; even where
-- allowed, the new value can't be used later in that same transaction, and a runner
-- can silently batch further migrations into the same transaction). To stay
-- transaction-safe regardless of Postgres version or how the migrator batches
-- files, we rebuild the enum type instead of appending to it in place:
--   1. rename the existing type out of the way
--   2. create a new type with the full value set (old + new)
--   3. repoint the column at the new type
--   4. drop the old type
-- This is fully transactional and idempotent-safe to re-run (guarded checks below).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_old') THEN
    RAISE NOTICE 'account_type_old already exists — migration already applied, skipping';
  ELSE
    ALTER TYPE "public"."account_type" RENAME TO "account_type_old";

    CREATE TYPE "public"."account_type" AS ENUM (
      'checking',
      'savings',
      'credit_card',
      'edu_529',
      'brokerage',
      'cash_sweep'
    );

    ALTER TABLE "accounts"
      ALTER COLUMN "account_type" TYPE "public"."account_type"
      USING "account_type"::text::"public"."account_type";

    DROP TYPE "public"."account_type_old";
  END IF;
END $$;
