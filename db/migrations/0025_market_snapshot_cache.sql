-- Precomputed snapshot of the /api/market/overview response.
--
-- WHY THIS EXISTS:
--   The live aggregation path scans 370 days × ~5,000 symbols of
--   golden.price_history (for 52W high/low + 1D moves) and runs ~7 app-DB
--   queries every cold cache hit. On Neon's autoscale compute that
--   amounts to 15-21s of wall time on the FIRST visit per cache window,
--   which is unacceptable for a landing surface.
--
--   This table holds the entire response shape as a single JSONB row
--   keyed by date. scripts/build-market-snapshot.py runs once after the
--   daily refresh-ltp lands prices and writes a fresh row. The /market
--   route then reads ONE indexed row (~5 KB) and returns it as-is.
--
-- WHY JSONB AND NOT NORMALISED COLUMNS:
--   The response shape changes whenever we add a card (52W H/L, holidays,
--   FII chart, etc.). A schema migration per UI tweak would be friction.
--   JSONB lets the build script evolve without DDL churn. We give up
--   indexability on inner fields — but we never query inside the blob,
--   only read it whole.
--
-- RETENTION:
--   Keep at most 1 year of daily snapshots so the table stays small
--   (~365 rows × ~30 KB = 11 MB max) and a future "historical /market"
--   surface has data to pull from. Older rows are dropped at the end of
--   each build run.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.market_snapshot_cache (
    date         date         PRIMARY KEY,
    data         jsonb        NOT NULL,
    computed_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_snapshot_cache_date_idx
    ON app.market_snapshot_cache (date DESC);

COMMENT ON TABLE app.market_snapshot_cache IS
'Precomputed /api/market/overview response, one row per build run.
Read pattern: SELECT data FROM ... ORDER BY date DESC LIMIT 1.
Populated daily by scripts/build-market-snapshot.py.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.market_snapshot_cache TO fundamental_app;
    END IF;
END $$;
