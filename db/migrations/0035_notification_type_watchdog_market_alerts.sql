-- #watchdog-market-alerts: 16 notification types dispatched via
-- NotificationsService.createAndDispatch are missing from the notification_type
-- enum (and DEFAULT_PREFERENCES), so NotificationPreferencesService downgrades
-- them to in-app-only delivery, silently dropping Telegram and Home Assistant
-- routing. This registers the sixteen missing values.
--
-- NOTE: this repo's migrator (drizzle-orm's `migrate()`) runs ALL pending migration
-- files inside a single wrapping transaction, and `ALTER TYPE ... ADD VALUE` is not
-- safe to rely on inside any transaction block that a migration runner controls (in
-- older Postgres it's outright forbidden in a transaction block at all; even where
-- allowed, the new value can't be used later in that same transaction, and a runner
-- can silently batch further migrations into the same transaction). To stay
-- transaction-safe regardless of Postgres version or how the migrator batches
-- files, we rebuild the enum type instead of appending to it in place (same
-- approach as 0033_notification_type_digest_advisor_coach.sql):
--   1. rename the existing type out of the way
--   2. create a new type with the full value set (old + new)
--   3. repoint the column(s) at the new type
--   4. drop the old type
-- This is fully transactional and idempotent-safe to re-run (guarded checks below).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type_old') THEN
    RAISE NOTICE 'notification_type_old already exists — migration already applied, skipping';
  ELSE
    ALTER TYPE "public"."notification_type" RENAME TO "notification_type_old";

    CREATE TYPE "public"."notification_type" AS ENUM (
      'loan_payment_due',
      'loan_payment_missed',
      'bill_due',
      'budget_overage',
      'anomaly_detected',
      'data_freshness',
      'market_event',
      'advisor_insight',
      'system_alert',
      'daily_brief',
      'digest',
      'advisor_digest',
      'advisor_review',
      'bill_overdue',
      'benchmark_rate_move',
      'idle_cash',
      'investment_coach_contribution',
      'savings_coach',
      'monthly_close_freshness_nudge',
      'subscription_price_increase',
      'budget_alert',
      'savings_milestone',
      'balance_reminder',
      'cashflow_low',
      'spending_anomaly',
      'refi_opportunity',
      'market_update',
      'duplicate_charge',
      'new_recurring',
      'price_creep',
      'fee_detected',
      'budget_pace',
      'stat_anomaly',
      'fuel_vs_market',
      'power_vs_market'
    );

    ALTER TABLE "notification_preferences"
      ALTER COLUMN "notification_type" TYPE "public"."notification_type"
      USING "notification_type"::text::"public"."notification_type";

    DROP TYPE "public"."notification_type_old";
  END IF;
END $$;
