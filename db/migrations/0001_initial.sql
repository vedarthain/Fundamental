-- Initial schema for fundamental_app.
-- All app tables live under the `app` schema. golden_db (read-only) stays untouched.

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

-- Universe of stocks we cover. Synced periodically from golden.stocks (NSE active only for v1).
CREATE TABLE app.universe (
    symbol               TEXT PRIMARY KEY,
    company_name         TEXT NOT NULL,
    sector               TEXT,
    industry             TEXT,
    market_cap_category  TEXT,
    isin                 TEXT,
    listing_date         DATE,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_universe_sector ON app.universe (sector) WHERE is_active;
CREATE INDEX idx_universe_industry ON app.universe (industry) WHERE is_active;

-- Per-stock scrape state for Screener. export_id is discovered from the company page.
CREATE TABLE app.screener_meta (
    symbol                  TEXT PRIMARY KEY REFERENCES app.universe(symbol) ON DELETE CASCADE,
    export_id               TEXT,
    last_scraped_at         TIMESTAMPTZ,
    last_export_size_bytes  INT,
    last_status             TEXT,         -- ok | not_found | auth_failed | parse_error | http_error
    last_error              TEXT,
    consecutive_failures    INT NOT NULL DEFAULT 0
);

-- Raw xlsx blobs versioned by fetch timestamp. Lets us re-parse without re-scraping.
CREATE TABLE app.screener_export_raw (
    symbol           TEXT NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content          BYTEA NOT NULL,
    content_sha256   TEXT NOT NULL,
    PRIMARY KEY (symbol, fetched_at)
);
CREATE INDEX idx_export_raw_symbol_recent ON app.screener_export_raw (symbol, fetched_at DESC);

-- Parsed annual fundamentals. One row per stock × fiscal year end.
CREATE TABLE app.fundamentals_annual (
    symbol                 TEXT NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    period_end             DATE NOT NULL,
    -- P&L (rupees in crores, as reported by Screener)
    sales                  NUMERIC,
    expenses               NUMERIC,
    operating_profit       NUMERIC,
    other_income           NUMERIC,
    depreciation           NUMERIC,
    interest               NUMERIC,
    profit_before_tax      NUMERIC,
    tax                    NUMERIC,
    net_profit             NUMERIC,
    dividend_amount        NUMERIC,
    -- Balance sheet
    equity_share_capital   NUMERIC,
    reserves               NUMERIC,
    borrowings             NUMERIC,
    other_liabilities      NUMERIC,
    total_liabilities      NUMERIC,
    net_block              NUMERIC,
    cwip                   NUMERIC,
    investments            NUMERIC,
    other_assets           NUMERIC,
    total_assets           NUMERIC,
    receivables            NUMERIC,
    inventory              NUMERIC,
    cash_and_bank          NUMERIC,
    no_of_equity_shares    NUMERIC,
    -- Cash flow
    cash_from_operating    NUMERIC,
    cash_from_investing    NUMERIC,
    cash_from_financing    NUMERIC,
    net_cash_flow          NUMERIC,
    -- Annual close price (Screener's PRICE row)
    annual_close_price     NUMERIC,
    -- Provenance
    source_fetched_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (symbol, period_end)
);

-- Parsed quarterly results. Up to 10 quarters from the Screener export.
CREATE TABLE app.fundamentals_quarterly (
    symbol               TEXT NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    period_end           DATE NOT NULL,
    sales                NUMERIC,
    expenses             NUMERIC,
    other_income         NUMERIC,
    depreciation         NUMERIC,
    interest             NUMERIC,
    profit_before_tax    NUMERIC,
    tax                  NUMERIC,
    net_profit           NUMERIC,
    operating_profit     NUMERIC,
    source_fetched_at    TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (symbol, period_end)
);

-- Pipeline run log.
CREATE TABLE app.etl_run (
    id                BIGSERIAL PRIMARY KEY,
    job_name          TEXT NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at       TIMESTAMPTZ,
    status            TEXT,
    rows_processed    INT,
    rows_failed       INT,
    notes             TEXT
);
CREATE INDEX idx_etl_run_recent ON app.etl_run (job_name, started_at DESC);
