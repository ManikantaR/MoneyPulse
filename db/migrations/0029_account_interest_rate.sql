-- Add nullable interest_rate_bps to accounts so interest-bearing accounts
-- (savings, cash_sweep, etc.) can record their own APY directly.
-- Additive-only: nullable column, no backfill, existing rows get NULL.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "interest_rate_bps" integer;
