#!/usr/bin/env python3
"""
recon-universe.py — reconcile app.universe against the NSE-traded set.

Two sets compared:

  A. NSE-TRADED:  symbols with valid OHLC in golden.price_history over the
                  last N trading days (sourced from bhavcopy + yfinance).
                  This is what NSE actually traded.

  B. APP.UNIVERSE: symbols we score, surface on /sectors, /discover, etc.
                  Driven by app.universe.is_active.

Differences we care about:

  - In NSE but NOT in our universe  → "potential adds". A stock we could
    be tracking but currently aren't.  Sorted by recent volume descending
    so the biggest ones lead the list.

  - In our universe but NOT in NSE  → "potential delistings". A stock we
    claim to track that hasn't traded in N days.  These are candidates
    for is_active = false.

  - In both                         → "current coverage". Good baseline.

USAGE:
  # Reconcile local DBs (default)
  scripts/recon-universe.py

  # Reconcile against Neon production
  APP_DB_URL="$NEON_APP_URL" GOLDEN_DB_URL="$NEON_GOLDEN_URL" \\
      scripts/recon-universe.py

  # Tune window (default 5 trading days)
  scripts/recon-universe.py --days 10

  # Limit list output for terminal readability
  scripts/recon-universe.py --top 20

Zero CU impact — pure read of existing tables.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
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
    parser = argparse.ArgumentParser(description="Reconcile app.universe vs NSE-traded set.")
    parser.add_argument("--days", type=int, default=5,
        help="Window of trading days to consider 'recently traded' (default 5)")
    parser.add_argument("--top", type=int, default=50,
        help="Cap on how many rows to print in each diff list (default 50)")
    args = parser.parse_args()

    app_url = env_url("APP_DB_URL")
    golden_url = env_url("GOLDEN_DB_URL")
    print(f"App DB:    {mask(app_url)}")
    print(f"Golden DB: {mask(golden_url)}")
    print(f"Window:    last {args.days} trading days")
    print()

    # ── A. NSE-TRADED set: distinct symbols with valid close in window ────
    # We require a non-NULL close so partial-broken rows (the yfinance
    # NULL-OHLC quirk) don't inflate the set.
    with psycopg.connect(golden_url) as gc, gc.cursor() as cur:
        cur.execute("""
            WITH window_dates AS (
                SELECT DISTINCT date
                  FROM golden.price_history
                 WHERE interval = '1d' AND close IS NOT NULL
                 ORDER BY date DESC
                 LIMIT %s
            )
            SELECT REPLACE(ph.symbol, '.NS', '')        AS symbol,
                   COALESCE(MAX(ph.close), 0)::float    AS last_close,
                   COALESCE(SUM(ph.volume), 0)::bigint  AS total_volume,
                   COUNT(*)::int                        AS n_days
              FROM golden.price_history ph
              JOIN window_dates wd ON wd.date = ph.date
             WHERE ph.interval = '1d' AND ph.close IS NOT NULL
             GROUP BY ph.symbol
        """, (args.days,))
        traded = {r[0]: {"close": r[1], "vol": r[2], "days": r[3]} for r in cur.fetchall()}

    # ── B. APP.UNIVERSE set + meta ────────────────────────────────────────
    with psycopg.connect(app_url) as ac, ac.cursor() as cur:
        cur.execute("""
            SELECT u.symbol,
                   u.company_name,
                   u.is_active,
                   COALESCE(sm.market_cap_cr, 0)::float AS mcap
              FROM app.universe u
         LEFT JOIN app.screener_meta sm USING (symbol)
        """)
        universe = {r[0]: {"name": r[1], "active": r[2], "mcap": r[3]} for r in cur.fetchall()}

    active_universe = {s for s, m in universe.items() if m["active"]}

    # ── Set differences ────────────────────────────────────────────────────
    traded_set = set(traded.keys())
    nse_only = traded_set - set(universe.keys())          # truly unknown to us
    universe_only_active = active_universe - traded_set   # we say active but didn't trade
    in_both_active = active_universe & traded_set
    inactive_but_traded = {
        s for s in universe.keys() - active_universe if s in traded_set
    }                                                     # we marked inactive but they're trading

    print("=" * 72)
    print("SUMMARY")
    print("=" * 72)
    print(f"  NSE recently-traded (window={args.days}d) : {len(traded_set):>6,}")
    print(f"  app.universe (total)                  : {len(universe):>6,}")
    print(f"  app.universe (active)                 : {len(active_universe):>6,}")
    print(f"  Coverage (active ∩ traded)            : {len(in_both_active):>6,}")
    print()
    print(f"  ⚠ NSE-only (unknown to us)            : {len(nse_only):>6,}")
    print(f"  ⚠ Active universe but not traded      : {len(universe_only_active):>6,}")
    print(f"  ⚠ Marked inactive but trading         : {len(inactive_but_traded):>6,}")
    print()

    # ── Detail: NSE-only (potential adds) ──────────────────────────────────
    if nse_only:
        print("=" * 72)
        print(f"NSE-only ({len(nse_only)} symbols) — potential adds, top {args.top} by recent volume")
        print("=" * 72)
        print(f"{'SYMBOL':<14} {'last close':>12} {'volume (5d)':>16}  {'days':>5}")
        print("-" * 72)
        ranked = sorted(
            nse_only,
            key=lambda s: traded[s]["vol"],
            reverse=True,
        )[: args.top]
        for s in ranked:
            t = traded[s]
            print(f"{s:<14} {t['close']:>12,.2f} {t['vol']:>16,}  {t['days']:>5}")
        if len(nse_only) > args.top:
            print(f"... ({len(nse_only) - args.top} more — re-run with --top {len(nse_only)} to see all)")
        print()

    # ── Detail: active but not trading (potential delistings) ──────────────
    if universe_only_active:
        print("=" * 72)
        print(f"Active universe but NOT trading ({len(universe_only_active)}) — review for is_active=false")
        print("=" * 72)
        print(f"{'SYMBOL':<14} {'mcap (Cr)':>14}  COMPANY")
        print("-" * 72)
        ranked = sorted(
            universe_only_active,
            key=lambda s: universe[s]["mcap"] or 0,
            reverse=True,
        )[: args.top]
        for s in ranked:
            u = universe[s]
            mcap_str = f"{u['mcap']:,.0f}" if u['mcap'] else "—"
            name = (u["name"] or "")[:40]
            print(f"{s:<14} {mcap_str:>14}  {name}")
        if len(universe_only_active) > args.top:
            print(f"... ({len(universe_only_active) - args.top} more)")
        print()

    # ── Detail: inactive but trading (we might've turned off too aggressively) ─
    if inactive_but_traded:
        print("=" * 72)
        print(f"Marked inactive BUT trading ({len(inactive_but_traded)}) — review for is_active=true")
        print("=" * 72)
        print(f"{'SYMBOL':<14} {'last close':>12} {'volume (5d)':>16}  COMPANY")
        print("-" * 72)
        ranked = sorted(
            inactive_but_traded,
            key=lambda s: traded[s]["vol"],
            reverse=True,
        )[: args.top]
        for s in ranked:
            t = traded[s]
            name = (universe[s]["name"] or "")[:35]
            print(f"{s:<14} {t['close']:>12,.2f} {t['vol']:>16,}  {name}")
        if len(inactive_but_traded) > args.top:
            print(f"... ({len(inactive_but_traded) - args.top} more)")
        print()

    print("Done.")
    # Informational audit — never exit non-zero.
    return 0


if __name__ == "__main__":
    sys.exit(main())
