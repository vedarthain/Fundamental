#!/usr/bin/env python3
"""
refresh-ltp.py — fetch the latest NSE bhavcopy and refresh two things from
the same single CSV download:

  1. app.screener_meta.current_price        — today's LTP for header/cards
  2. golden.price_history (interval='1d')   — today's OHLC bar for /sectors
                                              1W/1M/1Y returns + scoring

Designed to run as a GitHub Action every weekday after market close +
bhavcopy publish time (cron 13:00 UTC = 18:30 IST). Also runnable manually:

    APP_DB_URL=postgres://...        \\
    NEON_GOLDEN_URL=postgres://...   \\
    etl/.venv/bin/python scripts/refresh-ltp.py

If invoked with no APP_DB_URL env var, falls back to reading it from
.env.local at the repo root (so local dev runs work the same way as CI).
NEON_GOLDEN_URL is optional — if not set, only LTP is updated and the
OHLC INSERT step is skipped (with a notice). This lets the script keep
working for local dev where you may only have a local golden_db.

Why one script instead of two:
  - One bhavcopy fetch covers both jobs — no duplicate NSE traffic
  - LTP and historical OHLC are conceptually "today's market data" — they
    travel together
  - Replaces the yfinance-based refresh-ohlc.py which had rate-limit
    risk and was slower (~30 min vs ~30 sec for bhavcopy)

What it does NOT do:
  - Doesn't add new rows to screener_meta (only updates existing symbols)
  - Doesn't fetch longer intervals (1wk / 1mo / 3mo). The web app's
    1W/1M/1Y return columns are derived from 1d data on the fly, so
    storing those intervals separately on Neon is not needed.
  - Doesn't recompute scores or metrics — those are weekly via ./snap
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
# `sec_bhavdata_full_DDMMYYYY.csv` is a plain CSV that includes OPEN, HIGH,
# LOW, CLOSE, LTP, PREV_CLOSE, volume, etc. for every equity scrip that day.
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

# Yahoo Finance suffix — golden.price_history stores symbols as 'SBIN.NS'
# (matches the format used by the local yfinance ingest and sync-neon.sh).
YF_SUFFIX = ".NS"

# Data source label written to golden.price_history.data_source for rows
# inserted by this script — lets you tell bhavcopy-sourced rows apart from
# yfinance-sourced ones in audit queries.
DATA_SOURCE = "nse_bhavcopy"


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
            f"{name} not set — pass as env var, or add to .env.local for local runs."
        )
    return None


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


def _f(v: str) -> float | None:
    """Float-or-None parse helper for bhavcopy fields."""
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _i(v: str) -> int | None:
    """Int-or-None parse helper for bhavcopy volume column."""
    if not v:
        return None
    try:
        # Volume can come through as "12345.0" if NSE feeds it as decimal
        return int(float(v))
    except ValueError:
        return None


def parse_bhavcopy(csv_text: str) -> dict[str, dict]:
    """Parse CSV → {symbol: {open, high, low, close, volume}} for allowed series.

    Used by both the LTP update and the OHLC insert paths — single pass over
    the CSV produces everything we need.

    NSE bhavcopy quirks handled here:
      - Header column names have leading whitespace (" SERIES", " OPEN_PRICE")
      - Row values also have leading whitespace
      - SERIES filter excludes bonds, preference shares, ETFs, mutual funds
      - Some rows have empty/blank price fields when no trade happened
    """
    out: dict[str, dict] = {}
    reader = csv.DictReader(io.StringIO(csv_text), skipinitialspace=True)
    fieldnames = [(f or "").strip() for f in (reader.fieldnames or [])]
    required = {"SYMBOL", "SERIES", "OPEN_PRICE", "HIGH_PRICE",
                "LOW_PRICE", "CLOSE_PRICE", "TTL_TRD_QNTY"}
    if not required.issubset(set(fieldnames)):
        return out
    for raw in reader:
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k is not None}
        if row.get("SERIES") not in ALLOWED_SERIES:
            continue
        symbol = row.get("SYMBOL")
        if not symbol:
            continue
        close = _f(row.get("CLOSE_PRICE", ""))
        if close is None:
            # No close = no useful data for either LTP or OHLC; skip.
            continue
        out[symbol.upper()] = {
            "open":   _f(row.get("OPEN_PRICE", "")),
            "high":   _f(row.get("HIGH_PRICE", "")),
            "low":    _f(row.get("LOW_PRICE", "")),
            "close":  close,
            "volume": _i(row.get("TTL_TRD_QNTY", "")),
        }
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


def update_ltps(conn: psycopg.Connection, bars: dict[str, dict]) -> tuple[int, int]:
    """UPDATE app.screener_meta.current_price for symbols we already track.

    Returns (rows_updated, symbols_in_bhavcopy_not_in_db). We deliberately
    don't INSERT new rows — keeps the update strictly additive in value,
    never additive in scope.
    """
    if not bars:
        return 0, 0
    with conn.cursor() as cur:
        cur.execute("SELECT symbol FROM app.screener_meta")
        known = {r[0] for r in cur.fetchall()}
    rows = [(sym, b["close"]) for sym, b in bars.items() if sym in known]
    missing = sum(1 for sym in bars if sym not in known)
    if not rows:
        return 0, missing
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE app.screener_meta SET current_price = %s WHERE symbol = %s",
            [(price, sym) for sym, price in rows],
        )
    conn.commit()
    return len(rows), missing


def insert_ohlc(
    conn: psycopg.Connection,
    bars: dict[str, dict],
    trade_date: date,
) -> int:
    """INSERT today's OHLC bar (interval='1d') into golden.price_history.

    Uses ON CONFLICT DO NOTHING — re-running the script later in the day, or
    after a missed-day backfill, is harmless. Returns the count of rows
    submitted (not the count of rows actually new, since psycopg doesn't
    surface the conflict-skip count without a CTE).
    """
    if not bars:
        return 0
    # adj_close := close. NSE bhavcopy doesn't separate split/dividend-adjusted
    # closes; we'd need a separate corporate-action feed. For 1W/1M/1Y returns
    # (the main consumer) this is fine — those are short horizons where
    # corporate actions are rare and adj_close ≈ close to within a few %.
    rows = [
        (
            sym + YF_SUFFIX,
            "1d",
            trade_date,
            b["open"], b["high"], b["low"], b["close"], b["close"], b["volume"],
            DATA_SOURCE,
        )
        for sym, b in bars.items()
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO golden.price_history
                (symbol, interval, date, open, high, low, close, adj_close, volume, data_source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, interval, date) DO NOTHING
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def main() -> None:
    today = date.today()
    print(f"refresh-ltp: looking for latest bhavcopy from {today.isoformat()}")
    result = find_latest_bhavcopy(today)
    if not result:
        print(f"✗ no bhavcopy found within {MAX_DAYS_BACK} days — exiting non-zero")
        sys.exit(1)
    trade_date, csv_text = result
    print(f"✓ fetched bhavcopy for {trade_date.isoformat()} ({len(csv_text):,} bytes)")
    bars = parse_bhavcopy(csv_text)
    if not bars:
        print("✗ parser returned 0 rows — bhavcopy format may have changed")
        sys.exit(2)
    print(f"  parsed {len(bars):,} equity rows")

    # Step 1: update screener_meta.current_price (always)
    app_url = env_url("APP_DB_URL", required=True)
    with psycopg.connect(app_url) as conn:
        updated, missing = update_ltps(conn, bars)
    print(f"✓ updated current_price for {updated:,} symbols")
    if missing:
        print(f"  {missing:,} bhavcopy symbols not in our universe (ignored)")

    # Step 2: insert today's OHLC bar into golden.price_history (if configured)
    # The OHLC write is optional so local dev still works without a Neon golden
    # URL configured. In CI, NEON_GOLDEN_URL is always set as a repo secret.
    golden_url = env_url("NEON_GOLDEN_URL", required=False)
    if not golden_url:
        print("  NEON_GOLDEN_URL not set — skipping OHLC INSERT into golden.price_history")
        return
    with psycopg.connect(golden_url) as conn:
        submitted = insert_ohlc(conn, bars, trade_date)
    print(f"✓ submitted {submitted:,} OHLC rows to golden.price_history "
          f"(date={trade_date.isoformat()}, conflicts ignored)")


if __name__ == "__main__":
    main()
