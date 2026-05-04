-- Maturity tier on universe + extras on screener_meta + adjustments to scoring tables.

SET search_path = app, public;

-- Maturity tier persisted on universe for cheap filtering. Recomputed weekly.
ALTER TABLE app.universe
    ADD COLUMN IF NOT EXISTS maturity_tier TEXT,
    ADD COLUMN IF NOT EXISTS years_of_data INT,
    ADD COLUMN IF NOT EXISTS maturity_tier_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_universe_maturity ON app.universe (maturity_tier) WHERE is_active;

-- Extra metadata captured from each Screener export (current price, mc, etc.)
ALTER TABLE app.screener_meta
    ADD COLUMN IF NOT EXISTS company_name        TEXT,
    ADD COLUMN IF NOT EXISTS current_price       NUMERIC,
    ADD COLUMN IF NOT EXISTS market_cap_cr       NUMERIC,    -- Screener reports in INR crore
    ADD COLUMN IF NOT EXISTS face_value          NUMERIC,
    ADD COLUMN IF NOT EXISTS no_of_shares        NUMERIC;

-- Add maturity_tier to metrics + scores for filterability
ALTER TABLE app.metrics_snapshot
    ADD COLUMN IF NOT EXISTS maturity_tier  TEXT,
    ADD COLUMN IF NOT EXISTS cluster_metrics JSONB;
CREATE INDEX IF NOT EXISTS idx_metrics_cluster_tier
    ON app.metrics_snapshot (snapshot_date DESC, maturity_tier);

ALTER TABLE app.scores
    ADD COLUMN IF NOT EXISTS maturity_tier TEXT,
    ADD COLUMN IF NOT EXISTS score_status  TEXT;
CREATE INDEX IF NOT EXISTS idx_scores_cluster_tier
    ON app.scores (cluster_id, maturity_tier, snapshot_date DESC, composite_pct DESC NULLS LAST);

-- Refresh the latest-scores view
DROP VIEW IF EXISTS app.scores_latest;
CREATE VIEW app.scores_latest AS
SELECT DISTINCT ON (symbol) *
FROM app.scores
ORDER BY symbol, snapshot_date DESC;
