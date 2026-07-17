-- Create push_subscriptions table for Web Push (self-hosted)
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  -- Web Push subscription endpoint (from browser PushSubscription.endpoint)
  "endpoint" text NOT NULL,
  -- Encrypted key material (p256dh + auth from PushSubscription.getKey())
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  -- User agent / device identifier (optional, for debugging)
  "user_agent" varchar(500),
  -- Last successful delivery timestamp
  "last_delivery_at" timestamp WITH TIME ZONE,
  "created_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Composite unique on (user_id, endpoint) to prevent duplicates
  UNIQUE("user_id", "endpoint")
);

CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user" ON "push_subscriptions" ("user_id");
