-- 0039_fix_polluted_listing_date.sql
--
-- Data fix: 106 companies had listing_date stamped '2026-04-20' — a
-- price-DB ingestion date that leaked into app.universe (and golden.stocks),
-- NOT a real listing. It gave decades-old veterans (HAWKINCOOK, TIMEX,
-- GOODYEAR, ELANTAS) the signature of a two-month-old IPO, which:
--   * excluded them from the ETL `repair` command (HAVING years_listed >= 5),
--     so genuinely-old companies with sparse fundamentals never got re-fetched;
--   * skewed audit-price-coverage.py (expects data only from listing_date on);
--   * was masked at the web layer only because hasScoreableHistory() also
--     checks years_of_data — the display was right, the underlying data wrong.
--
-- The true IPO dates are unrecoverable (golden's price history and listing_date
-- are polluted with the same 2026-04-20 stamp). The most defensible substitute
-- is the earliest fundamental period_end: a company must be listed to file
-- results, so min(period_end) is a hard lower bound on the listing date. That
-- keeps veterans old (floor ~2006-2016, well past the 12-month / 5-year gates)
-- and genuine young listings recent (floor ~2020-2024, so they stay "unscored").
--
-- Idempotent: after this runs no row carries listing_date = '2026-04-20', so a
-- re-run matches nothing. All 106 affected rows have a fundamental floor (0
-- rows without) — verified before writing this migration.

UPDATE app.universe u
SET listing_date = floor.d
FROM (
  SELECT s.symbol,
         LEAST(
           COALESCE((SELECT min(a.period_end) FROM app.fundamentals_annual a    WHERE a.symbol = s.symbol), DATE '9999-12-31'),
           COALESCE((SELECT min(q.period_end) FROM app.fundamentals_quarterly q WHERE q.symbol = s.symbol), DATE '9999-12-31')
         ) AS d
  FROM app.universe s
  WHERE s.listing_date = DATE '2026-04-20'
) AS floor
WHERE u.symbol = floor.symbol
  AND u.listing_date = DATE '2026-04-20'
  AND floor.d < DATE '9999-12-31';   -- guard: never write the sentinel
