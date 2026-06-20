#!/usr/bin/env python3
"""
check-freshness.py — alarm if production data is stale.

Checks run against Neon (production):

  1. app.scores           — MAX(snapshot_date) within 8 days?
                            Score ETL runs weekly; >8 days = a missed run.

  1a. app.scores cadence  — gap between the last two weekly snapshots ≤ 10 days?
                            Catches a SKIPPED WEEK even after a later run made
                            the latest date look fresh — a permanent hole in the
                            score archive (the moat). Self-clears once cadence
                            resumes, so it's loud when a hole forms, not forever.

  1b. app.scores rows     — latest snapshot has the full universe (~2,150)?
                            Catches a PARTIAL snapshot (date recent but the
                            score step was cut short, e.g. a job timeout).

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


def check_snapshot_cadence(conn: psycopg.Connection, max_gap_days: int) -> tuple[bool, str]:
    """Gap-proof the score archive (the moat): the week-over-week interval
    between the two most recent weekly snapshots must not exceed the cadence +
    slack. A larger gap means a WEEK WAS SKIPPED — a permanent hole in the
    archive that can never be backfilled (you can't recompute a past week's
    prices/fundamentals as they were).

    Why this is distinct from `check_snapshot_age`: age only looks at the NEWEST
    snapshot. If week N is skipped but week N+1 runs normally, age passes (latest
    is fresh) yet there's a permanent hole between N-1 and N+1. This check fires
    the moment that post-hole run lands, then self-clears once a normal weekly
    cadence resumes — so it's loud exactly when a hole forms, without nagging
    forever about an old, unfixable gap.

    Double-run robustness: a same-week re-run can leave two snapshots 1 day
    apart. We skip any snapshot within 3 days of the latest so we measure the
    true week-over-week gap, not the double-run sibling.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT snapshot_date
              FROM app.scores
             ORDER BY snapshot_date DESC
             LIMIT 6
        """)
        dates = [r[0] for r in cur.fetchall()]
    if len(dates) < 2:
        return True, "✓ snapshot_cadence: <2 snapshots yet — skipped (early archive)"
    latest = dates[0]
    prev = next((d for d in dates[1:] if (latest - d).days >= 3), None)
    if prev is None:
        return True, "✓ snapshot_cadence: only same-week snapshots — skipped"
    gap = (latest - prev).days
    ok = gap <= max_gap_days
    icon = "✓" if ok else "✗"
    suffix = "" if ok else (
        " — a WEEKLY SNAPSHOT WAS SKIPPED. This is a permanent hole in the score "
        "archive (the moat). Investigate the missed weekly-fetch/compute run."
    )
    return ok, (
        f"{icon} snapshot_cadence: {gap}d between last two weekly snapshots "
        f"({prev.isoformat()} → {latest.isoformat()}, max {max_gap_days}d){suffix}"
    )


def check_snapshot_completeness(conn: psycopg.Connection, min_rows: int) -> tuple[bool, str]:
    """Verify the latest snapshot isn't a partial/truncated run.

    Scoring covers the whole active universe (~2,150), so a latest snapshot
    with far fewer rows means the score step was cut short (e.g. the job timed
    out mid-run). snapshot_age alone can't catch this — the date is recent, the
    data is just incomplete."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
            SELECT COUNT(*)::int
              FROM app.scores s JOIN latest ON s.snapshot_date = latest.d
        """)
        row = cur.fetchone()
    n = int(row[0]) if row else 0
    ok = n >= min_rows
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} snapshot_rows: {n} scored in latest snapshot "
        f"(expected ≥ {min_rows})"
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
    """Detect Screener cookie expiry — alert on EVEN ONE recent auth_failed.

    fetch-many runs with stop_on_auth_fail=True (the weekly workflow's
    default), so the *first* auth failure HALTS the whole run — recording just
    ONE auth_failed row before truncating and leaving the rest of the universe
    unscraped. So a single recent auth_failed is the real signal that the
    cookie expired and the weekly run was silently cut short.

    (The old threshold of ≥10 never fired in this mode — the halt meant the
    count never got past ~1 — so an expired cookie truncated the run with no
    alert. That's the gap this closes.)

    Window: 3 days — covers the weekly Saturday run plus the 12h check cadence,
    while ageing out so a fixed-and-re-run cookie clears the alert.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*)::int
              FROM app.screener_meta
             WHERE last_status = 'auth_failed'
               AND last_scraped_at > NOW() - INTERVAL '3 days'
        """)
        row = cur.fetchone()
    n = (row[0] or 0) if row else 0
    ok = n < 1
    icon = "✓" if ok else "✗"
    suffix = (
        "" if ok else
        " — Screener cookies likely expired; the run HALTED/truncated. Rotate "
        "SCREENER_SESSIONID + SCREENER_CSRFTOKEN (GitHub secrets + .env.local), "
        "then re-run the fetch."
    )
    return ok, (
        f"{icon} cookie_health: {n} auth_failed scrape(s) in last 3d "
        f"(alert if ≥ 1){suffix}"
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
    parser.add_argument("--snapshot-min-rows", type=int, default=2000,
        help="Alert if the latest snapshot has fewer than this many scored rows (default 2000; full universe ~2,150)")
    parser.add_argument("--snapshot-max-gap-days", type=int, default=10,
        help="Alert if the gap between the two most recent weekly snapshots exceeds this (default 10 = 7d cadence + holiday slack; larger = a skipped week / archive hole)")
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
            results.append(check_snapshot_cadence(conn, args.snapshot_max_gap_days))
            results.append(check_snapshot_completeness(conn, args.snapshot_min_rows))
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
