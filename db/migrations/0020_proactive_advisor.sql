-- 11.9 proactive advisor: standing weekly/monthly AI review into the insights feed.
-- Default OFF (opt-in) — no cloud LLM run happens for a user until they enable it.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "proactive_advisor_enabled" boolean NOT NULL DEFAULT false;
