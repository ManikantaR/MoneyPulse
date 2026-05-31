ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "original_amount_cents" INTEGER;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3);
