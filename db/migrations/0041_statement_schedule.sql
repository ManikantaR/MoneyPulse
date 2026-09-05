-- Import Pipeline Radar Phase 4: `statement_schedule` — the auto-learned (or
-- manually set) per-account expectation of when the next statement/import
-- should land, so an absence (no file, no event) can be detected against a
-- schedule instead of going unnoticed. See statement-schedule.service.ts.
DO $$ BEGIN
  CREATE TYPE "public"."statement_cadence" AS ENUM ('monthly', 'weekly', 'biweekly', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."statement_schedule_source" AS ENUM ('learned', 'manual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "statement_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL UNIQUE REFERENCES "public"."accounts"("id"),
  "cadence" "public"."statement_cadence" NOT NULL,
  "expected_day_of_month" integer,
  "cadence_days" integer,
  "grace_days" integer NOT NULL DEFAULT 5,
  "last_satisfied_at" timestamp with time zone,
  "snoozed_until" timestamp with time zone,
  "source" "public"."statement_schedule_source" NOT NULL DEFAULT 'learned',
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_statement_schedule_account_id"
  ON "statement_schedule" USING btree ("account_id");
