ALTER TABLE "advisor_settings" ADD COLUMN IF NOT EXISTS "anthropic_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "advisor_settings" ADD COLUMN IF NOT EXISTS "openai_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "advisor_settings" ADD COLUMN IF NOT EXISTS "google_key_ciphertext" text;--> statement-breakpoint
UPDATE "advisor_settings" SET "anthropic_key_ciphertext" = "api_key_ciphertext"
  WHERE "provider" = 'anthropic' AND "api_key_ciphertext" IS NOT NULL AND "anthropic_key_ciphertext" IS NULL;--> statement-breakpoint
UPDATE "advisor_settings" SET "openai_key_ciphertext" = "api_key_ciphertext"
  WHERE "provider" = 'openai' AND "api_key_ciphertext" IS NOT NULL AND "openai_key_ciphertext" IS NULL;--> statement-breakpoint
UPDATE "advisor_settings" SET "google_key_ciphertext" = "api_key_ciphertext"
  WHERE "provider" = 'google' AND "api_key_ciphertext" IS NOT NULL AND "google_key_ciphertext" IS NULL;
