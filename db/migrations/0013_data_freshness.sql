-- Add freshness_threshold_days to user_settings (default 14 days)
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "freshness_threshold_days" integer DEFAULT 14 NOT NULL;

-- Add expected_import_cadence_days and is_dormant to accounts
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "expected_import_cadence_days" integer;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_dormant" boolean DEFAULT false NOT NULL;
