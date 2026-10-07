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
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
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
    compute_ema_metrics,
    compute_returns,
    load_price_history,
)

# Metrics the verdict prose actually leans on. The universe-wide NULL audit
# runs over exactly this list, so adding a metric to a verdict means adding it
# here — otherwise it can be dead everywhere and nothing will say so.
#
# These are keys of metrics_snapshot.cluster_metrics, NOT the flat columns on
# that table. The flat columns are a narrower legacy set (there is no roce_5y
# column, for one); cluster_metrics is what the scorer's formulas actually
# read, so auditing anything else would audit something nothing consumes.
AUDITED_METRICS = [
    "roce_3y", "roce_5y", "roce_latest", "roe_3y", "roe_5y",
    "op_margin_3y", "op_margin_latest", "op_margin_trend_3y", "op_margin_trend_7y",
    "rev_cagr_3y", "rev_cagr_5y", "np_cagr_3y", "np_cagr_5y",
    "np_consistency_5y", "cfo_pat_3y", "cfo_pat_latest", "cfo_ebitda_3y",
    "debt_equity", "net_debt_ebitda", "equity_to_assets",
    "pe_ttm", "pb", "ev_ebitda_ttm", "peg", "fcf_yield", "div_yield",
    "wc_days", "inv_days", "dso", "asset_turnover",
    "ret_3m_rel", "ret_6m_rel", "ret_12m_rel",
    "pct_above_200ema_252d", "ema_stack_bull", "tech_net_score_scaled",
    "sales_yoy_q", "np_yoy_q",
]

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


def pe_band(annual: list[dict]) -> Optional[dict]:
    """Own-history PE band from annual close price and reported net profit.

    derived_here: the engine stores no own-history valuation metric, only the
    cross-sectional percentile. Reading a cross-sectional percentile as though
    it meant "cheap" is the error that put Nilkamal at ACCUMULATE in v1.
    """
    pes = []
    for a in annual:
        px, np_, sh = a.get("annual_close_price"), a.get("net_profit"), a.get("no_of_equity_shares")
        if not px or not np_ or not sh or np_ <= 0 or sh <= 0:
            continue
        eps = float(np_) / float(sh)
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
        annual = list(reversed(cur.fetchall()))
        pack["annual"] = annual

        cur.execute(
            """SELECT * FROM app.fundamentals_quarterly
                WHERE symbol = %s ORDER BY period_end DESC LIMIT 12""", (symbol,))
        quarterly = list(reversed(cur.fetchall()))
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

    pack["pe_band"] = pe_band(annual)
    pack["ttm_vs_prior"] = ttm_vs_prior(quarterly)

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
