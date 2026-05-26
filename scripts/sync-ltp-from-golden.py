#!/usr/bin/env python3
"""
sync-ltp-from-golden.py — push the latest close from golden.price_history
into app.screener_meta.current_price for every active universe stock.

WHY THIS EXISTS:
  refresh-ltp.yml (the GH Action) keeps NEON's screener_meta.current_price
  fresh daily by parsing the NSE bhavcopy. But LOCAL's screener_meta has
  no daily writer — fetch-many doesn't touch current_price (Screener LTP
  is no longer trusted), and your separate bhavcopy ingest only writes
  to local golden.price_history, not screener_meta. Result: local LTP
  drifts further from production every day.

  This script bridges the gap: read the latest close per active universe
  symbol from local golden.price_history, UPDATE local screener_meta.
  Run it after your daily golden-db bhavcopy update, OR before any
  sync-neon.sh so Neon stays in lockstep.

USAGE:
  scripts/sync-ltp-from-golden.py             # local app + local golden (default)
  scripts/sync-ltp-from-golden.py --dry-run   # show what would change, write nothing

  # Update Neon directly (e.g. if refresh-ltp.yml is failing):
  APP_DB_URL=$NEON_APP_URL GOLDEN_DB_URL=$NEON_GOLDEN_URL \\
      scripts/sync-ltp-from-golden.py

  Override individual URLs:
  APP_DB_WRITE_URL=postgresql:///fundamental_app \\
      scripts/sync-ltp-from-golden.py

Output: count of rows updated + first few price changes for spot-check.

Cost (Rule #1):
  - Local mode: zero Neon CU (local writes only).
  - Neon mode: one UPDATE per stale symbol, ~5ms each. < $0.01/run.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent


def env_url(name: str, fallback: str | None = None) -> str:
    """Read a Postgres URL from env, fall back to .env.local then to a
    provided default (used for local-socket connections)."""
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if fallback is not None:
        return fallback
    raise SystemExit(f"✗ {name} not set — pass as env var or add to .env.local")


def mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync screener_meta.current_price from golden.price_history.")
    parser.add_argument("--dry-run", action="store_true",
        help="Show what would change without writing.")
    parser.add_argument("--limit", type=int, default=10,
        help="Number of sample rows to print (default 10).")
    args = parser.parse_args()

    # App DB needs write access. Prefer APP_DB_WRITE_URL (e.g., local
    # superuser socket) > APP_DB_URL (.env.local). For Neon, pass NEON_APP_URL.
    app_url = (
        os.environ.get("APP_DB_WRITE_URL")
        or env_url("APP_DB_URL", fallback="postgresql:///fundamental_app")
    )
    # Golden read-only is fine. Same fallback hierarchy.
    golden_url = env_url("GOLDEN_DB_URL", fallback="postgresql:///golden_db")

    print(f"App DB:    {mask(app_url)}")
    print(f"Golden DB: {mask(golden_url)}")
    if args.dry_run:
        print("DRY RUN — no writes will be made.")
    print()

    # ── 1. Active universe symbols (with .NS suffix for golden lookup) ───
    with psycopg.connect(app_url) as ac, ac.cursor() as cur:
        cur.execute("SELECT symbol FROM app.universe WHERE is_active")
        universe = [r[0] for r in cur.fetchall()]
    if not universe:
        print("No active universe symbols.")
        return 0
    print(f"Universe: {len(universe):,} active stocks")

    sym_ns = [f"{s}.NS" for s in universe]

    # ── 2. Latest close per symbol from golden (single grouped query) ────
    # DISTINCT ON (symbol) + ORDER BY symbol, date DESC = latest non-null
    # close per symbol. Constrained to interval='1d' so we hit the right
    # partition.
    with psycopg.connect(golden_url) as gc, gc.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (symbol)
                   REPLACE(symbol, '.NS', '') AS symbol,
                   close::float                AS close,
                   date::text                  AS date
              FROM golden.price_history
             WHERE interval = '1d'
               AND close IS NOT NULL
               AND symbol = ANY(%s)
             ORDER BY symbol, date DESC
        """, (sym_ns,))
        latest = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
    print(f"Golden has latest close for: {len(latest):,} symbols")

    # ── 3. Current screener_meta prices for diff ─────────────────────────
    with psycopg.connect(app_url) as ac, ac.cursor() as cur:
        cur.execute("SELECT symbol, current_price::float FROM app.screener_meta WHERE symbol = ANY(%s)", (universe,))
        current = {r[0]: r[1] for r in cur.fetchall()}

    # ── 4. Compute changes ────────────────────────────────────────────────
    # Only update when:
    #   - We have a golden close for that symbol, AND
    #   - The stored price is null OR differs by >0.005 (penny tolerance to
    #     avoid no-op UPDATEs from float rounding)
    changes: list[tuple[str, float, float | None, str]] = []
    for sym, (new_close, date) in latest.items():
        old = current.get(sym)
        if old is None or abs((old or 0) - new_close) > 0.005:
            changes.append((sym, new_close, old, date))

    print(f"Stale or missing current_price: {len(changes):,} stocks")
    print()

    # Note: even if screener_meta is fully up-to-date (changes == 0), we
    # ALWAYS refresh cluster_stocks_panel_cache from screener_meta below.
    # The panel cache can be stale relative to screener_meta when the
    # score run hasn't happened recently — separate write paths.

    # ── 5. Print a sample so the operator can sanity-check ───────────────
    print(f"Sample changes (first {min(args.limit, len(changes))}):")
    print(f"  {'SYMBOL':<14} {'OLD':>10}  {'NEW':>10}  {'GOLDEN DATE':<12}")
    print("  " + "-" * 52)
    for sym, new_close, old, date in changes[: args.limit]:
        old_str = f"{old:.2f}" if old is not None else "NULL"
        print(f"  {sym:<14} {old_str:>10}  {new_close:>10.2f}  {date}")
    if len(changes) > args.limit:
        print(f"  ... ({len(changes) - args.limit} more)")
    print()

    if args.dry_run:
        print("Skipping writes (--dry-run).")
        return 0

    n_meta = 0
    with psycopg.connect(app_url) as ac, ac.cursor() as cur:
        # ── 6. Bulk update screener_meta (only if any rows are stale) ────
        if changes:
            rows = [(new_close, sym) for sym, new_close, _, _ in changes]
            cur.executemany(
                "UPDATE app.screener_meta SET current_price = %s WHERE symbol = %s",
                rows,
            )
            n_meta = cur.rowcount

        # ── 7. ALWAYS refresh cluster_stocks_panel_cache for the latest
        # snapshot — /sectors reads from this materialised table, not
        # screener_meta. Even when screener_meta is fully in sync, the
        # panel cache may still be stale (separate write paths — score
        # writes it weekly, refresh-ltp/this-script write screener_meta
        # daily). Older snapshot rows are intentionally left alone
        # (they're historical archives keyed to their snapshot date).
        cur.execute("""
            UPDATE app.cluster_stocks_panel_cache c
               SET current_price = sm.current_price
              FROM app.screener_meta sm
             WHERE c.symbol = sm.symbol
               AND c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
               AND sm.current_price IS NOT NULL
               AND (c.current_price IS DISTINCT FROM sm.current_price)
        """)
        n_panel = cur.rowcount
    print(f"✓ Updated current_price for {n_meta:,} screener_meta rows.")
    print(f"✓ Updated current_price for {n_panel:,} cluster_stocks_panel_cache rows (latest snapshot).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
