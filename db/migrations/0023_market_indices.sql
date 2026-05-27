-- Daily OHLC for Indian market indices (NIFTY 50, SENSEX, sectoral indices).
--
-- Powers the /market overview page: index strip at the top, sparkline
-- charts, 1D/1W/1M/1Y returns, and serves as a benchmark for stock-level
-- relative performance later.
--
-- Why a NEW table instead of overloading golden.price_history:
--   golden.price_history is keyed on (symbol, date, interval) where symbol
--   maps to NSE equity scrips. Indices aren't equity — they're computed
--   composites with their own naming conventions ("NIFTY 50" vs "NSE:^NIFTY"
--   vs yfinance "^NSEI"). Mixing them would pollute every existing query
--   that filters on the equity universe. A dedicated table is cleaner and
--   simpler to grant separate read permissions to later if needed.
--
-- Source: NSE archives — daily index CSV at
--   https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
-- which lists EVERY index NSE computes (~100 indices) for that day, with
-- open / high / low / close. We filter at ETL time to the curated list
-- (see scripts/fetch-indices.py INDEX_WHITELIST) so we don't accumulate
-- noise from niche thematic indices nobody uses.
--
-- Primary key (index_code, date) guarantees idempotency — re-running the
-- fetcher for the same day is a safe no-op via ON CONFLICT DO UPDATE.
-- pct_change is stored even though it's derivable, because deriving it
-- requires a self-join on the previous trading day (more expensive than
-- the ETL doing it once at write time).

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.market_index_history (
    index_code   text          NOT NULL,
    -- Stable internal code: "NIFTY50", "SENSEX", "NIFTYBANK", etc.
    -- Whitelist enforced at ETL time; this column itself stays free-form
    -- so we don't need a migration every time we add a new index later.

    date         date          NOT NULL,
    open         numeric(14,4),
    high         numeric(14,4),
    low          numeric(14,4),
    close        numeric(14,4) NOT NULL,
    prev_close   numeric(14,4),
    -- Stored alongside close so we can render daily change without
    -- joining to the prior trading day in every query.

    pct_change   numeric(8,4),
    -- (close - prev_close) / prev_close * 100. ETL computes this from
    -- prev_close when available; falls back to NULL on a backfill row
    -- whose prior day isn't yet inserted.

    display_name text          NOT NULL,
    -- "NIFTY 50", "S&P BSE SENSEX" — what we render on the page.
    -- Lives in this table (denormalised) rather than a separate
    -- registry table because the list rarely changes and joins are
    -- pure overhead for ~12 known rows per snapshot.

    PRIMARY KEY (index_code, date)
);

-- Common queries:
--   * Latest close per index: SELECT MAX(date) per index_code
--   * Time series for a chart: WHERE index_code = ? ORDER BY date
--   * Today's leaderboard: WHERE date = (max date) ORDER BY pct_change DESC
-- A single descending date index serves all of them well.
CREATE INDEX IF NOT EXISTS market_index_history_date_idx
    ON app.market_index_history (date DESC);

COMMENT ON TABLE app.market_index_history IS
'Daily OHLC for curated NSE/BSE indices. Source: NSE archives index CSV.
PK (index_code, date) makes the ETL idempotent. pct_change is stored at
write time so /market queries stay single-row reads.';

-- Permissions
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE ON app.market_index_history TO fundamental_app;
    END IF;
END $$;
