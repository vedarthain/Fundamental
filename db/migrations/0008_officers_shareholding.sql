-- 0008_officers_shareholding.sql
-- Phase B data: CEO/MD details on app.universe + a new app.shareholding_pattern
-- table (quarterly snapshots scraped from Screener company page HTML).
--
-- The shareholding table is append-only by (symbol, period_end). We re-parse
-- on every scrape; ON CONFLICT keeps the latest values for the same period.

-- 1. Officers / CEO on universe ---------------------------------------------
ALTER TABLE app.universe
  ADD COLUMN IF NOT EXISTS ceo_name            TEXT,
  ADD COLUMN IF NOT EXISTS ceo_title           TEXT,
  -- Full officers list (name, title, age, etc.) as returned by yfinance.
  ADD COLUMN IF NOT EXISTS key_officers        JSONB,
  ADD COLUMN IF NOT EXISTS officers_fetched_at TIMESTAMPTZ;

-- 2. Shareholding pattern (quarterly) ---------------------------------------
CREATE TABLE IF NOT EXISTS app.shareholding_pattern (
    symbol         TEXT NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    -- Quarter-end date (Mar/Jun/Sep/Dec). Always the last day of the quarter.
    period_end     DATE NOT NULL,
    promoter_pct   NUMERIC(5,2),
    fii_pct        NUMERIC(5,2),
    dii_pct        NUMERIC(5,2),
    government_pct NUMERIC(5,2),
    public_pct     NUMERIC(5,2),
    -- Total shareholders count (sometimes appears in the same table).
    shareholders   BIGINT,
    parsed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (symbol, period_end)
);

CREATE INDEX IF NOT EXISTS idx_shareholding_recent
  ON app.shareholding_pattern (period_end DESC);

CREATE INDEX IF NOT EXISTS idx_shareholding_symbol
  ON app.shareholding_pattern (symbol, period_end DESC);
