-- 12.2 Holdings & security prices: user-declared ticker/share-count holdings and
-- autonomous EOD price history (Stooq primary, Alpha Vantage fallback for mutual-fund
-- NAVs). Both append-only, same history-kept pattern as investment_snapshots.

CREATE TABLE IF NOT EXISTS "investment_holdings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investment_account_id" uuid NOT NULL REFERENCES "investment_accounts"("id"),
  "ticker" varchar(20) NOT NULL,
  "share_count" numeric(20, 6) NOT NULL,
  "as_of" date NOT NULL,
  "notes" varchar(500),
  "created_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_investment_holdings_account"
  ON "investment_holdings" ("investment_account_id", "ticker", "as_of" DESC);

-- Global (not user-scoped) — same public-time-series shape as market_metrics.
-- Only tickers actually held are fetched (see SecurityPricesService).
CREATE TABLE IF NOT EXISTS "security_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticker" varchar(20) NOT NULL,
  "price_date" date NOT NULL,
  "close_cents" integer NOT NULL,
  "currency" varchar(8) NOT NULL DEFAULT 'USD',
  "source" varchar(16) NOT NULL,
  "fetched_at" timestamp WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_security_prices_ticker_date"
  ON "security_prices" ("ticker", "price_date");

CREATE INDEX IF NOT EXISTS "idx_security_prices_ticker_latest"
  ON "security_prices" ("ticker", "price_date" DESC);
