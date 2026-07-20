-- 11.6 Market-data module: public time-series metrics (EIA gas/electricity, FRED rates).
-- Global, not user-scoped. Append-only; upserts keyed on (metric_key, region, period_date).

CREATE TABLE IF NOT EXISTS "market_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "metric_key" varchar(64) NOT NULL,
  "region" varchar(16),
  "period_date" date NOT NULL,
  "value" numeric(14, 4) NOT NULL,
  "unit" varchar(32) NOT NULL,
  "source" varchar(16) NOT NULL,
  "fetched_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_market_metrics_key_region_period"
  ON "market_metrics" ("metric_key", "region", "period_date");

CREATE INDEX IF NOT EXISTS "idx_market_metrics_key_period"
  ON "market_metrics" ("metric_key", "period_date");
