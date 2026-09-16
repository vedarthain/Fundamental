-- 0066 — live prices for ETFs and index funds held in portfolios.
--
-- WHY: /portfolio splits holdings into "Stocks" (rows mapped into app.universe,
-- i.e. scored NSE equities) and "Others" (ETFs, index funds — anything we don't
-- score). The Stocks side is priced from golden's EOD bar or, since the
-- intraday overlay, from app.screener_meta.current_price. The Others side had
-- NO price source whatsoever: it was carried at `broker_cur_value`, the value
-- printed on the broker's CSV, frozen at whatever the last import said.
--
-- On my own book that was 2,36,161 across 26 rows — 20% of the portfolio,
-- drifting indefinitely, with gold and silver ETFs (the fastest-moving things
-- in it) a third of the total. There was no error and no stale indicator; the
-- number simply stopped being true the day after each import.
--
-- WHY A SEPARATE TABLE rather than reusing app.screener_meta: screener_meta is
-- keyed to app.universe, which is the scored-equity universe by definition. An
-- ETF has no fundamentals, no cluster, no score, and must never appear in a
-- screen or a peer ranking. Widening universe to admit unscored instruments
-- would leak them into every scoring surface downstream. This table holds the
-- one thing we actually want from them — a last traded price.
--
-- Deliberately NOT per-user: an ETF's price is a property of the instrument,
-- not of who owns it. Two users holding GOLDCASE share one row.
--
-- Keyed by the Upstox symbol rather than by ISIN because holdings resolve to it
-- from both directions — Groww rows carry an ISIN, Upstox/Zerodha rows carry
-- the bare ticker as raw_symbol and no ISIN at all — and the symbol is the one
-- identifier both paths converge on. instrument_key is carried alongside so the
-- pinger can refresh without re-resolving.

CREATE TABLE IF NOT EXISTS app.etf_price (
  symbol         text        PRIMARY KEY,
  instrument_key text        NOT NULL,
  ltp            numeric     NOT NULL CHECK (ltp > 0),
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

-- The pinger refreshes only instruments somebody actually holds, so this stays
-- small (tens of rows), but the lookup is per-render on /portfolio.
CREATE INDEX IF NOT EXISTS etf_price_fetched_at_idx ON app.etf_price (fetched_at DESC);

COMMENT ON TABLE app.etf_price IS
  'Last traded price for unscored instruments (ETFs, index funds) held in user portfolios. Written by /api/cron/intraday-equity; read by /portfolio for the "Others" tab. Not per-user — price is a property of the instrument.';
COMMENT ON COLUMN app.etf_price.fetched_at IS
  'When the tick was pulled. /portfolio uses the price regardless of age (a last traded price is still the best number available) but surfaces the timestamp so a dead pinger is visible rather than silent.';
