-- 0007_nifty500.sql
-- Adds Nifty 500 membership flag to app.universe.
-- Used by /ideas (and any future surface) to default to recognizable names.
--
-- Population is operator-driven. The NSE publishes the official CSV at:
--   https://archives.nseindia.com/content/indices/ind_nifty500list.csv
--
-- One-time seed (run once after pulling the CSV):
--   UPDATE app.universe
--      SET is_nifty500 = TRUE
--    WHERE symbol IN ('RELIANCE', 'TCS', ...);
--
-- The /ideas page works regardless of population state — falls back to
-- "all stocks" with a banner if zero symbols are flagged.

ALTER TABLE app.universe
  ADD COLUMN IF NOT EXISTS is_nifty500 BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_universe_nifty500
  ON app.universe (is_nifty500)
  WHERE is_nifty500 = TRUE;
