# PLAN — the main-session half of the evidence sheet

**Written from the `verdict` channel, 2026-10-24, to be executed from `main`.**
Steps 1–4 of `SPEC-evidence-sheet.md` are built and verified in
`build/verdicts/lib/`. Everything below touches files outside
`build/verdicts/`, which this channel may not write, so it is a handoff rather
than a to-do list.

---

## Read this before step 1 — the premise has moved

**The Verdict tab is admin-only today.** `web/src/app/stock/[symbol]/page.tsx`
gates it on `isAdminRequest()`, and the gate is on the *query*, not the render,
so a non-admin request never touches `app.stock_verdict` and the tab is omitted
entirely. Measured 2026-10-24.

Three consequences, and the first one is the uncomfortable one:

1. **No public reader has ever seen a verdict.** The spec's cost argument —
   "2,773 symbols get nothing" — is a statement about Deb's own coverage, not
   about what the site shows. Nothing is currently withheld from readers,
   because nothing is currently offered to them.
2. **So the risk the sheet was designed around is deferred, not absent.** A
   templated sheet that reads as a judgment is a risk the moment the tab goes
   public, and the heading in step 4 is what stands between those two states.
   It is worth building correctly now and cheap to get wrong later.
3. **Whether sheets are public at all is a product call, not an engineering
   one.** Do not decide it inside a migration. The plan below ships the sheet
   behind the same admin gate as the verdict, and going public is a separate,
   one-line change Deb makes deliberately.

---

## Step 1 — migration `0088_stock_evidence_sheet.sql`

DDL is in `SPEC-evidence-sheet.md` and is unchanged. The things the next
reader will want to know, which belong in the migration's own header comment:

- **Why a separate table and not a `kind` column on `app.stock_verdict`.**
  Three readers already query that table without a `kind` filter —
  `loadVerdict`, `loadVerdictChips` and the backlog query, all in
  `web/src/lib/verdict.ts` (lines 133, 207 and 398, measured 2026-10-24). A
  `kind` column makes every one of them wrong *by omission*: a missing
  `WHERE kind = 'verdict'` is invisible, passes review, and silently restates
  "384 verdicts" as "3,157 verdicts" in the watchlist chips and the queue
  count. A separate table cannot be joined by accident.
- **Why there is no `confidence`, `verdict` or `trigger_text` column.** The
  absence is the schema refusing to let a sheet grow into a verdict. Anyone
  adding one of those columns is converting the artefact into something that
  needs a human, and the comment should say so.
- `pack_sha` and `generator` are not decoration: they are how a stale sheet is
  detectable at all. See step 3.

Applied to prod **and** committed in the same session, per CLAUDE.md §4.

## Step 2 — `scripts/evidence-sheet-load.py`

Model it on `scripts/verdict-load.py`, which already has the right shape:
validate, `--dry-run`, refuse rather than warn. Differences:

- **It takes a pack, not prose.** Input is the output of
  `scripts/verdict-evidence.py` plus the cohort's measured floor; the loader
  imports `build/verdicts/lib/sheet.py` and renders. There is no hand-written
  field to validate, which is the whole point of the artefact.
- **It runs `check_sheet.py` on its own output and refuses to write if a single
  number is untraced.** Not a warning. `verdict-load.py`'s own header records
  what happened when the unresolvable-key check was a warning: it printed
  underneath "N verdict(s) valid" and nobody saw it for five months.
- **The floor is a required argument with no default.** It was measured per
  cohort — 27 in leisure, 28/17 in cement, 19 in textiles — and a default
  would bake one cluster's measurement into all of them.
- **It writes `pack_sha` as the hash of the pack file it actually read**, and
  `generator` as a version string bumped by hand when `sheet.py` changes
  output. A sheet whose generator string nobody can map back to a commit is a
  sheet nobody can reproduce.

## Step 3 — the DQ assertions, and the one that has teeth

Two in `etl/src/fundamental_etl/coverage.py`, run by the same
`... coverage` command:

1. **Staleness, on the count and not on a sample.** Every row in
   `app.stock_evidence_sheet` whose `snapshot_date` is behind the newest
   `app.scores` snapshot is stale. The assertion is `count(stale) = 0`.
   Sampling here is what §5 warns about: one fresh row proves nothing about
   2,772 others.
2. **Coverage, phrased so it can fail.** *Not* "of the symbols with a sheet,
   how many have a current sheet" — that asks a question whose answer is
   always 100% and is exactly the `FROM app.scores` mistake. The denominator
   must be **every scored symbol with no hand-written verdict**, so the
   assertion fails while the backfill is incomplete and keeps failing if a
   newly-scored symbol never gets a sheet.

Before trusting either, run them against a deliberately stale row and confirm
they go red. A green tick on an unproven assertion is worse than no assertion.

## Step 4 — the render, behind the existing admin gate

In `web/src/app/stock/[symbol]/page.tsx`, the precedence is:

1. A row in `app.stock_verdict` → render the verdict as today. **The sheet is
   not shown, not even below it.** A verdict beside a sheet invites the reader
   to average them.
2. No verdict, a row in `app.stock_evidence_sheet` → render the sheet.
3. Neither → today's empty state.

Keep `isAdminRequest()` on the sheet query too, for the reason in the preamble.

**The heading is load-bearing copy, not decoration:**
**"No verdict yet — here is what the data says."** It must appear *before* the
reader sees any number. A templated sheet under the same tab inherits the
authority of the hand-written verdicts beside it, and that sentence is the only
thing standing between them. Do not let it become a subtitle, and do not let
it be shortened to fit a layout.

Render the table (`sheet.render_table`), not the prose blocks. The table needs
no selection rule; prose over thirty-seven measurements forces a choice among
them, and choosing is the judgment a sheet is not allowed to make.

**Visual separation cannot be verified from a Claude session** — there is no
browser access. Report what changed and ask Deb to look. Never claim it reads
correctly.

## Step 5 — backfill, one cluster at a time

- One cluster, loaded, looked at, before the second. 2,773 rows written in one
  command is 2,773 rows nobody read.
- The floor is measured per cohort before each cluster's load. Carrying the
  previous cluster's floor forward is the single most likely way to ship a
  wrong sheet, because nothing in the output looks wrong when the floor is.
- **Purge the Vercel Data Cache after each cluster.** It survives deploys and
  the loaders precompute server-side; a load with no purge is invisible.

---

## What this plan does not resolve

Two gaps found while building steps 1–4, both belonging to the pack builder
(`scripts/verdict-evidence.py`, `main` channel) rather than to the sheet:

1. **The pack does not say which columns are yes/no flags.**
   `sheet.BINARY_METRICS` is therefore maintained by hand and will go stale the
   moment a flag column is added. A binary column can never carry a rank at any
   tie size — the whole cohort sits in one of two groups — and the one-third tie
   rule does *not* catch it, because 11 ties out of 59 clears the test.
2. **The pack does not declare each column's unit.** `sheet.COLUMNS` carries a
   hand-written unit for all 56 columns seen across the surviving packs, each
   read off the formula that computes it in
   `etl/src/fundamental_etl/scoring/`. That map is correct today and is not
   self-maintaining. `check_sheet.py` fails on any column with no declared
   unit, so the decay is loud rather than silent — but the right fix is for the
   pack to carry the unit.

And one defect logged rather than fixed, on Deb's call: six published verdicts
quote a pillar percentile over a shortfall they never disclose. They are listed
in `SPEC-evidence-sheet.md` and held in `replay_refusals.py`'s `KNOWN_GAPS`
with an assertion that each still reproduces. If one stops reproducing, the
pack moved or the prose changed, and both need re-reading before the entry is
deleted.
