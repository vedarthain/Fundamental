#!/usr/bin/env python3
"""
audit-price-coverage.py — find stocks missing historical price data.

Different from audit-renamed-tickers.py (which is narrow — finds renamed
tickers via the "fundamentals long, prices short" signature). This script
is broader: for every active universe stock, computes the gap between
"how much history we SHOULD have" and "how much we actually have".

Expected coverage logic:
  - If listing_date is known: expect data from listing_date forward,
    capped at 10 years back from today.
  - If listing_date is unknown: assume we should have 10 years.

A gap of >1 year is flagged.  Sorted by market cap descending so the
biggest stocks (most user-visible) appear first.

USAGE:
  # Local audit (default)
  scripts/audit-price-coverage.py

  # Production audit
  APP_DB_URL="$NEON_APP_URL" GOLDEN_DB_URL="$NEON_GOLDEN_URL" \\
      scripts/audit-price-coverage.py

  # Tune the gap threshold (default 1 year)
  scripts/audit-price-coverage.py --min-gap-years 0.5

  # Limit list output
  scripts/audit-price-coverage.py --top 30

Backfill workflow:
  1. Run this audit, eyeball the top of the list.
  2. For each candidate: scripts/backfill-nse-bhavcopy.py --symbol SYM
     --start <listing or 10y ago>  (will skip already-present dates).
  3. Re-run audit to confirm gap closed.

Zero CU impact — pure reads.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent


def env_url(name: str) -> str:
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"✗ {name} not set — pass as env var or add to .env.local")


def mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find stocks with insufficient historical price coverage.")
    parser.add_argument("--target-years", type=int, default=10,
        help="Expected years of history per stock (default 10).")
    parser.add_argument("--min-gap-years", type=float, default=1.0,
        help="Only flag stocks with gap larger than this (default 1.0).")
    parser.add_argument("--top", type=int, default=50,
        help="Cap on rows printed in the flagged list (default 50).")
    args = parser.parse_args()

    today = date.today()
    target_start = today - timedelta(days=int(args.target_years * 365.25))

    app_url = env_url("APP_DB_URL")
    golden_url = env_url("GOLDEN_DB_URL")
    print(f"App DB:    {mask(app_url)}")
    print(f"Golden DB: {mask(golden_url)}")
    print(f"Target: {args.target_years} years of history (cutoff {target_start.isoformat()})")
    print(f"Gap threshold: > {args.min_gap_years} year(s)")
    print()

    # ── Universe + listing dates + market caps ────────────────────────────
    with psycopg.connect(app_url) as ac, ac.cursor() as cur:
        cur.execute("""
            SELECT u.symbol,
                   u.company_name,
                   u.listing_date,
                   u.years_of_data,
                   COALESCE(sm.market_cap_cr, 0)::float AS mcap
              FROM app.universe u
         LEFT JOIN app.screener_meta sm USING (symbol)
             WHERE u.is_active
        """)
        universe = [
            {
                "symbol": r[0],
                "name": r[1] or "",
                "listing_date": r[2],
                "years_of_data": r[3],
                "mcap": r[4] or 0,
            }
            for r in cur.fetchall()
        ]

    if not universe:
        print("No active stocks in universe.")
        return 0

    # ── Price history coverage per symbol (single grouped query) ──────────
    sym_ns_list = [f"{u['symbol']}.NS" for u in universe]
    with psycopg.connect(golden_url) as gc, gc.cursor() as cur:
        cur.execute("""
            WITH targets AS (SELECT unnest(%s::text[]) AS symbol)
            SELECT REPLACE(t.symbol, '.NS', '')        AS symbol,
                   MIN(p.date)                         AS first_date,
                   MAX(p.date)                         AS last_date,
                   COUNT(p.date)::int                  AS n_days
              FROM targets t
         LEFT JOIN golden.price_history p
                ON p.symbol = t.symbol
               AND p.interval = '1d'
               AND p.close IS NOT NULL
             GROUP BY t.symbol
        """, (sym_ns_list,))
        coverage = {
            r[0]: {"first": r[1], "last": r[2], "n_days": r[3]}
            for r in cur.fetchall()
        }

    # ── Compute gaps ──────────────────────────────────────────────────────
    flagged = []
    no_data = []
    for u in universe:
        cov = coverage.get(u["symbol"])
        if not cov or cov["n_days"] == 0:
            no_data.append(u)
            continue

        # Expected start: later of (listing_date) and (target_start).
        # If listing_date unknown, default to target_start (no penalty for
        # not knowing).
        if u["listing_date"]:
            expected_start = max(u["listing_date"], target_start)
        else:
            expected_start = target_start

        # Don't flag stocks listed AFTER our window — they legitimately
        # have less history.
        if expected_start >= today:
            continue

        gap_days = (cov["first"] - expected_start).days
        gap_years = gap_days / 365.25
        if gap_years > args.min_gap_years:
            flagged.append({
                **u,
                "first": cov["first"],
                "n_days": cov["n_days"],
                "gap_years": gap_years,
            })

    print("=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(f"  Active universe                    : {len(universe):>6,}")
    print(f"  With ANY price data                : {len(universe) - len(no_data):>6,}")
    print(f"  No price data at all (zero rows)   : {len(no_data):>6,}")
    print(f"  Coverage gap > {args.min_gap_years:.1f}y                  : {len(flagged):>6,}")
    print()

    # ── Zero-data list ────────────────────────────────────────────────────
    if no_data:
        no_data.sort(key=lambda u: u["mcap"], reverse=True)
        print("=" * 78)
        print(f"NO PRICE DATA ({len(no_data)} stocks) — backfill priority by market cap")
        print("=" * 78)
        print(f"{'SYMBOL':<14} {'Mcap (Cr)':>12}  COMPANY")
        print("-" * 78)
        for u in no_data[: args.top]:
            mcap_str = f"{u['mcap']:,.0f}" if u['mcap'] else "—"
            name = u["name"][:48]
            print(f"{u['symbol']:<14} {mcap_str:>12}  {name}")
        if len(no_data) > args.top:
            print(f"... ({len(no_data) - args.top} more)")
        print()

    # ── Gap list (sorted by mcap × gap years) ─────────────────────────────
    if flagged:
        flagged.sort(key=lambda u: (u["mcap"] or 0) * u["gap_years"], reverse=True)
        print("=" * 78)
        print(f"COVERAGE GAPS ({len(flagged)} stocks) — ranked by impact (mcap × gap years)")
        print("=" * 78)
        print(f"{'SYMBOL':<14} {'Listed':<12} {'PriceFrom':<12} {'Gap (y)':>8}  {'Mcap (Cr)':>12}  COMPANY")
        print("-" * 102)
        for u in flagged[: args.top]:
            mcap_str = f"{u['mcap']:,.0f}" if u['mcap'] else "—"
            listed = u["listing_date"].isoformat() if u["listing_date"] else "—"
            first = u["first"].isoformat() if u["first"] else "—"
            name = u["name"][:32]
            print(f"{u['symbol']:<14} {listed:<12} {first:<12} "
                  f"{u['gap_years']:>8.1f}  {mcap_str:>12}  {name}")
        if len(flagged) > args.top:
            print(f"... ({len(flagged) - args.top} more — re-run with --top {len(flagged)})")
        print()
        print("Next step: backfill the top candidates via")
        print("  scripts/backfill-nse-bhavcopy.py --symbol <SYM> --start <YYYY-MM-DD>")

    return 0


if __name__ == "__main__":
    sys.exit(main())
