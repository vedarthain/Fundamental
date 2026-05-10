-- 0009_nifty50.sql
-- Adds is_nifty50 flag to app.universe and seeds it with the current
-- 50 constituents (as of 2025-Q4). Used for the soft-launch Neon migration
-- that publishes only Nifty 50 stocks to production.
--
-- The list is hardcoded here rather than fetched live, because:
--   - The Nifty 50 changes ~twice a year
--   - We want migrations to be idempotent and reproducible
--   - The exact constituents on launch day don't matter for proof-of-concept
--
-- To refresh the list later: pull the official CSV from
--   https://archives.nseindia.com/content/indices/ind_nifty50list.csv
-- and rewrite this UPDATE statement.

ALTER TABLE app.universe
  ADD COLUMN IF NOT EXISTS is_nifty50 BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_universe_nifty50
  ON app.universe (is_nifty50)
  WHERE is_nifty50 = TRUE;

-- Reset before re-applying so a refreshed list doesn't accumulate stale entries.
UPDATE app.universe SET is_nifty50 = FALSE;

UPDATE app.universe
   SET is_nifty50 = TRUE
 WHERE symbol IN (
   'ADANIENT',    'ADANIPORTS',  'APOLLOHOSP',  'ASIANPAINT',  'AXISBANK',
   'BAJAJ-AUTO',  'BAJAJFINSV',  'BAJFINANCE',  'BEL',         'BHARTIARTL',
   'CIPLA',       'COALINDIA',   'DRREDDY',     'EICHERMOT',   'ETERNAL',
   'GRASIM',      'HCLTECH',     'HDFCBANK',    'HDFCLIFE',    'HEROMOTOCO',
   'HINDALCO',    'HINDUNILVR',  'ICICIBANK',   'INDUSINDBK',  'INFY',
   'ITC',         'JIOFIN',      'JSWSTEEL',    'KOTAKBANK',   'LT',
   'M&M',         'MARUTI',      'NESTLEIND',   'NTPC',        'ONGC',
   'POWERGRID',   'RELIANCE',    'SBILIFE',     'SBIN',        'SHRIRAMFIN',
   -- TATAMOTORS demerged in 2025 → TMPV (passenger vehicles, the larger
   -- successor) takes its Nifty 50 slot; TMCV (commercial vehicles) included
   -- here too so both halves show up under the soft-launch.
   'SUNPHARMA',   'TATACONSUM',  'TMPV',        'TMCV',        'TATASTEEL',   'TCS',
   'TECHM',       'TITAN',       'TRENT',       'ULTRACEMCO',  'WIPRO'
 );
