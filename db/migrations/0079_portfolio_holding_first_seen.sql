-- 0079 — app.portfolio_holding.first_seen_at: when we FIRST tracked this
-- position, as distinct from when its current snapshot row was written.
--
-- THE BUG
--
-- A holdings import REPLACES the broker's rows: DELETE, then INSERT with
-- `imported_at DEFAULT now()`. So `imported_at` has always meant "the last
-- time you uploaded this broker", never "since when have I known about this
-- holding" — and every re-upload silently moved it forward.
--
-- portfolio.ts read MIN(imported_at) into a variable called `firstImported`
-- and used it as the window anchor for Fall from top / Rise from bottom on any
-- position with no recorded trade date. On 2026-09-26 four brokers were
-- re-uploaded, so 91 of 98 mapped holdings anchored on 2026-09-26, and
-- golden.price_history_1d's newest close was 2026-09-25. The scan
--
--     JOIN golden.price_history_1d p ON p.symbol = b.sym AND p.date >= b.since
--
-- matched zero rows and both columns rendered "—" for all 91. The 7 upstox
-- holdings, last uploaded 2026-09-16, still had an 8-bar window and still
-- rendered — which is what isolated the cause to the anchor rather than the
-- join.
--
-- WHY A NEW COLUMN AND NOT A CHANGE OF MEANING
--
-- The obvious fix — carry the old `imported_at` forward across the re-import —
-- breaks the broker freshness panel, which is built from MAX(imported_at) per
-- broker (loadPortfolio → brokerSnapshots) and exists to tell you how stale a
-- broker's quantities are. Preserve `imported_at` and a broker you uploaded
-- five minutes ago reports as ten days old. That is a worse bug than the one
-- being fixed, and it would have arrived wearing the trust of a fix.
--
-- So `imported_at` keeps its honest meaning (this snapshot row's upload) and
-- the new column carries the other one. Two facts, two columns.
--
-- WHAT THE BACKFILL CAN AND CANNOT KNOW
--
-- Existing rows are backfilled to their own `imported_at`. For anything
-- uploaded before today that is exactly right. For the 108 rows re-uploaded on
-- 2026-09-26 the DELETE took the original value with it, and
-- app.portfolio_import only began recording uploads at 0077, so there is no
-- earlier holdings upload on file to read it back from.
--
-- But there IS a second record, and it is a measurement rather than a guess:
-- app.portfolio_snapshot.holdings carries a per-symbol breakdown of the book on
-- every day the equity-curve cron has run since 2026-07-16 — 128 symbols. The
-- earliest snapshot a symbol appears in is hard evidence that the position was
-- held on that date. So the second backfill below lowers first_seen_at to that
-- date wherever it is earlier. It can only ever move the value BACKWARD, and
-- only to a date on which the position demonstrably existed.
--
-- It is still a floor: the curve starts 2026-07-16, so a position held since
-- 2019 reads as 2026-07-16 and "Held" understates it. A floor that is
-- provably true beats a plausible invention, and the value becomes exact from
-- the next import onward because import/route.ts now carries it across the
-- delete/reinsert.
--
-- (The CASE on jsonb_typeof is not defensive padding. Snapshot rows written
-- before 2026-09-26 stored this column as a jsonb STRING scalar — the
-- `${JSON.stringify(x)}::jsonb` double-encode fixed in 3745b99 — so
-- jsonb_array_elements fails on exactly the rows that carry the oldest and
-- most valuable history.)
--
-- This is also why the fall/rise columns no longer use it at all. A window
-- whose length depends on when the user last clicked Upload produces a number
-- indistinguishable from a measured one — §5's "check that cannot fail", in
-- the shape of a statistic. Those columns now require a real trade date or
-- show "—". first_seen_at survives for "held for N months" and for the
-- position's start marker, where "since we started tracking" is the honest
-- claim and is labelled as such in the UI.
--
-- WHAT KEEPS THIS CURRENT (§5)
--
-- Nothing in this file. Two writers must preserve it:
--   * web/src/app/api/portfolio/import/route.ts — reads the prior first_seen_at
--     per (broker, raw_symbol) before the DELETE and replays it on INSERT.
--   * web/src/lib/derivedHoldings.ts — sets it to the first trade date, which
--     for a derived row is the true first-seen.
-- A third writer that forgets it gets DEFAULT now() and silently resets the
-- clock for those rows. The DEFAULT is deliberate anyway: a genuinely new
-- holding is first seen now.

ALTER TABLE app.portfolio_holding
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now();

-- Backfill: the row's own upload timestamp is the best available lower bound.
-- Guarded so a re-run is a no-op rather than a reset — after the first import
-- under the new code, first_seen_at < imported_at is the CORRECT state and
-- must not be overwritten.
UPDATE app.portfolio_holding
   SET first_seen_at = imported_at
 WHERE first_seen_at > imported_at;

-- Second backfill: lower first_seen_at to the earliest equity-curve snapshot
-- that already contained the position. Strictly a lowering (the WHERE), so it
-- is idempotent and safe to run after real first_seen_at values have started
-- accumulating — a genuine later value can never be pulled forward by it, and
-- a genuine earlier one is already below the floor and won't match.
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
  ),
  seen AS (
    SELECT ex.user_id, e->>'k' AS k, MIN(ex.snap_date) AS d
      FROM ex, LATERAL jsonb_array_elements(ex.h) e
     WHERE e->>'k' IS NOT NULL
     GROUP BY 1, 2
  )
  UPDATE app.portfolio_holding h
     SET first_seen_at = seen.d::timestamptz
    FROM seen
   WHERE seen.user_id = h.user_id
     -- 'k' is `symbol ?? key`, so a mapped row matches on symbol and an
     -- unmapped ETF on the aggregation key that ended up in raw_symbol.
     AND (seen.k = h.symbol OR seen.k = h.raw_symbol)
     AND seen.d < h.first_seen_at::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0079: % holding row(s) back-dated from the equity curve', n;
END
$do$;

COMMENT ON COLUMN app.portfolio_holding.first_seen_at IS
  'When this position was first tracked, preserved across holdings re-imports. '
  'Distinct from imported_at (this snapshot row''s upload time, which the broker '
  'freshness panel reads). A floor, not a measurement, for rows backfilled by 0079.';
