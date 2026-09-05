-- Import Pipeline Radar Phase 1: adds three new `upload_status` values so
-- silent import-pipeline gaps become visible in `file_uploads` instead of
-- being dropped or misreported:
--   'orphaned' — a file staged under a watch-folder slug with no matching
--                MoneyPulse account (or an unsupported file type), previously
--                silently dropped with no file_uploads row at all.
--   'empty'    — a parse completed with 0 rows imported and 0 row errors
--                (e.g. every row was a duplicate), previously indistinguishable
--                from a healthy 'completed' import.
--   'stalled'  — the Phase 0 stalled-upload sweep's proper status; it
--                previously reused 'failed'.
--
-- Same rebuild approach as 0033/0035/0036 — this repo's migrator runs all
-- pending migration files inside a single wrapping transaction, and
-- `ALTER TYPE ... ADD VALUE` is not safe to rely on inside a transaction
-- block a migration runner controls. Rebuild the enum type instead of
-- appending to it in place:
--   1. rename the existing type out of the way
--   2. create a new type with the full value set (old + new)
--   3. repoint the column(s) at the new type
--   4. drop the old type
-- Fully transactional and idempotent-safe to re-run (guarded checks below).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upload_status_old') THEN
    RAISE NOTICE 'upload_status_old already exists — migration already applied, skipping';
  ELSE
    ALTER TYPE "public"."upload_status" RENAME TO "upload_status_old";

    CREATE TYPE "public"."upload_status" AS ENUM (
      'pending',
      'processing',
      'completed',
      'failed',
      'orphaned',
      'empty',
      'stalled'
    );

    ALTER TABLE "file_uploads"
      ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "file_uploads"
      ALTER COLUMN "status" TYPE "public"."upload_status"
      USING "status"::text::"public"."upload_status";
    ALTER TABLE "file_uploads"
      ALTER COLUMN "status" SET DEFAULT 'pending';

    DROP TYPE "public"."upload_status_old";
  END IF;
END $$;
