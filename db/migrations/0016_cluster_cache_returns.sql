-- Materialise cluster-level price returns in the cache table.
--
-- Background: /sectors loaded in ~8s on cold start because it joined
-- app.cluster_composite_cache (instant) with a live golden_db query that
-- computed per-symbol prices at 4 horizons across 2,150 symbols, then
-- weighted-averaged them per cluster. Even after rewriting that query as
-- a single scan it remained 3-4s on cold golden_db.
--
-- Fix: compute the cluster-weighted returns once during the ETL score run
-- (which already touches both DBs) and store them in this cache table.
-- /sectors becomes a single 46-row read from app DB — no golden_db hit.
--
-- Returns are MARKET-CAP-WEIGHTED across the stocks in each cluster, so a
-- cluster's headline number reflects the heavyweights (e.g. RELIANCE
-- dominating Energy), not the simple average across small + large names.
-- A cluster's return is NULL if no stock in it has prices at that horizon
-- (preserves "we don't know" instead of fabricating zero).

SET search_path = app, public;

ALTER TABLE app.cluster_composite_cache
    ADD COLUMN IF NOT EXISTS ret_1w numeric,
    ADD COLUMN IF NOT EXISTS ret_1m numeric,
    ADD COLUMN IF NOT EXISTS ret_1y numeric;

COMMENT ON COLUMN app.cluster_composite_cache.ret_1w IS
'Market-cap-weighted 1-week price return for the cluster (fraction, e.g. 0.02 = +2%).';
COMMENT ON COLUMN app.cluster_composite_cache.ret_1m IS
'Market-cap-weighted 1-month price return for the cluster (fraction).';
COMMENT ON COLUMN app.cluster_composite_cache.ret_1y IS
'Market-cap-weighted 1-year price return for the cluster (fraction).';

-- Idempotent grant (same as 0015)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.cluster_composite_cache TO fundamental_app;
    END IF;
END $$;
