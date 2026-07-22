-- 12.3 Treasury yields, rate watchlist, earned APY.
-- Additive-only: new nullable-safe column with a default, and a new table. No
-- backfill needed and no existing reads are affected.

ALTER TABLE "market_metrics"
  ADD COLUMN IF NOT EXISTS "state_tax_exempt" boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "watchlist_product_type" AS ENUM ('hysa', 'cd', 'mmf', 'treasury');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "rate_watchlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "institution" varchar(200) NOT NULL,
  "product_type" "watchlist_product_type" NOT NULL,
  "apy_bps" integer NOT NULL,
  "term_months" integer,
  "notes" varchar(1000),
  "source" varchar(16) NOT NULL DEFAULT 'user',
  "updated_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now(),
  "created_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_rate_watchlist_user" ON "rate_watchlist" ("user_id");
