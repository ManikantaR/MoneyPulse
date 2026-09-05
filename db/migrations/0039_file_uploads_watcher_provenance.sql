-- Import Pipeline Radar Phase 1: nullable watcher-provenance columns on
-- `file_uploads`, and relaxing user_id/account_id to nullable so an
-- `orphaned` row (no matching account for the watch-folder slug) or a
-- lightweight watcher-side `failed` row can be recorded instead of silently
-- dropped. Additive/relaxing-only: no backfill, no data loss.
ALTER TABLE "file_uploads" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "file_uploads" ALTER COLUMN "account_id" DROP NOT NULL;

ALTER TABLE "file_uploads" ADD COLUMN IF NOT EXISTS "original_filename" text;
ALTER TABLE "file_uploads" ADD COLUMN IF NOT EXISTS "watcher_bank" text;
ALTER TABLE "file_uploads" ADD COLUMN IF NOT EXISTS "watcher_slug" text;
ALTER TABLE "file_uploads" ADD COLUMN IF NOT EXISTS "detected_at" timestamp with time zone;
ALTER TABLE "file_uploads" ADD COLUMN IF NOT EXISTS "staged_at" timestamp with time zone;
