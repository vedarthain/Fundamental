-- app.stock_evidence_sheet — the DERIVED half of the Verdict tab.
--
-- WHY THIS TABLE EXISTS
--
-- 0086 bought honesty at a price: verdicts are hand-written, so there are 384
-- of them against a ~2,600-name universe, and the other ~2,200 symbols get an
-- empty tab. The scan that produces a verdict already reads the whole peer
-- group, so the measurements exist for every name in it — what does not scale
-- is the opinion, the `check_*` script and the liability of publishing one.
--
-- So this table holds what the scan measured, and nothing it concluded. Same
-- evidence pack the verdict generators read; rendered by template, from
-- build/verdicts/lib/sheet.py; rebuilt rather than maintained.
--
-- WHY A SEPARATE TABLE AND NOT A `kind` COLUMN ON app.stock_verdict
--
-- Three readers already query app.stock_verdict with no kind filter, because
-- today there is nothing to filter: loadVerdict, loadVerdictChips and the
-- backlog query, in web/src/lib/verdict.ts (lines 133, 207 and 398, measured
-- 2026-10-24). Adding `kind` to that table makes every one of them wrong BY
-- OMISSION — a missing `WHERE kind = 'verdict'` throws no error, passes
-- review, and silently restates "384 verdicts" as "3,157" in the watchlist
-- chips and the admin queue count. That is CLAUDE.md §5's check that cannot
-- fail, inverted: a number that is wrong and looks right.
--
-- A separate table cannot be joined by accident. The cost is one extra query
-- on the stock page; the benefit is that no existing query changes meaning.
--
-- WHY THERE IS NO `verdict`, `confidence` OR `trigger_text` COLUMN
--
-- The absence is the schema refusing to let a sheet grow into a verdict.
--
-- A sheet is not a weaker verdict, it is a different artefact: it states what
-- the data says and stops. `confidence` would invite a reader to average a
-- derived sheet against a hand-written opinion; `verdict` would make it one;
-- `trigger_text` ("what would change this") is a falsification condition,
-- which only a claim can have.
--
-- Anyone adding one of those three columns is converting this into something
-- that needs a human author, a check script and an eviction rule — i.e. back
-- into 0086, at 2,200 rows. If that is genuinely wanted, write the verdict.
--
-- WHY pack_sha AND generator ARE NOT DECORATION
--
-- They are the only way a stale sheet is detectable at all.
--
-- 0086 made staleness visible by freezing `evidence` and comparing it against
-- live metrics, because a verdict's prose cannot be re-derived. A sheet can:
-- it is a pure function of (pack, template). So `pack_sha` is the hash of the
-- pack file the row was actually built from, and `generator` is a version
-- string bumped by hand when sheet.py changes its output. Together they answer
-- "could this row be reproduced today, and would it come out the same" — which
-- is what the DQ assertions in coverage.py test against. A row whose generator
-- string maps to no commit is a row nobody can reproduce, and an irreproducible
-- derived artefact has all of a verdict's liabilities and none of its care.
--
-- WHY HISTORY, AND WHY NO FK ON symbol
--
-- Both for 0086's reasons, unchanged. PRIMARY KEY (symbol, generated_at) keeps
-- every sheet ever written, so two consecutive rows show what moved. No FK,
-- because a sheet is a record of what was measured on a date and must survive
-- the symbol being delisted, renamed or dropped from app.universe — an FK with
-- a cascade would delete exactly the rows most worth keeping.
--
-- SHAPE
--
--   symbol         NSE symbol, uppercase, no .NS suffix (matches app.scores).
--   generated_at   when the sheet was rendered. Part of the PK.
--   blocks         jsonb array of rendered blocks, in display order, from
--                  sheet.py. Non-empty: a sheet with no blocks is the empty
--                  state and must not be stored as a row, because a stored
--                  empty row is indistinguishable from a failed render.
--   withheld       jsonb object, metric key -> reason it was NOT shown. The
--                  refusal rules in build/verdicts/lib/refusals.py decide
--                  this. Stored rather than discarded: "we did not show
--                  operating-margin rank because 31 of 59 peers tie" is the
--                  part a reader cannot reconstruct, and dropping it makes a
--                  withheld metric look like a metric that does not exist.
--   snapshot_date  app.scores snapshot the pack was built from. NOT NULL — it
--                  is the staleness key the DQ assertion counts on.
--   price_asof     latest golden.price_history date behind the technicals.
--   pack_sha       sha256 of the pack file read. See above.
--   generator      version of build/verdicts/lib/sheet.py. See above.
--
-- WHAT KEEPS THIS CURRENT
--
-- Two DQ assertions in etl/src/fundamental_etl/coverage.py, added with the
-- loader in the same change — not as a follow-up, because the follow-up is
-- what did not happen to app.screener_meta.
--
--   1. staleness: COUNT of rows whose snapshot_date is behind the newest
--      app.scores snapshot must be 0. On the count, never on a sample — one
--      fresh row proves nothing about 2,772 others.
--   2. coverage: the denominator is EVERY SCORED SYMBOL WITH NO HAND-WRITTEN
--      VERDICT, not "symbols that have a sheet". The second phrasing always
--      answers 100% and is precisely the `FROM app.scores` mistake in §5. The
--      first stays red while the backfill is incomplete and goes red again
--      when a newly-scored symbol never gets a sheet.
--
-- ADMIN-ONLY ON ARRIVAL. web/src/app/stock/[symbol]/page.tsx gates the Verdict
-- tab on isAdminRequest(), and the gate is on the QUERY, not the render — so
-- no public reader has ever seen a verdict, and none will see a sheet. Going
-- public is a deliberate one-line product decision, not something this
-- migration or its loader may imply.

CREATE TABLE IF NOT EXISTS app.stock_evidence_sheet (
  symbol         text        NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  blocks         jsonb       NOT NULL,
  withheld       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  snapshot_date  date        NOT NULL,
  price_asof     date,
  pack_sha       text        NOT NULL,
  generator      text        NOT NULL,

  PRIMARY KEY (symbol, generated_at),

  CONSTRAINT stock_evidence_sheet_symbol_upper
    CHECK (symbol = upper(symbol) AND symbol <> ''),
  -- A sheet with no blocks is a failed render wearing a row. Refuse it here so
  -- the loader cannot turn an exception into an empty tab.
  CONSTRAINT stock_evidence_sheet_blocks_nonempty
    CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) > 0),
  CONSTRAINT stock_evidence_sheet_withheld_object
    CHECK (jsonb_typeof(withheld) = 'object'),
  -- pack_sha and generator are the reproducibility pair; an empty string in
  -- either is the same as not having them, and would pass NOT NULL.
  CONSTRAINT stock_evidence_sheet_provenance_nonempty
    CHECK (pack_sha <> '' AND generator <> '')
);

-- The staleness assertion scans by snapshot_date across all symbols, and the
-- per-cluster backfill loads one snapshot at a time. The PK serves the
-- per-symbol read on the stock page; this serves both of those.
CREATE INDEX IF NOT EXISTS stock_evidence_sheet_snapshot_idx
  ON app.stock_evidence_sheet (snapshot_date DESC, symbol);

COMMENT ON TABLE app.stock_evidence_sheet IS
  'Derived, templated evidence sheets for symbols with no hand-written '
  'verdict. Admin-only, same tab as app.stock_verdict but never shown beside '
  'one. Append-only by PK (symbol, generated_at). Deliberately has no '
  'verdict/confidence/trigger_text column — see 0088 for why that absence is '
  'the design, and why this is a separate table rather than a kind column on '
  'app.stock_verdict.';

COMMENT ON COLUMN app.stock_evidence_sheet.withheld IS
  'Metric key -> reason it was not rendered, from the shared refusal rules. '
  'Stored because a withheld metric and a missing metric are different facts '
  'and a reader cannot tell them apart without this.';

COMMENT ON COLUMN app.stock_evidence_sheet.pack_sha IS
  'sha256 of the evidence pack this row was built from. With generator, the '
  'only way to tell whether a sheet could be reproduced today — a sheet is a '
  'pure function of (pack, template), unlike a verdict''s prose.';

COMMENT ON COLUMN app.stock_evidence_sheet.generator IS
  'Version string of build/verdicts/lib/sheet.py, bumped by hand when its '
  'output changes. A generator string that maps to no commit is a row nobody '
  'can reproduce.';
