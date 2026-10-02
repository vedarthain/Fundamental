-- app.universe.is_sme — which NSE board a member trades on.
--
-- WHY THIS COLUMN EXISTS
--
-- Until 2026-10-02 the universe was mainboard-only, so "which board" was not a
-- question anything had to ask. It was mainboard-only by accident rather than by
-- decision: the bhavcopy ingest filtered to series EQ/BE/BZ/BL and so never saw
-- series SM/ST, and sync-universe additionally refused to onboard anything
-- absent from NSE's EQUITY_L.csv, which is mainboard-only. Both gates are now
-- open and ~575 NSE EMERGE scrips become eligible, so the distinction has to be
-- recorded rather than inferred.
--
-- WHY NOT INFER IT FROM THE SERIES OR THE MARKET CAP INSTEAD
--
-- Series lives in the bhavcopy, which app.universe does not keep, and a symbol's
-- series changes when it moves between normal and T2T settlement — so it tracks
-- surveillance status, not board. Market cap is worse: an SME scrip and a
-- mainboard microcap can be the same size, and market_cap_category has no tier
-- below small_cap anyway (2,119 of 2,605 active members are small_cap). Board
-- membership is a fact NSE publishes in a separate file; it gets stored.
--
-- WHAT THIS DOES *NOT* DO, DELIBERATELY
--
-- It does not change cluster assignment and it does not gate scoring. Clusters
-- key on (sector, industry, market_cap_category), so an SME name will share a
-- peer bucket with mainboard small caps once it has Screener fundamentals, and
-- MIN_PEERS/SHRINK_N damping is the only thing moderating that. Whether SME
-- names should be percentiled separately is a scoring question with its own
-- blast radius — cluster_id values feed app.cluster_composite and several caches
-- — and it must not ride along silently with a visibility fix. This column is
-- what makes that decision possible later; it is not the decision.
--
-- NOT NULL DEFAULT false is safe on a 2,605-row table and correct as a
-- backfill: every existing member predates SME onboarding, because the two gates
-- above made it impossible for an EMERGE scrip to be here.
--
-- WHAT KEEPS THIS CURRENT (CLAUDE.md §5)
--
-- sync-universe stamps it on every run from NSE's SME_EQUITY_L.csv — for new
-- members at insert, and for existing members by comparing the full master
-- against the active set. It is not a seed. A scrip that migrates from EMERGE to
-- the mainboard (a real event; NSE calls it migration) drops out of the SME
-- master, and the same run flips the flag back to false.

ALTER TABLE app.universe
  ADD COLUMN IF NOT EXISTS is_sme boolean NOT NULL DEFAULT false;

-- Partial index: the predicate of interest is always "is this one SME", and the
-- false side is ~80% of the table, where a plain index would not be used.
CREATE INDEX IF NOT EXISTS universe_is_sme_idx
  ON app.universe (symbol) WHERE is_sme;

COMMENT ON COLUMN app.universe.is_sme IS
  'True when NSE lists this symbol on the EMERGE (SME) board rather than the '
  'mainboard. Stamped by sync-universe from SME_EQUITY_L.csv. Does not affect '
  'cluster assignment or scoring — see 0083 for why.';
