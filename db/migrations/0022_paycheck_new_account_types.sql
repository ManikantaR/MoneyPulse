-- 11.11: New account types for 529 education savings, brokerage/index-fund accounts
-- (ties into #118 holdings & prices — this only adds the account_type value, holdings
-- tracking is out of scope here), and cash-sweep/interest-bearing settlement funds
-- (distinct from a plain savings account).
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement that
-- USES the new value, so this migration only adds the enum values — nothing else.
ALTER TYPE "public"."account_type" ADD VALUE IF NOT EXISTS 'edu_529';
--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE IF NOT EXISTS 'brokerage';
--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE IF NOT EXISTS 'cash_sweep';
