#!/usr/bin/env python3
"""Refuse to score a universe the week's fetches never finished.

WHY THIS EXISTS. weekly-compute used to run because weekly-fetch had exited 0.
That tested the wrong thing. fetch-many exits 0 on a GRACEFUL truncation — it
stops launching batches when --max-runtime-min is reached and says so in the
log — so "the fetch succeeded" was compatible with two thirds of the universe
being weeks stale. On 2026-10-21, with every fetch run of the preceding month
reported green, 1,414 of 3,179 active symbols had not been scraped in 16-24
days. Nothing was broken; nothing was measuring, either.

That staleness is not cosmetic. compute-metrics reads MARKET CAP out of the
raw Screener blobs for the valuation pillar, so a symbol whose blob is three
weeks old is valued on three-week-old prices while its peers are valued on
today's — and the composite score ranks them against each other.

WHAT MAKES THIS ABLE TO FAIL (CLAUDE.md §5). It counts the universe as the
denominator, not the scraped rows: `FROM app.universe LEFT JOIN
app.screener_meta`. A symbol that has never been scraped has a NULL
last_scraped_at and counts as stale, which is the case a `FROM screener_meta`
query would silently drop. Run it with --min-pct 100 against any real week and
it fails; that is the test, and it is in the commit message.

EXIT CODES
  0  coverage is at or above the threshold — scoring may proceed
  1  coverage is below it — the caller should NOT score
  2  the query could not run (bad DSN, missing table). NOT a coverage verdict.

The threshold is a floor on FRESH symbols, not a cap on staleness: 95% within
10 days tolerates the tail that Screener 404s or that genuinely failed, while
still catching the "half the week's runs never happened" case this was written
for.
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg


SQL = """
SELECT count(*)                                                        AS total,
       count(*) FILTER (
         WHERE m.last_scraped_at > now() - (%s || ' days')::interval
       )                                                               AS fresh
  FROM app.universe u
  LEFT JOIN app.screener_meta m ON m.symbol = u.symbol
 WHERE u.is_active
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--within-days", type=int, default=10,
                    help="A symbol counts as fresh if scraped inside this window")
    ap.add_argument("--min-pct", type=float, default=95.0,
                    help="Minimum percentage of active symbols that must be fresh")
    args = ap.parse_args()

    dsn = os.environ.get("APP_DB_URL")
    if not dsn:
        print("✗ fetch_coverage: APP_DB_URL is not set", file=sys.stderr)
        return 2

    try:
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(SQL, (str(args.within_days),))
            row = cur.fetchone()
    except Exception as exc:                       # transport / schema only
        print(f"✗ fetch_coverage: query failed ({type(exc).__name__}: {exc}) "
              f"— this is NOT a coverage verdict", file=sys.stderr)
        return 2

    total, fresh = (row[0] or 0), (row[1] or 0)
    if total == 0:
        print("✗ fetch_coverage: app.universe has no active symbols — the "
              "instrument is broken, not the data", file=sys.stderr)
        return 2

    pct = 100.0 * fresh / total
    line = (f"fetch_coverage: {fresh}/{total} active symbols scraped within "
            f"{args.within_days}d = {pct:.1f}% (floor {args.min_pct:.1f}%)")

    if pct < args.min_pct:
        print(f"✗ {line}", file=sys.stderr)
        print(f"  {total - fresh} symbols are stale. Scoring now would rank "
              f"them on stale market caps against freshly-priced peers. Run "
              f"Weekly Fetch (Screener) until coverage clears the floor, then "
              f"re-dispatch this workflow.", file=sys.stderr)
        return 1

    print(f"✓ {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
