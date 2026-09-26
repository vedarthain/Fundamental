-- 0080 — app.portfolio_snapshot.equity_value / equity_cost: the same book with
-- the unpriceable instruments taken out.
--
-- WHAT DEB ASKED FOR AND WHY IT IS NOT AN OVERWRITE
--
-- "Exclude the ETFs" — from the stored equity curve, not just the UI, which
-- 0079's sibling change had already done for the live cards. The obvious
-- implementation is to make total_value mapped-only and rewrite the 50 rows on
-- file. That was refused for the same reason 0079 refused to redefine
-- imported_at: total_value is the one number that reconciles to what the broker
-- apps show when you add them up, and it is the only record of the ETF leg's
-- valuation that exists. Redefining it destroys a fact to express a preference,
-- and the destruction is not reversible. Two facts, two columns.
--
-- So total_value / total_cost keep their meaning (the whole book, broker-
-- reconcilable) and the new columns carry the equities-only view the charts
-- read. Turning the preference around later is a UI change, not a migration.
--
-- WHY THE BACKFILL IS A DERIVATION AND NOT AN ESTIMATE
--
-- Every snapshot row already carries a per-symbol breakdown in `holdings`:
-- {k: symbol, m: is_mapped, q: qty, v: current_value, p: pnl}. So the split
-- already exists on every row ever written — it was simply never aggregated.
-- Measured before writing this, across all 50 rows:
--
--     max |total_value - Σ v|        = 0.00
--     max |total_cost  - Σ (v - p)|  = 0.00
--
-- Exact, not approximate. The backfill therefore invents nothing; it reads a
-- number that was stored and never used. If those gaps had been non-zero this
-- migration would not exist in this form — a derived column that does not
-- reconcile to the column it derives from is a second source of truth.
--
-- (jsonb_typeof: 49 of 50 rows store `holdings` as a jsonb STRING scalar, from
-- the `${JSON.stringify(x)}::jsonb` double-encode fixed in 3745b99. Same shape
-- as 0079's backfill. The one array row is everything written since.)
--
-- WHAT IS DELIBERATELY NOT BACKFILLED
--
-- day_change_value. The per-symbol breakdown carries value and P&L but no
-- per-symbol day move, so the equities-only daily delta cannot be recovered
-- from what is on file. It could be *approximated* as eq_value(D) - eq_value(D-1),
-- and that would be wrong on every day with a buy or a sell — a cashflow
-- rendered as a market move, confidently, in a column nothing could audit.
--
-- It needs no backfill anyway: as of the same session, loadPortfolio returns a
-- NULL day change for any instrument golden has no bar for, so day_change_value
-- has been equities-only from that day forward by construction. The historical
-- rows contain a small contamination from the frozen broker_day_pct figure
-- (measured at -366.66/day across 13 rows) and are left honestly as they are.
--
-- WHAT THE NUMBERS SAY (2026-07-16 → 2026-09-25, user 1)
--
-- The ETF leg is worth 227,032 on EVERY row in the series — identical to the
-- rupee across 50 trading days. That is not stability, it is the absence of a
-- price feed: an unmapped ETF is valued at the broker's figure frozen at the
-- last holdings upload, so it contributes a constant to the numerator and a
-- constant to the denominator and damps every percentage the curve reports.
-- Removing it is not a cosmetic filter; it removes a ~20% dead weight that was
-- making real moves look smaller than they were.
--
-- WHAT KEEPS THIS CURRENT (§5)
--
-- Nothing in this file. web/src/app/api/cron/portfolio-snapshot/route.ts must
-- write both columns on every run; it computes them from pf.instruments with
-- the same isMapped predicate used here. A future writer that forgets them
-- leaves NULLs, which the chart must render as a gap rather than as zero — a
-- zero would draw a cliff, and a cliff is indistinguishable from a crash.
-- That is why these columns are NULLable and have no DEFAULT: a missing
-- measurement should look missing.

ALTER TABLE app.portfolio_snapshot
  ADD COLUMN IF NOT EXISTS equity_value numeric,
  ADD COLUMN IF NOT EXISTS equity_cost  numeric;

-- Backfill from the per-symbol breakdown each row already carries.
-- Guarded on IS NULL so a re-run cannot overwrite a value the cron has since
-- written from live instruments (which is the more accurate source once it
-- exists — it does not round-trip through jsonb).
DO $do$
DECLARE n integer;
BEGIN
  WITH ex AS (
    SELECT s.user_id, s.snap_date,
           CASE WHEN jsonb_typeof(s.holdings) = 'string'
                THEN (s.holdings #>> '{}')::jsonb
                ELSE s.holdings END AS h
      FROM app.portfolio_snapshot s
     WHERE s.holdings IS NOT NULL
       AND (s.equity_value IS NULL OR s.equity_cost IS NULL)
  ),
  agg AS (
    SELECT ex.user_id, ex.snap_date,
           SUM((e->>'v')::numeric) AS v,
           SUM((e->>'v')::numeric - (e->>'p')::numeric) AS c
      FROM ex, LATERAL jsonb_array_elements(ex.h) e
     -- The predicate, and the only one: is_mapped means golden has a bar for
     -- it, which is exactly the condition under which a daily move is a
     -- measurement rather than a leftover. Matching the read model's own test
     -- rather than sniffing the symbol for "ETF" / "GOLD" / "BEES" — a name
     -- test would silently reclassify an instrument the day golden onboards it.
     WHERE (e->>'m')::boolean
     GROUP BY 1, 2
  )
  UPDATE app.portfolio_snapshot s
     SET equity_value = agg.v,
         equity_cost  = agg.c
    FROM agg
   WHERE agg.user_id = s.user_id AND agg.snap_date = s.snap_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0080: % snapshot row(s) given an equities-only total', n;
END
$do$;

COMMENT ON COLUMN app.portfolio_snapshot.equity_value IS
  'Market value of holdings golden has daily price history for (is_mapped). '
  'total_value minus the unpriceable ETF/fund leg, which is carried at the '
  'broker''s figure frozen at the last holdings upload. NULL means not measured '
  '— render as a gap, never as zero.';
COMMENT ON COLUMN app.portfolio_snapshot.equity_cost IS
  'Cost basis of the same mapped subset. Pairs with equity_value; total_cost '
  'remains the whole book so the snapshot still reconciles to the brokers.';
