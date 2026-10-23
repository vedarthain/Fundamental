# SPEC — the evidence sheet: coverage for the 2,773 symbols that get no verdict

**Status:** proposed, 2026-10-24. Not built.
**Channel:** the table and loader belong to `main`. The generator belongs here.

---

## The problem this solves

384 symbols carry a narrative verdict. 3,157 are scored. The gap is 2,773.

A narrative verdict costs one session per five symbols, because what makes it
trustworthy is a bespoke generator with guards written against *that batch's*
specific traps — the wide band, the thin reading, the tie that covers a third
of the bucket, the pillar scored on 90 of its declared 100 points. Those guards
are not reusable prose rules; they are measurements of one pack.

So extending the verdict to 2,600 symbols is ~555 more sessions. The cheap
alternative — reuse one generator and drop the per-batch guards — is worse than
silence, because it produces confident prose nobody measured. **A fabricated
verdict on a stock Deb does not hold is still a fabrication on equityroots.in.**

The answer is to stop treating "has a verdict" as the only state. Add a second,
weaker artefact that is honest about being weaker.

---

## What it is

An **evidence sheet**: pack-derived sentences for any scored symbol, carrying
**no verdict label, no confidence, and no judgment**. Every sentence is a
template filled from `verdict-evidence.py`'s pack. Nothing is written by hand,
so nothing needs a hand-written guard.

It answers "what does the data say about this row" and explicitly does not
answer "should I buy it".

### What it contains

| Block | Source | Template shape |
|---|---|---|
| Cohort | `peer_ranks.cohort` | "Peered against N peers in the `<cluster>` <tier> tier, weighted q/v/m." |
| Pillars | `peer_ranks.scores` | Four percentiles with their own denominators, each stating the rank. |
| What is real | `peer_ranks.metrics` | The rankable metrics, rank and denominator, tie stated when `tied > 1`. |
| What is withheld | same | Every metric refused, **with the reason** — sub-floor denominator, tie covering more than 1/3 of the bucket, NULL on this row. |
| What is caveated | `scorecard_coverage.pillars` | Any pillar whose `covered_weight < 100`, naming the missing weight and the metric behind it. |
| Earnings quality | `earnings_quality`, `annual` | Negative operating-cash years, loss-making years, the margin step, the CFO/OP ratio — counted, never characterised. |
| Price history | `technicals.bars` | Bar count when under the 252+200 window needs. |
| Band | `pe_band` | Three-valued: absent / too wide to price / stated. |

### What it must never contain

- A verdict label, an action word, or a confidence grade.
- Any adjective that grades the row: cheap, expensive, strong, weak, durable.
- A falsification trigger. A trigger implies a thesis, and there is none.
- A superlative that is not a literal rank of 1 in the pack.
- A metric the cluster does not carry (the `BANNED_PHRASES` problem, now a
  shared library rather than a per-batch tuple).

---

## The load-bearing design call: a separate table

`app.stock_evidence_sheet`, **not** a `kind` column on `app.stock_verdict`.

Reason, and it is the §5 failure mode: `stock_verdict` already has a
`confidence` CHECK that assumes a judgment, a `points_nonempty` CHECK, and an
unknown number of readers — the Verdict tab, the drift job, the backlog SQL,
every count-of-coverage metric. Putting 2,773 templated rows in that table
means each of those becomes wrong **by omission** — a missing `WHERE kind =
'verdict'` is invisible, passes review, and silently restates "384 verdicts" as
"3,157 verdicts". A separate table cannot be joined by accident.

Same tab in the UI. Different table in the database. The UI is where they sit
together; the schema is where they must not.

```sql
CREATE TABLE app.stock_evidence_sheet (
  symbol        text NOT NULL CHECK (symbol = upper(symbol) AND symbol <> ''),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  blocks        jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'
                                      AND jsonb_array_length(blocks) > 0),
  withheld      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- metric -> reason
  snapshot_date date NOT NULL,
  price_asof    date,
  pack_sha      text NOT NULL,   -- which pack built this; makes staleness visible
  generator     text NOT NULL,   -- version of the template library
  PRIMARY KEY (symbol, generated_at)
);
```

No `confidence`, no `verdict`, no `trigger_text`. The absence of those columns
is the schema refusing to let a sheet grow into a verdict.

---

## Rendering under the Verdict tab

Precedence, in `web/src/app/stock/[symbol]`:

1. A row in `stock_verdict` → render the verdict as today. The sheet is not
   shown, not even below it.
2. No verdict, a row in `stock_evidence_sheet` → render the sheet under a
   heading that says what it is **before** the reader sees any number:
   **"No verdict yet — here is what the data says."**
3. Neither → the existing empty state.

The heading is not decoration. A templated sheet under the same tab inherits
the authority of the hand-written verdicts beside it, and the heading is the
only thing standing between those two. It is load-bearing copy; do not let it
become a subtitle.

Visual separation is Deb's call and cannot be verified from here — flag it for
him to look at rather than claiming it reads correctly.

---

## Why the guards collapse to a library

A per-batch guard exists because a human wrote a sentence and the guard checks
the sentence against the pack. Here nothing is written, so there is one class
of bug: a template that renders a figure the pack does not support. That is
checkable **once**, generically:

1. **Every number in the output traces to a pack field.** Render each block
   with the field provenance attached, then assert every numeric token in the
   final string came from a traced substitution. This is `verdict-check.py`'s
   job made total — and unlike the prose version, 100% is achievable, because
   there is no hand-written sentence to carry an untraceable figure.
2. **Every refusal rule from the 80-odd batch guards that is NOT batch-specific
   moves here**, as a shared module: the denominator floor, the tie divisor,
   the band ratio, the thin-reading rule, the pillar-weight caveat, the dead
   metrics, the NULL-key rule, the delivery-session rule, the price-history
   floor. These were re-derived per batch; they should have been a library two
   months ago.
3. **The mutation discipline survives.** The library gets one mutation suite,
   run against a sample of packs spanning every cluster and tier — not per
   batch. A rule that cannot fail against *any* real pack is decoration.

**What keeps this current** (§5): the sheet is regenerated by the same job that
writes `app.scores`, keyed on `pack_sha`. A sheet whose `snapshot_date` trails
the latest scores snapshot is stale and the DQ suite fails on the count, not on
a sample. Seeding 2,773 rows once and never regenerating them is the exact bug
this project keeps shipping.

---

## Open defect found by step 1 — logged, not fixed

**2026-10-24.** Replaying the extracted rules found six published verdicts that
quote a pillar percentile over a shortfall they never disclose:

| Symbol | Batch | Pillar scored on | Disclosed? |
|---|---|---|---|
| DHARMAJ | chemicals_agro_8 | quality 92.0 of 100 | no |
| CENTUM | defense_aero_10 | quality 92.8 of 100 | no |
| SIGMAADV | defense_aero_10 | quality 89.2 of 100 | no |
| CALSOFT | it_services_8 | valuation 95 of 100 | no |
| PVRINOX | media_6 | valuation 85 of 100 | no |
| PFOCUS | media_6 | valuation 85 of 100 | no |

(RATEGAIN also mismatched, but its *prose* does disclose the 95 of 100 — only
its `PILLAR_WEIGHT` constant is stale. Not a reader-facing defect.)

Cause: every generator applied a materiality threshold and none declared it,
so they disagreed with each other — realty disclosed a quality pillar at 92.8
of 100 while defense left the identical 92.8 silent.

Deb's call on 2026-10-24: log and keep building. `refusals.pillar_caveats` now
takes the threshold as an argument and defaults to disclosing every shortfall,
so this cannot recur in the sheet. The six live verdicts are unchanged and
`replay_refusals.py` holds them in `KNOWN_GAPS` with an assertion that each
still reproduces — if one stops, the pack moved or the prose changed, and both
need re-reading before the entry is deleted.

---

## Build order

1. Extract the shared refusal library from the existing `mk_*.py` guards.
   Prove it by replaying it against three already-shipped packs and getting
   zero new errors on prose already known clean.
2. Template library + provenance-traced renderer. One cluster first.
3. The generic numeric-provenance check, driven to 100% on that cluster.
4. The mutation suite for the library.
5. Migration + loader (`main` channel), DQ assertion on staleness and count.
6. Render precedence + the heading (`main` channel).
7. Backfill, cluster by cluster. Purge the Data Cache.

Step 1 is the whole bet. If the refusal rules do not survive extraction —
if too many of them turn out to be genuinely batch-specific — the sheet cannot
be trusted and the honest outcome is to ship nothing for the 2,773 and say so.
Find that out in step 1, not in step 7.
