-- Materialize cluster_composite as a real table so /sectors serves from a
-- pre-computed snapshot rather than re-running PERCENT_RANK() windows + AVG(JSONB)
-- across ~2,150 stocks × 46 clusters on every web request.
--
-- Problem: app.cluster_composite is a view that does:
--   1. AVG() of 8 JSONB-extracted numeric columns across ~2,150 rows
--   2. 8 PERCENT_RANK() window functions across ~46 clusters
--   3. Two JOINs (app.cluster + app.meta_cluster)
-- On cold Neon compute (scales to zero) this adds 3-4 seconds to every
-- /sectors page load, on top of the ~500ms cold-start tax.
--
-- Fix: app.cluster_composite_cache is the same data as a real TABLE.
-- The ETL score command refreshes it after each weekly score run via
-- `etl score` → `refresh_cluster_composite_cache()` call in cli.py.
-- The /sectors Next.js page reads from this table (not the view).
--
-- 💰 Cost: ~50 KB per snapshot_date × ~52 snapshots/year ≈ 2.5 MB/year.
-- At Neon's Launch tier pricing that's effectively $0.00/month.
--
-- The original view (app.cluster_composite) is kept for debugging /
-- ad-hoc queries. It is no longer read by the web app.

SET search_path = app, public;

-- Create the cache table with the same column shape as the view.
-- refreshed_at lets us confirm staleness in monitoring / admin queries.
CREATE TABLE IF NOT EXISTS app.cluster_composite_cache (
    cluster_id          text        NOT NULL,
    snapshot_date       date        NOT NULL,
    n_stocks            int,
    industry_name       text,
    meta_cluster_id     text,
    sector_name         text,
    avg_roe_3y          numeric,
    avg_roce_3y         numeric,
    avg_op_margin_3y    numeric,
    avg_np_cagr_5y      numeric,
    avg_rev_cagr_5y     numeric,
    avg_pe_ttm          numeric,
    avg_pb              numeric,
    avg_ret_12m_rel     numeric,
    roe_pct             int,
    roce_pct            int,
    opm_pct             int,
    np_pct              int,
    rev_pct             int,
    pe_pct              int,
    pb_pct              int,
    mom_pct             int,
    quality_aggr_pct    int,
    valuation_aggr_pct  int,
    momentum_aggr_pct   int,
    composite_aggr_pct  int,
    refreshed_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cluster_id, snapshot_date)
);

-- Fast lookup: sectors page always filters WHERE snapshot_date = <latest>
CREATE INDEX IF NOT EXISTS cluster_composite_cache_snap_idx
    ON app.cluster_composite_cache (snapshot_date);

-- Seed the cache from the current view (latest snapshot only).
-- Subsequent refreshes happen via the ETL score command.
INSERT INTO app.cluster_composite_cache (
    cluster_id, snapshot_date, n_stocks, industry_name, meta_cluster_id,
    sector_name, avg_roe_3y, avg_roce_3y, avg_op_margin_3y, avg_np_cagr_5y,
    avg_rev_cagr_5y, avg_pe_ttm, avg_pb, avg_ret_12m_rel,
    roe_pct, roce_pct, opm_pct, np_pct, rev_pct, pe_pct, pb_pct, mom_pct,
    quality_aggr_pct, valuation_aggr_pct, momentum_aggr_pct, composite_aggr_pct,
    refreshed_at
)
SELECT
    cluster_id, snapshot_date, n_stocks, industry_name, meta_cluster_id,
    sector_name, avg_roe_3y, avg_roce_3y, avg_op_margin_3y, avg_np_cagr_5y,
    avg_rev_cagr_5y, avg_pe_ttm, avg_pb, avg_ret_12m_rel,
    roe_pct, roce_pct, opm_pct, np_pct, rev_pct, pe_pct, pb_pct, mom_pct,
    quality_aggr_pct, valuation_aggr_pct, momentum_aggr_pct, composite_aggr_pct,
    now()
FROM app.cluster_composite
WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
ON CONFLICT (cluster_id, snapshot_date) DO UPDATE SET
    n_stocks            = EXCLUDED.n_stocks,
    industry_name       = EXCLUDED.industry_name,
    meta_cluster_id     = EXCLUDED.meta_cluster_id,
    sector_name         = EXCLUDED.sector_name,
    avg_roe_3y          = EXCLUDED.avg_roe_3y,
    avg_roce_3y         = EXCLUDED.avg_roce_3y,
    avg_op_margin_3y    = EXCLUDED.avg_op_margin_3y,
    avg_np_cagr_5y      = EXCLUDED.avg_np_cagr_5y,
    avg_rev_cagr_5y     = EXCLUDED.avg_rev_cagr_5y,
    avg_pe_ttm          = EXCLUDED.avg_pe_ttm,
    avg_pb              = EXCLUDED.avg_pb,
    avg_ret_12m_rel     = EXCLUDED.avg_ret_12m_rel,
    roe_pct             = EXCLUDED.roe_pct,
    roce_pct            = EXCLUDED.roce_pct,
    opm_pct             = EXCLUDED.opm_pct,
    np_pct              = EXCLUDED.np_pct,
    rev_pct             = EXCLUDED.rev_pct,
    pe_pct              = EXCLUDED.pe_pct,
    pb_pct              = EXCLUDED.pb_pct,
    mom_pct             = EXCLUDED.mom_pct,
    quality_aggr_pct    = EXCLUDED.quality_aggr_pct,
    valuation_aggr_pct  = EXCLUDED.valuation_aggr_pct,
    momentum_aggr_pct   = EXCLUDED.momentum_aggr_pct,
    composite_aggr_pct  = EXCLUDED.composite_aggr_pct,
    refreshed_at        = EXCLUDED.refreshed_at;

-- Grant write access to the ETL role (fundamental_app on local; neondb_owner on Neon).
-- The Neon grant is a no-op on a fresh Neon DB where neondb_owner already owns everything.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.cluster_composite_cache TO fundamental_app;
    END IF;
END $$;

COMMENT ON TABLE app.cluster_composite_cache IS
'Pre-computed cluster aggregates + percentile ranks. Refreshed by ETL score command
after each weekly score run. Read by /sectors page instead of the cluster_composite
view to avoid recomputing PERCENT_RANK() windows on every web request.';
