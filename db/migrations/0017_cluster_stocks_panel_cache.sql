-- Pre-compute the stocks panel data for /sectors so the page can render
-- ALL industries' stock lists in a single 2,150-row query, ship them to
-- the client, and make every subsequent interaction (industry switch,
-- tier filter, sector tab) a pure client-side React state change with
-- zero server round-trips.
--
-- Architecture before this migration:
--   /sectors load → query 1 (heatmap, fast)
--                 → query 2 (stocks for ONE selected cluster only, ~1-2s)
--   Click industry → re-render → query 2 with new cluster ID → ~1-2s lag
--   With 46 clusters × 4 tier filters = ~200 URL combinations, the ISR
--   cache never warms up and every click hits Neon fresh.
--
-- Architecture after:
--   /sectors load → single query (all 2,150 stock rows pre-joined with
--                   prices + returns), cached for 24h via unstable_cache
--   Click industry → JS state change → 0ms
--   Tier filter, sector tab → 0ms
--   URLs stay shareable via shallow routing.
--
-- The cache is populated weekly during the ETL `score` command, in
-- parallel with cluster_composite_cache and cluster returns. ~2,150 rows
-- × ~150 bytes ≈ 320 KB per snapshot.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.cluster_stocks_panel_cache (
    snapshot_date    date    NOT NULL,
    cluster_id       text    NOT NULL,
    symbol           text    NOT NULL,
    company_name     text,
    market_cap_cr    numeric,
    current_price    numeric,
    composite_pct    numeric,
    quality_pct      numeric,
    valuation_pct    numeric,
    momentum_pct     numeric,
    maturity_tier    text,
    -- Per-stock price returns at 3 horizons. Stored as fractions
    -- (e.g. 0.024 = +2.4%). NULL when no price history at that horizon.
    ret_1w           numeric,
    ret_1m           numeric,
    ret_1y           numeric,
    refreshed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_date, cluster_id, symbol)
);

-- Lookups are always by (snapshot_date) — fetch entire panel for one snapshot.
CREATE INDEX IF NOT EXISTS cluster_stocks_panel_cache_snap_idx
    ON app.cluster_stocks_panel_cache (snapshot_date);

-- Secondary lookup if someone ever wants one cluster only.
CREATE INDEX IF NOT EXISTS cluster_stocks_panel_cache_cluster_idx
    ON app.cluster_stocks_panel_cache (cluster_id, snapshot_date);

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
          ON app.cluster_stocks_panel_cache TO fundamental_app;
    END IF;
END $$;

COMMENT ON TABLE app.cluster_stocks_panel_cache IS
'Pre-joined per-stock panel data for /sectors. One row per (snapshot, cluster, symbol).
Powers the SPA-style /sectors page where all industries'' stocks ship in one fetch and
interactions are client-side React state changes. Refreshed weekly by ETL score command.';
