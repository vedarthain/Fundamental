#!/usr/bin/env python3
"""
fetch-indices.py — Daily NSE index OHLC ingest.

Pulls the NSE daily index CSV (every index NSE computes, ~100 of them)
for one or more trading days, filters to a curated whitelist, and upserts
into app.market_index_history.

Why a curated whitelist (vs ingesting everything):
  NSE ships ~100 indices including thematic / strategy variants nobody on
  /market needs to see. Storing all of them inflates the table 10× without
  any user-facing benefit. Adding a new index is a one-line edit to
  INDEX_WHITELIST below — cheaper than carrying 95 dead rows per day.

Source:
  https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv

USAGE:
  # Today's close (auto-walks back to find the latest published file):
  etl/.venv/bin/python scripts/fetch-indices.py

  # Specific date:
  etl/.venv/bin/python scripts/fetch-indices.py --date 2026-05-23

  # Backfill a range (inclusive). Skips weekends/holidays automatically.
  etl/.venv/bin/python scripts/fetch-indices.py --from 2024-01-01 --to 2026-05-26

  # Against prod Neon explicitly:
  etl/.venv/bin/python scripts/fetch-indices.py --url "$PROD_URL"

Cost (Rule #1):
  One INSERT/UPDATE per (index, date) pair. ~12 indices × 1 row =
  ~12 inserts per daily run. Negligible.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


# ----------------------- Config -------------------------------------------

# Curated set of indices we surface on /market. The KEY is our internal
# index_code (compact, no spaces); the VALUE is the EXACT "Index Name"
# string NSE uses in the CSV (case-sensitive, includes spaces).
#
# Adding an index: find the exact name in a sample CSV by running this
# script once with WHITELIST commented out — it logs every unknown name
# it sees. Then add a new (CODE → "Exact NSE Name") pair here.
INDEX_WHITELIST: dict[str, str] = {
    "NIFTY50":         "Nifty 50",
    "NIFTYBANK":       "Nifty Bank",
    # NSE inconsistently capitalises "NIFTY" — Midcap/Smallcap shipped as
    # NIFTY (uppercase) while Auto/Bank/IT use "Nifty". Names below match
    # the CSV verbatim; do not "normalise" the case.
    "NIFTYMIDCAP100":  "NIFTY Midcap 100",
    "NIFTYSMALLCAP100":"NIFTY Smallcap 100",
    "NIFTYNEXT50":     "Nifty Next 50",
    "NIFTY100":        "Nifty 100",
    "NIFTY500":        "Nifty 500",
    "NIFTYIT":         "Nifty IT",
    "NIFTYAUTO":       "Nifty Auto",
    "NIFTYFMCG":       "Nifty FMCG",
    "NIFTYPHARMA":     "Nifty Pharma",
    "NIFTYENERGY":     "Nifty Energy",
    "NIFTYMETAL":      "Nifty Metal",
    "NIFTYREALTY":     "Nifty Realty",
    # SENSEX is a BSE index — not present in NSE's ind_close_all CSV. If
    # we want it later we'll add a separate BSE source (or YF "^BSESN")
    # and write into the same table with code="SENSEX".
}

# CSV URL templates — try archive paths in order. NSE has moved them
# around historically.
CSV_URL_TEMPLATES = [
    "https://nsearchives.nseindia.com/content/indices/ind_close_all_{ddmmyyyy}.csv",
    "https://archives.nseindia.com/content/indices/ind_close_all_{ddmmyyyy}.csv",
]

# Mimic a real browser; NSE blocks default User-Agents.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

MAX_DAYS_BACK = 5   # walk-back limit for "find latest published"
DEFAULT_CONCURRENCY = 4  # parallel HTTP fetches during backfill; NSE handles this fine


# ----------------------- Helpers ------------------------------------------

def env_url(name: str, required: bool = True) -> str | None:
    """Read a Postgres URL from env, fall back to .env.local for local runs."""
    v = os.environ.get(name)
    if v:
        return v
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if required:
        raise SystemExit(
            f"{name} not set — pass as env var, or add to .env.local."
        )
    return None


def fetch_csv(d: date) -> str | None:
    """Fetch the daily ind_close_all CSV for date `d`. Returns text or None."""
    ddmmyyyy = d.strftime("%d%m%Y")
    for url_tmpl in CSV_URL_TEMPLATES:
        url = url_tmpl.format(ddmmyyyy=ddmmyyyy)
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", errors="replace")
                # NSE sometimes returns an HTML 200 error page; real CSV has
                # "Index Name" in the header.
                if "Index Name" in body[:500]:
                    return body
        except HTTPError as e:
            if e.code == 404:
                continue
            print(f"  http {e.code} for {url}: {e.reason}", file=sys.stderr)
        except (URLError, TimeoutError, OSError) as e:
            print(f"  url err for {url}: {e}", file=sys.stderr)
    return None


def _f(v: str | None) -> float | None:
    if not v:
        return None
    # NSE uses commas as thousand separators in some fields.
    try:
        return float(v.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def parse_rows(csv_text: str) -> list[dict]:
    """Parse the index CSV into a list of dicts, one per whitelisted index.

    NSE CSV columns (as of 2024-2026):
      Index Name, Index Date, Open Index Value, High Index Value,
      Low Index Value, Closing Index Value, Points Change, Change(%),
      Volume, Turnover (Rs. Cr.), P/E, P/B, Div Yield

    "Index Date" is dd-mm-YYYY in the CSV; we re-parse to ISO.
    """
    out: list[dict] = []
    reader = csv.DictReader(io.StringIO(csv_text), skipinitialspace=True)
    fieldnames = [(f or "").strip() for f in (reader.fieldnames or [])]
    required = {"Index Name", "Index Date", "Closing Index Value"}
    if not required.issubset(set(fieldnames)):
        print(f"  warning: missing required cols, got {fieldnames}", file=sys.stderr)
        return out

    # Build reverse lookup: NSE name → our code, so we only emit whitelisted ones.
    name_to_code = {v: k for k, v in INDEX_WHITELIST.items()}

    for raw in reader:
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k is not None}
        name = row.get("Index Name", "")
        code = name_to_code.get(name)
        if not code:
            continue   # not in whitelist — skip
        date_str = row.get("Index Date", "")
        try:
            dt = datetime.strptime(date_str, "%d-%m-%Y").date()
        except ValueError:
            print(f"  bad date '{date_str}' for {name}", file=sys.stderr)
            continue
        close = _f(row.get("Closing Index Value"))
        if close is None:
            continue
        # NSE doesn't always include prev close — derive after insert.
        out.append({
            "code": code,
            "date": dt,
            "name": name,
            "open":  _f(row.get("Open Index Value")),
            "high":  _f(row.get("High Index Value")),
            "low":   _f(row.get("Low Index Value")),
            "close": close,
            "pct_change": _f(row.get("Change(%)")),
        })
    return out


def upsert(conn: psycopg.Connection, rows: list[dict]) -> int:
    """Upsert a list of index rows. Returns count written."""
    if not rows:
        return 0
    written = 0
    with conn.cursor() as cur:
        for r in rows:
            # prev_close is left NULL on insert; we compute it after the
            # batch via a window query so a single-day fetch still gets
            # accurate prev_close + pct_change once history is in place.
            cur.execute("""
                INSERT INTO app.market_index_history
                  (index_code, date, open, high, low, close, pct_change, display_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (index_code, date) DO UPDATE SET
                  open         = EXCLUDED.open,
                  high         = EXCLUDED.high,
                  low          = EXCLUDED.low,
                  close        = EXCLUDED.close,
                  pct_change   = COALESCE(EXCLUDED.pct_change, app.market_index_history.pct_change),
                  display_name = EXCLUDED.display_name
            """, (
                r["code"], r["date"],
                r["open"], r["high"], r["low"], r["close"],
                r["pct_change"], r["name"],
            ))
            written += 1
    return written


def recompute_prev_close(conn: psycopg.Connection) -> int:
    """Backfill prev_close (and pct_change where missing) using a single
    window query over the whole table. Cheap — small table — and idempotent.

    Run after each batch insert so the latest day always has prev_close
    populated from the day before, even when NSE's CSV didn't ship it.
    """
    with conn.cursor() as cur:
        cur.execute("""
            WITH ranked AS (
                SELECT index_code, date, close,
                       LAG(close) OVER (PARTITION BY index_code ORDER BY date) AS lag_close
                  FROM app.market_index_history
            )
            UPDATE app.market_index_history h
               SET prev_close = r.lag_close,
                   pct_change = CASE
                       WHEN r.lag_close IS NOT NULL AND r.lag_close <> 0
                         THEN ((r.close - r.lag_close) / r.lag_close * 100)::numeric(8,4)
                       ELSE h.pct_change
                   END
              FROM ranked r
             WHERE h.index_code = r.index_code
               AND h.date       = r.date
               AND (h.prev_close IS DISTINCT FROM r.lag_close
                    OR h.pct_change IS NULL)
        """)
        return cur.rowcount or 0


# ----------------------- Modes --------------------------------------------

def run_single(conn: psycopg.Connection, d: date) -> int:
    """Fetch one specific date and upsert. Returns row count written."""
    print(f"fetching {d.isoformat()}…")
    body = fetch_csv(d)
    if not body:
        print("  no CSV (404 / not published / weekend?)")
        return 0
    rows = parse_rows(body)
    n = upsert(conn, rows)
    print(f"  wrote {n} rows")
    return n


def run_latest(conn: psycopg.Connection) -> int:
    """Walk back from today to find the most recent published CSV."""
    today = date.today()
    for delta in range(MAX_DAYS_BACK + 1):
        d = today - timedelta(days=delta)
        if d.weekday() >= 5:  # Sat/Sun
            continue
        print(f"trying {d.isoformat()}")
        body = fetch_csv(d)
        if body:
            rows = parse_rows(body)
            n = upsert(conn, rows)
            print(f"  wrote {n} rows for {d}")
            return n
    print("no CSV found within walk-back window")
    return 0


def run_backfill(
    conn: psycopg.Connection,
    start: date,
    end: date,
    concurrency: int = DEFAULT_CONCURRENCY,
    skip_existing: bool = True,
) -> int:
    """Backfill an inclusive date range.

    Two optimisations on top of the original sequential loop:
      1. skip_existing — query the DB up front for dates that already
         have rows in this range, and never fetch those.  Critical when
         resuming an interrupted run: a re-invocation only fetches the
         missing tail.
      2. Concurrent fetches via a thread pool — NSE handles 4 parallel
         CSV downloads without rate-limiting, and HTTP latency dominates
         the loop. We still serialise the DB inserts in the main thread
         because psycopg connections aren't thread-safe.

    Output is intentionally compact: one line per date.  The earlier
    "fetching X… wrote 14 rows" two-line format gets noisy on a
    1-year backfill.
    """
    # 1. Build list of weekday targets.
    targets: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            targets.append(d)
        d += timedelta(days=1)

    if not targets:
        print("(no weekdays in range)")
        return 0

    # 2. Filter out dates already in DB.
    if skip_existing:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT date
                  FROM app.market_index_history
                 WHERE date BETWEEN %s AND %s
            """, (targets[0], targets[-1]))
            existing = {row[0] for row in cur.fetchall()}
        before = len(targets)
        targets = [d for d in targets if d not in existing]
        if before != len(targets):
            print(f"skipping {before - len(targets)} dates already in DB; "
                  f"fetching {len(targets)}")
        if not targets:
            print("nothing to fetch.")
            return 0

    # 3. Parallel fetch → serial upsert.
    print(f"backfilling {len(targets)} dates with concurrency={concurrency}")
    total = 0
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = {ex.submit(fetch_csv, d): d for d in targets}
        for fut in as_completed(futures):
            d = futures[fut]
            try:
                body = fut.result()
            except Exception as e:  # noqa: BLE001 — log + continue
                print(f"  {d}: fetch error {e}", file=sys.stderr)
                continue
            if not body:
                print(f"  {d}: no CSV (404 / holiday)")
                continue
            rows = parse_rows(body)
            n = upsert(conn, rows)
            total += n
            print(f"  {d}: {n} rows")
    return total


# ----------------------- CLI ----------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--date", help="Single ISO date (YYYY-MM-DD) to fetch")
    p.add_argument("--from", dest="from_", help="Backfill start (YYYY-MM-DD)")
    p.add_argument("--to", help="Backfill end (YYYY-MM-DD, inclusive)")
    p.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                   help=f"Parallel HTTP fetches during backfill (default: {DEFAULT_CONCURRENCY})")
    p.add_argument("--no-skip-existing", action="store_true",
                   help="Re-fetch dates that already have rows (default: skip them).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    url = args.url or env_url("APP_DB_URL", required=True)
    assert url is not None

    with psycopg.connect(url) as conn:
        if args.from_ and args.to:
            start = datetime.strptime(args.from_, "%Y-%m-%d").date()
            end   = datetime.strptime(args.to,    "%Y-%m-%d").date()
            print(f"backfill {start} → {end}")
            n = run_backfill(
                conn, start, end,
                concurrency=args.concurrency,
                skip_existing=not args.no_skip_existing,
            )
        elif args.date:
            d = datetime.strptime(args.date, "%Y-%m-%d").date()
            n = run_single(conn, d)
        else:
            n = run_latest(conn)

        if n > 0:
            updated = recompute_prev_close(conn)
            print(f"prev_close / pct_change recomputed for {updated} rows")
        conn.commit()
    print("done.")


if __name__ == "__main__":
    main()
