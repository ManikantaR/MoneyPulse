-- Add nullable interest_rate_bps to investment_accounts so a cash-equivalent position
-- inside a brokerage account (money-market fund, cash sweep balance) can declare its own
-- yield, the same way accounts.interest_rate_bps does for checking/savings (see 0029).
-- Additive-only: nullable column, no backfill, existing rows get NULL.

ALTER TABLE "investment_accounts" ADD COLUMN IF NOT EXISTS "interest_rate_bps" integer;
