-- Cash-flow shortfall radar: configurable per-user floor (in cents) that the
-- forecasted checking balance is compared against before an upcoming recurring
-- bill. Additive-only: nullable column, no backfill; NULL means "use the
-- $500 default" (see shortfall-detector.service.ts DEFAULT_CASHFLOW_FLOOR_CENTS).
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "cashflow_floor_cents" integer;
