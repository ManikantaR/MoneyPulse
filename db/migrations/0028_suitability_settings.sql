-- 12.4 Suitability settings & investment policy.
-- Additive-only: new enum + new table. No backfill needed and no existing reads
-- are affected. Versioned/append-only by design — see schema.ts comment.

DO $$ BEGIN
  CREATE TYPE "risk_tolerance" AS ENUM ('conservative', 'moderate', 'aggressive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "suitability_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "version" integer NOT NULL,
  "emergency_fund_target_months" integer NOT NULL DEFAULT 6,
  "liquidity_horizon_months" integer,
  "risk_tolerance" "risk_tolerance",
  "tax_state" varchar(2),
  "monthly_investing_target_cents" integer,
  "target_allocation" jsonb NOT NULL DEFAULT '[]',
  "ticker_asset_class_map" jsonb NOT NULL DEFAULT '{}',
  "dca_day_of_month" integer,
  "dca_amount_cents" integer,
  "created_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_suitability_settings_user_version"
  ON "suitability_settings" ("user_id", "version");
CREATE INDEX IF NOT EXISTS "idx_suitability_settings_user_created"
  ON "suitability_settings" ("user_id", "created_at" DESC);
