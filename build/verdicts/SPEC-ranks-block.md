# SPEC — the `ranks` block, and the one checker that replaces the per-batch ones

**Status:** specification only. Written 2026-10-22 from the `verdict` checkout,
which is scoped to `build/verdicts/`. **Both deliverables live in `scripts/`
and must be implemented from the `main` session.** Nothing in this file is
code that runs.

**Why it exists:** ~150 verdicts remain under the watchlist+portfolio scope
rule, across 31 clusters. At the current cost per batch they are not
affordable, and the cost is not the prose.

---

## 1. The problem this solves

Verdict verification is two passes, and only one of them is reusable.

- **Pass 1** — `scripts/verdict-check.py`. Traces every numeric token in the
  prose back to the symbol's own pack. Permanent, generic, cheap.
- **Pass 2** — a hand-written `build/verdicts/check_<batch>.py`, ~200–330
  lines, written once per batch and never run again. It exists for exactly one
  class of claim that pass 1 *structurally cannot see*: **anything about the
  peer set.** "#2 of 37", "the largest of the 14", "bottom nine of 42". Every
  individual number in such a sentence is present in the pack; only the
  ordering *between* symbols is wrong, and the ordering is not in the pack.

This is not a hypothetical cost. On 2026-10-22, across **two** verdicts, pass 2
caught three false claims, none visible to pass 1:

| Claim written | Truth | Why pass 1 missed it |
|---|---|---|
| "the largest of the 14" (CHOICEIN, mcap) | CRISIL ₹33,243cr > CHOICEIN ₹16,186cr → **second** | CHOICEIN's own mcap is in its pack and correct |
| "nine of the fourteen carry a margin-step or earnings-quality blocker" | **twelve** do | no peer blocker counts in any pack |
| "`cfo_pat_3y` 0.000 is 37th of 42" | **nine names tie at exactly 0.0**, spanning positions 34–42 | 0.000 is in the pack and correct; 37 was fake precision the sort merely happened to return |

Three errors per two verdicts, in prose that read as entirely plausible. Pass 2
is not optional. It is also, as currently built, ~200 lines of throwaway per
batch — and the pair for the first 76 verdicts is already gone, so those
claims are now unverifiable forever.

**The fix is to move the sort out of the checker and into the pack.** If the
pack states the rank, the prose *quotes* a number instead of deriving one, and
pass 2 collapses to a string-diff that is identical for every batch.

---

## 2. Deliverable 1 — `peer_ranks()` in `scripts/verdict-evidence.py`

### 2.1 Signature

Mirror `scorecard_coverage()` (line 385): takes already-fetched inputs,
returns `None` rather than raising, emits a flat dict keyed by metric.

```python
def peer_ranks(cluster_id: Optional[str],
               tier: Optional[str],
               symbol: str,
               peer_rows: Optional[list[dict]]) -> Optional[dict]:
    """Where `symbol` sits inside its own cluster, metric by metric.

    `peer_rows` is one row per cluster member: {symbol, cluster_metrics,
    market_cap_cr, quality_pct, valuation_pct, momentum_pct, composite_pct,
    score_status, maturity_tier}. Fetched once per cluster by the caller and
    reused across every symbol in that cluster (see 2.4) — a 43-name cluster
    batch must not issue 43 identical peer queries.

    Returns None if the cluster, the tier, or the peer rows are missing. A
    cluster of one returns a block with of == 1 for every metric, not None:
    "there is nobody to rank against" is a finding the prose must be able to
    state, and silence reads as "I forgot to check".
    """
```

### 2.2 Output schema — per metric

```json
"cfo_pat_3y": {
  "value": 0.0,
  "of": 42,
  "rank_high": 34,
  "rank_low": 1,
  "tied": 9,
  "tie_span": [34, 42],
  "ahead": ["AVONMORE", "CRISIL", "..."],
  "ahead_n": 33,
  "pctile": 19.0
}
```

Field rules, each one load-bearing:

- **`of` is the count of peers carrying a non-NULL reading for *this metric*,
  not the cluster size.** These differ constantly — `cluster_metrics` is a bag
  of whatever that (cluster, tier) needed, and coverage is per metric. This is
  the same trap `scorecard_coverage`'s docstring records from the 2026-10-08
  health_services incident: *the only honest denominator is the one you
  actually measured.* A right rank on a wrong denominator still misleads, so
  the block states both and the checker asserts both.
- **Emit `rank_high` AND `rank_low`. Never one plus a direction flag.**
  `rank_high` = position in descending order (1 = largest value). `rank_low` =
  position ascending (1 = smallest). Do not bake a per-metric
  higher-is-better table: it would have to be maintained alongside every
  scorecard, and §5 of CLAUDE.md is the story of seeded tables nobody
  maintains. Both numbers cost nothing and the prose picks the one it means.
  *This specific field pair exists because of a real error:* today's checker
  asserted `rank(..., n=16, reverse=False)` — position 16 against an
  **ascending** sort, where "lowest" is position 1 — and reported four false
  failures on prose that was correct. With both ranks present there is no
  argument to get backwards.
- **Ties are mandatory, not decorative.** `tied` is how many peers share this
  exact value; `tie_span` is `[first_position, last_position]` of the tied
  group in descending order. When `tied > 1`, `rank_high` is the **first**
  position of the tied group (competition ranking), never the sort's incidental
  index. The nine-way zero tie above is the case: any single integer in 34–42
  is fake precision, and the honest prose is "bottom nine of 42, all nine tied
  at the floor". The checker (3.4) **rejects** a bare "Nth of M" whenever
  `tied > 1`.
- **`ahead`** — symbols strictly ahead in descending order, **capped at 5**,
  with `ahead_n` carrying the true count. Uncapped, a 43-name cluster puts
  ~40 tickers per metric into the pack and the pack stops being readable,
  which is the only reason it earns its tokens. Five is enough to write
  "behind CRISIL at ₹33,243cr" — which is what the fixed CHOICEIN line needed.
- **`pctile`** — `100 * (of - rank_high) / (of - 1)` rounded to 1dp, omitted
  when `of == 1`. Convenience only; the prose should prefer "#2 of 37", which
  is falsifiable by eye. Never print a percentile when `of < 10` — it implies
  a resolution the cohort does not have.
- **Float comparison:** round to the metric's stored precision **before**
  sorting and before the tie test. Two values differing in the 15th decimal
  are a tie to any reader, and an un-rounded `==` manufactures a false
  ordering — exactly the fake precision the zero-tie case punished.

### 2.3 Non-`cluster_metrics` dimensions

Rank these too; they carry most of the prose's comparative claims:

- `market_cap_cr` (from `app.universe` / the scores join — "the second-largest
  of the 14" is a market-cap claim)
- `quality_pct`, `valuation_pct`, `momentum_pct`, `composite_pct`

Namespace them under a `scores` sub-key so a cluster metric named
`composite_pct` can never collide.

**Also emit a `cohort` header**, once per block, not per metric:

```json
"cohort": {
  "cluster_id": "bfsi_broker",
  "tier": "mature",
  "basis": "cluster_all_tiers",
  "n": 43,
  "snapshot_date": "2026-10-21",
  "status_counts": {"ok": 38, "partial-cluster-mixed-tiers": 5}
}
```

`basis` is `"cluster_tier"` when the peer set is `(cluster_id, maturity_tier)`
and `"cluster_all_tiers"` when tiers were mixed. **It must match what the
scorer actually peered against** — `MIN_PEERS = 10`, so under ten the scorer
falls back to all tiers and badges the row `partial-cluster-mixed-tiers`. A
rank computed on a different cohort than the percentile it sits next to is a
new bug, not a check. Note the badge means *"tiers were mixed to reach a
usable pool"*, **not** "too few peers" — do not surface it as a warning.

### 2.4 The peer query, and its cost

One query per cluster per run, memoised in `main()` by `cluster_id`:

```sql
SELECT s.symbol, s.quality_pct, s.valuation_pct, s.momentum_pct,
       s.composite_pct, s.score_status, s.maturity_tier,
       m.cluster_metrics, u.market_cap_cr
  FROM app.scores s
  JOIN app.metrics_snapshot m
    ON m.symbol = s.symbol AND m.snapshot_date = s.snapshot_date
  JOIN app.universe u ON u.symbol = s.symbol
 WHERE s.cluster_id = %s AND s.snapshot_date = %s
```

- **Pin `snapshot_date` to the subject symbol's own scores row.** Taking the
  max per symbol independently ranks a fresh symbol against stale peers and
  the block would be silently wrong rather than loudly empty.
- Batches are built one cluster at a time (that is the batch plan), so the
  memo makes this **one** query per batch, not one per symbol.
- Wire it in `build_symbol()` beside `pack["scorecard_coverage"]` (line 828),
  as `pack["peer_ranks"]`.

### 2.5 What keeps it current

Nothing, deliberately — it is **recomputed from `app.scores` and
`app.metrics_snapshot` on every `verdict-evidence.py` run.** There is no table
to seed and no cache to go stale. That is the whole §5 answer: a cluster
re-peering (like capital-markets out of `bfsi_nbfc` on 2026-10-22) changes
every rank in the next pack automatically, with no file to remember to edit.

### 2.6 Sanity, in the existing sanity block

The sanity block is the point of this script, so the ranks get one too. Fail
loudly, do not warn:

1. **`of <= cohort.n` for every metric.** A denominator above the cohort size
   means the peer rows were duplicated by the join.
2. **The subject symbol appears in its own peer rows.** If it does not, the
   cluster or snapshot is mismatched and every rank in the block is off by
   one. This is the check that would have caught a bad pin in 2.4.
3. **`rank_high + rank_low == of + 1`** for every untied metric. Arithmetic
   identity; cheap; catches an inverted sort instantly.
4. **A metric whose `of` is below 3 is emitted with `"rankable": false`** and
   the prose checker refuses any rank claim on it. "#2 of 2" is a sentence
   that should never ship.

Each of these can actually fail on a real defect. A check that cannot fail is
decoration (CLAUDE.md §5).

---

## 3. Deliverable 2 — `scripts/verdict-ranks-check.py`

One generic script. **Replaces `build/verdicts/check_<batch>.py` entirely.**

### 3.1 Contract

```
verdict-ranks-check.py --verdicts build/verdicts/<batch>-verdicts.json \
                       --pack /tmp/pack.json
```

For every symbol in the batch, scan `points[]`, `verdict`, and `trigger_text`
for comparative claims; resolve each against that symbol's `pack.peer_ranks`;
exit non-zero on any mismatch **or any unresolvable claim**.

### 3.2 The rule that makes it work

**An unparseable comparative claim is a failure, not a skip.** A checker that
silently ignores phrasings it does not recognise is the green-tick failure mode
— it would have passed all three of today's errors. So the prose is constrained
to a canonical grammar, and anything that smells comparative but does not parse
stops the batch and is either rewritten or whitelisted *in the batch JSON with
a reason string*.

"Smells comparative" = contains an ordinal word, a superlative, or the token
`of N` within 60 characters of a metric name. Deliberately over-broad; false
positives cost one rewrite, false negatives cost a published lie.

### 3.3 Canonical forms

| Form | Example | Resolves against |
|---|---|---|
| `#N of M` | `` `pe_ttm` 71.00 is #2 of 37 `` | `rank_high == N and of == M` |
| `Nth of M` | `34th of 42` | same |
| `the largest of the M` / `the highest of the M` | | `rank_high == 1 and of == M` |
| `the lowest of the M` / `the smallest of the M` | | `rank_low == 1 and of == M` |
| `second-largest of the M … behind SYM at V` | | `rank_high == 2 and of == M and ahead == [SYM]` and `V` matches that peer's value |
| `bottom K of M, all K tied at …` | `bottom nine of 42` | `tied == K and tie_span[1] == M and rank_low == 1` |
| `top K of M` | | `rank_high <= K and of == M` |
| `K of the M carry <predicate>` | `twelve of the fourteen` | a named predicate (3.5) |

Ordinal words spelled out (`second`, `third`, … `twentieth`) and digits are
both accepted and normalised. `M` likewise.

### 3.4 Hard rejections

- `Nth of M` where the block says `tied > 1` → **FAIL**: "N is inside a
  K-way tie spanning positions A–B; state the tie." (The zero-tie case.)
- Any rank claim on a metric with `"rankable": false` (`of < 3`).
- A claim whose `M` differs from the block's `of` by any amount — including
  ±1. The cluster size and the metric's coverage count are different numbers
  and the prose must quote the one it measured.
- A superlative with no `of M` at all ("the largest capital-markets name") →
  **FAIL**: unanchored, the reader cannot see the cohort. This generalises
  guard 6b in `mk_capmkt_14_v2.py`, which exists because a scope cut left five
  sentences referring to a 14-name group no reader could see.
- A peer ticker in `ahead`-style prose that is not in the cluster at all.

### 3.5 Predicate claims

"K of the M carry a margin-step or earnings-quality blocker" cannot be a
regex. These stay code, but **named, shared code**: a small registry of
predicates over `peer_rows`, e.g. `blocker_margin_or_quality`,
`blocker_any`, `negative_np_growth`. The prose cites the predicate name in a
trailing comment in the batch JSON; the checker runs it and asserts `K`.

Today's error here was not the count — it was that the **checker's predicate
was broader than the sentence**: the blocker list also holds thin-history and
missing-data flags, which the sentence did not claim. So each registered
predicate carries a one-line docstring stating exactly what it includes and
excludes, and that docstring is what the prose must mean.

### 3.6 Claims neither pass can trace

Some claims are about a **prior snapshot** — "composite 15, down from 61
before the re-peering". 61 is in neither the pack nor the peer file. These are
legitimate and must not be whitelisted silently: require a `prior` block in
the batch JSON carrying symbol, snapshot_date, cluster_id and the values, plus
the query that produced them, exactly as `check_capmkt_14_v2.py` recorded:

```
select snapshot_date, cluster_id, composite_pct from app.scores
 where symbol = 'PRIMESECU' order by snapshot_date desc limit 2;
→ 2026-10-21 bfsi_amc_wealth 15 | 2026-10-08 bfsi_nbfc 61
```

The checker asserts the prose's numbers against that block and prints the
query in its output, so the measurement survives the batch.

---

## 4. Acceptance — it must fail on the three real errors

Per CLAUDE.md §4: *a fix must fail on the bug it fixes.* Before this is
trusted, feed it the three original CHOICEIN sentences, pre-correction, from
git history at `1502b5d~1`:

1. "the largest of the 14" (truth: 2nd, behind CRISIL) → must FAIL on rank.
2. "nine of the fourteen rows carry a margin-step or earnings-quality
   blocker" (truth: 12) → must FAIL on predicate count.
3. "`cfo_pat_3y` 0.000 is 37th of 42" (truth: 9-way tie, 34–42) → must FAIL
   on the tie rejection, **not** merely pass because 37 is inside the span.

And one negative control: the **corrected** prose of both shipped verdicts
(CHOICEIN, PRIMESECU at `1502b5d`) must pass clean. A checker that fails
everything is as useless as one that passes everything.

Also replay one archived batch — `check_capmkt_16.py`'s 16 rows — and confirm
the generic checker reproduces its verdicts. If it cannot, the grammar is
missing a form that real prose uses.

---

## 5. What this changes about writing a verdict

Before: pull peers by hand, sort in my head, write prose, then write 200 lines
of single-use assertions to find out whether the sort was right.

After: the pack states `#2 of 37, nine tied at the floor`. The prose quotes it.
`verdict-ranks-check.py` diffs the quote against the block. **No per-batch
checker is written.** Pass 1 still runs unchanged and still catches everything
about the symbol's own figures.

The per-batch `mk_<batch>.py` generator **stays** — it is the record of how a
verdict was derived, and that record is the reason the `verdict` channel
commits at all. Only `check_<batch>.py` goes away.

---

## 6. Implementation order (a `main` session)

1. `peer_ranks()` + the memoised peer query + wire into `build_symbol()`.
2. The four sanity assertions (2.6). Prove each one fails: break the snapshot
   pin and confirm assertion 2 trips.
3. `verdict-ranks-check.py` with the §3.3 grammar and §3.4 rejections.
4. Run §4's acceptance set. Do not proceed past a green-on-everything result.
5. `docs/VERDICT_WRITING.md` — replace the "write a pass-2 file per batch"
   instruction with the canonical grammar table. The doc is wrong the moment
   step 3 lands, and fixing it is part of the change that made it wrong.
6. Then the ~12 cluster batches: chemicals_specialty 12, fmcg_food_agri 12,
   textiles 11, defense_aero 10, chemicals_agro 8, it_services_midsmall 8,
   bfsi_pvt_banks_mid_small 7, realty 7, media_entertainment 6,
   metals_nonferrous_mining 6 (= 87), then a tail sweep over the 21 small
   clusters for the remaining 63.

## 7. Known adjacent defects, not in scope here

- **SBIFUNDS sits in `bfsi_broker`** — an AMC misfiled by industry label,
  ranking 1st on eight broker metrics. Every `bfsi_broker` rank this block
  emits will carry it until it is moved. Fix before the broker batch, or the
  ranks are correct and the cohort is not.
- No DQ assertion yet that a published verdict's quoted denominator is within
  ±2 of the live cluster count. Cheap, and it is the only thing that would
  catch a rank going stale *after* publication.
