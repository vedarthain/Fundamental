-- Filter deprecated clusters out of the cluster_composite view.
--
-- Background: when bfsi_capmarkets was split into 4 sub-clusters (migration
-- 0011) and bfsi_pvt_banks was split into 3 (migration 0012), the legacy
-- clusters were kept in app.cluster (because app.scores has FK rows
-- referencing them from older snapshots that we don't want to delete) and
-- renamed to "<name> (deprecated)" so they were visibly retired.
--
-- That visibility-only retirement isn't enough: cluster_assignment can still
-- end up pointing at the deprecated cluster_ids (e.g. when Neon's
-- cluster_assignment table is stale relative to local reassignments). When
-- that happens, the /sectors page renders the deprecated cluster as a tile
-- with "ghost" stocks, which confuses users.
--
-- Fix: cluster_composite now filters out any cluster whose name ends with
-- "(deprecated)". The string-pattern check is a defensible defensive layer
-- — even if cluster_assignment is fully fresh, the filter is a no-op
-- (deprecated clusters with 0 assignments naturally don't appear anyway).
--
-- After applying, the /sectors page will hide both:
--   - "Capital Markets (deprecated)" → replaced by bfsi_amc_wealth /
--      bfsi_exchange / bfsi_rta_rating / bfsi_broker
--   - "Private Banks (deprecated)"  → replaced by bfsi_pvt_banks_large /
--      bfsi_pvt_banks_mid_small / bfsi_sfb

SET search_path = app, public;

DROP VIEW IF EXISTS app.cluster_composite;

CREATE VIEW app.cluster_composite AS
WITH cluster_agg AS (
    SELECT
        ca.cluster_id,
        m.snapshot_date,
        COUNT(*)::int AS n_stocks,
        AVG((m.cluster_metrics->>'roe_3y')::numeric)        AS avg_roe_3y,
        AVG((m.cluster_metrics->>'roce_3y')::numeric)       AS avg_roce_3y,
        AVG((m.cluster_metrics->>'op_margin_3y')::numeric)  AS avg_op_margin_3y,
        AVG((m.cluster_metrics->>'np_cagr_5y')::numeric)    AS avg_np_cagr_5y,
        AVG((m.cluster_metrics->>'rev_cagr_5y')::numeric)   AS avg_rev_cagr_5y,
        AVG((m.cluster_metrics->>'pe_ttm')::numeric)        AS avg_pe_ttm,
        AVG((m.cluster_metrics->>'pb')::numeric)            AS avg_pb,
        AVG((m.cluster_metrics->>'ret_12m_rel')::numeric)   AS avg_ret_12m_rel
    FROM app.metrics_snapshot m
    JOIN app.cluster_assignment ca USING (symbol)
    JOIN app.universe u USING (symbol)
    JOIN app.cluster c ON c.id = ca.cluster_id
    WHERE u.is_active
      AND m.maturity_tier IN ('veteran','mature','mid','new')
      -- Skip deprecated clusters entirely. These are clusters whose stocks
      -- have been re-assigned to split successors but the legacy row is
      -- kept for FK integrity with old app.scores rows.
      AND c.name NOT LIKE '%(deprecated)%'
    GROUP BY ca.cluster_id, m.snapshot_date
),
ranked AS (
    SELECT
        cluster_id, snapshot_date, n_stocks,
        avg_roe_3y, avg_roce_3y, avg_op_margin_3y,
        avg_np_cagr_5y, avg_rev_cagr_5y,
        avg_pe_ttm, avg_pb, avg_ret_12m_rel,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_roe_3y       ASC NULLS FIRST) * 100)::int AS roe_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_roce_3y      ASC NULLS FIRST) * 100)::int AS roce_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_op_margin_3y ASC NULLS FIRST) * 100)::int AS opm_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_np_cagr_5y   ASC NULLS FIRST) * 100)::int AS np_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_rev_cagr_5y  ASC NULLS FIRST) * 100)::int AS rev_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_pe_ttm       DESC NULLS LAST)  * 100)::int AS pe_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_pb           DESC NULLS LAST)  * 100)::int AS pb_pct,
        (PERCENT_RANK() OVER (PARTITION BY snapshot_date ORDER BY avg_ret_12m_rel  ASC NULLS FIRST) * 100)::int AS mom_pct
    FROM cluster_agg
)
SELECT
    r.cluster_id,
    r.snapshot_date,
    r.n_stocks,
    c.name           AS industry_name,
    c.meta_cluster_id,
    mc.name          AS sector_name,
    r.avg_roe_3y, r.avg_roce_3y, r.avg_op_margin_3y,
    r.avg_np_cagr_5y, r.avg_rev_cagr_5y,
    r.avg_pe_ttm, r.avg_pb, r.avg_ret_12m_rel,
    r.roe_pct, r.roce_pct, r.opm_pct, r.np_pct, r.rev_pct,
    r.pe_pct, r.pb_pct, r.mom_pct,
    ((r.roe_pct * 30 + r.roce_pct * 25 + r.opm_pct * 15
      + r.np_pct * 20 + r.rev_pct * 10) / 100)::int       AS quality_aggr_pct,
    ((r.pe_pct * 50 + r.pb_pct * 50) / 100)::int           AS valuation_aggr_pct,
    r.mom_pct                                              AS momentum_aggr_pct,
    ((((r.roe_pct * 30 + r.roce_pct * 25 + r.opm_pct * 15
        + r.np_pct * 20 + r.rev_pct * 10) / 100) * 50
      + ((r.pe_pct * 50 + r.pb_pct * 50) / 100) * 30
      + r.mom_pct * 20) / 100)::int                        AS composite_aggr_pct
FROM ranked r
JOIN app.cluster c ON c.id = r.cluster_id
JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
WHERE c.id <> 'unclassified';

COMMENT ON VIEW app.cluster_composite IS
'Cross-cluster industry ranking. Filters out deprecated clusters (name LIKE "%(deprecated)%"). Use composite_aggr_pct for industry strength comparison instead of AVG(scores.composite_pct).';
