-- 11.4 Daily morning brief: settings + insight batching support

-- New notification_type value for the brief message itself (routes through
-- notification_preferences like any other type; default channels below).
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'daily_brief';

ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "daily_brief_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "daily_brief_hour" integer NOT NULL DEFAULT 7;

-- Marks an insight as already folded into a delivered brief so it is never
-- batched (and thus never sent) twice.
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "briefed_at" timestamp WITH TIME ZONE;
