#!/usr/bin/env python3
"""
check-freshness.py — alarm if production data is stale.

Three checks run against Neon (production):

  1. app.scores           — MAX(snapshot_date) within 8 days?
                            Score ETL runs weekly; >8 days = a missed run.

  2. golden.price_history — MAX(date) within 4 days?
                            refresh-ltp.py runs weekdays after close.
                            Fri close → Mon evening = 3 days, holidays
                            can push it to 4. >4 days = the bhavcopy
                            ingest is broken.

  3. app.cluster_stocks_panel_cache — has rows for the latest snapshot?
                            Catches the case where score ran but the
                            cache refresher silently failed.

USAGE:
  # Local dev (reads URLs from .env.local)
  scripts/check-freshness.py

  # CI / explicit URLs
  APP_DB_URL=$NEON_APP_URL GOLDEN_DB_URL=$NEON_GOLDEN_URL scripts/check-freshness.py

  # Override thresholds (useful for tuning)
  scripts/check-freshness.py --snapshot-max-days 10 --price-max-days 5

Exit codes:
  0 — all checks pass
  1 — at least one check failed (GitHub Actions emails repo notification settings)
  2 — could not connect to a DB (treated separately so connection vs data
      issues are distinguishable in logs)

Every check prints a one-line PASS/FAIL summary regardless of outcome, so
the GH Actions log is a complete diagnostic without needing to dig.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
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
    raise SystemExit(
        f"✗ {name} not set — pass as env var or add to .env.local"
    )


def mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)


# Each check returns (passed: bool, summary_line: str).  The runner prints
# the line and tallies pass/fail at the end.


def check_snapshot_age(conn: psycopg.Connection, max_days: int) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(snapshot_date) FROM app.scores")
        row = cur.fetchone()
    snap = row[0] if row else None
    if snap is None:
        return False, "✗ snapshot_age: no rows in app.scores"
    age = (date.today() - snap).days
    ok = age <= max_days
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} snapshot_age: latest={snap.isoformat()} "
        f"({age}d ago, threshold={max_days}d)"
    )


def check_price_age(conn: psycopg.Connection, max_days: int) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(date) FROM golden.price_history "
            "WHERE interval = '1d' AND close IS NOT NULL"
        )
        row = cur.fetchone()
    d = row[0] if row else None
    if d is None:
        return False, "✗ price_age: no rows in golden.price_history"
    age = (date.today() - d).days
    ok = age <= max_days
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} price_age: latest={d.isoformat()} "
        f"({age}d ago, threshold={max_days}d)"
    )


def check_cookie_health(conn: psycopg.Connection) -> tuple[bool, str]:
    """Detect Screener cookie expiry.

    When fetch-many runs with dead cookies, every scrape returns 401/403 and
    we record last_status='auth_failed' in screener_meta.  If we see a burst
    of those in the last 7 days, cookies are dead and need refreshing.

    Threshold: ≥ 10 recent auth_failed rows. One or two could be transient
    (e.g. Screener temporarily rate-limiting one symbol); dozens means the
    whole session is dead.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*)::int
              FROM app.screener_meta
             WHERE last_status = 'auth_failed'
               AND last_scraped_at > NOW() - INTERVAL '7 days'
        """)
        row = cur.fetchone()
    n = (row[0] or 0) if row else 0
    ok = n < 10
    icon = "✓" if ok else "✗"
    suffix = "" if ok else " — refresh SCREENER cookies in .env.local"
    return ok, (
        f"{icon} cookie_health: {n} auth_failed scrapes in last 7d "
        f"(threshold < 10){suffix}"
    )


def check_panel_cache_populated(conn: psycopg.Connection) -> tuple[bool, str]:
    """Verify the stocks panel cache has rows for the latest snapshot.
    Detects the case where score_snapshot ran but the panel refresher
    failed — without this check, /sectors would render empty for up to
    a week before the next score run."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
            SELECT COUNT(*)::int
              FROM app.cluster_stocks_panel_cache c
              JOIN latest ON c.snapshot_date = latest.d
        """)
        row = cur.fetchone()
    n = int(row[0]) if row else 0
    # Threshold: at least 500 rows (we usually have ~2,150).  A small
    # number could indicate a partial refresh.  Zero = definitely broken.
    ok = n >= 500
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} panel_cache: {n} rows for latest snapshot "
        f"(expected ≥ 500)"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that production data on Neon is fresh.",
    )
    parser.add_argument("--snapshot-max-days", type=int, default=8,
        help="Alert if latest snapshot is older than this (default 8)")
    parser.add_argument("--price-max-days", type=int, default=4,
        help="Alert if latest price is older than this (default 4 — covers a long weekend + holiday)")
    args = parser.parse_args()

    app_url = env_url("APP_DB_URL")
    golden_url = env_url("GOLDEN_DB_URL")
    print(f"App DB:    {mask(app_url)}")
    print(f"Golden DB: {mask(golden_url)}")
    print(f"Run at:    {datetime.now(timezone.utc).isoformat()}")
    print()

    results: list[tuple[bool, str]] = []

    # App DB checks
    try:
        with psycopg.connect(app_url) as conn:
            results.append(check_snapshot_age(conn, args.snapshot_max_days))
            results.append(check_panel_cache_populated(conn))
            results.append(check_cookie_health(conn))
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: could not connect to app DB — {e}", file=sys.stderr)
        return 2

    # Golden DB checks
    try:
        with psycopg.connect(golden_url) as conn:
            results.append(check_price_age(conn, args.price_max_days))
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: could not connect to golden DB — {e}", file=sys.stderr)
        return 2

    for _, line in results:
        print(line)

    failed = [line for ok, line in results if not ok]
    print()
    if failed:
        print(f"FAIL — {len(failed)} of {len(results)} check(s) failed:")
        for line in failed:
            print(f"  {line}")
        return 1
    print(f"OK — all {len(results)} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
