-- Index membership: which symbols belong to which tracked Nifty index.
--
-- Powers the expandable constituents view on /indices. NSE publishes one
-- "list" CSV per index (archives.nseindia.com/content/indices/
-- ind_nifty<name>list.csv) with Company / Symbol / Industry / ISIN. The
-- ingest script scripts/fetch-index-constituents.py upserts those here.
--
-- Why a dedicated table (not universe flags): app.universe only carries
-- is_nifty50 / is_nifty200 / is_nifty500 booleans — three indices, and one
-- column per index doesn't scale to the 14 we display (sectoral + broad).
-- A (index_code, symbol) membership table holds all of them in one shape
-- and lets a new index be added by the ingest script alone, no migration.
--
-- Symbol convention: bare NSE symbol WITHOUT ".NS" (e.g. "RELIANCE"),
-- matching app.screener_meta.symbol / app.universe.symbol so the
-- constituents endpoint can join live prices directly. The golden daily
-- series uses "<symbol>.NS"; the API adds the suffix at that boundary.
--
-- Refresh cadence: membership changes only at NSE's semi-annual rebalance,
-- so a weekly (or even monthly) re-run of the ingest is ample. The script
-- replaces each index's rows atomically, so dropped names disappear and
-- added names appear on the next run.
--
-- index_code matches market_index_history / market_index_intraday so the
-- board can join an index's level to its members.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.index_constituent (
    index_code   text NOT NULL,
    -- Internal index code, e.g. "NIFTYIT" (= market_index_history.index_code).

    symbol       text NOT NULL,
    -- Bare NSE symbol (no ".NS"), = screener_meta.symbol.

    company_name text,
    -- Display name from the NSE CSV ("Company Name" column). Nullable so a
    -- membership row survives even if NSE omits the name.

    refreshed_at timestamptz NOT NULL DEFAULT now(),
    -- When the ingest last wrote this row; lets the UI show data age.

    PRIMARY KEY (index_code, symbol)
);

-- Primary read pattern: "all members of one index" → index_code prefix.
CREATE INDEX IF NOT EXISTS index_constituent_code_idx
    ON app.index_constituent (index_code);

-- Secondary: "which indices is this symbol in" (reverse lookup, future use).
CREATE INDEX IF NOT EXISTS index_constituent_symbol_idx
    ON app.index_constituent (symbol);

COMMENT ON TABLE app.index_constituent IS
'Index membership (index_code, symbol) seeded from NSE per-index list CSVs by
scripts/fetch-index-constituents.py. Drives the /indices constituents view.
Refreshed on NSE rebalances (weekly/monthly cron is plenty).';

-- Permissions
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.index_constituent TO fundamental_app;
    END IF;
END $$;
