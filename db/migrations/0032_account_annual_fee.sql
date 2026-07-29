-- Add nullable annual_fee_cents to accounts so premium credit cards (Amex
-- Gold/Platinum style) can record their annual fee for the "is this card
-- worth it" calculator (statement credits received vs. fee paid, #142).
-- Additive-only: nullable column, no backfill, existing rows get NULL.

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "annual_fee_cents" integer;
