#!/usr/bin/env python3
"""Backfill target prices, accumulation zones, and valuation methods for all stocks in app.stock_verdict.

Usage:
    etl/.venv/bin/python scripts/backfill_target_prices.py
    etl/.venv/bin/python scripts/backfill_target_prices.py --dry-run
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from valuation_engine import calculate_stock_valuation  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Preview calculations without writing to database")
    ap.add_argument("--limit", type=int, help="Limit number of stocks to process")
    args = ap.parse_args()

    print("\n" + "=" * 80)
    print("🏛️  BACKFILL INSTITUTIONAL TARGET PRICES & ACCUMULATION ZONES")
    print("=" * 80)
    print(f"Dry Run: {'YES' if args.dry_run else 'NO'}")
    print("=" * 80 + "\n")

    t0 = time.time()

    with psycopg.connect("dbname=fundamental_app") as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            # 1. Fetch all distinct symbols with their latest verdict
            cur.execute("""
                SELECT DISTINCT ON (symbol) 
                    symbol, generated_at, verdict, anchor_price
                FROM app.stock_verdict
                ORDER BY symbol, generated_at DESC;
            """)
            verdicts = cur.fetchall()
            print(f"✓ Found {len(verdicts)} distinct stocks in app.stock_verdict.")

            if args.limit:
                verdicts = verdicts[:args.limit]
                print(f"Limiting to first {len(verdicts)} stocks.")

            # 2. Pre-fetch screener_meta (prices & shares)
            cur.execute("SELECT symbol, current_price, market_cap_cr, no_of_shares FROM app.screener_meta;")
            meta_map = {r["symbol"]: r for r in cur.fetchall()}

            # 3. Pre-fetch cluster assignments
            cur.execute("SELECT symbol, cluster_id FROM app.cluster_assignment;")
            cluster_map = {r["symbol"]: r["cluster_id"] for r in cur.fetchall()}

            # 4. Pre-fetch metrics_snapshot
            cur.execute("""
                SELECT DISTINCT ON (symbol)
                    symbol, roe_3y, roce_3y, op_margin_3y, rev_cagr_5y, np_cagr_5y, cfo_pat_3y,
                    pe_ttm, pb, ev_ebitda_ttm, market_cap
                FROM app.metrics_snapshot
                ORDER BY symbol, snapshot_date DESC;
            """)
            snapshot_map = {r["symbol"]: r for r in cur.fetchall()}

            # 5. Pre-fetch annual financials (group by symbol)
            print("Loading longitudinal annual financials...")
            cur.execute("""
                SELECT symbol, period_end, sales, operating_profit, net_profit, cash_from_operating,
                       borrowings, cash_and_bank, equity_share_capital, reserves
                FROM app.fundamentals_annual
                ORDER BY symbol, period_end DESC;
            """)
            annual_map: dict[str, list[dict]] = {}
            for r in cur.fetchall():
                sym = r["symbol"]
                if sym not in annual_map:
                    annual_map[sym] = []
                if len(annual_map[sym]) < 10:
                    annual_map[sym].append(r)

            # 6. Pre-fetch quarterly financials (group by symbol)
            print("Loading quarterly filings...")
            cur.execute("""
                SELECT symbol, period_end, sales, operating_profit, net_profit
                FROM app.fundamentals_quarterly
                ORDER BY symbol, period_end DESC;
            """)
            quarterly_map: dict[str, list[dict]] = {}
            for r in cur.fetchall():
                sym = r["symbol"]
                if sym not in quarterly_map:
                    quarterly_map[sym] = []
                if len(quarterly_map[sym]) < 8:
                    quarterly_map[sym].append(r)

    print("Computing institutional valuation models across all stocks...")
    updates: list[dict[str, Any]] = []

    for idx, v in enumerate(verdicts, 1):
        sym = v["symbol"]
        gen_at = v["generated_at"]

        sm = meta_map.get(sym) or {}
        curr_price = float(sm.get("current_price") or 0.0)
        mcap = float(sm.get("market_cap_cr") or 0.0)
        shares = float(sm.get("no_of_shares") or 0.0)
        cid = cluster_map.get(sym)

        s_row = snapshot_map.get(sym) or {}
        m = {
            "roe_3y": float(s_row["roe_3y"]) if s_row.get("roe_3y") is not None else None,
            "roce_3y": float(s_row["roce_3y"]) if s_row.get("roce_3y") is not None else None,
            "op_margin_3y": float(s_row["op_margin_3y"]) if s_row.get("op_margin_3y") is not None else None,
            "rev_cagr_5y": float(s_row["rev_cagr_5y"]) if s_row.get("rev_cagr_5y") is not None else None,
            "np_cagr_5y": float(s_row["np_cagr_5y"]) if s_row.get("np_cagr_5y") is not None else None,
            "cfo_pat_3y": float(s_row["cfo_pat_3y"]) if s_row.get("cfo_pat_3y") is not None else None,
            "pe_ttm": float(s_row["pe_ttm"]) if s_row.get("pe_ttm") is not None else None,
            "pb": float(s_row["pb"]) if s_row.get("pb") is not None else None,
            "ev_ebitda_ttm": float(s_row["ev_ebitda_ttm"]) if s_row.get("ev_ebitda_ttm") is not None else None,
            "market_cap": float(s_row["market_cap"]) if s_row.get("market_cap") is not None else mcap,
            "current_price": curr_price,
            "shares_cr": shares if shares > 0 else (mcap / curr_price if curr_price > 0 else None),
        }

        pack = {
            "identity": {"symbol": sym, "cluster_id": cid, "current_price": curr_price},
            "metrics": m,
            "annual": annual_map.get(sym, []),
            "quarterly": quarterly_map.get(sym, []),
        }

        val = calculate_stock_valuation(pack)

        updates.append({
            "symbol": sym,
            "generated_at": gen_at,
            "target_price": val["target_price"],
            "buy_below": val["buy_below"],
            "bear_floor": val["bear_floor"],
            "upside_pct": val["upside_pct"],
            "valuation_method": val["valuation_method"],
        })

        if idx % 500 == 0 or idx == len(verdicts):
            print(f"  .. processed {idx}/{len(verdicts)} stocks ({round(idx/len(verdicts)*100, 1)}%)")

    print(f"✓ Calculated target prices for {len(updates)} stocks in {round(time.time() - t0, 1)}s.")

    if args.dry_run:
        print("\n[Dry Run] Sample preview of 5 stocks:")
        for u in updates[:5]:
            print(f"  • {u['symbol']:<10} Target: ₹{u['target_price']:>8.2f} ({u['upside_pct']:>+5.1f}%) | Buy Below: ₹{u['buy_below']:>8.2f} | Method: {u['valuation_method']}")
        return 0

    print("Updating app.stock_verdict in local PostgreSQL...")
    with psycopg.connect("dbname=fundamental_app") as conn:
        with conn.cursor() as cur:
            cur.executemany("""
                UPDATE app.stock_verdict SET
                    target_price = %(target_price)s,
                    buy_below = %(buy_below)s,
                    bear_floor = %(bear_floor)s,
                    upside_pct = %(upside_pct)s,
                    valuation_method = %(valuation_method)s
                WHERE symbol = %(symbol)s AND generated_at = %(generated_at)s;
            """, updates)
        conn.commit()

    print("✓ Successfully backfilled all target prices into app.stock_verdict!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
