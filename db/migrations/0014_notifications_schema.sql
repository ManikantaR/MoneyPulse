-- Add severity and source enums
CREATE TYPE notification_severity AS ENUM ('info', 'insight', 'warning', 'critical');
CREATE TYPE notification_source AS ENUM ('watchdog', 'freshness', 'market', 'advisor', 'budget', 'system');

-- Extend notifications table with severity, source, data, dismissed_at
ALTER TABLE "notifications"
ADD COLUMN IF NOT EXISTS "severity" notification_severity DEFAULT 'insight' NOT NULL,
ADD COLUMN IF NOT EXISTS "source" notification_source DEFAULT 'system' NOT NULL,
ADD COLUMN IF NOT EXISTS "data" jsonb DEFAULT '{}' NOT NULL,
ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp WITH TIME ZONE;

-- Index for filtering by user + severity (for bell badge) and created_at for feed ordering
CREATE INDEX IF NOT EXISTS "idx_notifications_user_severity_created" ON "notifications" ("user_id", "severity", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_notifications_user_dismissed" ON "notifications" ("user_id", "dismissed_at") WHERE "dismissed_at" IS NULL;
