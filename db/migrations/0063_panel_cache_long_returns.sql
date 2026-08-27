-- Add longer-horizon price returns to the per-stock panel cache so the
-- watchlist (and /sectors) can show 6M / 2Y / 5Y / 10Y / ALL moves without
-- a live golden_db query. These are PRECOMPUTED weekly during the ETL
-- `score` run (see _refresh_stocks_panel_cache), same as ret_1w/1m/1y.
--
-- Stored as fractions (e.g. 0.24 = +24%). NULL when no price history exists
-- at that horizon (a young listing simply has no 5Y/10Y/ALL point yet).
--
-- ret_all is the return since the EARLIEST adjusted-close bar golden has for
-- the symbol — a "since inception (as far as we can see)" number. Because the
-- window can span a decade+, the plausibility cap on it is deliberately loose
-- (a genuine 100-bagger must survive); it only nulls physically-absurd values
-- that come from golden's occasional split-scale defects.

SET search_path = app, public;

ALTER TABLE app.cluster_stocks_panel_cache
    ADD COLUMN IF NOT EXISTS ret_6m  numeric,
    ADD COLUMN IF NOT EXISTS ret_2y  numeric,
    ADD COLUMN IF NOT EXISTS ret_5y  numeric,
    ADD COLUMN IF NOT EXISTS ret_10y numeric,
    ADD COLUMN IF NOT EXISTS ret_all numeric;

COMMENT ON COLUMN app.cluster_stocks_panel_cache.ret_6m IS
'Per-stock 6-month price return (fraction, split-adjusted). NULL if no history.';
COMMENT ON COLUMN app.cluster_stocks_panel_cache.ret_2y IS
'Per-stock 2-year price return (fraction, split-adjusted). NULL if no history.';
COMMENT ON COLUMN app.cluster_stocks_panel_cache.ret_5y IS
'Per-stock 5-year price return (fraction, split-adjusted). NULL if no history.';
COMMENT ON COLUMN app.cluster_stocks_panel_cache.ret_10y IS
'Per-stock 10-year price return (fraction, split-adjusted). NULL if no history.';
COMMENT ON COLUMN app.cluster_stocks_panel_cache.ret_all IS
'Per-stock return since earliest adjusted-close bar in golden (fraction). NULL if no history.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
          ON app.cluster_stocks_panel_cache TO fundamental_app;
    END IF;
END $$;
