-- Add nullable setup_tracker_dismissed_at to user_settings so the setup-progress
-- widget (#224 epic, sub-issue 2/4 #229) can be dismissed by the user without
-- hiding it forever: the web card re-surfaces the tracker once progress moves
-- on since the dismissal timestamp. Additive-only: nullable column, no
-- backfill, existing rows get NULL (= not dismissed).

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "setup_tracker_dismissed_at" timestamp with time zone;
