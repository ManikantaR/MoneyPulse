-- Notification type and mode enums
CREATE TYPE notification_type AS ENUM (
  'loan_payment_due',
  'loan_payment_missed',
  'bill_due',
  'budget_overage',
  'anomaly_detected',
  'data_freshness',
  'market_event',
  'advisor_insight',
  'system_alert'
);

CREATE TYPE notification_mode AS ENUM ('instant', 'brief', 'off');
CREATE TYPE notification_channel AS ENUM ('inApp', 'telegram', 'webPush', 'email', 'haWebhook');

-- Create notification_preferences table with channels matrix
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "notification_type" notification_type NOT NULL,
  -- Mode: instant, brief (batched), or off
  "mode" notification_mode NOT NULL DEFAULT 'instant',
  -- JSON array of enabled channels: ["inApp", "telegram", "webPush", "email", "haWebhook"]
  "enabled_channels" jsonb NOT NULL DEFAULT '["inApp"]',
  "created_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE("user_id", "notification_type")
);

CREATE INDEX IF NOT EXISTS "idx_notification_prefs_user" ON "notification_preferences" ("user_id");

-- Add quiet hours to user_settings
ALTER TABLE "user_settings"
ADD COLUMN IF NOT EXISTS "quiet_hours_start" time DEFAULT '22:00',
ADD COLUMN IF NOT EXISTS "quiet_hours_end" time DEFAULT '08:00';
