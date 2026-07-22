-- 0042 — app.momentum_signal: daily "volume-ignition" breakout scanner cache.
--
-- WHAT: one row per (snap_date, symbol) for every stock that ignited on the
-- latest trading day — a big up-day on abnormal volume breaking a fresh high.
-- A daily post-close Vercel cron (/api/cron/momentum-signals) recomputes the
-- whole universe and REPLACES that day's rows, so a re-run is idempotent.
--
-- WHY a cache: the trigger is a set of window functions over ~21M rows of
-- golden.price_history_1d (per-symbol 50-day avg volume + 60-day high). Far too
-- heavy to run on every page load, so we precompute once a day — same pattern
-- as cluster_stocks_panel_cache and portfolio_snapshot.
--
-- The catalyst_* and fundamental_* columns are ENRICHMENT, not filters. The
-- delivery-% "pump" idea was discarded: it false-flagged five genuine
-- results-driven winners (Kalyan, BlueStone, Jindal Worldwide, Stallion,
-- Karur Vysya). A blank catalyst is a human-eyeballed flag, never an auto-drop.

CREATE TABLE IF NOT EXISTS app.momentum_signal (
  snap_date        date          NOT NULL,      -- IST trading date the ignition fired on (latest golden bar)
  symbol           text          NOT NULL,      -- bare NSE symbol (e.g. KALYANKJIL)
  close            numeric(14,4)  NOT NULL,      -- ignition-day close
  ret_pct          numeric(9,4)   NOT NULL,      -- 1-day return, %
  vol_x            numeric(9,2)   NOT NULL,      -- volume ÷ 50-day avg volume
  delivery_pct     numeric(9,2),                 -- context only, NOT a filter
  new_high         boolean        NOT NULL DEFAULT false,  -- close > prior 60-day high
  market_cap_cr    numeric(18,2),               -- from panel cache (may be NULL / unscored)
  composite_pct    numeric(6,2),                -- fundamental Industry Score percentile
  quality_pct      numeric(6,2),
  momentum_pct     numeric(6,2),
  is_scored        boolean        NOT NULL DEFAULT false,  -- present in our scoring universe
  catalyst_title   text,                        -- latest tagged headline (<=2d), NULL = pump flag
  catalyst_url     text,
  catalyst_source  text,
  catalyst_at      timestamptz,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (snap_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_momentum_signal_date
  ON app.momentum_signal (snap_date DESC, vol_x DESC);

COMMENT ON TABLE app.momentum_signal IS
  'Daily volume-ignition breakout scanner (cron-refreshed). Ruleset: >=6% day, >=3x 50d avg volume, fresh 60-day high, >=Rs30, >=Rs1cr turnover. Catalyst + fundamental columns are shown, never filtered on.';
