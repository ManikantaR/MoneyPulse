ALTER TYPE "public"."rule_match_type" RENAME VALUE 'startsWith' TO 'starts_with';--> statement-breakpoint
ALTER TABLE "categorization_rules" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "categorization_rules" ALTER COLUMN "confidence" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "csv_format_config" jsonb;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;