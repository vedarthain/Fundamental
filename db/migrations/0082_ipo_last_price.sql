-- 0082_ipo_last_price.sql — a post-listing price on app.ipo, and nothing else.
--
-- WHY THIS IS NOT READ FROM golden
--
--   The obvious source for "how is this IPO trading now" is golden.price_history,
--   and it does not work: measured 2026-10-02, 0 of the 86 NSE-listed IPO symbols
--   in app.ipo exist in golden.stocks at all (2,981 rows). golden.stocks was
--   seeded and is not enriched when NSE lists something new — CLAUDE.md §5's
--   exact failure mode. A newly-listed IPO is, by definition, always the case
--   golden has not caught up with, so joining to it would leave the growth column
--   permanently blank for every row anyone cares about.
--
-- WHERE IT COMES FROM INSTEAD
--
--   https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz
--
--   Upstox's public instrument master. It carries instrument_key (ISIN-suffixed),
--   tradingsymbol and last_price for every NSE equity, and it needs NO
--   Authorization header — which matters more than convenience here. The IPO
--   snapshot itself dies the moment the daily Upstox token lapses; the price pass
--   does not, so a dead token degrades the calendar without also blanking the
--   returns. Matching is by ISIN, not symbol: 86/86 NSE rows matched by ISIN.
--
-- WHY last_price_at IS SEPARATE AND NOT NULLABLE-BY-DEFAULT-NOW()
--
--   Same rule as fetched_at on this table: a price with no timestamp is worse
--   than no price. The master file is a daily snapshot, not a live tick, so
--   "+38% since issue" is a claim about a specific close and the UI has to be
--   able to say which one. A DEFAULT now() would stamp a row that never received
--   a price, so there is no default — last_price and last_price_at are written
--   together by the price pass or not at all.
--
--   instrument_key is stored even though nothing joins on it yet: it is the only
--   stable Upstox handle for the scrip (symbols get renamed, ISINs survive
--   corporate actions badly), and it is what a future live-quote call would need.

ALTER TABLE app.ipo
  ADD COLUMN IF NOT EXISTS instrument_key text,
  ADD COLUMN IF NOT EXISTS last_price     numeric(14,2),
  ADD COLUMN IF NOT EXISTS last_price_at  timestamptz;

-- A zero is what the master file sends for a scrip that has not traded. It is
-- not a price, and -100% growth against the issue band is the wrong answer, so
-- the constraint forbids storing it and the loader maps it to NULL.
ALTER TABLE app.ipo
  DROP CONSTRAINT IF EXISTS ipo_last_price_positive;
ALTER TABLE app.ipo
  ADD CONSTRAINT ipo_last_price_positive
  CHECK (last_price IS NULL OR last_price > 0);

-- Neither column is meaningful without the other.
ALTER TABLE app.ipo
  DROP CONSTRAINT IF EXISTS ipo_last_price_dated;
ALTER TABLE app.ipo
  ADD CONSTRAINT ipo_last_price_dated
  CHECK ((last_price IS NULL) = (last_price_at IS NULL));

COMMENT ON COLUMN app.ipo.last_price IS
  'Latest close from Upstox''s public NSE instrument master (unauthenticated). NULL for BSE-only issues and for scrips that have not traded.';
COMMENT ON COLUMN app.ipo.last_price_at IS
  'When last_price was read. Always set together with last_price; no default.';
COMMENT ON COLUMN app.ipo.instrument_key IS
  'Upstox instrument key, e.g. NSE_EQ|INE0PTN01011. Stable handle for the scrip.';
