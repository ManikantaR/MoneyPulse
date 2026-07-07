CREATE TABLE IF NOT EXISTS "loans" (
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
DO $$ BEGIN
 ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_loans_user" ON "loans" USING btree ("user_id");
