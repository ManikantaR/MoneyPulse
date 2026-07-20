-- 11.7 idle-cash detector: optional per-user buffer override (months of trailing-3-month
-- avg expenses). Nullable — null means "use the app default".
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "idle_cash_buffer_months" integer;
