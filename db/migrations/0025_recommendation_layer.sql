-- 12.1: Recommendation layer — evidence contract + decision memory.
-- Extends the existing notifications table (11.3); NOT a new table.

CREATE TYPE notification_kind AS ENUM ('insight', 'recommendation');
CREATE TYPE recommendation_confidence_band AS ENUM ('high', 'medium', 'low');
CREATE TYPE recommendation_decision AS ENUM (
  'accepted',
  'rejected',
  'dismissed',
  'snoozed',
  'not_applicable'
);

ALTER TABLE "notifications"
ADD COLUMN IF NOT EXISTS "kind" notification_kind DEFAULT 'insight' NOT NULL,
ADD COLUMN IF NOT EXISTS "action_summary" varchar(500),
ADD COLUMN IF NOT EXISTS "expected_impact" jsonb,
ADD COLUMN IF NOT EXISTS "evidence" jsonb,
ADD COLUMN IF NOT EXISTS "assumptions" jsonb,
ADD COLUMN IF NOT EXISTS "confidence_band" recommendation_confidence_band,
ADD COLUMN IF NOT EXISTS "calculation_version" varchar(50),
ADD COLUMN IF NOT EXISTS "producer" jsonb,
ADD COLUMN IF NOT EXISTS "expires_at" timestamp WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS "decision" recommendation_decision,
ADD COLUMN IF NOT EXISTS "decision_reason" text,
ADD COLUMN IF NOT EXISTS "decided_at" timestamp WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS "suppressed_reason" text;

-- Support decision-aware suppression lookups (same topic/type, latest decision first).
CREATE INDEX IF NOT EXISTS "idx_notifications_user_type_decision" ON "notifications" ("user_id", "type", "decided_at" DESC);
