-- 0078 — app.portfolio_snapshot: the equity curve was dated by the clock, not
-- by the prices in it. Re-date the rows that are wrong; leave the ones that
-- are right.
--
-- THE BUG
--
-- /api/cron/portfolio-snapshot ran at 12:30 UTC. refresh-ltp — the job that
-- writes the day's close into golden.price_history_1d — has never completed
-- before 17:33 UTC (measured over 21–25 Sep 2026: 17:49, 17:47, 17:45, 17:33,
-- 18:32). So at the moment the snapshot ran, golden's newest bar was
-- YESTERDAY's, loadPortfolio priced the book at yesterday's close, and
-- day_change_value was yesterday's move. The row was then stamped with
-- today's calendar date.
--
-- Not a race. A guaranteed off-by-one, every trading day, for two months.
-- Nothing could have caught it: the values were internally consistent, the
-- right order of magnitude, and correct in every respect except which day
-- they belonged to. It surfaced on 2026-09-26 only because the live Day-change
-- card (+5,532, Thu→Fri) and the curve's last point (−16,021, Wed→Thu)
-- disagreed in SIGN on the same book.
--
-- WHY THIS IS NOT A BLANKET SHIFT
--
-- The obvious repair — move every row back one trading day — would corrupt
-- eight of them. Commit e6e750f (2026-09-16) taught loadPortfolio to prefer a
-- same-day intraday tick over the EOD bar. From that day the 12:30 UTC run
-- DID see the current day's price, so its rows are dated correctly. Then the
-- intraday pinger stopped after its last tick at 2026-09-23 10:00 UTC and the
-- off-by-one resumed.
--
-- Each of the 51 rows was classified by recomputing its day change from its
-- own stored `holdings` quantities against golden's closes, both same-day and
-- previous-day, and keeping whichever matched. The classification lands
-- exactly on the two regime boundaries above, which is the evidence that it is
-- reading a real mechanism and not fitting noise:
--
--   2026-07-17 .. 2026-09-15   previous-day  → shift back one trading day
--   2026-09-16 .. 2026-09-23   same-day      → leave alone
--   2026-09-24 .. 2026-09-25   previous-day  → shift back one trading day
--
-- The mapping below is therefore a literal list, not a computed rule: the
-- trading calendar lives in golden, a different database, and the regime
-- boundaries are facts about this repo's history that no query can derive.
--
-- THE ONE COLLISION
--
-- 2026-09-24 shifts onto 2026-09-23, which already holds a row. They measure
-- the same day. The existing 2026-09-23 row was priced off a 10:00 UTC tick —
-- mid-session, not the close. The row arriving from 2026-09-24 was priced off
-- the 23rd's actual close. The close wins; the mid-session row is deleted.
--
-- 2026-09-25 is left as a HOLE rather than reconstructed. Its move (+5,734 by
-- recomputation) can only be re-derived by re-running the snapshot job, which
-- is what fills it — no literal is written here that nobody measured.
--
-- WHAT KEEPS THIS FROM COMING BACK (CLAUDE.md §5)
--
-- Nothing in this file. The fix is in the route: snap_date is now
-- pf.priceAsOf — the date of the prices in the row — so the schedule is no
-- longer load-bearing and cron drift cannot re-introduce it. This migration
-- only repairs the rows the old behaviour already wrote.

DO $$
DECLARE
  n_del   integer;
  n_shift integer;
BEGIN
  -- Guard: the signature of the un-repaired state. Applying this twice would
  -- shift the rows a second time — the old_date and new_date sets overlap, so
  -- the mapping is not self-idempotent and something has to say "already done".
  IF NOT EXISTS (
    SELECT 1 FROM app.portfolio_snapshot
     WHERE snap_date = DATE '2026-09-25' AND day_change_value = -16021.49
  ) THEN
    RAISE NOTICE '0078: already applied, or no matching data — skipping';
    RETURN;
  END IF;

  CREATE TEMP TABLE _snap_remap (
    old_date date PRIMARY KEY,
    new_date date NOT NULL UNIQUE   -- the UNIQUE is the collision check, in the schema
  ) ON COMMIT DROP;

  INSERT INTO _snap_remap (old_date, new_date) VALUES
  ('2026-07-17','2026-07-16'),
  ('2026-07-20','2026-07-17'),
  ('2026-07-21','2026-07-20'),
  ('2026-07-22','2026-07-21'),
  ('2026-07-23','2026-07-22'),
  ('2026-07-24','2026-07-23'),
  ('2026-07-27','2026-07-24'),
  ('2026-07-28','2026-07-27'),
  ('2026-07-29','2026-07-28'),
  ('2026-07-30','2026-07-29'),
  ('2026-07-31','2026-07-30'),
  ('2026-08-03','2026-07-31'),
  ('2026-08-04','2026-08-03'),
  ('2026-08-05','2026-08-04'),
  ('2026-08-06','2026-08-05'),
  ('2026-08-07','2026-08-06'),
  ('2026-08-10','2026-08-07'),
  ('2026-08-11','2026-08-10'),
  ('2026-08-12','2026-08-11'),
  ('2026-08-13','2026-08-12'),
  ('2026-08-14','2026-08-13'),
  ('2026-08-17','2026-08-14'),
  ('2026-08-18','2026-08-17'),
  ('2026-08-19','2026-08-18'),
  ('2026-08-20','2026-08-19'),
  ('2026-08-21','2026-08-20'),
  ('2026-08-24','2026-08-21'),
  ('2026-08-25','2026-08-24'),
  ('2026-08-26','2026-08-25'),
  ('2026-08-27','2026-08-26'),
  ('2026-08-28','2026-08-27'),
  ('2026-08-31','2026-08-28'),
  ('2026-09-01','2026-08-31'),
  ('2026-09-02','2026-09-01'),
  ('2026-09-03','2026-09-02'),
  ('2026-09-04','2026-09-03'),
  ('2026-09-07','2026-09-04'),
  ('2026-09-08','2026-09-07'),
  ('2026-09-09','2026-09-08'),
  ('2026-09-10','2026-09-09'),
  ('2026-09-11','2026-09-10'),
  ('2026-09-14','2026-09-11'),
  ('2026-09-15','2026-09-14'),
  ('2026-09-24','2026-09-23'),
  ('2026-09-25','2026-09-24');

  -- The mid-session duplicate that 2026-09-24 is about to land on.
  DELETE FROM app.portfolio_snapshot WHERE snap_date = DATE '2026-09-23';
  GET DIAGNOSTICS n_del = ROW_COUNT;

  -- Round-trip through a temp table rather than UPDATE in place: the rows move
  -- backwards onto dates still occupied by other rows of the same batch, and
  -- portfolio_snapshot_user_id_snap_date_key is a plain (non-deferrable)
  -- UNIQUE constraint that can fire on the transient overlap depending on the
  -- order the planner happens to update in. Delete-then-reinsert has no order.
  CREATE TEMP TABLE _snap_moved ON COMMIT DROP AS
    SELECT s.*, r.new_date
      FROM app.portfolio_snapshot s
      JOIN _snap_remap r ON r.old_date = s.snap_date;

  DELETE FROM app.portfolio_snapshot s USING _snap_moved m WHERE m.id = s.id;

  INSERT INTO app.portfolio_snapshot
    (id, user_id, snap_date, total_value, total_cost, day_change_value, holdings, created_at)
  SELECT id, user_id, new_date, total_value, total_cost, day_change_value, holdings, created_at
    FROM _snap_moved;
  GET DIAGNOSTICS n_shift = ROW_COUNT;

  RAISE NOTICE '0078: % row(s) re-dated, % duplicate row(s) removed', n_shift, n_del;

  -- 2026-09-25 is now absent by design. Re-run /api/cron/portfolio-snapshot to
  -- fill it from live data; do not hand-write it.
END $$;

-- ── A second instance, found while verifying the first ──────────────────────
--
-- After the re-dating above, one row still failed the check: 2026-08-07 held
-- the 6→5 Aug move, not the 7→6 Aug move.
--
-- Cause is the same class, different trigger. refresh-ltp FAILED on
-- 2026-08-07 (GitHub run, 14:13 UTC, conclusion: failure). golden therefore
-- had no 7 Aug close when the Monday 10 Aug snapshot ran, so that run re-read
-- the 6 Aug close and produced a row byte-identical to the Friday one —
-- id 16 and id 17 agree on total_value, total_cost AND day_change_value to
-- the paisa. The re-dating moved the pair onto 2026-08-06 and 2026-08-07 and
-- preserved the duplication.
--
-- The duplicate is deleted. 2026-08-07 is left as a GAP rather than
-- reconstructed: the 6→7 Aug move can be recomputed for the mapped holdings
-- (+141) but not for the unmapped/ETF part, so any row written here would be
-- slightly wrong and indistinguishable from a measured one. A visible hole
-- beats a plausible invention. Same reasoning as 2026-09-25 above.
--
-- Note what this means for the curve generally: a failed refresh-ltp does not
-- produce a missing point, it produces a REPEATED one. Worth remembering the
-- next time the equity curve shows a suspiciously flat day.

DO $$
DECLARE n integer;
BEGIN
  DELETE FROM app.portfolio_snapshot a
   USING app.portfolio_snapshot b
   WHERE a.user_id = b.user_id
     AND a.snap_date = DATE '2026-08-07'
     AND b.snap_date = DATE '2026-08-06'
     AND a.total_value      IS NOT DISTINCT FROM b.total_value
     AND a.total_cost       IS NOT DISTINCT FROM b.total_cost
     AND a.day_change_value IS NOT DISTINCT FROM b.day_change_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0078: % stalled-price duplicate(s) removed at 2026-08-07', n;
END $$;
