#!/usr/bin/env python3
"""
refresh-ohlc.py — fetch the last few days of daily OHLC bars from yfinance
and INSERT them into Neon's `golden.price_history` for every active symbol.

Designed to run as a GitHub Action every weekday after NSE close + yfinance
settling time (cron 17:30 UTC = 23:00 IST). Also runnable manually:

    NEON_GOLDEN_URL=postgres://... \
    NEON_APP_URL=postgres://... \
    etl/.venv/bin/python scripts/refresh-ohlc.py

What it does:
  1. Reads the list of active NSE symbols from Neon's app.universe
  2. Walks back N days from "today" and fetches yfinance daily bars for
     each symbol (throttled to avoid Yahoo rate limits)
  3. INSERT ... ON CONFLICT DO NOTHING into golden.price_history so reruns
     are safe and partial-day failures don't corrupt good data

What it does NOT do:
  - Doesn't backfill multi-year history (that's a one-shot via
    scripts/backfill-prices-neon.sh — this is only for daily increments)
  - Doesn't fetch 1wk / 1mo / 3mo intervals (1d is what the app needs;
    those longer intervals are computed from 1d data on demand if needed)
  - Doesn't refresh fundamentals or scores — see ./snap for that

Resilience:
  - Throttle between symbols (yfinance has been getting strict)
  - Skip symbols that yfinance returns empty / errors for, don't fail the
    whole batch
  - Defensive close-IS-NOT-NULL on every row (yfinance occasionally returns
    rows with NaN close — those get filtered before insert)
  - Final-status report so the GHA log shows what got through
"""
from __future__ import annotations

import math
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg

# yfinance is dynamically imported inside main() so that --help (and import
# errors at workflow-config time) don't require the dependency.


# ----------------------- Config -------------------------------------------

# How many calendar days back to fetch. yfinance returns trading days in
# this window, so 7 covers a long weekend + 1 buffer day for partial fills.
LOOKBACK_DAYS = 7

# Yahoo Finance suffix for NSE listings.
YF_SUFFIX = ".NS"

# Sleep between symbols. yfinance shares Yahoo Finance's anti-bot infra;
# burst requests get 429s pretty quickly. 0.3s = ~3 symbols/sec = ~12 min
# for a 2,150-symbol pass, comfortably under GHA's 6h job limit.
THROTTLE_SEC = 0.3

# If a single symbol fails more than this many times across retries, give
# up on it for today. yfinance is noisy enough that one-off blips happen.
PER_SYMBOL_RETRIES = 2

# How long to wait between retries for a single symbol.
RETRY_BACKOFF_SEC = 2.0


# ----------------------- Helpers ------------------------------------------

def env_url(name: str) -> str:
    """Read a Postgres URL from env, fall back to .env.local for local runs."""
    v = os.environ.get(name)
    if v:
        return v
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        f"{name} not set — pass as env var, or add to .env.local for local runs."
    )


def fetch_symbols(app_url: str) -> list[str]:
    """Pull the list of active NSE symbols from Neon's app.universe."""
    with psycopg.connect(app_url) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT symbol FROM app.universe
             WHERE is_active
             ORDER BY symbol
        """)
        return [r[0] for r in cur.fetchall()]


def fetch_yf_bars(yf, symbol: str, start: date, end: date) -> list[tuple]:
    """Return [(date, open, high, low, close, adj_close, volume), ...] for
    a single symbol over the window. Empty list on any failure / empty data.

    yfinance returns a pandas DataFrame indexed by date. We convert to a list
    of plain tuples so the insert path doesn't depend on pandas.
    """
    for attempt in range(PER_SYMBOL_RETRIES + 1):
        try:
            t = yf.Ticker(symbol + YF_SUFFIX)
            df = t.history(start=start.isoformat(), end=(end + timedelta(days=1)).isoformat(),
                           interval="1d", auto_adjust=False, actions=False)
            if df is None or df.empty:
                return []
            out: list[tuple] = []
            for idx, row in df.iterrows():
                d = idx.date() if hasattr(idx, "date") else idx
                close = row.get("Close")
                # Skip rows with no close — yfinance occasionally returns NaN
                # for the latest day before market settles.
                if close is None or (isinstance(close, float) and math.isnan(close)):
                    continue
                out.append((
                    d,
                    _safe_num(row.get("Open")),
                    _safe_num(row.get("High")),
                    _safe_num(row.get("Low")),
                    _safe_num(close),
                    _safe_num(row.get("Adj Close")),
                    _safe_int(row.get("Volume")),
                ))
            return out
        except Exception as e:
            if attempt < PER_SYMBOL_RETRIES:
                time.sleep(RETRY_BACKOFF_SEC * (attempt + 1))
                continue
            print(f"    {symbol}: yfinance error after retries: {str(e)[:120]}",
                  file=sys.stderr)
            return []
    return []


def _safe_num(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else int(f)
    except (TypeError, ValueError):
        return None


def insert_bars(golden_url: str, symbol_yf: str, bars: list[tuple]) -> int:
    """INSERT ... ON CONFLICT DO NOTHING for one symbol's bars. Returns the
    number of rows actually inserted (existing rows on conflict count as 0)."""
    if not bars:
        return 0
    rows = [
        (symbol_yf, "1d", d, o, h, l, c, ac, v, "yfinance")
        for (d, o, h, l, c, ac, v) in bars
    ]
    with psycopg.connect(golden_url) as conn, conn.cursor() as cur:
        # We rely on the unique constraint over (symbol, interval, date).
        cur.executemany(
            """
            INSERT INTO golden.price_history
                (symbol, interval, date, open, high, low, close, adj_close, volume, data_source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, interval, date) DO NOTHING
            """,
            rows,
        )
        # psycopg doesn't return per-row "did it insert" without RETURNING; we
        # approximate by reporting len(bars) as "rows considered". For "rows
        # actually new" you'd need a CTE — over-engineered for a daily job.
        conn.commit()
        return len(rows)


# ----------------------- Main ---------------------------------------------

def main() -> None:
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        raise SystemExit(
            "yfinance not installed. Run: pip install 'yfinance>=0.2.40'"
        )

    app_url = env_url("APP_DB_URL") if os.environ.get("APP_DB_URL") else env_url("NEON_APP_URL")
    golden_url = env_url("NEON_GOLDEN_URL")

    today = date.today()
    start = today - timedelta(days=LOOKBACK_DAYS)
    print(f"refresh-ohlc: window {start.isoformat()} → {today.isoformat()} (last {LOOKBACK_DAYS} days)")

    symbols = fetch_symbols(app_url)
    print(f"  active symbols in scope: {len(symbols)}")

    ok = empty = error = 0
    rows_total = 0
    started = datetime.utcnow()
    for i, sym in enumerate(symbols, 1):
        bars = fetch_yf_bars(yf, sym, start, today)
        if not bars:
            empty += 1
        else:
            try:
                rows = insert_bars(golden_url, sym + YF_SUFFIX, bars)
                rows_total += rows
                ok += 1
            except Exception as e:
                error += 1
                print(f"    {sym}: insert failed: {str(e)[:120]}", file=sys.stderr)
        if i % 200 == 0:
            elapsed = (datetime.utcnow() - started).total_seconds()
            print(f"  progress: {i}/{len(symbols)} (ok={ok} empty={empty} err={error}, "
                  f"{rows_total} bars considered, {elapsed:.0f}s elapsed)")
        time.sleep(THROTTLE_SEC)

    elapsed = (datetime.utcnow() - started).total_seconds()
    print(f"refresh-ohlc done in {elapsed:.0f}s: "
          f"ok={ok} empty={empty} error={error} rows_considered={rows_total}")

    # Exit non-zero if too many symbols failed (signals a real outage vs
    # the usual sprinkle of yfinance flakes). Threshold: 25% failure rate.
    failed = empty + error
    if failed > len(symbols) * 0.25:
        print(f"✗ {failed}/{len(symbols)} symbols failed — exceeds 25% threshold",
              file=sys.stderr)
        sys.exit(1)
    print("✓ healthy run")


if __name__ == "__main__":
    main()
