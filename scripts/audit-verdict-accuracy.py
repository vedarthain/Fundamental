#!/usr/bin/env python3
"""audit-verdict-accuracy.py — Backtest historical app.stock_verdict calls against actual returns.

Measures win rate, median return, alpha vs Nifty 50, max drawdown, target hits,
and bear-floor breaches across call types, momentum buckets, sectors, and cap tiers.

Usage:
    etl/.venv/bin/python scripts/audit-verdict-accuracy.py
    etl/.venv/bin/python scripts/audit-verdict-accuracy.py --min-days 5
"""

from __future__ import annotations

import argparse
import os
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent


def env_url(name: str, default: str) -> str:
    if os.environ.get(name):
        return os.environ[name].strip().strip("\"'")
    for p in (ROOT / ".env.local", ROOT / "web" / ".env.local"):
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return default


def normalize_call(verdict: str | None) -> str:
    if not verdict:
        return "OTHER"
    first = verdict.strip().split()[0].upper().rstrip(",:—-")
    if first in ("BUY", "ACCUMULATE"):
        return "ACCUMULATE/BUY"
    if first == "WATCH":
        return "WATCH"
    if first == "HOLD":
        return "HOLD"
    if first in ("AVOID", "SELL", "REDUCE"):
        return "AVOID/SELL"
    return "OTHER"


def median_or_none(vals: list[float]) -> float | None:
    return round(statistics.median(vals), 2) if vals else None


def fmt_pct(v: float | None) -> str:
    return f"{v:+.2f}%" if v is not None else "   —  "


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--min-days", type=int, default=3, help="Minimum calendar days since verdict (default: 3)")
    args = ap.parse_args()

    app_url = env_url("APP_DB_URL", "postgresql:///fundamental_app")
    golden_url = env_url("GOLDEN_DB_URL", "postgresql:///golden_db")

    with psycopg.connect(app_url, row_factory=dict_row) as aconn, psycopg.connect(golden_url, row_factory=dict_row) as gconn:
        with aconn.cursor() as acur, gconn.cursor() as gcur:
            # 1. Load earliest verdict per (symbol, normalized bucket) that is at least min_days old
            acur.execute(
                """
                WITH latest_panel AS (
                    SELECT symbol, composite_pct, quality_pct, valuation_pct, momentum_pct,
                           market_cap_cr, current_price AS panel_ltp
                    FROM app.cluster_stocks_panel_cache
                    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
                )
                SELECT DISTINCT ON (v.symbol)
                    v.symbol,
                    v.generated_at::date::text AS call_date,
                    v.verdict,
                    v.confidence,
                    v.anchor_price::float8 AS anchor_price,
                    v.buy_below::float8 AS buy_below,
                    v.target_price::float8 AS target_price,
                    v.bear_floor::float8 AS bear_floor,
                    COALESCE(sm.current_price, lp.panel_ltp)::float8 AS live_ltp,
                    lp.composite_pct::float8 AS composite_pct,
                    lp.quality_pct::float8 AS quality_pct,
                    lp.valuation_pct::float8 AS valuation_pct,
                    lp.momentum_pct::float8 AS momentum_pct,
                    lp.market_cap_cr::float8 AS market_cap_cr,
                    COALESCE(u.sector, 'Other') AS sector,
                    COALESCE(u.market_cap_category, 'unknown') AS cap_tier
                FROM app.stock_verdict v
                LEFT JOIN latest_panel lp ON lp.symbol = v.symbol
                LEFT JOIN app.screener_meta sm ON sm.symbol = v.symbol
                LEFT JOIN app.universe u ON u.symbol = v.symbol
                WHERE v.anchor_price IS NOT NULL
                  AND v.anchor_price > 0
                  AND v.generated_at::date <= CURRENT_DATE - %s::int
                ORDER BY v.symbol, v.generated_at ASC
                """,
                (args.min_days,),
            )
            verdicts = acur.fetchall()

            # 2. Load Nifty 50 daily closes for benchmark alpha
            acur.execute(
                """
                SELECT date::text AS d, close::float8 AS close
                FROM app.market_index_history
                WHERE index_code = 'NIFTY50' AND date >= '2026-10-01'
                ORDER BY date ASC
                """
            )
            nifty_rows = acur.fetchall()
            nifty_dates = [r["d"] for r in nifty_rows]
            nifty_by_date = {r["d"]: r["close"] for r in nifty_rows}
            nifty_latest = nifty_rows[-1]["close"] if nifty_rows else None

            def nifty_on_or_before(d: str) -> float | None:
                best = None
                for nd in nifty_dates:
                    if nd <= d:
                        best = nifty_by_date[nd]
                    else:
                        break
                return best

            # 3. Load latest close + min/max since earliest call_date from golden.price_history_1d
            syms = [v["symbol"] for v in verdicts]
            ns_syms = [f"{s}.NS" for s in syms]
            min_dates = [v["call_date"] for v in verdicts]

            price_stats: dict[str, dict[str, Any]] = {}
            if ns_syms:
                gcur.execute(
                    """
                    WITH bounds AS (
                        SELECT sym, since::date AS since
                        FROM unnest(%s::text[], %s::text[]) AS b(sym, since)
                    )
                    SELECT b.sym AS symbol,
                           (array_agg(COALESCE(p.adj_close, p.close) ORDER BY p.date DESC))[1]::float8 AS last_close,
                           MAX(COALESCE(p.high, p.close))::float8 AS max_high,
                           MIN(COALESCE(p.low, p.close))::float8 AS min_low,
                           MAX(p.date)::text AS last_date
                    FROM bounds b
                    JOIN golden.price_history_1d p
                      ON p.symbol = b.sym
                     AND p.interval = '1d'
                     AND p.date >= b.since
                    WHERE COALESCE(p.adj_close, p.close) IS NOT NULL
                    GROUP BY b.sym
                    """,
                    (ns_syms, min_dates),
                )
                for r in gcur.fetchall():
                    bare = r["symbol"][:-3] if r["symbol"].endswith(".NS") else r["symbol"]
                    price_stats[bare] = r

    # 4. Compute per-verdict performance
    scored: list[dict[str, Any]] = []
    for v in verdicts:
        sym = v["symbol"]
        anchor = v["anchor_price"]
        ps = price_stats.get(sym)
        # Prefer golden last_close if present, else live_ltp
        cur_px = (ps["last_close"] if ps and ps["last_close"] else None) or v["live_ltp"]
        if not cur_px or cur_px <= 0:
            continue

        ret_pct = ((cur_px - anchor) / anchor) * 100.0
        max_hi = max(ps["max_high"], cur_px) if ps and ps["max_high"] else cur_px
        min_lo = min(ps["min_low"], cur_px) if ps and ps["min_low"] else cur_px
        max_dd = ((min_lo - anchor) / anchor) * 100.0
        max_gain = ((max_hi - anchor) / anchor) * 100.0

        n0 = nifty_on_or_before(v["call_date"])
        n_ret = ((nifty_latest - n0) / n0) * 100.0 if (n0 and nifty_latest) else None
        alpha = (ret_pct - n_ret) if n_ret is not None else None

        hit_target = bool(v["target_price"] and max_hi >= v["target_price"])
        breached_floor = bool(v["bear_floor"] and min_lo <= v["bear_floor"])

        scored.append({
            **v,
            "bucket": normalize_call(v["verdict"]),
            "cur_px": cur_px,
            "ret_pct": ret_pct,
            "alpha_pct": alpha,
            "max_dd": max_dd,
            "max_gain": max_gain,
            "hit_target": hit_target,
            "breached_floor": breached_floor,
        })

    print("=" * 96)
    print(f"VERDICT ACCURACY AUDIT  |  Evaluated: {len(scored)} stocks (min age >= {args.min_days} days)")
    print("=" * 96)

    # Table 1: By Call Type
    print("\n1. PERFORMANCE BY CALL TYPE")
    print(f"{'Call Type':<18} {'N':>5} {'Win>0%':>8} {'BeatNifty':>10} {'MedRet':>9} {'MedAlpha':>9} {'MedMaxDD':>9} {'HitTgt':>8} {'HitFloor':>9}")
    print("-" * 96)
    for bname in ("ACCUMULATE/BUY", "WATCH", "HOLD", "AVOID/SELL", "OTHER"):
        rows = [r for r in scored if r["bucket"] == bname]
        if not rows:
            continue
        n = len(rows)
        win_rate = sum(1 for r in rows if r["ret_pct"] > 0) / n * 100
        alphas = [r["alpha_pct"] for r in rows if r["alpha_pct"] is not None]
        beat = (sum(1 for a in alphas if a > 0) / len(alphas) * 100) if alphas else 0.0
        med_ret = median_or_none([r["ret_pct"] for r in rows])
        med_alpha = median_or_none(alphas)
        med_dd = median_or_none([r["max_dd"] for r in rows])
        tgt_n = sum(1 for r in rows if r["target_price"])
        tgt_hit = (sum(1 for r in rows if r["hit_target"]) / tgt_n * 100) if tgt_n else 0.0
        flr_n = sum(1 for r in rows if r["bear_floor"])
        flr_hit = (sum(1 for r in rows if r["breached_floor"]) / flr_n * 100) if flr_n else 0.0
        print(
            f"{bname:<18} {n:>5} {win_rate:>7.1f}% {beat:>9.1f}% {fmt_pct(med_ret):>9} "
            f"{fmt_pct(med_alpha):>9} {fmt_pct(med_dd):>9} {tgt_hit:>7.1f}% {flr_hit:>8.1f}%"
        )

    # Table 2: Inside ACCUMULATE/BUY — By Momentum Bucket
    buys = [r for r in scored if r["bucket"] == "ACCUMULATE/BUY"]
    print(f"\n2. ACCUMULATE/BUY BREAKDOWN BY MOMENTUM PERCENTILE (N={len(buys)})")
    print(f"{'Momentum Bucket':<18} {'N':>5} {'Win>0%':>8} {'BeatNifty':>10} {'MedRet':>9} {'MedAlpha':>9} {'MedMaxDD':>9}")
    print("-" * 76)
    mom_buckets = [
        ("< 45 (Weak)", lambda m: m is not None and m < 45),
        ("45 - 59 (Neutral)", lambda m: m is not None and 45 <= m < 60),
        ("60 - 74 (Strong)", lambda m: m is not None and 60 <= m < 75),
        (">= 75 (Leader)", lambda m: m is not None and m >= 75),
        ("Unknown", lambda m: m is None),
    ]
    for label, pred in mom_buckets:
        rows = [r for r in buys if pred(r["momentum_pct"])]
        if not rows:
            continue
        n = len(rows)
        win = sum(1 for r in rows if r["ret_pct"] > 0) / n * 100
        alphas = [r["alpha_pct"] for r in rows if r["alpha_pct"] is not None]
        beat = (sum(1 for a in alphas if a > 0) / len(alphas) * 100) if alphas else 0.0
        print(
            f"{label:<18} {n:>5} {win:>7.1f}% {beat:>9.1f}% "
            f"{fmt_pct(median_or_none([r['ret_pct'] for r in rows])):>9} "
            f"{fmt_pct(median_or_none(alphas)):>9} "
            f"{fmt_pct(median_or_none([r['max_dd'] for r in rows])):>9}"
        )

    # Table 3: Inside ACCUMULATE/BUY — By Sector
    print("\n3. ACCUMULATE/BUY BREAKDOWN BY SECTOR")
    print(f"{'Sector':<26} {'N':>4} {'Win>0%':>8} {'MedRet':>9} {'MedMaxDD':>9}")
    print("-" * 62)
    by_sec: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in buys:
        by_sec[r["sector"]].append(r)
    for sec, rows in sorted(by_sec.items(), key=lambda kv: -len(kv[1])):
        n = len(rows)
        win = sum(1 for r in rows if r["ret_pct"] > 0) / n * 100
        print(
            f"{sec[:25]:<26} {n:>4} {win:>7.1f}% "
            f"{fmt_pct(median_or_none([r['ret_pct'] for r in rows])):>9} "
            f"{fmt_pct(median_or_none([r['max_dd'] for r in rows])):>9}"
        )

    # Table 4: Worst 10 & Best 10 ACCUMULATE/BUY calls
    buys_sorted = sorted(buys, key=lambda r: r["ret_pct"])
    print("\n4. WORST 10 ACCUMULATE/BUY CALLS (FAILURE ANALYSIS)")
    print(f"{'Symbol':<13} {'Date':<11} {'Anchor':>8} {'Now':>8} {'Ret%':>8} {'MaxDD':>8} {'C/Q/V/M':<17} {'Sector':<18}")
    print("-" * 96)
    for r in buys_sorted[:10]:
        cqvm = f"{r['composite_pct'] or 0:.0f}/{r['quality_pct'] or 0:.0f}/{r['valuation_pct'] or 0:.0f}/{r['momentum_pct'] or 0:.0f}"
        print(
            f"{r['symbol']:<13} {r['call_date']:<11} {r['anchor_price']:>8.1f} {r['cur_px']:>8.1f} "
            f"{r['ret_pct']:>+7.1f}% {r['max_dd']:>+7.1f}% {cqvm:<17} {r['sector'][:18]:<18}"
        )

    print("\n5. TOP 10 ACCUMULATE/BUY CALLS (WINNER SIGNATURE)")
    print(f"{'Symbol':<13} {'Date':<11} {'Anchor':>8} {'Now':>8} {'Ret%':>8} {'MaxGn':>8} {'C/Q/V/M':<17} {'Sector':<18}")
    print("-" * 96)
    for r in reversed(buys_sorted[-10:]):
        cqvm = f"{r['composite_pct'] or 0:.0f}/{r['quality_pct'] or 0:.0f}/{r['valuation_pct'] or 0:.0f}/{r['momentum_pct'] or 0:.0f}"
        print(
            f"{r['symbol']:<13} {r['call_date']:<11} {r['anchor_price']:>8.1f} {r['cur_px']:>8.1f} "
            f"{r['ret_pct']:>+7.1f}% {r['max_gain']:>+7.1f}% {cqvm:<17} {r['sector'][:18]:<18}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
