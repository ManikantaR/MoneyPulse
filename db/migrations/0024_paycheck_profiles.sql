-- 11.11: Paycheck profiles — manually-entered, effective-dated paystub figures used to
-- model actual take-home pay. Each pay change (raise, new deduction, benefits election)
-- is a new row keyed by (user_id, effective_date) rather than a mutated existing row.
DO $$ BEGIN
  CREATE TYPE "public"."pay_frequency" AS ENUM ('weekly', 'biweekly', 'semi_monthly', 'monthly');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paycheck_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "effective_date" date NOT NULL,
  "pay_frequency" "pay_frequency" NOT NULL,
  "gross_pay_cents" integer NOT NULL,
  "federal_tax_cents" integer DEFAULT 0 NOT NULL,
  "state_tax_cents" integer DEFAULT 0 NOT NULL,
  "social_security_cents" integer DEFAULT 0 NOT NULL,
  "medicare_cents" integer DEFAULT 0 NOT NULL,
  "pretax_401k_cents" integer DEFAULT 0 NOT NULL,
  "hsa_cents" integer DEFAULT 0 NOT NULL,
  "medical_premium_cents" integer DEFAULT 0 NOT NULL,
  "dental_premium_cents" integer DEFAULT 0 NOT NULL,
  "vision_premium_cents" integer DEFAULT 0 NOT NULL,
  "commuter_cents" integer DEFAULT 0 NOT NULL,
  "parking_cents" integer DEFAULT 0 NOT NULL,
  "other_pretax_cents" integer DEFAULT 0 NOT NULL,
  "supplemental_life_cents" integer DEFAULT 0 NOT NULL,
  "legal_cents" integer DEFAULT 0 NOT NULL,
  "accident_insurance_cents" integer DEFAULT 0 NOT NULL,
  "other_posttax_cents" integer DEFAULT 0 NOT NULL,
  "espp_contribution_cents" integer DEFAULT 0 NOT NULL,
  "espp_discount_percent" integer,
  "employer_401k_match_cents" integer DEFAULT 0 NOT NULL,
  "employer_health_contribution_cents" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "paycheck_profiles" ADD CONSTRAINT "paycheck_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_paycheck_profiles_user_effective_date" ON "paycheck_profiles" USING btree ("user_id", "effective_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_paycheck_profiles_user_effective_date" ON "paycheck_profiles" USING btree ("user_id", "effective_date" DESC);
