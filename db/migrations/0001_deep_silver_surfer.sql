DO $$
BEGIN
    -- Conditionally rename enum value to avoid errors on fresh databases
    -- where 'startsWith' does not exist (0000 migration already uses 'starts_with').
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public'
          AND t.typname = 'rule_match_type'
          AND e.enumlabel = 'startsWith'
    ) THEN
        ALTER TYPE "public"."rule_match_type" RENAME VALUE 'startsWith' TO 'starts_with';
    END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "categorization_rules" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "categorization_rules" ALTER COLUMN "confidence" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "csv_format_config" jsonb;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;