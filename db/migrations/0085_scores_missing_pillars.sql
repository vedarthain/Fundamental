-- app.scores.missing_pillars — which pillars the composite was NOT built from.
--
-- WHY THIS COLUMN EXISTS
--
-- scorer._score_bucket renormalises the composite across whichever pillars came
-- back non-null. That is the correct arithmetic and the wrong disclosure: a
-- composite_pct computed from Quality and Valuation alone is published in the
-- same column, re-percentiled in the same pool, and rendered with the same
-- confidence as one that had all three. Nothing downstream could tell them
-- apart. On the 2026-10 snapshot that is 494 of 3,061 rows (16%) — 493 of them
-- missing momentum (recent listings with too little price history) and one
-- missing valuation. The 0.20 coverage floor added in scorer.COVERAGE_FLOOR
-- raises it: ~264 more lose valuation and ~12 lose quality, because withholding
-- a thin pillar is exactly what that floor does. The floor made the composite's
-- silence louder, so the silence has to end.
--
-- This is CLAUDE.md §5's failure shape one level up. The pillar-level guard
-- already returns None honestly; the composite then quietly papers over it.
--
-- WHY FLAG RATHER THAN SUPPRESS THE COMPOSITE
--
-- Nulling composite_pct whenever a pillar is missing would remove ~770 symbols
-- (a quarter of the universe, nearly all recent listings) from every ranked
-- surface on the site. A newly listed company with real financials and no price
-- history still has a defensible Q+V opinion; what it does not have is the
-- right to be mistaken for a complete one. Flagging keeps the opinion and
-- removes the mistake. Suppression is the heavier remedy and can be revisited
-- per-surface once this column exists to make the decision measurable.
--
-- WHY NOT REUSE score_status
--
-- score_status answers a different question — which PEER POOL the percentiles
-- were ranked in ('full' vs 'partial-cluster-mixed-tiers') — and coverage.py
-- already branches on its values to classify gated symbols. Overloading one
-- text column with two orthogonal facts means every reader has to parse rather
-- than compare, and the first reader to forget is a silent bug. Separate fact,
-- separate column.
--
-- SHAPE
--
-- NULL means the composite used all three pillars. Otherwise a sorted subset of
-- the letters q, v, m concatenated — 'm', 'v', 'qv', 'qvm'. 'qvm' can occur:
-- every pillar null leaves composite_pct NULL too, and recording why is more
-- useful than an unexplained null. Text rather than an array because the
-- cardinality is seven and the consumers compare for equality or test
-- containment of a single letter; `position('m' in missing_pillars) > 0` needs
-- no extension and no array semantics.
--
-- WHAT KEEPS THIS CURRENT (CLAUDE.md §5)
--
-- scorer._score_bucket writes it on every row of every scoring run, in the same
-- INSERT ... ON CONFLICT DO UPDATE that writes the pillar scores. It is derived
-- from the pillar values in the same loop iteration, so it cannot drift from
-- them: there is no separate job to forget to run and no backfill to go stale.
-- Existing rows stay NULL until the next run rewrites them, which is wrong for
-- the 494 rows above — see the backfill below, which fixes that without
-- rescoring.

ALTER TABLE app.scores
  ADD COLUMN IF NOT EXISTS missing_pillars text;

-- Backfill from the pillar columns already on the row. This is not a guess: the
-- three *_pct columns ARE the pillars the composite was renormalised across, so
-- deriving the flag from them reproduces exactly what the scorer would write.
-- Without it the column reads "complete" for 494 rows that are not, and a new
-- column that lies on day one is worse than no column.
UPDATE app.scores
   SET missing_pillars =
         NULLIF(
           CASE WHEN quality_pct   IS NULL THEN 'q' ELSE '' END ||
           CASE WHEN valuation_pct IS NULL THEN 'v' ELSE '' END ||
           CASE WHEN momentum_pct  IS NULL THEN 'm' ELSE '' END,
           '')
 WHERE missing_pillars IS NULL
   AND (quality_pct IS NULL OR valuation_pct IS NULL OR momentum_pct IS NULL);

COMMENT ON COLUMN app.scores.missing_pillars IS
  'Pillars that were NULL when composite_pct was computed, as a sorted subset '
  'of q/v/m (e.g. ''m'', ''qv''). NULL = composite used all three. The '
  'composite renormalises across the survivors; this column is the only record '
  'that it did. Distinct from score_status, which describes the peer pool. '
  'Written by scorer._score_bucket on every run — see 0085 for why it is a '
  'separate column and why the composite is flagged rather than suppressed.';
