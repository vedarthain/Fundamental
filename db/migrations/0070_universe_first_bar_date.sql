-- app.universe.first_bar_date — the earliest daily bar we hold for a symbol.
--
-- WHY THIS EXISTS
--   The "IPO" chip and the percentile-display gate both ask one question:
--   "has this stock traded long enough for momentum and market-relative
--   valuation to mean anything?" Until now both answered it from
--   `listing_date`, which is a PROXY for trading history, not a measurement of
--   it — and the proxy is wrong for a whole class of names.
--
--   NSE's listing_date (and EQUITY_L.csv's DATE OF LISTING, which agrees with
--   it) records the MAINBOARD listing. A company that graduates from NSE
--   Emerge to the mainboard gets a fresh date despite having traded under the
--   same ticker for years. KOTYARK lists 2026-03-12 and has 1,203 daily bars
--   back to 2021-11-17. SOLEX has 1,480 bars back to 2018-02-05 — 8.6 years —
--   and was being shown an "IPO" badge with its score suppressed.
--
--   The old two-signal guard (recent listing_date AND <6 years of fundamentals)
--   rescued BSE→NSE migrations of OLD companies via the fundamentals clause.
--   It structurally cannot rescue SME migrations: SME companies are small and
--   young, so Screener holds only 4-5 years for them and both clauses fire.
--
-- WHAT THIS COLUMN IS NOT
--   It is not the true first-ever trade date. It is the first bar in
--   golden.price_history, which is bounded by when that symbol was ingested.
--   The ~105 veterans (HAWKINCOOK, TIMEX, GOODYEAR…) backfilled on 2026-04-20
--   carry that date here, exactly as they do in listing_date. They are NOT
--   rescued by this column — they are rescued by the years_of_data clause,
--   which stays. This column replaces the FIRST clause of the AND, not the
--   second, and the guard remains two-signal for that reason.
ALTER TABLE app.universe
    ADD COLUMN IF NOT EXISTS first_bar_date DATE;

COMMENT ON COLUMN app.universe.first_bar_date IS
'Earliest daily bar held in golden.price_history for this symbol. Maintained by
sync-universe. A measurement of how long we have observed the stock trading —
NOT the exchange listing date and NOT the true first trade. Use this, not
listing_date, to decide whether price-derived signals (momentum, market-relative
valuation) have enough history to be meaningful: an NSE Emerge to mainboard
migration resets listing_date but not this.';
