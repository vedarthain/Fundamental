-- Move scorecards from Python config to DB. Versioned by effective_from so we can
-- audit changes without losing history. Loader reads the latest row per cluster.
-- See docs/scorecards.md and REQUIREMENTS.md §5b "Editable scorecards".

SET search_path = app, public;

CREATE TABLE app.cluster_scorecard (
    id              BIGSERIAL PRIMARY KEY,
    cluster_id      TEXT NOT NULL REFERENCES app.cluster(id) ON DELETE CASCADE,
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pillar_weights  JSONB NOT NULL,    -- {"q": 50, "v": 30, "m": 20}
    quality         JSONB NOT NULL,    -- {formula_id: weight, ...}
    valuation       JSONB NOT NULL,
    momentum        JSONB NOT NULL,
    loss_maker_val_fallback JSONB NOT NULL DEFAULT '[]'::jsonb,
                                       -- [["ev_sales_ttm", 1.0], ["pb", 0.4]] form
    edited_by       TEXT,              -- admin user id (free-text in v1)
    notes           TEXT,
    UNIQUE (cluster_id, effective_from)
);
CREATE INDEX idx_cluster_scorecard_latest
    ON app.cluster_scorecard (cluster_id, effective_from DESC);

-- Convenience view: most recent scorecard per cluster (what the loader reads)
CREATE VIEW app.cluster_scorecard_active AS
SELECT DISTINCT ON (cluster_id) *
FROM app.cluster_scorecard
ORDER BY cluster_id, effective_from DESC;

-- Placeholder for v2 user-customizable presets (kept here so v1 schema is "complete")
CREATE TABLE app.user_scorecard_override (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,           -- once auth lands
    name          TEXT NOT NULL,           -- "Buffett-style" / "Growth investor"
    cluster_id    TEXT REFERENCES app.cluster(id),  -- null = applies to all clusters
    pillar_weights JSONB,                   -- only fields user overrode
    quality_overrides    JSONB,
    valuation_overrides  JSONB,
    momentum_overrides   JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name, cluster_id)
);
