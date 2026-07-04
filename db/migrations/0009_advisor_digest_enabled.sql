ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "advisor_digest_enabled" boolean DEFAULT false NOT NULL;
