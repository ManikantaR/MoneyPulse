CREATE TYPE "public"."ai_prompt_type" AS ENUM('categorization', 'pdf_parse');--> statement-breakpoint
CREATE TABLE "ai_prompt_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"prompt_type" "ai_prompt_type" NOT NULL,
	"model" varchar(100) NOT NULL,
	"input_text" text NOT NULL,
	"output_text" text,
	"token_count_in" integer,
	"token_count_out" integer,
	"latency_ms" integer,
	"transactions_count" integer,
	"categories_assigned" integer,
	"avg_confidence" real,
	"pii_detected" boolean DEFAULT false NOT NULL,
	"pii_types_found" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid,
	"payload_json" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"policy_passed" boolean,
	"policy_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" varchar(64),
	"last_error_message" text,
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "sync_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"user_id" uuid,
	"action" varchar(40) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"policy_passed" boolean NOT NULL,
	"policy_reason" text,
	"signature_kid" varchar(64),
	"attempt_no" integer NOT NULL,
	"http_status" integer,
	"error_code" varchar(64),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_prompt_logs" ADD CONSTRAINT "ai_prompt_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_audit_logs" ADD CONSTRAINT "sync_audit_logs_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_audit_logs" ADD CONSTRAINT "sync_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_log_user" ON "ai_prompt_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_log_type" ON "ai_prompt_logs" USING btree ("prompt_type");--> statement-breakpoint
CREATE INDEX "idx_ai_log_created" ON "ai_prompt_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_status_next_attempt" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_user_created" ON "outbox_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_aggregate" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "idx_sync_audit_outbox" ON "sync_audit_logs" USING btree ("outbox_event_id");--> statement-breakpoint
CREATE INDEX "idx_sync_audit_created" ON "sync_audit_logs" USING btree ("created_at");