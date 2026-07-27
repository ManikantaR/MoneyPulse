-- 13.1 Monthly close, manual assets, and loan balance snapshots (schema-only slice).
-- Additive-only: new tables + two new nullable columns on suitability_settings. No
-- backfill needed and no existing reads are affected.
--
-- Deviations from the original spec doc, per epic #158 "Resolved decisions" (these
-- override the spec body):
--   - manual_assets: no household_id (user-scoped only, decision #5).
--   - monthly_financial_snapshots: no household_id (decision #5); adds edited_at +
--     is_edited for the lightweight audit approach instead of a separate events
--     table (decision #6).
--   - monthly_snapshot_events is intentionally NOT created (decision #6).
--   - suitability_settings gets employer_match_bps / employer_match_limit_cents
--     (decision #12), appended via the table's existing versioned/append-only
--     pattern — no backfill of historical versions.

CREATE TABLE IF NOT EXISTS "manual_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" varchar(120) NOT NULL,
  "asset_type" varchar(30) NOT NULL, -- home | car | gold | other
  "liquidity_class" varchar(30) NOT NULL, -- liquid | semi_liquid | illiquid
  "is_depreciating" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "idx_manual_assets_user" ON "manual_assets" ("user_id");

CREATE TABLE IF NOT EXISTS "manual_asset_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "manual_asset_id" uuid NOT NULL REFERENCES "manual_assets"("id"),
  "snapshot_month" date NOT NULL, -- first day of month
  "value_cents" integer NOT NULL,
  "source" varchar(40) NOT NULL DEFAULT 'manual', -- manual | estimate | imported
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_manual_asset_snapshots_asset_month"
  ON "manual_asset_snapshots" ("manual_asset_id", "snapshot_month");

CREATE TABLE IF NOT EXISTS "loan_balance_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" uuid NOT NULL REFERENCES "loans"("id"),
  "snapshot_month" date NOT NULL,
  "balance_cents" integer NOT NULL,
  "source" varchar(40) NOT NULL, -- amortized | manual_statement
  "verified_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_loan_balance_snapshots_loan_month_source"
  ON "loan_balance_snapshots" ("loan_id", "snapshot_month", "source");

CREATE TABLE IF NOT EXISTS "monthly_financial_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "snapshot_month" date NOT NULL, -- first day of month
  "status" varchar(20) NOT NULL DEFAULT 'draft', -- draft | confirmed

  "take_home_income_cents" integer NOT NULL DEFAULT 0,
  "gross_income_cents" integer,
  "expense_cents" integer NOT NULL DEFAULT 0,
  "fixed_expense_cents" integer NOT NULL DEFAULT 0,
  "variable_expense_cents" integer NOT NULL DEFAULT 0,

  "cash_savings_cents" integer NOT NULL DEFAULT 0,
  "investment_contribution_cents" integer NOT NULL DEFAULT 0,
  "debt_principal_paid_cents" integer NOT NULL DEFAULT 0,
  "extra_debt_principal_paid_cents" integer NOT NULL DEFAULT 0,

  "liquid_asset_cents" integer NOT NULL DEFAULT 0,
  "investment_asset_cents" integer NOT NULL DEFAULT 0,
  "manual_asset_cents" integer NOT NULL DEFAULT 0,
  "total_asset_cents" integer NOT NULL DEFAULT 0,

  "credit_card_liability_cents" integer NOT NULL DEFAULT 0,
  "loan_liability_cents" integer NOT NULL DEFAULT 0,
  "total_liability_cents" integer NOT NULL DEFAULT 0,
  "net_worth_cents" integer NOT NULL DEFAULT 0,

  "savings_rate_bps" integer, -- cash_savings / take_home_income
  "investing_rate_bps" integer, -- investment_contribution / take_home_income
  "debt_paydown_rate_bps" integer, -- debt principal / take_home_income
  "wealth_building_rate_bps" integer, -- savings + investments + principal / take_home_income
  "expense_ratio_bps" integer, -- expenses / take_home_income
  "liquid_net_worth_ratio_bps" integer, -- liquid assets / net worth
  "debt_asset_ratio_bps" integer, -- total liabilities / total assets
  "debt_payment_income_ratio_bps" integer,

  "target_status" jsonb NOT NULL DEFAULT '{}',
  "freshness" jsonb NOT NULL DEFAULT '{}',
  "calculation_version" varchar(30) NOT NULL,
  "notes" text,
  "ai_review" text,
  -- Lightweight audit trail (decision #6): confirmed snapshots stay editable;
  -- edits stamp these two fields instead of writing to a separate events table.
  "edited_at" timestamptz,
  "is_edited" boolean NOT NULL DEFAULT false,
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_monthly_financial_snapshots_user_month"
  ON "monthly_financial_snapshots" ("user_id", "snapshot_month");

-- Employer 401k match fields (decision #12) — added to the existing versioned,
-- append-only suitability_settings table. Nullable so historical versions (and any
-- version written before the FOO overlay reads this) are unaffected.
ALTER TABLE "suitability_settings"
  ADD COLUMN IF NOT EXISTS "employer_match_bps" integer,
  ADD COLUMN IF NOT EXISTS "employer_match_limit_cents" integer;
