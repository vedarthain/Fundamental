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

from fundamental_etl.dq import (  # noqa: E402
    run_assertions, run_golden_assertions, run_portfolio_assertions, summarize,
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
    app_url = url

    # Golden EOD price-feed checks (freshness/coverage/sentinels) — the "bhav
    # copy imported but 0 stocks updated" guard. golden is a separate DB; run
    # them when GOLDEN_DB_URL is available. If it isn't, warn loudly rather than
    # silently skipping — a missing freshness check is itself a gap worth seeing.
    golden_url = env_url("GOLDEN_DB_URL", required=False)
    if golden_url:
        try:
            with psycopg.connect(golden_url) as gconn:
                results = results + run_golden_assertions(gconn)
                # Cross-DB: the buy anchors the UI shows, checked against what
                # the stock actually traded at on the date shown beside them.
                # Needs both connections open at once, hence its home here.
                with psycopg.connect(app_url) as aconn:
                    results = results + run_portfolio_assertions(aconn, gconn)
        except psycopg.OperationalError as e:
            print(f"✗ FATAL: could not connect to golden — {e}", file=sys.stderr)
            return 2
    else:
        print("⚠ GOLDEN_DB_URL not set — SKIPPING golden price-feed freshness")
        print("  checks AND the portfolio buy-anchor check (it needs prices).")
        print()

    for r in results:
        print(r.short())

    passed, _ = summarize(results)
    print()

    # Advisory failures are printed but do not set the exit code — they mean a
    # human has something to look at, not that the data is untrustworthy. See
    # AssertionResult.advisory. They are listed SEPARATELY rather than folded
    # into the pass list, because a failure summarised as a pass is how a check
    # stops being read at all.
    advisory = [r for r in results if not r.passed and r.advisory]
    hard = [r for r in results if not r.passed and not r.advisory]

    if advisory:
        print(f"ADVISORY — {len(advisory)} check(s) need a human, not a rerun:")
        for r in advisory:
            print(f"  {r.short()}")
        print()

    if hard:
        print(f"FAIL — {len(hard)} of {len(results)} check(s) below threshold:")
        for r in hard:
            print(f"  {r.short()}")
        return 1
    print(f"OK — {passed} of {len(results)} checks passed"
          f"{f', {len(advisory)} advisory' if advisory else ''}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
