-- Phase 14 S2: the laptop watcher agent's heartbeat record, and the
-- server-side alarm episodes derived from it (silence, unhealthy,
-- staged-not-ingested, import-failed). See watcher-agent.service.ts and
-- specs/PHASE14-IMPORT-VISIBILITY-SPEC.md "Data Model".
--
-- `key_hash` is nullable up front per the spec's resolved review outcome
-- (3): either answer to Open Question 2 (per-agent key vs shared
-- INGEST_API_KEY) needs no further migration.
CREATE TABLE IF NOT EXISTS "watcher_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
  "agent_id" varchar(64) NOT NULL UNIQUE,
  "key_hash" varchar(128),
  "version" varchar(100),
  "process_path" text,
  "python_version" varchar(32),
  "started_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_diagnostics" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_watcher_agents_user_id" ON "watcher_agents" USING btree ("user_id");

-- One open (unresolved) episode per user+type+scope. `scope_key` is the
-- agentId (watcher_silent/watcher_unhealthy) or the fileKey/uploadId
-- (staged_not_ingested/import_failed). Partial unique index instead of a
-- table constraint so a new episode can open again after the previous one
-- resolves.
CREATE TABLE IF NOT EXISTS "pipeline_alarms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
  "type" varchar(64) NOT NULL,
  "scope_key" varchar(255) NOT NULL,
  "severity" varchar(16) NOT NULL DEFAULT 'warning',
  "opened_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_notified_at" timestamp with time zone,
  "snoozed_until" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "notification_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_pipeline_alarms_open_episode"
  ON "pipeline_alarms" USING btree ("user_id", "type", "scope_key")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_pipeline_alarms_user_id" ON "pipeline_alarms" USING btree ("user_id");
