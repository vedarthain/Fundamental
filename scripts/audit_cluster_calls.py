#!/usr/bin/env python3
"""audit_cluster_calls.py — Sunday Audit & Calls Generation Engine.

Scans all industry clusters, calculates target valuations, evaluates portfolio actions,
and audits the weekly high-conviction deployment plan before Monday market open.

Usage:
    python scripts/audit_cluster_calls.py
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any
import psycopg
from psycopg.rows import dict_row

def main() -> int:
    t0 = time.time()
    db_url = os.environ.get("APP_DB_URL", "dbname=fundamental_app")

    print("\n" + "=" * 80)
    print("🏛️  SUNDAY INSTITUTIONAL CALLS & PORTFOLIO AUDIT DESK")
    print("=" * 80)
    print(f"Database: {'Neon' if 'neon' in db_url else 'local'}")
    print("Scanning cluster-by-cluster to audit actionable calls & portfolio sweep...")
    print("=" * 80 + "\n")

    with psycopg.connect(db_url) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            # 1. Total clusters
            cur.execute("SELECT id, name FROM app.cluster ORDER BY name;")
            clusters = cur.fetchall()
            print(f"✓ Found {len(clusters)} active industry clusters.")

            # 2. Cluster gems & calls
            cur.execute("""
                WITH latest_verdict AS (
                    SELECT DISTINCT ON (symbol)
                        symbol, verdict, confidence, target_price, fair_value, buy_below, bear_floor, upside_pct, valuation_method, generated_at, anchor_price
                    FROM app.stock_verdict
                    ORDER BY symbol, generated_at DESC
                ),
                latest_panel AS (
                    SELECT DISTINCT ON (symbol)
                        symbol, company_name, cluster_id, market_cap_cr, current_price, composite_pct, quality_pct, valuation_pct, momentum_pct
                    FROM app.cluster_stocks_panel_cache
                    ORDER BY symbol, snapshot_date DESC
                )
                SELECT 
                    p.symbol,
                    p.company_name,
                    c.name AS cluster_name,
                    p.market_cap_cr,
                    COALESCE(sm.current_price, p.current_price) AS ltp,
                    v.anchor_price,
                    v.target_price,
                    v.buy_below,
                    v.bear_floor,
                    v.upside_pct,
                    v.valuation_method,
                    p.composite_pct,
                    p.quality_pct,
                    p.momentum_pct,
                    EXISTS(SELECT 1 FROM app.portfolio_holding ph WHERE ph.symbol = p.symbol AND ph.quantity > 0) AS is_portfolio
                FROM latest_panel p
                JOIN latest_verdict v ON v.symbol = p.symbol
                LEFT JOIN app.cluster c ON c.id = p.cluster_id
                LEFT JOIN app.screener_meta sm ON sm.symbol = p.symbol
                WHERE v.target_price IS NOT NULL AND v.buy_below IS NOT NULL
                  AND p.composite_pct >= 60
                  AND p.quality_pct >= 50
                ORDER BY p.composite_pct DESC;
            """)
            gems = cur.fetchall()
            print(f"✓ Identified {len(gems)} qualifying cluster gems (Composite >= 60, Quality >= 50).")

            # 3. Portfolio sweep
            cur.execute("""
                WITH latest_verdict AS (
                    SELECT DISTINCT ON (symbol)
                        symbol, target_price, buy_below, bear_floor, upside_pct
                    FROM app.stock_verdict
                    ORDER BY symbol, generated_at DESC
                ),
                latest_panel AS (
                    SELECT DISTINCT ON (symbol)
                        symbol, current_price, composite_pct, quality_pct, momentum_pct
                    FROM app.cluster_stocks_panel_cache
                    ORDER BY symbol, snapshot_date DESC
                )
                SELECT 
                    p.symbol,
                    SUM(p.quantity) AS total_qty,
                    SUM(p.quantity * p.avg_cost) / NULLIF(SUM(p.quantity), 0) AS avg_cost,
                    COALESCE(MAX(sm.current_price), MAX(lp.current_price), MAX(p.broker_ltp)) AS ltp,
                    CASE WHEN SUM(p.quantity * p.avg_cost) > 0 
                         THEN ((SUM(p.broker_cur_value) - SUM(p.quantity * p.avg_cost)) / SUM(p.quantity * p.avg_cost)) * 100 
                         ELSE NULL END AS pnl_pct,
                    c.name AS cluster_name,
                    lp.composite_pct,
                    lp.quality_pct,
                    lp.momentum_pct,
                    v.target_price,
                    v.buy_below,
                    v.bear_floor,
                    v.upside_pct
                FROM app.portfolio_holding p
                LEFT JOIN app.cluster_assignment ca ON ca.symbol = p.symbol
                LEFT JOIN app.cluster c ON c.id = ca.cluster_id
                LEFT JOIN app.screener_meta sm ON sm.symbol = p.symbol
                LEFT JOIN latest_panel lp ON lp.symbol = p.symbol
                LEFT JOIN latest_verdict v ON v.symbol = p.symbol
                WHERE p.quantity > 0
                GROUP BY p.symbol, c.name, lp.composite_pct, lp.quality_pct, lp.momentum_pct,
                         v.target_price, v.buy_below, v.bear_floor, v.upside_pct
                ORDER BY p.symbol;
            """)
            portfolio_rows = cur.fetchall()
            print(f"✓ Swept {len(portfolio_rows)} active portfolio holdings.\n")

            # Actions categorization
            trims, accumulates, exits, holds = [], [], [], []
            for p in portfolio_rows:
                sym = p.get("symbol")
                if not sym:
                    continue
                ltp = float(p["ltp"] or 0)
                target = float(p["target_price"] or 0)
                buy_below = float(p["buy_below"] or 0)
                bear_floor = float(p["bear_floor"] or 0)
                comp = int(p["composite_pct"] or 50)
                pnl = float(p["pnl_pct"] or 0)

                if (target > 0 and ltp >= target * 0.98) or (pnl >= 35 and comp < 70):
                    trims.append(sym)
                elif bear_floor > 0 and ltp < bear_floor:
                    exits.append(sym)
                elif buy_below > 0 and ltp <= buy_below and comp >= 60:
                    accumulates.append(sym)
                else:
                    holds.append(sym)

            print("📊 PORTFOLIO ACTION AUDIT SUMMARY:")
            print(f"  • TRIM / TAKE PROFIT  : {len(trims):>2} stocks ({', '.join(trims) if trims else 'None'})")
            print(f"  • ACCUMULATE (Dip)    : {len(accumulates):>2} stocks ({', '.join(accumulates) if accumulates else 'None'})")
            print(f"  • EXIT / CUT LOSS     : {len(exits):>2} stocks ({', '.join(exits) if exits else 'None'})")
            print(f"  • HOLD & COMPOUND     : {len(holds):>2} stocks ({', '.join(holds) if holds else 'None'})")
            print("-" * 80)

            # Cluster representation preview
            cluster_counts: dict[str, int] = {}
            for g in gems:
                cname = g["cluster_name"] or "General"
                cluster_counts[cname] = cluster_counts.get(cname, 0) + 1

            print(f"\n💎 TOP CLUSTER GEMS DISTRIBUTION ({len(cluster_counts)} clusters represented):")
            for cname, cnt in sorted(cluster_counts.items(), key=lambda x: -x[1])[:10]:
                print(f"  • {cname:<25}: {cnt} gems")

            # Curated ₹1 Lakh Deployment Candidates
            print("\n🎯 TOP 6 HIGH-CONVICTION CALLS PREVIEW FOR MONDAY:")
            sample_picks = gems[:6]
            for i, p in enumerate(sample_picks, 1):
                sym = p["symbol"]
                ltp = float(p["ltp"] or 0)
                target = float(p["target_price"] or 0)
                upside = float(p["upside_pct"] or 0)
                comp = p["composite_pct"]
                cname = p["cluster_name"]
                print(f"  {i}. {sym:<12} (₹{ltp:>7.1f} → Target ₹{target:>7.1f}, +{upside:>4.1f}%) | Comp: {comp} | Cluster: {cname}")

    print("\n" + "=" * 80)
    print(f"✓ Sunday Audit & Calls Generation completed successfully in {round(time.time() - t0, 1)}s!")
    print("=" * 80 + "\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
