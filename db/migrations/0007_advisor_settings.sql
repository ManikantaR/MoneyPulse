CREATE TABLE IF NOT EXISTS "advisor_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" varchar(20) DEFAULT 'anthropic' NOT NULL,
	"model" varchar(100),
	"api_key_ciphertext" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
