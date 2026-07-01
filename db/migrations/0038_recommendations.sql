-- 0038 — app.recommendations: PRIVATE paper-trading ledger for the score's picks.
--
-- Each weekly score snapshot produces a LOCKED cohort: the top-N stocks by
-- composite_pct, each stamped with an immutable entry price (first golden close
-- on/after the snapshot), a fixed stop-loss and target, and a fixed holding
-- horizon in trading days. Once written a row NEVER changes — the outcome
-- (hit target / stopped / expired / still open) is computed at read time from
-- golden OHLC, so the ledger can't drift and needs no settlement job.
--
-- WHY LOCKED (not a rolling book): locked cohorts give clean per-pick
-- attribution — "did THIS pick pay off over its horizon?" A rolling top-N
-- churns names on ranking wobble and destroys the win-rate you're trying to
-- measure. See web/src/lib/recommendations.ts.
--
-- This is admin-only and paper-only: NO orders are placed. It exists to build
-- an honest track record of whether the fundamental score's picks actually work
-- before any real conviction is placed on them.

CREATE TABLE IF NOT EXISTS app.recommendations (
  id            bigserial     PRIMARY KEY,
  cohort_date   date          NOT NULL,      -- score snapshot_date this pick came from
  symbol        text          NOT NULL,      -- bare NSE symbol (golden uses symbol||'.NS')
  rank          smallint      NOT NULL,      -- 1 = highest composite in the cohort
  composite_pct smallint,                    -- score at pick time (audit trail)
  quality_pct   smallint,
  valuation_pct smallint,
  momentum_pct  smallint,
  entry_date    date          NOT NULL,      -- first golden trading day on/after cohort_date
  entry_price   numeric(14,4) NOT NULL,      -- golden close on entry_date
  stop_price    numeric(14,4) NOT NULL,      -- entry_price * (1 - stop_pct)
  target_price  numeric(14,4) NOT NULL,      -- entry_price * (1 + target_pct)
  horizon_td    smallint      NOT NULL DEFAULT 21,  -- holding period, trading days
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (cohort_date, symbol)               -- idempotent generation
);

CREATE INDEX IF NOT EXISTS idx_reco_cohort
  ON app.recommendations (cohort_date DESC, rank);

COMMENT ON TABLE app.recommendations IS
  'PRIVATE paper-trading ledger: locked weekly top-N cohorts of the composite score. Outcomes computed at read time from golden OHLC. No orders placed.';
