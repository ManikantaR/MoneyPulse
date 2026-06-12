CREATE TABLE "account_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"balance_cents" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_snapshot_account_date" UNIQUE("account_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "merchant_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"pattern" varchar(200) NOT NULL,
	"match_type" varchar(20) DEFAULT 'contains' NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_pattern" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"category_id" uuid,
	"expected_amount_cents" integer NOT NULL,
	"amount_tolerance_percent" integer DEFAULT 15 NOT NULL,
	"frequency" varchar(20) DEFAULT 'monthly' NOT NULL,
	"next_expected_date" timestamp with time zone,
	"last_seen_date" timestamp with time zone,
	"last_amount_cents" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "normalized_merchant_name" varchar(200);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency_code" varchar(3);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "daily_digest_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "monthly_digest_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "firebase_uid" varchar(128);--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_aliases" ADD CONSTRAINT "merchant_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_snapshot_account" ON "account_balance_snapshots" USING btree ("account_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_merchant_alias_user" ON "merchant_aliases" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bills_user_merchant" ON "recurring_bills" USING btree ("user_id","merchant_pattern");--> statement-breakpoint
CREATE INDEX "idx_bills_user" ON "recurring_bills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_bills_next_date" ON "recurring_bills" USING btree ("next_expected_date");--> statement-breakpoint
CREATE INDEX "idx_bills_active" ON "recurring_bills" USING btree ("user_id","is_active","next_expected_date");--> statement-breakpoint
CREATE INDEX "idx_attachment_txn" ON "transaction_attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_attachment_user" ON "transaction_attachments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_categories_name_parent" ON "categories" USING btree ("name","parent_id");