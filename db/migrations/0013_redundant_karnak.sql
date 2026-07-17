ALTER TYPE "public"."ai_prompt_type" ADD VALUE 'advisor';--> statement-breakpoint
CREATE TABLE "advisor_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" varchar(20) DEFAULT 'anthropic' NOT NULL,
	"model" varchar(100),
	"api_key_ciphertext" text,
	"anthropic_key_ciphertext" text,
	"openai_key_ciphertext" text,
	"google_key_ciphertext" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"lender_pattern" varchar(200) NOT NULL,
	"loan_type" varchar(30) DEFAULT 'mortgage' NOT NULL,
	"original_balance_cents" integer NOT NULL,
	"apr_bps" integer NOT NULL,
	"term_months" integer,
	"start_date" date NOT NULL,
	"scheduled_payment_cents" integer NOT NULL,
	"extra_principal_pattern" varchar(200),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "expected_import_cadence_days" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_dormant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "advisor_digest_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "telegram_notifications_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "freshness_threshold_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;