-- Industry-level (cluster) aggregate composite — for landing-page heat map
-- and any "which industry is stronger" comparison.
--
-- Why this view exists
-- --------------------
-- app.scores.composite_pct is a percentile rank WITHIN each (cluster, tier)
-- bucket. By construction, AVG(composite_pct) per cluster is always ~50:
-- if you rank 5 stocks 1..5, the average rank is always (1+2+3+4+5)/5 = 3
-- regardless of how "good" the stocks are absolutely. So averaging the
-- per-stock percentile gives you the math, not the signal.
--
-- This view sidesteps that by averaging RAW fundamentals (not percentiles)
-- across the cluster's stocks, then percent-ranking those cluster averages
-- against every other cluster. The result: 0–100 spread across the 41
-- industries on each axis (quality, valuation, momentum, composite).
--
-- Data source note: metrics_snapshot.cluster_metrics is a JSONB column;
-- the typed columns at the table level are not populated. We extract the
-- relevant raw metric keys from JSONB. Clusters with different scorecards
-- (e.g. lenders use loan_book_cagr_3y, FMCG uses op_margin_3y) may have
-- some keys missing; AVG() correctly ignores NULLs.

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
    WHERE u.is_active
      AND m.maturity_tier IN ('veteran','mature','mid','new')
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
        -- Valuation: lower is better, so sort DESC so the cheapest cluster gets the highest rank.
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
    -- Quality aggregate: 30% ROE, 25% ROCE, 15% margin, 20% NP growth, 10% rev growth
    ((r.roe_pct * 30 + r.roce_pct * 25 + r.opm_pct * 15
      + r.np_pct * 20 + r.rev_pct * 10) / 100)::int       AS quality_aggr_pct,
    -- Valuation aggregate: 50% P/E + 50% P/B
    ((r.pe_pct * 50 + r.pb_pct * 50) / 100)::int           AS valuation_aggr_pct,
    -- Momentum aggregate: 12m relative return
    r.mom_pct                                              AS momentum_aggr_pct,
    -- Composite: 50% Q, 30% V, 20% M
    ((((r.roe_pct * 30 + r.roce_pct * 25 + r.opm_pct * 15
        + r.np_pct * 20 + r.rev_pct * 10) / 100) * 50
      + ((r.pe_pct * 50 + r.pb_pct * 50) / 100) * 30
      + r.mom_pct * 20) / 100)::int                        AS composite_aggr_pct
FROM ranked r
JOIN app.cluster c ON c.id = r.cluster_id
JOIN app.meta_cluster mc ON mc.id = c.meta_cluster_id
WHERE c.id <> 'unclassified';

COMMENT ON VIEW app.cluster_composite IS
'Cross-cluster industry ranking. Use composite_aggr_pct for industry strength comparison instead of AVG(scores.composite_pct), which is structurally pinned at ~50 by the percentile math.';
