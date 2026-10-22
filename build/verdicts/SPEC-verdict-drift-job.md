# SPEC — move drift detection off the website into a daily job

**Status:** specification only. Written 2026-10-22 from the `verdict`
checkout, which is scoped to `build/verdicts/`. The implementation touches
`etl/`, `web/` and a migration — **a `main` session owns all of it.**

**Decision this records (Deb, 2026-10-22):** the website must not compute
anything. Drift is computed elsewhere, persisted, and the site only
*displays* the output.

**Companion spec:** `SPEC-ranks-block.md`. That one makes a verdict cheap to
*write*; this one caps how often one must be *rewritten*. Neither alone makes
the 300-verdict corpus sustainable.

---

## 1. What exists today, measured

Nothing runs. There is no job, no table, no notification.

`loadVerdictQueue()` in `web/src/lib/verdict.ts` computes drift **lazily on
page load**. `/watchlist` and `/dashboard` are `export const dynamic =
"force-dynamic"`, so every request re-runs `computeDrift` for every tracked
symbol, buckets each one, and throws the result away when the response ends.

Consequences, all of them live right now:

- **You are never told.** A verdict breaks and nothing surfaces until you
  happen to open the tab.
- **No history.** "When did this verdict break?" is unanswerable, because the
  computation is never stored. The weekly timeline in `loadVerdictQueue`
  reconstructs an approximation from `metrics_snapshot` on every request.
- **Every page view pays for it.** 12 weeks of weekly `cluster_metrics` for
  every verdict-carrying symbol, per request.
- **Two staleness constants disagree.** The queue uses `STALE_DAYS = 30`;
  `NeedsAction.tsx` uses `VERDICT_STALE_DAYS = 120`. Both are live.

### 1.1 The logic being moved (copy it exactly, do not improve it)

From `web/src/lib/verdictTypes.ts`:

```
STALE_DAYS              = 30
REL_THRESHOLD           = 0.1
ABS_THRESHOLD_FOR_RATES = 0.05
DERIVED_KEYS = {pe_band_lo, pe_band_hi, pe_band_avg, pe_vs_own_history,
                delivery_pct, pledge_pct}
```

`hasMoved(stored, live)` — the order of these branches is the behaviour:

1. `live` null/undefined → `{moved: false, liveMissing: true}`. **Unverifiable
   is not the same as unchanged**, and the type carries the difference.
2. Either side boolean → moved iff `Boolean(stored) !== Boolean(live)`. A
   boolean flip is always material; `ema_stack_bull` is the entire content of
   two live verdicts' upgrade triggers.
3. Coerce both via `asNumber` (number → itself, boolean → 1/0, string →
   `Number()`, else null). Either null → `liveMissing: true`.
4. `stored == 0` → moved iff `live != 0`. (No relative test is possible.)
5. `isRate = |a| <= 1 and |b| <= 1` → moved iff `|b - a| >= 0.05`;
   otherwise moved iff `|b/a - 1| >= 0.1`.

`computeDrift(evidence, live)` — for each key in `evidence`: if the key is in
`DERIVED_KEYS` **or** absent from `live`, emit `comparable: false,
moved: false`; else run `hasMoved`.

Live values come from **`app.metrics_snapshot.cluster_metrics`** at the latest
snapshot date — *not* the flat columns on `metrics_snapshot`. The comment at
`verdict.ts:147` records why: the flat columns and `cluster_metrics` disagree
in the last decimal, and `cluster_metrics` is what the scorer's formulas
actually used.

Bucketing (`verdict.ts:478`):

```
bucket = movedKeys.length > 0 || ageDays > STALE_DAYS ? "due" : "current"
missing  = tracked symbol with no verdict
dormant  = verdict exists, symbol no longer tracked
```

**Port this verbatim first and change nothing.** The behaviour changes in §4
are a separate, later commit, so that a regression can be attributed to either
the port or the change but never to both.

---

## 2. Deliverable 1 — the table

Migration in `db/migrations/`. One row per tracked symbol per run.

```sql
CREATE TABLE app.verdict_drift (
  computed_on      date        NOT NULL,
  symbol           text        NOT NULL,
  bucket           text        NOT NULL,
  verdict          text,
  confidence       text,
  generated_at     timestamptz,
  age_days         int,
  snapshot_date    date,
  moved_keys       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cited_keys       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  moved_cited      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  comparable_count int         NOT NULL DEFAULT 0,
  unverifiable     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  detail           jsonb,
  PRIMARY KEY (computed_on, symbol),
  CHECK (bucket IN ('due','current','missing','dormant')),
  CHECK (symbol = upper(symbol)),
  CHECK (jsonb_typeof(moved_keys) = 'array')
);
CREATE INDEX verdict_drift_bucket_idx ON app.verdict_drift (computed_on DESC, bucket);
```

Design notes, each with a reason:

- **Keyed by `computed_on`, not upserted in place.** History is half the point
  — "this broke on the 14th" has to be answerable, and an upsert destroys
  exactly that. One row per symbol per day, ~300 rows/day, ~110k/year. Trivial.
- **`unverifiable` is a key list, not a count.** The lazy version stores only
  `unverifiableCount`, so a metric that goes permanently NULL looks like
  stability forever. Naming the keys makes that visible. This is the
  `pct_above_200ema_252d` failure mode already recorded in
  `verdict-evidence.py`'s docstring.
- **`detail`** holds the full per-key `{stored, live, rel_pct, moved,
  comparable, live_missing}` array — what the panel renders. Kept so the site
  needs no second query and no arithmetic.
- **`snapshot_date`** records which `metrics_snapshot` the comparison used.
  Without it, a run against a stale snapshot is indistinguishable from a run
  against a fresh one, and "nothing moved" would be a lie about the wrong day.
- **Retention:** none initially. Revisit at >1M rows, which is 2030.

---

## 3. Deliverable 2 — the ETL command

`etl/src/fundamental_etl/` gains a `verdict_drift` module and a CLI verb:

```
etl/.venv/bin/python -m fundamental_etl.cli verdict-drift [--dry-run] [--on DATE]
```

### 3.1 What it does

1. Read tracked = `app.user_watchlist ∪ app.portfolio_holding`.
2. Read the newest verdict per symbol from `app.stock_verdict` (append-only on
   `(symbol, generated_at)`, so: `DISTINCT ON (symbol) ... ORDER BY symbol,
   generated_at DESC`).
3. Read `cluster_metrics` for all of them at `MAX(snapshot_date)`.
4. Run the §1.1 logic. Bucket. Write one row per symbol.
5. Print a summary: counts per bucket, and the `due` list with the keys that
   moved.

### 3.2 Python owns the logic. The TS copy is deleted.

**`hasMoved`, `computeDrift`, `DERIVED_KEYS`, `STALE_DAYS`, `REL_THRESHOLD`
and `ABS_THRESHOLD_FOR_RATES` are removed from `web/src/lib/verdictTypes.ts`
and `verdict.ts` in the same commit that the job goes live.**

This is not tidiness. A TS copy left in place as a fallback is the
duplicate-implementation bug we are moving the job to avoid — and this repo
already pays for one: `DERIVED_KEYS` is duplicated in
`scripts/verdict-load.py` and `verdictTypes.ts`, with a 6-line comment at
`verdictTypes.ts:160` explaining that both divergence directions fail
*quietly*. Do not add a third copy. After this change `verdict-load.py`'s copy
imports from the ETL module, leaving exactly one definition in the repo.

The TS types (`DriftRow`, `QueueEntry`, `VerdictBucket`, `BUCKET_COLOR`) stay
— they describe the shape being read, which is still needed.

### 3.3 Sanity, in the job, failing loudly

A drift job that silently measures nothing is the §5 "check that cannot fail",
and it is *especially* dangerous here because its benign output ("0 due") is
identical to total failure. So:

1. **`snapshot_date` must be within 10 days of today.** `metrics_snapshot` is
   weekly; older means the pipeline stalled and the comparison is against old
   data. Fail, do not warn.
2. **Control row.** Before reporting any result, confirm `cluster_metrics` is
   non-empty for at least one known-present symbol (e.g. `RELIANCE`). CLAUDE.md
   §4: *a zero result is a claim; prove the query can succeed first.* An empty
   `cluster_metrics` join would mark every verdict `current` and report a clean
   bill of health on a dead feed.
3. **`comparable_count == 0` for a symbol is an error, not a clean row.** It
   means none of its evidence keys matched live at all — a renamed metric or a
   cluster change, not stability.
4. **Tracked count sanity:** if tracked drops by more than 20% versus the
   previous `computed_on`, stop. A half-loaded watchlist would mass-produce
   `dormant` rows.

### 3.4 The key-name seam

Drift matches `evidence` keys to `cluster_metrics` keys **by name**. Rename a
metric in the scorer and every verdict citing it silently becomes
`liveMissing` — never `due`, forever. The job must emit a DQ line: *"N keys
across M verdicts have no live counterpart"*, with the top offenders. Today
nothing reports this; `unverifiableCount` is rendered as a number next to a
clean-looking row.

---

## 4. Deliverable 3 — the behaviour change (separate commit)

Only after §2–3 are live and verified does the actual sustainability fix land.

### 4.1 `cited_keys`, from pass 1

`scripts/verdict-check.py` already traces every numeric token in the prose
back to the pack key it came from — that trace *is* the citation map, and it
is currently printed and discarded. Emit it into the batch JSON as
`cited_keys` (per point, plus a top-level union); `verdict-load.py` writes it
to a new `app.stock_verdict.cited_keys jsonb` column.

Limitation to state in the column comment: pass 1 traces **numbers only**. A
qualitative claim ("promoter pledge is unchanged") attributes nothing and would
never go due. The generator guards against that — same shape as guard 6b in
`mk_capmkt_14_v2.py` — by requiring any non-numeric claim about a metric to
name the key explicitly.

### 4.2 Kill age-based staleness

```
bucket = moved_cited non-empty ? "due" : "current"
```

`age_days` is still recorded and still displayed; it stops *causing* `due`.

Why: `STALE_DAYS = 30` marks every verdict `due` monthly on the calendar
alone. At 300 verdicts that is ~300 rewrites a month forever, whether or not
anything changed — which is the actual reason the corpus is unsustainable, not
the one-time backlog. A drift-triggered queue is bounded by how much the
market actually moved.

Keep an age **display** threshold and reconcile the two constants while here:
the queue's 30 and `NeedsAction.tsx`'s `VERDICT_STALE_DAYS = 120` currently
both exist and disagree. One constant, one place.

### 4.3 Measure before shipping 4.2

Run the job for one week recording both buckets — old rule and new — and
report the two `due` counts. CLAUDE.md §4: *"should be unaffected" is not a
measurement*; a changed predicate changes a row count and both sides get
measured. Known prior: a replay of `hasMoved` over `metrics_snapshot` showed
172 of 277 verdicts (62%) drifting within three weeks — so the new rule is
lighter than age-based, but **not light**. If `moved_cited` does not cut that
materially, the citation map is too broad and §4.1 needs tightening before
§4.2 ships.

---

## 5. Deliverable 4 — the schedule

GitHub Action, daily, after the weekly metrics load on the days it runs.

- Runs the ETL verb against Neon with `FUNDAMENTAL_ALLOW_REMOTE_DB=1`.
- **No web route involved.** The earlier idea of having the Action call an
  admin API so the TS stayed the single implementation is **rejected** by the
  decision in the header: the site computes nothing.
- On a non-empty `due` list, notify. On a sanity failure, notify *louder* — a
  silent failure here reads as "nothing is due", which is the one wrong answer
  that looks like good news.
- The repo is public, so Actions minutes are unlimited; no cost argument
  against daily.

---

## 6. Deliverable 5 — the website, now read-only

`loadVerdictQueue()` becomes one `SELECT` against the newest `computed_on`.

- Drop `force-dynamic` from `/watchlist` and `/dashboard` — with no
  computation left there is nothing to be dynamic about. A tag-based revalidate
  on the drift job's completion is enough.
- `/stock/[symbol]` keeps `revalidate = 21600`; the panel reads `detail` from
  the same table.
- The 12-week timeline stops being reconstructed per request and becomes
  `SELECT ... FROM app.verdict_drift WHERE computed_on >= ...` — which is also
  the first time it will be *accurate* rather than approximated from weekly
  snapshots.
- **No fallback path.** If the table is empty the tab says "drift has not been
  computed" and names the job. It must never quietly recompute, because a
  fallback is how the deleted TS logic comes back.

Note while in this file: the Verdict tab currently blanks the entire page on a
client throw, because there is no `error.tsx` or `global-error.tsx` anywhere
in `web/src/app/`. Unrelated to drift, but it is the reason a bug here is
invisible rather than noisy. Add the boundary in the same session.

---

## 7. Acceptance

Per CLAUDE.md §4, *a fix must fail on the bug it fixes*:

1. **Parity.** Run the Python job and the existing TS queue against the same
   snapshot. Every symbol's bucket and `moved_keys` must match **exactly**.
   Any disagreement is a port bug — resolve it in favour of the TS behaviour,
   which is what has been shipping.
2. **Each sanity check trips.** Point the job at an old snapshot (3.3.1 must
   fail). Empty the `cluster_metrics` join (3.3.2 must fail, *not* report 0
   due). Rename one evidence key (3.3.3 must flag that symbol).
3. **A real break is caught.** Take a live verdict, find a key whose
   `cluster_metrics` value moved >10% since it was written, and confirm the
   job marks it `due` and names that key.
4. **A real non-break is not.** A verdict whose keys all sit inside the
   thresholds must come back `current` — a job that marks everything `due` is
   as useless as one that marks nothing.
5. **History works.** Two runs on different `computed_on` values, and a query
   that answers "on what date did SYMBOL first go due?".

---

## 8. Order of work

1. Migration + `app.verdict_drift`. Applied to prod **and** committed, same
   session (CLAUDE.md §4).
2. ETL `verdict-drift` verb, logic ported verbatim, sanity checks.
3. §7.1 parity run. Do not proceed on a mismatch.
4. Delete the TS logic; rewire the site to read the table (§6). Purge the Data
   Cache — the deploy and the purge are one act.
5. GitHub Action, daily.
6. `cited_keys` (§4.1), then one week of dual measurement (§4.3), then §4.2.
7. `docs/ARCHITECTURE.md` and `docs/RUNBOOK.md`: drift is a scheduled job with
   a symptom entry, no longer a page-load side effect. The docs are wrong the
   moment step 4 lands, and fixing them is part of the change.

## 9. Why this is the sustainable half

`SPEC-ranks-block.md` cuts the cost of writing one verdict. This spec cuts the
*number* of verdicts that must be rewritten, from "all 300, monthly, by the
calendar" to "the ones whose cited numbers actually moved". Shipping the ranks
block alone would only make an unbounded treadmill cheaper per lap.
