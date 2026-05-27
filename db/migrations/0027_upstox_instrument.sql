-- Mapping from NSE trading symbol → Upstox instrument_key.
--
-- WHY THIS EXISTS:
--   Upstox's quote API doesn't accept "RELIANCE" — it needs a stable
--   per-instrument identifier like "NSE_EQ|INE002A01018" (exchange-segment
--   + ISIN).  We can't construct it from the symbol alone; we have to look
--   it up from Upstox's published instrument master file.
--
-- DATA SOURCE:
--   Upstox publishes a daily JSON dump at
--     https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
--   scripts/fetch-upstox-instruments.py downloads it, filters to EQ-only
--   rows, and upserts into this table.  Refresh once a day before the
--   first intraday LTP fetch — instrument_keys are stable but ISINs can
--   change on corporate actions, and new listings appear.
--
-- KEY DESIGN:
--   symbol is the PK (joins with app.universe.symbol and the panel cache).
--   instrument_key has a UNIQUE constraint so dual lookups stay cheap.

SET search_path = app, public;

CREATE TABLE IF NOT EXISTS app.upstox_instrument (
    symbol         text         PRIMARY KEY,
    instrument_key text         NOT NULL UNIQUE,
    isin           text,
    name           text,
    updated_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upstox_instrument_isin_idx
    ON app.upstox_instrument (isin);

COMMENT ON TABLE app.upstox_instrument IS
'NSE symbol → Upstox instrument_key map. Refreshed daily from
upstox.com/market-quote/instruments/exchange/NSE.json.gz by
scripts/fetch-upstox-instruments.py.';

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundamental_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON app.upstox_instrument TO fundamental_app;
    END IF;
END $$;
