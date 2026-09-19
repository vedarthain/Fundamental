#!/usr/bin/env python3
"""
check-coverage.py — is every active symbol accounted for?

WHY THIS EXISTS

For five months the weekly reports said coverage was 99.8% while it was 81.8%.
Nothing was lying; every check was structurally incapable of noticing. There
were three independent versions of the same mistake:

  1. dq.py asserted screener_meta completeness with
       app.screener_meta sm JOIN app.universe u USING (symbol)
     an INNER JOIN. The 472 active symbols with no screener_meta row — exactly
     the symbols the check existed to find — were dropped from the population
     BEFORE the percentage was computed. Denominator 2,150, not 2,622.

  2. check-freshness.py asserted `rows >= 2000` on the snapshot. That constant
     was written when the universe was ~2,150. The universe grew to 2,622; the
     floor did not. A check that passes more easily every month is not a check.

  3. dq.py capped the known-stale cohort at 40 with a baseline of 25. Drawing a
     tolerance band around a defect converts the alarm into a thermostat: it
     reports green for as long as the breakage stays the size it was on the day
     someone measured it.

WHAT REPLACED THEM

app.coverage_ledger (migration 0068) assigns every active symbol to exactly one
status every snapshot, via a single CASE over LEFT JOINs rooted at app.universe.
Rooted-at-universe is the load-bearing detail: a symbol missing from every other
table still gets a row, still gets counted, and lands in 'never_attempted'
instead of vanishing.

This script asserts three things, none of which contains a tunable number:

  partition    — ledger rows == active universe, and unclassified == 0.
                 This is what makes the other two trustworthy. If a symbol can
                 fall outside the buckets, bucket counts prove nothing.

  no problems  — the problem buckets are EMPTY. Not small. Zero is the only
                 threshold that cannot rot as the universe grows, and there is
                 no defensible reading of "N symbols we have never once
                 attempted to scrape is fine".

  no regression— no problem bucket grew, and 'scored' did not shrink, versus the
                 previous snapshot. This catches the movement that absolute
                 counts miss: 2,122 scored cleared the old floor of 2,000 while
                 500 symbols were missing.

The zero-assertion and the delta-assertion are both required and neither
subsumes the other. Zero alone is silent about a slow bleed that starts from a
clean baseline within one snapshot. Delta alone is blind to a pre-existing hole:
the 472 were static for months, so every week-over-week delta was +0 and a
delta-only check would have called that healthy — the ceiling-of-40 mistake
arrived at from the other direction.

USAGE
  # Local dev (reads APP_DB_URL from .env.local)
  scripts/check-coverage.py

  # Against Neon, read-only (report + assert, no ledger write)
  APP_DB_URL="$NEON_APP_URL" scripts/check-coverage.py

  # Write the ledger row for the latest snapshot, then assert on it
  scripts/check-coverage.py --write

  # Assert a specific historical snapshot
  scripts/check-coverage.py --snapshot 2026-09-12

Exit codes:
  0 — every active symbol accounted for, no problem buckets, no regression
  1 — at least one assertion failed (the failing symbols are printed)
  2 — connection error, or no snapshot / no ledger data to check
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
# Make the ETL package importable when running this script standalone, so the
# classification SQL has exactly one definition (coverage.py) shared by the
# `score` command, the `coverage` command, and this script. A second copy of
# that CASE statement would drift, and a drifted partition is a partition that
# silently stops being exhaustive.
sys.path.insert(0, str(ROOT / "etl" / "src"))

from fundamental_etl.coverage import (  # noqa: E402
    check_no_problems,
    check_no_regression,
    check_partition,
    delta_report,
    format_report,
    write_ledger,
)


def env_url(name: str, required: bool = True) -> str | None:
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if not required:
        return None
    raise SystemExit(f"✗ {name} not set — pass as env var or add to .env.local")


def latest_snapshot(conn: psycopg.Connection) -> date | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT MAX(snapshot_date) AS d FROM app.scores")
        row = cur.fetchone()
    return row["d"] if row else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--snapshot", help="YYYY-MM-DD; defaults to the latest scored snapshot")
    ap.add_argument("--write", action="store_true",
                    help="Recompute and write the ledger rows for this snapshot before asserting")
    args = ap.parse_args()

    url = env_url("APP_DB_URL")
    print(f"Target: {re.sub(r'://([^:/@]+):[^@]+@', r'://\\1:****@', url)}")
    print()

    try:
        conn = psycopg.connect(url)
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: could not connect — {e}", file=sys.stderr)
        return 2

    with conn:
        snap = date.fromisoformat(args.snapshot) if args.snapshot else latest_snapshot(conn)
        if snap is None:
            print("✗ FATAL: no snapshot in app.scores to check", file=sys.stderr)
            return 2

        if args.write:
            counts = write_ledger(conn, snap)
            conn.commit()
            print(f"Wrote ledger for {snap}: {sum(counts.values())} rows")
            print()

        rows, prev = delta_report(conn, snap)
        if not rows:
            # No ledger rows for this snapshot. Do NOT treat an empty ledger as
            # "nothing wrong" — an absent measurement is the exact failure mode
            # this whole file exists to stop reporting as green.
            print(f"✗ FATAL: no coverage_ledger rows for {snap}. "
                  f"Run with --write, or run the `score` command.", file=sys.stderr)
            return 2

        print(format_report(rows, prev, snap))
        print()

        results = (
            check_partition(conn, snap)
            + check_no_problems(conn, snap)
            + check_no_regression(conn, snap)
        )

    for r in results:
        print(f"{'✓' if r.passed else '✗'} {r.name:38s} {r.message}")

    failed = [r for r in results if not r.passed]
    print()
    if failed:
        print(f"FAIL — {len(failed)} of {len(results)} coverage assertion(s) failed:")
        for r in failed:
            print(f"  ✗ {r.name}: {r.message}")
        return 1
    print(f"OK — all {len(results)} coverage assertions passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
