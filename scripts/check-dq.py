#!/usr/bin/env python3
"""
check-dq.py — run data-quality assertions standalone.

Same checks the ETL `score` command runs at the end of every weekly
score, but as a separate command-line entry point.  Use this when:
  - You want to verify production data quality without waiting for the
    next score run.
  - You're investigating a suspected regression and want a snapshot of
    which columns are populated below threshold.
  - You want to wire DQ alerts into CI / a cron workflow (exit code 1
    on any failure mirrors check-freshness.py).

USAGE:
  # Local dev (reads APP_DB_URL from .env.local)
  scripts/check-dq.py

  # Explicit URL — e.g. against Neon
  APP_DB_URL="$NEON_APP_URL" scripts/check-dq.py

Exit codes:
  0 — all DQ checks pass
  1 — at least one failed (and printed in summary)
  2 — connection error

The checks themselves live in fundamental_etl.dq so cli.py and this
script share the exact same SQL + thresholds — single source of truth.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
# Make the ETL package importable when running this script standalone.
sys.path.insert(0, str(ROOT / "etl" / "src"))

from fundamental_etl.dq import run_assertions, summarize  # noqa: E402


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


def main() -> int:
    url = env_url("APP_DB_URL")
    masked = re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)
    print(f"Target: {masked}")
    print()

    try:
        with psycopg.connect(url) as conn:
            results = run_assertions(conn)
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: could not connect — {e}", file=sys.stderr)
        return 2

    for r in results:
        print(r.short())

    passed, failed = summarize(results)
    print()
    if failed:
        print(f"FAIL — {failed} of {len(results)} check(s) below threshold:")
        for r in results:
            if not r.passed:
                print(f"  {r.short()}")
        return 1
    print(f"OK — all {len(results)} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
