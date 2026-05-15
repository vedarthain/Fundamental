#!/usr/bin/env python3
"""
refresh-ltp.py — fetch yesterday's NSE bhavcopy and update
`app.screener_meta.current_price` for every symbol in our universe.

Designed to run as a GitHub Action every weekday after market close +
bhavcopy publish time (cron 13:00 UTC = 18:30 IST). Also runnable manually:

    APP_DB_URL=postgres://... etl/.venv/bin/python scripts/refresh-ltp.py

If invoked with no APP_DB_URL env var, falls back to reading it from
.env.local at the repo root (so local dev runs work the same way as CI).

What it does NOT do:
  - Doesn't add new rows to screener_meta (only updates existing symbols)
  - Doesn't touch golden.price_history (the daily-close history table) —
    that's heavier and stays on the weekly snap+sync flow
  - Doesn't recompute scores or metrics — those are weekly by design
"""
from __future__ import annotations

import csv
import io
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


# ----------------------- Config -------------------------------------------

# NSE bhavcopy URLs. NSE has migrated archives a few times — we try both.
# `sec_bhavdata_full_DDMMYYYY.csv` is a plain CSV that includes CLOSE_PRICE,
# DELIV_QTY, etc. for every equity scrip traded that day.
BHAVCOPY_URL_TEMPLATES = [
    "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
    "https://archives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
]

# NSE returns 403 to default User-Agents. These mimic a real browser request
# closely enough to get through their bot filter.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

# How many calendar days to walk back before giving up. Covers a long weekend
# plus a national holiday plus a Sunday — 5 is generous.
MAX_DAYS_BACK = 5

# We only update prices for equity scrips. T2T (BE/BZ) and limited-trading
# (BL) are still equities, just with stricter settlement. Exclude bonds,
# preference shares, ETFs, etc.
ALLOWED_SERIES = {"EQ", "BE", "BZ", "BL"}


# ----------------------- Helpers ------------------------------------------

def env_app_db_url() -> str:
    """Read APP_DB_URL from env first, fall back to .env.local for local runs."""
    v = os.environ.get("APP_DB_URL")
    if v:
        return v
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("APP_DB_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        "APP_DB_URL not set — pass as env var, or add to .env.local for local runs."
    )


def fetch_bhavcopy(d: date) -> str | None:
    """Try to fetch the bhavcopy CSV for date `d`. Returns CSV text, or None
    if the file isn't published for that date (404, weekend, holiday)."""
    ddmmyyyy = d.strftime("%d%m%Y")
    for url_tmpl in BHAVCOPY_URL_TEMPLATES:
        url = url_tmpl.format(ddmmyyyy=ddmmyyyy)
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", errors="replace")
                # Sanity: NSE sometimes returns an HTML error page with a 200
                # status. Real bhavcopy CSVs have CLOSE_PRICE in the header.
                if "CLOSE_PRICE" in body[:300].upper():
                    return body
        except HTTPError as e:
            if e.code == 404:
                continue
            print(f"  http error {e.code} for {url}: {e.reason}", file=sys.stderr)
        except URLError as e:
            print(f"  url error for {url}: {e.reason}", file=sys.stderr)
    return None


def parse_bhavcopy(csv_text: str) -> dict[str, float]:
    """Parse CSV → {symbol: close_price} for the allowed equity series.

    NSE bhavcopy quirks handled here:
      - Header column names have leading whitespace (" SERIES", " CLOSE_PRICE")
      - Row values also have leading whitespace
      - SERIES filter excludes bonds, preference shares, ETFs, mutual funds.
    """
    out: dict[str, float] = {}
    reader = csv.DictReader(io.StringIO(csv_text), skipinitialspace=True)
    fieldnames = [(f or "").strip() for f in (reader.fieldnames or [])]
    if "SYMBOL" not in fieldnames or "CLOSE_PRICE" not in fieldnames:
        return out
    for raw in reader:
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k is not None}
        if row.get("SERIES") not in ALLOWED_SERIES:
            continue
        symbol = row.get("SYMBOL")
        close = row.get("CLOSE_PRICE")
        if not symbol or not close:
            continue
        try:
            out[symbol.upper()] = float(close)
        except ValueError:
            continue
    return out


def find_latest_bhavcopy(today: date) -> tuple[date, str] | None:
    """Walk back from today looking for the most recent published bhavcopy.
    NSE doesn't publish on weekends or trading holidays."""
    for delta in range(MAX_DAYS_BACK + 1):
        d = today - timedelta(days=delta)
        # Skip Saturday/Sunday — bhavcopy never exists for those.
        if d.weekday() >= 5:
            continue
        print(f"  trying {d.isoformat()}")
        body = fetch_bhavcopy(d)
        if body:
            return d, body
    return None


def update_ltps(conn: psycopg.Connection, prices: dict[str, float]) -> tuple[int, int]:
    """UPDATE app.screener_meta.current_price for symbols we already track.

    Returns (rows_updated, symbols_in_bhavcopy_not_in_db). We deliberately
    don't INSERT new rows — keeps the update strictly additive in value,
    never additive in scope.
    """
    if not prices:
        return 0, 0
    with conn.cursor() as cur:
        cur.execute("SELECT symbol FROM app.screener_meta")
        known = {r[0] for r in cur.fetchall()}
    rows = [(sym, price) for sym, price in prices.items() if sym in known]
    missing = sum(1 for sym in prices if sym not in known)
    if not rows:
        return 0, missing
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE app.screener_meta SET current_price = %s WHERE symbol = %s",
            [(price, sym) for sym, price in rows],
        )
    conn.commit()
    return len(rows), missing


def main() -> None:
    today = date.today()
    print(f"refresh-ltp: looking for latest bhavcopy from {today.isoformat()}")
    result = find_latest_bhavcopy(today)
    if not result:
        print(f"✗ no bhavcopy found within {MAX_DAYS_BACK} days — exiting non-zero")
        sys.exit(1)
    d, csv_text = result
    print(f"✓ fetched bhavcopy for {d.isoformat()} ({len(csv_text):,} bytes)")
    prices = parse_bhavcopy(csv_text)
    if not prices:
        print("✗ parser returned 0 rows — bhavcopy format may have changed")
        sys.exit(2)
    print(f"  parsed {len(prices):,} equity rows")
    with psycopg.connect(env_app_db_url()) as conn:
        updated, missing = update_ltps(conn, prices)
    print(f"✓ updated current_price for {updated:,} symbols")
    if missing:
        print(f"  {missing:,} bhavcopy symbols not in our universe (ignored)")


if __name__ == "__main__":
    main()
