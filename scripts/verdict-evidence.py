#!/usr/bin/env python3
"""Build the evidence pack behind a hand-written stock verdict.

WHAT THIS IS FOR

`app.stock_verdict` (migration 0086) holds per-symbol verdicts written by hand
in a Claude Code session — the opinion, the figures it rests on, and the
condition that would reverse it. This script assembles those figures. One JSON
document per symbol, everything the Consumer Durables review was written from,
pulled in one pass instead of seven ad-hoc psql queries that lived in /tmp and
were lost the moment the session ended.

Usage:

    etl/.venv/bin/python scripts/verdict-evidence.py --symbols TITAN,HAVELLS
    etl/.venv/bin/python scripts/verdict-evidence.py --tracked --out /tmp/pack.json
    etl/.venv/bin/python scripts/verdict-evidence.py --due 45 --sanity-only

Against prod, with the usual prefix:

    set -a && . ./.env.local && set +a
    APP_DB_URL="$NEON_APP_URL" GOLDEN_DB_URL="$NEON_GOLDEN_URL" \\
      etl/.venv/bin/python scripts/verdict-evidence.py --tracked

THE SANITY BLOCK IS THE POINT, NOT A PREAMBLE

An automated LLM pass over an evidence pack was costed and rejected, and the
reason is recorded in 0086: a model handed a pack cannot interrogate it. When
the v2 report was written, `pct_above_200ema_252d` and `ema_stack_bull` were
NULL for all 3,082 symbols — the table behind them had 60 columns, zero rows
and no writer — and `golden.delivery_data` was empty for the same reason.
Nothing failed. The scorer renormalised around the NULLs and published a
momentum pillar that looked exactly like a working one. Two verdicts were
wrong as a direct result.

So every run emits a `sanity` block first, and it is built to fail:

  * Universe-wide NULL rates, not per-symbol coverage. CLAUDE.md §5's trap is
    the check that asks "of the stocks we scored, how many did we score?" — it
    reads 100% while a third of the universe is missing. The denominator here
    is every row in the latest snapshot, so a metric that is dead everywhere
    reads as dead, not as absent-for-this-one.
  * A DEAD threshold (>=95% NULL universe-wide). That is the daily_signals
    detector. Had it existed, it would have fired on the two technical metrics
    before a word of v2 was written.
  * Delivery history DEPTH, in distinct dates. Delivery capture started
    2026-10-06; at the time of writing the whole table is a single session.
    One session is not a trend, and a delivery percentage quoted as though it
    were an average is a fabrication. The count is printed so the limitation
    cannot be forgotten.
  * Per-symbol blockers: bar count under 250 (no 200-EMA is computable — that
    is three of the Consumer Durables 23), fewer than 8 quarters (no
    TTM-vs-prior-TTM), a suppressed composite, a missing company overview
    (which caps confidence at medium regardless of how clear the financials
    look), and the stub-row defect that put Shanti Gold at rank 1 — an annual
    row carrying sales with a wholly NULL balance sheet, which the scorer read
    as zero inventory and zero debt, i.e. as best-possible.

Nothing here is fatal. The block describes what the pack cannot support, and
the verdict written from it has to say so rather than quietly assume coverage.

THE TECHNICALS ARE NOT RECOMPUTED HERE

`compute_ema_metrics` and `compute_returns` are imported from the scoring
package rather than reimplemented. A second copy of the EMA seeding rule would
drift from the scorer's, and then the verdict would be arguing from numbers the
site does not show. Where this script does compute something the engine has no
metric for — the own-history PE band, TTM vs prior TTM — it is marked
`derived_here: true` in the output, because a figure with no counterpart in the
database cannot be reconciled against the site later.

AND THE ONE-TIME OTHER-INCOME STRIP IS APPLIED BEFORE ANY OF IT

The scorer removes a one-off other-income spike from the latest quarter before
it computes anything net-profit-derived (`_oi_spike_adjustment` /
`_apply_oi_adjustment` in scoring/metrics.py). This script used to read the raw
quarterlies, so every figure it derived was on a base the engine had already
rejected — and `ttm_vs_prior`/`earnings_quality` sat in the same pack as
`cluster_metrics`, contradicting it.

MINDACORP, 2026-10-08, is the case: ₹125.6cr of other income in Q1FY27 against
a ~₹5.9cr baseline. Adjusted, TTM net profit grew 54.7%; raw, 95.3%. The pack
reported 95.3% beside a stored `ttm_np_pct` of 54.7 for the same window, and a
verdict was written off the pack carrying a caveat about a "pipeline bug" that
was in fact this script disagreeing with the engine. It was the only mismatch
in 78 checks across auto_components, which is exactly why it read as a one-off
data fault rather than as a systematic second copy of the rule.

So the adjustment happens once, in build_symbol, and every derived block below
sees the adjusted lists. The strip itself is reported as
`oi_spike_adjustment` whenever it fires — silently removing a ₹120cr gain and
then flagging nothing would make the pack quieter than the raw data, which is
the opposite of the point. Note the consequence for earnings_quality: a gap
that was PURELY a one-off no longer flags, because the engine already took it
out and the `pe_ttm` in the same pack is already clean. What flags now is a gap
that survives the strip.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
# Import the scorer's own EMA/return maths rather than copying it. See the
# module docstring: one definition, so the verdict and the site cannot disagree.
sys.path.insert(0, str(ROOT / "etl" / "src"))

from fundamental_etl.scoring.metrics import (  # noqa: E402
    EMA_MIN_BARS,
    _apply_oi_adjustment,
    _oi_spike_adjustment,
    compute_ema_metrics,
    compute_returns,
    load_price_history,
)
from fundamental_etl.scoring.scorecards import (  # noqa: E402
    SCORECARDS_MATURE,
    TIERS,
    get_scorecard,
)

# Metrics the verdict prose actually leans on. The universe-wide NULL audit
# runs over exactly this list.
#
# These are keys of metrics_snapshot.cluster_metrics, NOT the flat columns on
# that table. The flat columns are a narrower legacy set (there is no roce_5y
# column, for one); cluster_metrics is what the scorer's formulas actually
# read, so auditing anything else would audit something nothing consumes.
#
# THIS LIST IS DERIVED, AND IT USED TO BE TYPED BY HAND. THAT COST A WHOLE
# HEALTHCARE REVIEW — 2026-10-08
#
# The hand-written version listed 38 names. The scorecards between them
# reference 60. The 22 it omitted were not obscure: `ebitda_margin_3y` and
# `ebitda_margin_5y` carry 18 of the 100 quality points in `health_services`,
# `np_cagr_10y` and `np_consistency_10y` are what every VETERAN actually
# scores on (make_veteran rewrites the 5y keys away), `asset_turnover`,
# `cfo_ebitda_5y`, `op_margin_trend_7y`, and the six
# roe_avg_above_threshold_* / np_growth_above_inflation_* track-record
# bonuses. Meanwhile it DID list `op_margin_3y`, `rev_cagr_3y`, `np_cagr_3y`,
# `np_consistency_3y` and `debt_equity`, which no healthcare scorecard at
# veteran tier reads at all.
#
# The failure mode is not that the audit missed something. It is that the
# per-symbol pack carried `cluster_metrics` verbatim, a reader compared those
# keys against a MID-tier symbol's key set, found the 3y names absent on the
# veterans, and concluded the quality pillar was "running on two inputs" for
# all nine hospital names. It was running on 100% of its declared weight. Two
# verdicts and an entire "what would make these better" section were written
# off that. It is CLAUDE.md §5's check-that-cannot-fail wearing the opposite
# costume: an audit scoped to the wrong key set reports absence for everything
# outside the scope, and the absence reads exactly like a data gap.
#
# So the list is now generated from the scorecards themselves, across every
# (cluster, tier) pair plus the loss-maker valuation fallbacks. A metric
# cannot be scored without being audited, and a metric cannot be audited
# unless something scores it. If you add a formula to a scorecard, this
# follows automatically — there is nothing to remember.
def _audited_metrics() -> list[str]:
    seen: set[str] = set()
    for cluster_id in SCORECARDS_MATURE:
        for tier in TIERS:
            card = get_scorecard(cluster_id, tier)
            seen |= set(card.quality) | set(card.valuation) | set(card.momentum)
            seen |= {k for k, _ in (card.loss_maker_val_fallback or [])}
    return sorted(seen)


AUDITED_METRICS = _audited_metrics()

# At or above this share of NULLs across the whole snapshot, a metric is not
# "sparse" — it is not being produced at all, and any prose leaning on it is
# leaning on nothing.
DEAD_NULL_RATE = 0.95

# A tier smaller than this cannot rescue a metric from the DEAD verdict — one
# lucky row in a two-symbol tier is not evidence that a metric is being
# produced. 25 is below the smallest real tier (new, 31) and far above noise.
MIN_TIER_N = 25

YF_SUFFIX = ".NS"


def env_url(name: str, required: bool = True) -> Optional[str]:
    """Read a Postgres URL from env, falling back to .env.local for local runs."""
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if required:
        raise SystemExit(f"{name} not set — pass as env var, or add to .env.local.")
    return None


def _f(x: Any) -> Optional[float]:
    return None if x is None else float(x)


def _floatify_rows(rows: list[dict]) -> list[dict]:
    """Decimal -> float across fundamental rows, before anything derives from them.

    psycopg hands NUMERIC back as decimal.Decimal, while the scorer's own
    load_quarterly casts to float. Mixing the two raises
    "unsupported operand type(s) for +: 'Decimal' and 'float'" the moment a
    shared function from scoring/metrics.py touches these rows — which is how
    this surfaced when the one-time other-income strip was wired in. Coercing
    at the boundary keeps every figure here computed in the same arithmetic the
    engine uses, rather than at a different precision that would show up as a
    last-decimal disagreement with cluster_metrics.
    """
    out = []
    for r in rows:
        out.append({k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()})
    return out


# ----------------------------------------------------------------- selection


def resolve_symbols(conn: psycopg.Connection, args) -> tuple[list[str], str]:
    """Return (symbols, how) — `how` is recorded in the pack for provenance."""
    if args.symbols:
        syms = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        return syms, "explicit"

    # watchlist UNION portfolio. Watchlist alone was considered and rejected:
    # 54 of 95 holdings are not on the watchlist, carrying 53% of cost basis —
    # the half with real money in it would have had no verdict.
    where = {
        "tracked": "SELECT symbol FROM app.user_watchlist UNION "
                   "SELECT symbol FROM app.portfolio_holding WHERE symbol IS NOT NULL",
        "watchlist": "SELECT symbol FROM app.user_watchlist",
        "portfolio": "SELECT symbol FROM app.portfolio_holding WHERE symbol IS NOT NULL",
    }
    base = where["tracked" if args.tracked else
                 "watchlist" if args.watchlist else "portfolio"]

    if args.missing:
        sql = (f"SELECT DISTINCT t.symbol FROM ({base}) t "
               "LEFT JOIN app.stock_verdict v ON v.symbol = t.symbol "
               "WHERE v.symbol IS NULL ORDER BY 1")
        how = "missing"
    elif args.due is not None:
        # Newest verdict older than N days. Symbols with no verdict at all are
        # NOT due — they are missing, a different bucket with different work.
        sql = ("SELECT symbol FROM (SELECT t.symbol, MAX(v.generated_at) g "
               f"FROM ({base}) t JOIN app.stock_verdict v ON v.symbol = t.symbol "
               "GROUP BY 1) x "
               f"WHERE g < now() - interval '{int(args.due)} days' ORDER BY 1")
        how = f"due>{args.due}d"
    else:
        sql = f"SELECT DISTINCT symbol FROM ({base}) t ORDER BY 1"
        how = "tracked" if args.tracked else ("watchlist" if args.watchlist else "portfolio")

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        return [r["symbol"] for r in cur.fetchall()], how


# -------------------------------------------------------------------- sanity


def universe_sanity(app: psycopg.Connection, golden: psycopg.Connection) -> dict:
    """Checks whose denominator is the whole universe, not the sample."""
    out: dict[str, Any] = {}
    with app.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT MAX(snapshot_date) d FROM app.metrics_snapshot")
        snap = cur.fetchone()["d"]
        out["snapshot_date"] = snap.isoformat() if snap else None
        out["snapshot_age_days"] = (date.today() - snap).days if snap else None

        cur.execute("SELECT COUNT(*) n FROM app.metrics_snapshot WHERE snapshot_date = %s", (snap,))
        total = cur.fetchone()["n"]
        out["universe_rows"] = total

        # NULL rate per audited metric, PER MATURITY TIER. `->>` returns NULL
        # both for an absent key and a JSON null, which is the distinction the
        # formulas also cannot make — so this measures what the scorer gets.
        #
        # Why per tier and not one universe-wide number: the first version of
        # this check used the universe and immediately flagged roce_latest,
        # op_margin_latest and cfo_pat_latest as dead at ~99% NULL. They are
        # not dead. They exist only to substitute for multi-year metrics on
        # newly listed companies (scorecards._NEW_REPLACE_LATEST), so they are
        # computed for the 31 new-tier symbols and nothing else — 87% covered
        # in the population that uses them, 1% across a universe that does not.
        #
        # A check that fires three false alarms every run gets ignored, and
        # then the true one (the technical metrics, genuinely NULL for all
        # 3,082 rows) gets ignored alongside it. So a metric is DEAD only when
        # it is absent in EVERY tier large enough to measure: nowhere it could
        # be used is it present.
        cur.execute(
            """SELECT k,
                      m.maturity_tier AS tier,
                      COUNT(*) AS n,
                      COUNT(*) FILTER (WHERE m.cluster_metrics->>k IS NULL) AS nulls
                 FROM app.metrics_snapshot m
                 CROSS JOIN unnest(%s::text[]) AS k
                WHERE m.snapshot_date = %s
                GROUP BY k, m.maturity_tier""",
            (AUDITED_METRICS, snap),
        )
        per_tier: dict[str, dict[str, tuple[int, int]]] = {}
        for r in cur.fetchall():
            per_tier.setdefault(r["k"], {})[r["tier"] or "?"] = (r["nulls"], r["n"])

    rates, best = {}, {}
    for m in AUDITED_METRICS:
        tiers = per_tier.get(m, {})
        tot_n = sum(n for _, n in tiers.values()) or total
        tot_null = sum(x for x, _ in tiers.values())
        rates[m] = tot_null / tot_n if tot_n else 1.0
        # Best coverage in any tier of at least MIN_TIER_N rows. A 1-symbol
        # tier would otherwise rescue a dead metric on a single lucky row.
        cand = [(nl / n, t) for t, (nl, n) in tiers.items() if n >= MIN_TIER_N]
        best[m] = min(cand) if cand else (1.0, None)

    out["null_rate"] = {m: round(r, 4) for m, r in sorted(rates.items(), key=lambda kv: -kv[1])}
    out["best_tier_coverage"] = {
        m: {"tier": t, "null_rate": round(r, 4)} for m, (r, t) in best.items()
    }
    # Dead = absent in every measurable tier. Tier-scoped metrics survive this.
    out["dead_metrics"] = [m for m in AUDITED_METRICS if best[m][0] >= DEAD_NULL_RATE]
    out["tier_scoped_metrics"] = [
        m for m in AUDITED_METRICS
        if rates[m] >= DEAD_NULL_RATE and best[m][0] < DEAD_NULL_RATE
    ]
    out["sparse_metrics"] = [
        m for m in AUDITED_METRICS
        if 0.25 <= rates[m] < DEAD_NULL_RATE and best[m][0] < DEAD_NULL_RATE
    ]

    with golden.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT MAX(date) d, COUNT(DISTINCT date) n FROM golden.price_history")
        r = cur.fetchone()
        out["price_max_date"] = r["d"].isoformat() if r["d"] else None
        out["price_staleness_days"] = (date.today() - r["d"]).days if r["d"] else None

        cur.execute("SELECT MAX(date) d, COUNT(DISTINCT date) n, COUNT(*) rows FROM golden.delivery_data")
        r = cur.fetchone()
        out["delivery_max_date"] = r["d"].isoformat() if r["d"] else None
        out["delivery_distinct_days"] = r["n"]
        out["delivery_rows"] = r["rows"]

    warn = []
    if out["dead_metrics"]:
        warn.append(
            f"{len(out['dead_metrics'])} metric(s) are NULL for >={DEAD_NULL_RATE:.0%} of "
            f"EVERY maturity tier and are producing nothing: "
            f"{', '.join(out['dead_metrics'])}. Do not write prose that leans on them."
        )
    if (out["snapshot_age_days"] or 0) > 40:
        warn.append(f"metrics snapshot is {out['snapshot_age_days']} days old — "
                    "fundamentals in this pack predate the current quarter.")
    if (out["price_staleness_days"] or 0) > 5:
        warn.append(f"price history is {out['price_staleness_days']} days stale.")
    if (out["delivery_distinct_days"] or 0) < 20:
        warn.append(
            f"delivery_data holds only {out['delivery_distinct_days']} distinct session(s). "
            "Any delivery percentage here is a single-day reading, not an average — "
            "say so in the verdict or leave it out."
        )
    out["warnings"] = warn
    return out


# --------------------------------------------------------------- per symbol


def scorecard_coverage(cluster_id: Optional[str], tier: Optional[str],
                       cluster_metrics: Optional[dict]) -> Optional[dict]:
    """What this symbol's own scorecard asked for, and what it actually got.

    THE ONLY HONEST DENOMINATOR IS THE SYMBOL'S OWN SCORECARD

    `cluster_metrics` is a bag of whatever (cluster, tier) happened to need.
    A VETERAN pharma name has `np_cagr_10y` and no `np_cagr_3y`; a MID one in
    the same cluster has the reverse, because make_veteran and make_mid
    rewrite the window keys. Neither is missing anything. Compare the two key
    sets and you will "discover" a dozen absent metrics per symbol that were
    never requested, and — the expensive direction — you will not notice the
    one component that WAS requested and came back NULL, because it is just
    another name in a list of names you had no expectation for.

    That is exactly what happened on 2026-10-08. Nine health_services names
    were reported as scoring quality off two inputs. Their real coverage was
    100% of declared quality weight. The four names with a genuine hole —
    AKUMS, INDSWFTLAB, LUPIN, STAR, each missing np_cagr_5y/10y because a loss
    year makes a CAGR undefined, worth 10.8-12 quality points and 22 valuation
    points via peg — went unmentioned.

    So: resolve the symbol's scorecard, walk its declared components, and
    report covered weight per pillar plus the named gaps with their weights.
    `_weighted_pillar_score` renormalises over whatever is non-null, so a
    pillar at 78% coverage is not wrong, it is a percentile computed from a
    different question than the one the scorecard poses — and the verdict has
    to know which components stopped being asked.

    Returns None when the symbol has no cluster or no metrics row; the caller
    raises that as a blocker rather than printing an empty table.
    """
    if not cluster_id or not tier or not cluster_metrics:
        return None
    try:
        card = get_scorecard(cluster_id, tier)
    except ValueError:
        return None

    out: dict[str, Any] = {"cluster_id": cluster_id, "tier": tier,
                           "pillar_weights": dict(card.pillar_weights), "pillars": {}}
    for name, weights in (("quality", card.quality),
                          ("valuation", card.valuation),
                          ("momentum", card.momentum)):
        total = sum(weights.values())
        present, missing = {}, {}
        for k, w in weights.items():
            v = cluster_metrics.get(k)
            (present if v is not None else missing)[k] = round(w, 2)
        covered = sum(present.values())
        out["pillars"][name] = {
            "declared_weight": round(total, 2),
            "covered_weight": round(covered, 2),
            "covered_pct": round(covered / total, 4) if total else None,
            # Sorted heaviest-first: the top line is the component whose
            # absence moved the percentile most.
            "missing": dict(sorted(missing.items(), key=lambda kv: -kv[1])),
            "values": {k: cluster_metrics.get(k) for k in sorted(present)},
        }
    return out


# A pillar below this share of its declared weight is not a percentile of the
# scorecard any more — it is a percentile of the subset that survived. 0.85 is
# set so the healthcare cases that motivated it FIRE: LUPIN/STAR/INDSWFTLAB
# quality at 0.89 passes (one missing CAGR is survivable and named anyway),
# while their valuation at 0.73-0.78 trips, because losing `peg` costs 22 of
# 100 valuation points and that is the pillar the verdict quotes hardest.
# Tuned against the real cases rather than by intuition — CLAUDE.md §4: a
# guard that would not have caught the bug that motivated it is decoration.
_PILLAR_COVERAGE_FLOOR = 0.85


def earnings_quality(annual: list[dict], quarterly: list[dict]) -> Optional[dict]:
    """Is the reported profit growth showing up as cash and as operating profit?

    derived_here: the engine has no exceptional-item flag. Screener's export
    folds one-off gains — a licensing upfront, an asset sale, a tax writeback —
    straight into `net_profit`, and every ratio built on it inherits them
    silently. `pe_ttm` divides by the flattered base and reads cheap; the
    momentum pillar's `np_yoy_q` reads the spike as operating strength.

    GLENMARK, 2026-10-08, is the case this exists for: TTM net profit +138.5%
    against operating profit +104.7% and operating margin stepping 17.6% ->
    27.0% in one year. The quoted PE of 41.9 sits on that base.

    AND THE 3-YEAR AVERAGE IS WHY THIS READS THE LATEST YEAR

    The first verdict written off this pack called GLENMARK a one-off "that
    never became cash", citing cfo_ebitda_3y = 0.22 — the lowest of 26 names.
    That number is a THREE-YEAR MEAN, and it was dragged there by FY2024
    (-0.22) and FY2025 (-0.35). GLENMARK's FY2026 conversion is 0.75: CFO
    3,445cr on operating profit 4,572cr. The cash did arrive. A multi-year
    average answers "has this company historically converted", which is a
    quality question; "did THIS year's reported profit convert" is an
    earnings-integrity question, and only the latest year can answer it.
    Quoting one for the other produced a REDUCE on a position. So every
    figure below is single-year, with the prior-years mean beside it as
    context rather than as the reading.

    Three tests, because each alone has honest false positives:

      1. np_over_op_gap — the RATIO of growth factors, (1+np_g)/(1+op_g)-1,
         not the difference of the two percentages. A 138% vs 105% pair
         differs by 34 percentage points but only 16% multiplicatively, and
         at those magnitudes the percentage-point gap is mostly an artifact
         of the base. A genuine operating year moves the two together; a gap
         means the increase arrived below EBIT — other income, a one-off, a
         tax credit, or an interest swing. Deleveraging produces the same
         signature, which is why tests 2 and 3 exist.
      2. opm_step — TTM operating margin minus prior-TTM operating margin.
         Margins move by a point or two a year; a step of several points is a
         mix change, an acquisition, or something that is not trading.
      3. cash conversion in the LATEST year, absolutely (<0.40) and relative
         to the prior-years mean (<0.6x). Profit that was recognised but not
         collected.

    Returns the figures and a `flags` list. Interpretation is the verdict's
    job — this only refuses to let the numbers go unmentioned.
    """
    out: dict[str, Any] = {"derived_here": True, "flags": []}

    def _sum(rows, key):
        vals = [r.get(key) for r in rows]
        return None if not rows or any(v is None for v in vals) else sum(float(v) for v in vals)

    if len(quarterly) >= 8:
        cur, prv = quarterly[-4:], quarterly[-8:-4]
        np_now, np_prev = _sum(cur, "net_profit"), _sum(prv, "net_profit")
        op_now, op_prev = _sum(cur, "operating_profit"), _sum(prv, "operating_profit")
        s_now, s_prev = _sum(cur, "sales"), _sum(prv, "sales")
        if np_prev and op_prev and np_prev > 0 and op_prev > 0 and np_now is not None and op_now is not None:
            np_f, op_f = np_now / np_prev, op_now / op_prev
            out["ttm_np_growth"] = round(np_f - 1.0, 4)
            out["ttm_op_growth"] = round(op_f - 1.0, 4)
            # Ratio of growth FACTORS. See the docstring: differencing the two
            # percentages overstates the gap at high growth rates.
            out["np_over_op_gap"] = round(np_f / op_f - 1.0, 4)
        if s_now and s_prev and s_now > 0 and s_prev > 0 and op_now is not None and op_prev is not None:
            out["opm_now"] = round(op_now / s_now, 4)
            out["opm_prev"] = round(op_prev / s_prev, 4)
            out["opm_step"] = round(out["opm_now"] - out["opm_prev"], 4)

    # Cash conversion: latest full year with both lines, vs the mean of the
    # four before it. Uses operating profit as the EBITDA proxy the rest of
    # this codebase already uses (see formulas.cfo_ebitda_3y).
    conv = [(r.get("period_end"), float(r["cash_from_operating"]) / float(r["operating_profit"]))
            for r in annual
            if r.get("cash_from_operating") is not None
            and r.get("operating_profit") not in (None, 0)
            and float(r["operating_profit"]) > 0]
    if conv:
        out["cfo_op_latest"] = round(conv[-1][1], 3)
        out["cfo_op_latest_fy"] = str(conv[-1][0])[:4]
        prior = [c for _, c in conv[:-1]][-4:]
        if prior:
            out["cfo_op_prior_mean"] = round(sum(prior) / len(prior), 3)

    gap = out.get("np_over_op_gap")
    conv_now = out.get("cfo_op_latest")
    # 0.15 and 0.05 are set so GLENMARK — the case that motivated this — trips
    # BOTH: its multiplicative gap is 0.165 and its margin step is +9.4pp.
    # CLAUDE.md §4: fed the original broken input, a guard has to reject it.
    # A threshold picked by intuition at 0.25 would have passed it, green,
    # forever, which is precisely how the buy-anchor tripwire was first set.
    if gap is not None and gap >= 0.15:
        # Both legs can be negative — NATCOPHARM's NP fell 33% while operating
        # profit fell 46%, which is the same divergence and the opposite
        # sentence. "Grew faster" there would have described a collapsing
        # business as a growing one, in the one field a reader skims.
        shape = ("outran" if (out.get("ttm_op_growth") or 0) > 0
                 else "held up better than")
        out["flags"].append(
            f"net profit {shape} operating profit by {gap:.0%} over the TTM "
            f"(NP {out['ttm_np_growth']:+.0%} vs OP {out['ttm_op_growth']:+.0%}) — the "
            "difference sits below EBIT: other income, a one-off, tax or interest, "
            "not trading. A PE quoted on this base is not a PE on operations.")
    step = out.get("opm_step")
    if step is not None and abs(step) >= 0.05:
        out["flags"].append(
            f"operating margin stepped {step:+.1%} in one year "
            f"({out['opm_prev']:.1%} -> {out['opm_now']:.1%}). A move that size is a mix "
            "change, an acquisition or a one-off — not an operating trend. Ask what "
            "the margin is without it before using the current earnings base.")
    if conv_now is not None and conv_now < 0.40:
        out["flags"].append(
            f"cash conversion {conv_now:.2f} in FY{out.get('cfo_op_latest_fy')} — under 0.40 of "
            "operating profit reached operating cash. Reported profit is not being collected.")
    prior_mean = out.get("cfo_op_prior_mean")
    if conv_now is not None and prior_mean and prior_mean > 0 and conv_now < 0.6 * prior_mean:
        out["flags"].append(
            f"cash conversion fell to {conv_now:.2f} from a prior-years mean of {prior_mean:.2f} "
            "— a deterioration, not a level. Check receivables and inventory.")
    return out or None


def pe_band(annual: list[dict]) -> Optional[dict]:
    """Own-history PE band from annual close price and reported net profit.

    derived_here: the engine stores no own-history valuation metric, only the
    cross-sectional percentile. Reading a cross-sectional percentile as though
    it meant "cheap" is the error that put Nilkamal at ACCUMULATE in v1.

    THE UNITS DO NOT MATCH AND THE DIVISION WILL NOT TELL YOU

    `net_profit` arrives from the Screener export in ₹ CRORE; the share count
    in app.fundamentals_annual is a RAW COUNT. Dividing one by the other gives
    an EPS 10,000,000× too small and therefore a PE 10,000,000× too large, and
    nothing downstream objects — SUNPHARMA's band read lo=224,515,651
    hi=670,630,227 and was emitted into the evidence pack as a valuation
    figure, next to a pe_ttm of 38.5, for every symbol with ≥4 usable years.
    22 of the 26 Healthcare packs carried one on 2026-10-08.

    The CRORE constant below is the entire fix. It is spelled out rather than
    folded into the expression because this is the second unit bug in this
    column's lineage, and a bare `* 1e7` reads like a typo to the next person.

    Worked check (SUNPHARMA FY2026): net_profit 11,479.42 cr → 114,794,200,000
    ₹; shares 2,399,334,970 → EPS ₹47.84; close ₹1,757.20 → PE 36.7, which sits
    beside the engine's independently computed pe_ttm of 38.5. Before the fix
    the same row produced 367,000,000. If you change this function, redo that
    comparison — a PE band that cannot be reconciled against pe_ttm is not
    evidence, and the whole point of this script is that a model handed a pack
    cannot interrogate it.
    """
    CRORE = 10_000_000  # ₹ crore → ₹, to meet a raw share count
    pes = []
    for a in annual:
        px, np_, sh = a.get("annual_close_price"), a.get("net_profit"), a.get("no_of_equity_shares")
        if not px or not np_ or not sh or np_ <= 0 or sh <= 0:
            continue
        eps = (float(np_) * CRORE) / float(sh)
        if eps > 0:
            pes.append(float(px) / eps)
    if len(pes) < 4:
        return None
    return {"n": len(pes), "lo": round(min(pes), 2), "hi": round(max(pes), 2),
            "avg": round(sum(pes) / len(pes), 2), "derived_here": True}


def ttm_vs_prior(quarterly: list[dict]) -> Optional[dict]:
    """Rolling 4 quarters against the prior 4.

    derived_here: the engine scores sales_yoy_q / np_yoy_q, single-quarter
    comparisons that are noisy and seasonal. The rolling comparison is what
    exposed Greenlam's recovery (net profit +172.9%) under a five-year average
    that read as decline.
    """
    rs = sorted(quarterly, key=lambda r: r["period_end"])
    if len(rs) < 8:
        return None
    cur, pri = rs[-4:], rs[-8:-4]

    def agg(rows, key):
        vals = [_f(r.get(key)) for r in rows]
        return sum(vals) if all(v is not None for v in vals) else None

    out: dict[str, Any] = {"derived_here": True,
                           "window": [rs[-4]["period_end"].isoformat(),
                                      rs[-1]["period_end"].isoformat()]}
    for key, label in (("sales", "sales"), ("operating_profit", "op"), ("net_profit", "np")):
        a, b = agg(pri, key), agg(cur, key)
        out[label + "_pct"] = round((b / a - 1) * 100, 1) if a and b and a > 0 else None
    s_now, s_pri = agg(cur, "sales"), agg(pri, "sales")
    o_now, o_pri = agg(cur, "operating_profit"), agg(pri, "operating_profit")
    out["opm_now"] = round(o_now / s_now * 100, 1) if s_now and o_now is not None and s_now > 0 else None
    out["opm_prev"] = round(o_pri / s_pri * 100, 1) if s_pri and o_pri is not None and s_pri > 0 else None
    return out


def stub_annual_rows(annual: list[dict]) -> list[str]:
    """Annual rows carrying sales with a wholly absent balance sheet.

    This is the Shanti Gold defect. Its FY2026 row had sales and nothing else;
    the scorer read missing inventory and missing borrowings as ZERO, scored
    both as best-possible, and ranked it first of 23. A row shaped like this
    means every balance-sheet figure in this pack for that year is a fiction.
    """
    bad = []
    for a in annual:
        if a.get("sales") is None:
            continue
        bs = ("total_assets", "borrowings", "inventory", "reserves", "no_of_equity_shares")
        if all(a.get(k) is None for k in bs):
            bad.append(a["period_end"].isoformat())
    return bad


def build_symbol(app: psycopg.Connection, golden: psycopg.Connection,
                 symbol: str, snapshot: Optional[str]) -> dict:
    pack: dict[str, Any] = {"symbol": symbol, "blockers": []}

    with app.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT u.symbol, u.company_name, u.sector, u.industry, u.maturity_tier,
                      u.listing_date, u.first_bar_date, u.is_active, u.is_sme,
                      u.years_of_data, u.business_summary
                 FROM app.universe u WHERE u.symbol = %s""", (symbol,))
        pack["identity"] = cur.fetchone()

        cur.execute(
            """SELECT * FROM app.metrics_snapshot
                WHERE symbol = %s ORDER BY snapshot_date DESC LIMIT 1""", (symbol,))
        pack["metrics"] = cur.fetchone()

        cur.execute(
            """SELECT quality_pct, valuation_pct, momentum_pct, composite_pct,
                      cluster_id, maturity_tier, score_status, missing_pillars,
                      snapshot_date
                 FROM app.scores WHERE symbol = %s
                ORDER BY snapshot_date DESC LIMIT 1""", (symbol,))
        pack["scores"] = cur.fetchone()

        cur.execute("SELECT rows, latest_fy, generated_at FROM app.company_overview WHERE symbol = %s",
                    (symbol,))
        ov = cur.fetchone()
        pack["overview"] = (
            {k["label"]: k["value"] for k in ov["rows"] if isinstance(k, dict)} if ov else None)

        cur.execute(
            """SELECT * FROM app.fundamentals_annual
                WHERE symbol = %s ORDER BY period_end DESC LIMIT 10""", (symbol,))
        annual = _floatify_rows(list(reversed(cur.fetchall())))
        pack["annual"] = annual

        cur.execute(
            """SELECT * FROM app.fundamentals_quarterly
                WHERE symbol = %s ORDER BY period_end DESC LIMIT 12""", (symbol,))
        quarterly = _floatify_rows(list(reversed(cur.fetchall())))
        pack["quarterly"] = quarterly

        cur.execute(
            """SELECT period_end, promoter_pct, fii_pct, dii_pct, public_pct,
                      shareholders, pledge_pct
                 FROM app.shareholding_pattern
                WHERE symbol = %s ORDER BY period_end DESC LIMIT 9""", (symbol,))
        pack["shareholding"] = cur.fetchall()

        cur.execute(
            """SELECT generated_at, verdict, confidence, points, trigger_text, evidence
                 FROM app.stock_verdict WHERE symbol = %s
                ORDER BY generated_at DESC LIMIT 3""", (symbol,))
        pack["prior_verdicts"] = cur.fetchall()

    # Strip the one-time other-income spike exactly as the scorer does, BEFORE
    # anything is derived from these rows. See the module docstring: the raw
    # lists produce figures that contradict cluster_metrics in the same pack.
    # `annual` is adjusted too, because _apply_oi_adjustment only touches the
    # annual row when the spike quarter IS the fiscal year-end — which is when
    # the cash-conversion denominator would otherwise carry the gain as well.
    pbt_excess, np_excess = _oi_spike_adjustment(quarterly)
    if pbt_excess or np_excess:
        quarterly, annual = _apply_oi_adjustment(
            quarterly, annual, pbt_excess, np_excess)
        pack["oi_spike_adjustment"] = {
            "pbt_excess_cr": round(pbt_excess, 2),
            "np_excess_cr": round(np_excess, 2),
            "quarter": str((pack["quarterly"] or [{}])[-1].get("period_end") or ""),
            "note": "one-time other income removed from the latest quarter by the "
                    "scorer; every figure below is on the adjusted base, matching "
                    "cluster_metrics. The raw reported profit is higher.",
        }
        pack["blockers"].append(
            f"a one-time other-income gain of ₹{pbt_excess:,.1f}cr pre-tax "
            f"(₹{np_excess:,.1f}cr after tax) was stripped from the latest quarter "
            "before any figure here was computed — as the scorer does. Reported "
            "profit growth is higher than anything in this pack; do not quote a "
            "number from a screener alongside these.")
        pack["annual"] = annual
        pack["quarterly"] = quarterly

    pack["pe_band"] = pe_band(annual)
    pack["ttm_vs_prior"] = ttm_vs_prior(quarterly)
    pack["earnings_quality"] = earnings_quality(annual, quarterly)
    pack["scorecard_coverage"] = scorecard_coverage(
        (pack["scores"] or {}).get("cluster_id"),
        (pack["scores"] or {}).get("maturity_tier") or (pack["metrics"] or {}).get("maturity_tier"),
        (pack["metrics"] or {}).get("cluster_metrics"),
    )

    # Technicals, via the scorer's own functions.
    prices = load_price_history(golden, symbol, limit=700)
    pack["technicals"] = {
        "bars": len(prices),
        **{k: (round(v, 4) if isinstance(v, float) else v)
           for k, v in compute_ema_metrics(prices).items()},
        **{k: (round(v, 4) if isinstance(v, float) else v)
           for k, v in compute_returns(prices).items()},
    }

    with golden.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT date, delivery_pct, delivery_volume, total_traded_volume
                 FROM golden.delivery_data WHERE symbol = %s
                ORDER BY date DESC LIMIT 30""", (symbol + YF_SUFFIX,))
        dl = cur.fetchall()
    pack["delivery"] = {"sessions": len(dl), "rows": dl}

    # ---- blockers: what this pack cannot support ----
    b = pack["blockers"]
    if pack["identity"] is None:
        b.append("not in app.universe — symbol may be delisted or renamed")
    if pack["metrics"] is None:
        b.append("no metrics_snapshot row — nothing scored for this symbol")
    # Key off the computed value, not the bar count. The first version tested
    # `bars < EMA_MIN_BARS` (250) and stayed silent for SHANTIGOLD at 304 bars
    # and LGEINDIA at 255 — both of which have no reading at all, because the
    # metric needs 252 sessions each carrying a DEFINED 200-EMA, i.e. ~451
    # bars, not 250. A missing number with no stated reason is the shape of
    # bug this whole script exists to catch; it should not be in the catcher.
    if pack["technicals"].get("pct_above_200ema_252d") is None:
        b.append(f"no 200-EMA trend reading: {pack['technicals']['bars']} price bars, and the "
                 f"metric needs ~{200 + EMA_MIN_BARS} (a {EMA_MIN_BARS}-session window in which "
                 "every session already has a 200-day EMA). Absence here means too short a "
                 "listing history, NOT a weak trend — do not read it as a low score.")
    if pack["technicals"].get("ema_stack_bull") is None:
        b.append("no 9/20/50 EMA stack — fewer than 50 bars")
    if len(quarterly) < 8:
        b.append(f"only {len(quarterly)} quarters — no TTM-vs-prior-TTM comparison")
    if pack["overview"] is None:
        b.append("no company overview — qualitative read is financials-only; "
                 "cap confidence at medium")
    if pack["scores"] and pack["scores"].get("missing_pillars"):
        b.append(f"composite suppressed: pillar(s) '{pack['scores']['missing_pillars']}' "
                 "unresolved, so there is no composite rank for this symbol")
    stubs = stub_annual_rows(annual)
    if stubs:
        b.append(f"stub annual row(s) {', '.join(stubs)} — sales present, balance sheet "
                 "wholly NULL. Every balance-sheet figure for those years is unreliable "
                 "and the scorer reads the gaps as zeros (the Shanti Gold defect).")
    if not dl:
        b.append("no delivery row — cannot distinguish accumulation from churn")
    if pack["pe_band"] is None:
        b.append("insufficient usable annual history for an own-history PE band")

    # Scorecard coverage. These read as blockers rather than as a table the
    # reader is trusted to check, because the 2026-10-08 healthcare pack DID
    # carry every number needed to see that LUPIN's valuation pillar was
    # missing `peg` — in a 32-key JSON blob with no expectation attached to
    # it. A pillar percentile quoted without its coverage is the same class of
    # claim as a delivery average computed from one session.
    cov = pack["scorecard_coverage"]
    if cov is None:
        b.append("no scorecard resolved (missing cluster, tier or metrics row) — the "
                 "Q/V/M percentiles cannot be attributed to any set of components")
    else:
        for name, p in cov["pillars"].items():
            pct = p["covered_pct"]
            if pct is not None and pct < _PILLAR_COVERAGE_FLOOR:
                gaps = ", ".join(f"{k} ({w:g}pts)" for k, w in p["missing"].items())
                b.append(
                    f"{name} pillar scored on {pct:.0%} of its declared weight "
                    f"({p['covered_weight']:g} of {p['declared_weight']:g}) — "
                    f"renormalised around: {gaps}. The percentile answers a narrower "
                    "question than the scorecard asks; say which components are absent "
                    "if the verdict leans on this pillar.")

    eq = pack["earnings_quality"] or {}
    for f in eq.get("flags", []):
        b.append(f"earnings quality — {f}")
    return pack


# ---------------------------------------------------------------------- main


def _json(o: Any) -> Any:
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    try:
        return float(o)
    except Exception:
        return str(o)


def main() -> int:
    ap = argparse.ArgumentParser(description="Evidence pack for hand-written verdicts.")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--symbols", help="Comma-separated, e.g. TITAN,HAVELLS")
    g.add_argument("--tracked", action="store_true", help="watchlist UNION portfolio (default)")
    g.add_argument("--watchlist", action="store_true")
    g.add_argument("--portfolio", action="store_true")
    ap.add_argument("--missing", action="store_true", help="only symbols with no verdict yet")
    ap.add_argument("--due", type=int, metavar="DAYS",
                    help="only symbols whose newest verdict is older than DAYS")
    ap.add_argument("--sanity-only", action="store_true",
                    help="print the universe sanity block and stop")
    ap.add_argument("--limit", type=int, help="cap the number of symbols")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()
    if not (args.symbols or args.watchlist or args.portfolio):
        args.tracked = True

    # dict_row at connection level: load_price_history/load_split_factors in
    # the scoring package index their rows by name, so a tuple factory fails
    # inside imported code rather than here. Setting it once is the only way
    # the reuse in the docstring actually holds.
    app = psycopg.connect(env_url("APP_DB_URL"), row_factory=dict_row)
    golden = psycopg.connect(env_url("GOLDEN_DB_URL"), row_factory=dict_row)

    sanity = universe_sanity(app, golden)
    for w in sanity["warnings"]:
        print(f"  !! {w}", file=sys.stderr)
    if not sanity["warnings"]:
        print("  .. sanity: no universe-level warnings", file=sys.stderr)
    if args.sanity_only:
        print(json.dumps(sanity, indent=2, default=_json))
        return 0

    symbols, how = resolve_symbols(app, args)
    if args.limit:
        symbols = symbols[: args.limit]
    print(f"  .. {len(symbols)} symbol(s) selected ({how})", file=sys.stderr)

    doc = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "selection": how,
        "sanity": sanity,
        "symbols": [build_symbol(app, golden, s, sanity["snapshot_date"]) for s in symbols],
    }
    blocked = sum(1 for s in doc["symbols"] if s["blockers"])
    print(f"  .. {blocked}/{len(symbols)} symbol(s) carry at least one blocker", file=sys.stderr)

    text = json.dumps(doc, indent=2, default=_json)
    if args.out:
        Path(args.out).write_text(text)
        print(f"  -> {args.out} ({len(text):,} bytes)", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
