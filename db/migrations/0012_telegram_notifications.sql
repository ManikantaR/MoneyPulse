ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "telegram_notifications_enabled" boolean DEFAULT false NOT NULL;
