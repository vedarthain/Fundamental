-- Adds cluster taxonomy + scoring tables.
-- See docs/sector-clusters.md and docs/scoring-engine.md.

SET search_path = app, public;

-- Top-level grouping shown on the heat map (8 buckets).
CREATE TABLE app.meta_cluster (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    display_order   INT NOT NULL
);

-- Peer cluster — the unit of percentile comparison (~30-40 buckets).
CREATE TABLE app.cluster (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    meta_cluster_id TEXT NOT NULL REFERENCES app.meta_cluster(id),
    description     TEXT
);
CREATE INDEX idx_cluster_meta ON app.cluster (meta_cluster_id);

-- Per-stock cluster assignment. Versioned via assigned_at; the latest row wins.
CREATE TABLE app.cluster_assignment (
    symbol          TEXT PRIMARY KEY REFERENCES app.universe(symbol) ON DELETE CASCADE,
    cluster_id      TEXT NOT NULL REFERENCES app.cluster(id),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method          TEXT NOT NULL CHECK (method IN ('rule', 'manual', 'override'))
);
CREATE INDEX idx_cluster_assignment_cluster ON app.cluster_assignment (cluster_id);

-- Computed raw metrics per stock per snapshot. Inputs to the scoring step.
CREATE TABLE app.metrics_snapshot (
    symbol                TEXT NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    snapshot_date         DATE NOT NULL,

    -- Quality inputs
    roe_3y                NUMERIC,
    roce_3y               NUMERIC,
    op_margin_3y          NUMERIC,
    op_margin_trend       NUMERIC,
    rev_cagr_5y           NUMERIC,
    np_cagr_5y            NUMERIC,
    np_consistency        NUMERIC,
    debt_equity           NUMERIC,
    interest_coverage     NUMERIC,
    cfo_pat_3y            NUMERIC,

    -- Valuation inputs
    pe_ttm                NUMERIC,
    pb                    NUMERIC,
    ev_ebitda_ttm         NUMERIC,
    peg                   NUMERIC,
    fcf_yield             NUMERIC,
    div_yield             NUMERIC,

    -- Momentum inputs
    ret_3m_rel            NUMERIC,
    ret_6m_rel            NUMERIC,
    ret_12m_rel           NUMERIC,
    pct_above_200ema_252d NUMERIC,
    ema_stack_bull        BOOLEAN,
    technical_net_score   SMALLINT,
    sales_yoy_q           NUMERIC,
    np_yoy_q              NUMERIC,

    -- Provenance
    market_cap            NUMERIC,
    score_status          TEXT NOT NULL DEFAULT 'full',  -- full | partial | excluded
    notes                 TEXT,

    PRIMARY KEY (symbol, snapshot_date)
);
CREATE INDEX idx_metrics_recent ON app.metrics_snapshot (snapshot_date DESC);

-- Per-stock pillar + composite percentiles, computed from metrics_snapshot.
-- Append-only — every Sunday a new row goes in. This is the moat.
CREATE TABLE app.scores (
    symbol               TEXT NOT NULL REFERENCES app.universe(symbol) ON DELETE CASCADE,
    snapshot_date        DATE NOT NULL,
    cluster_id           TEXT NOT NULL REFERENCES app.cluster(id),

    quality_pct          SMALLINT,    -- 0-100, percentile within cluster
    valuation_pct        SMALLINT,
    momentum_pct         SMALLINT,
    composite_pct        SMALLINT,    -- itself percentiled within cluster

    -- Per-component sub-percentiles (for drill-down explainability)
    quality_components   JSONB,       -- {"roe_3y": 78, "roce_3y": 65, ...}
    valuation_components JSONB,
    momentum_components  JSONB,

    PRIMARY KEY (symbol, snapshot_date)
);
CREATE INDEX idx_scores_recent_composite ON app.scores (snapshot_date DESC, composite_pct DESC NULLS LAST);
CREATE INDEX idx_scores_cluster ON app.scores (cluster_id, snapshot_date DESC, composite_pct DESC NULLS LAST);
CREATE INDEX idx_scores_symbol_recent ON app.scores (symbol, snapshot_date DESC);

-- Convenience view: most recent score row per stock.
CREATE VIEW app.scores_latest AS
SELECT DISTINCT ON (symbol) *
FROM app.scores
ORDER BY symbol, snapshot_date DESC;
