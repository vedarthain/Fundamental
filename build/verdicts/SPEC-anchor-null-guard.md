# SPEC — make a missing `anchor_price` loud

**Status:** specced, not built. **Channel:** `main` — it changes
`scripts/verdict-load.py` and `etl/src/fundamental_etl/dq.py`, both of which
every other channel depends on. Written from the `verdict` channel because
that is where the failure was found.

**Found:** 2026-10-22. Fourteen rows in `app.stock_verdict` — the twelve
`chemicals_specialty` verdicts and the two re-published capital-markets ones —
loaded with `anchor_price` NULL because the load command omitted
`GOLDEN_DB_URL`. All fourteen were priceable: golden had a `1d` bar on or
before each row's `price_asof`, confirmed symbol by symbol after the fact.
Backfilled by hand the same session; `SELECT count(*) … WHERE anchor_price IS
NULL` is now 0.

---

## 1. The bug is not the NULL

`0087_stock_verdict_anchor_price.sql` made the column nullable on purpose, and
the reasoning there is still right: the prose is the asset, and a missing price
must never stop a verdict from being written. Two populations legitimately have
no anchor — a symbol golden has no bars for, and a row whose `price_asof` is
itself NULL.

The bug is that **operator error and legitimate absence are indistinguishable**
at the only moment anyone is watching. `anchor_prices()` has three failure
paths and they do not report differently:

| Cause | Current behaviour | What it actually means |
|---|---|---|
| `GOLDEN_DB_URL` unset | `if not url: return {}` — **silent**, no message at all | every anchor on the batch is lost |
| golden unreachable | one `~` warning line, exit 0 | every anchor on the batch is lost |
| golden has no bar for a symbol | folded into the same `no anchor price for N:` warning, exit 0 | one legitimately unpriceable row |

The first is the worst of the three and is the one that bit. It prints nothing,
and the `no anchor price for 12:` line that follows reads exactly like twelve
new listings — the legitimate case. Both end `-> 12 verdict(s) written` and
exit 0, so the load looked clean. It was not clean: drift was dead for every
row in it, which is the one thing `anchor_price` exists to make possible.

**This is CLAUDE.md §5 in both of its forms at once.** A check that cannot
fail — the loader reports success on the figures it managed to store, never on
the ones it was asked for — and a column fed by nothing, since the only thing
that ever populates `anchor_price` is the load that created the row.

## 2. Load time: separate the three causes

In `anchor_prices()`, return the cause, not just the dict. Then in `main()`:

- **`GOLDEN_DB_URL` unset, or golden unreachable** → `return 1` and write
  nothing, unless `--allow-no-anchor` is passed. This is a configuration
  failure, not a data condition, and it is uniform across the batch: nothing in
  it will have an anchor. Refusing is cheap because the fix is to re-run the
  same command with the env prefix from CLAUDE.md §2.
- **golden reachable, no bar for symbol S** → keep the current per-symbol
  warning, keep exit 0, keep writing. This is the population 0087 made the
  column nullable for, and it must stay non-fatal.

`--allow-no-anchor` exists for the same reason `--allow-no-evidence` does: to
make the omission deliberate and visible in the shell history, rather than
unavailable and therefore worked around.

The distinction has to be drawn in `anchor_prices()` because it is the only
place that knows which of the three happened. The current `except Exception`
collapses "no such host" and "no rows" into one return value, which is why the
caller cannot tell them apart.

## 3. The guard must fail on the bug it fixes

CLAUDE.md §4: feed it the original broken input and confirm it rejects it.
Concretely, before trusting this:

```bash
# 1. WITHOUT the golden URL — must refuse, write nothing, exit 1.
set -a && . ./.env.local && set +a
APP_DB_URL="$NEON_APP_URL" FUNDAMENTAL_ALLOW_REMOTE_DB=1 \
  etl/.venv/bin/python scripts/verdict-load.py <batch>.json --dry-run

# 2. WITH it — must load and anchor all rows.
APP_DB_URL="$NEON_APP_URL" GOLDEN_DB_URL="$NEON_GOLDEN_URL" \
  FUNDAMENTAL_ALLOW_REMOTE_DB=1 \
  etl/.venv/bin/python scripts/verdict-load.py <batch>.json --dry-run
```

Run 1 against a batch that is **already loaded**, so a mistake cannot write.
If run 1 exits 0, the guard is decoration.

## 4. Repair, because the guard only covers future loads

A load-time guard does nothing for rows already in the table, and the table is
append-only so they cannot be re-loaded. There must be a way to fill an anchor
that was missed:

- `scripts/verdict-load.py --repair-anchors` — for every row where
  `anchor_price IS NULL AND price_asof IS NOT NULL`, run the existing
  `anchor_prices()` query and `UPDATE … WHERE anchor_price IS NULL`.
- Idempotent, and narrow by construction: the `IS NULL` in the WHERE clause is
  what makes it unable to overwrite a stored anchor. That matters more than it
  looks — 0087's whole argument is that a stored anchor must never silently
  change, and a repair path that could rewrite one would reintroduce exactly
  the back-adjustment drift the column was created to prevent.
- Reuse `anchor_prices()` verbatim. It carries the `.NS` suffix, the
  `interval = '1d'` filter, the `close IS NOT NULL AND close > 0` guard and the
  `date <= asof` window. CLAUDE.md §4: read production through the code's own
  loader. The hand-run backfill on 2026-10-22 copied that query for this
  reason; `--repair-anchors` is that script, kept.
- Report `n rows filled, m still unpriceable` and name the m.

## 5. A standing check, or this rots again

Add to `run_assertions()` in `etl/src/fundamental_etl/dq.py`, via
`_run_max_count`:

```
name:      verdict.anchor_price_missing
sql:       SELECT COUNT(*)::int AS n FROM app.stock_verdict
            WHERE price_asof IS NOT NULL AND anchor_price IS NULL
maximum:   0
advisory:  False
```

Three deliberate choices:

- **The denominator is every verdict with a `price_asof`, not every verdict the
  loader anchored.** §5's canonical vacuous check is "of the stocks we scored,
  how many did we score?" — an assertion scoped to rows that already have an
  anchor would pass at 100% in precisely the state this is meant to catch.
- **`maximum = 0`, not a percentage threshold.** All 257 rows with a non-NULL
  `price_asof` resolved at 0087, and all 14 found on 2026-10-22 were priceable.
  There is no observed population of legitimately-unpriceable verdicts, so a
  tolerance would be a tolerance for the bug and nothing else.
- **Not advisory.** If a genuinely unpriceable verdict ever lands, this should
  go red once, be looked at, and then be recorded as a named exclusion with the
  symbol and the date — not absorbed by raising the ceiling to 1. The red is
  the mechanism; raising the threshold is how it stops being one.

**This changes the expected suite output.** CLAUDE.md §6 says the coverage
suite should read "8 passed, 0 failed, 0 skipped". Adding an assertion makes
that 9, and the §6 line must be updated **in the same commit** — a document
that disagrees with the code is how `docs/` died.

## 6. Out of scope

Nothing here detects an anchor that is *wrong* rather than missing — a verdict
whose `price_asof` predates a split, for instance, where golden's
back-adjustment means the stored anchor and a fresh lookup would disagree. That
is a real hole and it is 0087's hole, not this one's. It belongs with
`SPEC-verdict-drift-job.md`, which is already going to read both numbers.
