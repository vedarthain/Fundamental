#!/usr/bin/env python3
"""
fetch-index-history-upstox.py — deep index OHLC backfill from Upstox.

The daily driver for app.market_index_history is fetch-indices.py (NSE's
ind_close_all CSV, one HTTP call per trading day). That's fine for the daily
increment but a terrible backfiller — 13 years = ~3,200 fetches, and pre-2016
the sectorals are branded "CNX *". Upstox's historical-candle endpoint is the
opposite: PUBLIC (no auth), one request returns a whole multi-year series, and
depth goes back to ~2000 for the majors — all under the stable "Nifty *" name.

So the division of labour is:
  - THIS script  → one-time (or occasional) deep backfill, Upstox.
  - fetch-indices.py → ongoing daily close, NSE (also carries P/E, P/B, DivYield).

Both write to app.market_index_history (PK: index_code, date), so they compose:
whichever ran last for a given (index, date) wins the OHLC; the daily NSE run
keeps the tail current.

Upstox candle = [ts, open, high, low, close, volume, oi]. Index volume is 0.
prev_close / pct_change aren't in the payload — we derive them from the sorted
series (each day vs. the prior stored day).

USAGE:
  # Backfill all mapped indices from 2005 to today, local DB:
  etl/.venv/bin/python scripts/fetch-index-history-upstox.py

  # Just the 8 themes, from 2000, against prod:
  etl/.venv/bin/python scripts/fetch-index-history-upstox.py \
      --codes NIFTYAUTO,NIFTYBANK,NIFTYENERGY,NIFTYFMCG,NIFTYIT,NIFTYMETAL,NIFTYPHARMA,NIFTYREALTY \
      --from 2000-01-01 --url "$PROD_URL"

Cost (Rule #1):
  ~ceil(years/8) requests per index. 26 years × ~15 indices ≈ 60 HTTP calls
  total for a full-history backfill. Negligible; nothing like the per-day CSV.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


# our index_code → (Upstox index name, display_name stored in the table).
# The Upstox instrument_key is "NSE_INDEX|<name>". display_name matches the
# NSE naming fetch-indices.py uses, so the two sources agree on the label.
INDEX_MAP: dict[str, str] = {
    # The 8 themes (guaranteed to resolve; verified fresh to T-1).
    "NIFTYAUTO":   "Nifty Auto",
    "NIFTYBANK":   "Nifty Bank",
    "NIFTYENERGY": "Nifty Energy",
    "NIFTYFMCG":   "Nifty FMCG",
    "NIFTYIT":     "Nifty IT",
    "NIFTYMETAL":  "Nifty Metal",
    "NIFTYPHARMA": "Nifty Pharma",
    "NIFTYREALTY": "Nifty Realty",
    # Second wave of sectorals — all verified ~20y deep on Upstox (2004-2005
    # inception). Upstox uses truncated labels (the VALUE is the exact
    # instrument-key name; the daily NSE driver later overwrites display_name
    # on the tail with the clean "Nifty …" string).
    "NIFTYFINSERVICE":     "Nifty Fin Service",
    "NIFTYFINSRV2550":     "Nifty FinSrv25 50",
    "NIFTYHEALTHCARE":     "NIFTY HEALTHCARE",
    "NIFTYCONSDUR":        "NIFTY CONSR DURBL",
    "NIFTYOILGAS":         "NIFTY OIL AND GAS",
    "NIFTYPVTBANK":        "Nifty Pvt Bank",
    "NIFTYPSUBANK":        "Nifty PSU Bank",
    "NIFTYMEDIA":          "Nifty Media",
    "NIFTYMIDSMALLHEALTH": "Nifty MidSml Hlth",
    # Broad indices — useful benchmarks; skipped automatically if a key 404s.
    "NIFTY50":         "Nifty 50",
    "NIFTY100":        "Nifty 100",
    "NIFTY500":        "Nifty 500",
    "NIFTYNEXT50":     "Nifty Next 50",
    # Upstox uses UPPERCASE, abbreviated keys for these two (the lower-case
    # "Nifty …" forms 400). The daily NSE driver overwrites display_name on the
    # tail with the clean label, so the stored name stays "Nifty …".
    "NIFTYMIDCAP100":  "NIFTY MIDCAP 100",
    "NIFTYSMALLCAP100":"NIFTY SMLCAP 100",
}

UPSTOX_HIST = "https://api.upstox.com/v2/historical-candle/{key}/day/{to}/{frm}"

# Upstox caps the per-request span (10.5yr failed, 10yr worked). Chunk well
# under that so we never lose the tail of a window silently.
CHUNK_YEARS = 8


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
        raise SystemExit(f"{name} not set — pass as env var, or add to .env.local.")
    return None


def fetch_chunk(name: str, frm: date, to: date) -> list[list]:
    """Fetch day candles for one index over [frm, to]. Returns [] on any error."""
    key = urllib.parse.quote(f"NSE_INDEX|{name}")
    url = UPSTOX_HIST.format(key=key, to=to.isoformat(), frm=frm.isoformat())
    try:
        # Upstox 403s the default Python-urllib UA; mimic a browser (curl works
        # without this, urllib does not).
        req = Request(url, headers={
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            ),
        })
        with urlopen(req, timeout=45) as r:
            body = json.loads(r.read().decode("utf-8"))
    except HTTPError as e:
        # 404 = index/range not available on Upstox; caller decides to skip.
        if e.code != 404:
            print(f"    http {e.code} for {name} [{frm}..{to}]: {e.reason}", file=sys.stderr)
        return []
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        print(f"    err for {name} [{frm}..{to}]: {e}", file=sys.stderr)
        return []
    if body.get("status") != "success":
        return []
    return body.get("data", {}).get("candles", []) or []


def fetch_series(name: str, start: date, end: date) -> dict[date, tuple]:
    """Walk back from `end` to `start` in CHUNK_YEARS windows; merge candles.

    Returns {date: (open, high, low, close)} ascending-by-key when iterated
    sorted. Dedups overlapping chunk edges.
    """
    out: dict[date, tuple] = {}
    to = end
    while to >= start:
        frm = max(start, date(to.year - CHUNK_YEARS, to.month, to.day)
                  if _valid(to.year - CHUNK_YEARS, to.month, to.day)
                  else date(to.year - CHUNK_YEARS, to.month, 28))
        candles = fetch_chunk(name, frm, to)
        if not candles:
            # No data in this window — if we've already collected some, we've
            # walked past the index's inception; stop. Otherwise try older.
            if out:
                break
            to = frm - timedelta(days=1)
            continue
        for c in candles:
            try:
                d = datetime.fromisoformat(c[0]).date()
            except (ValueError, IndexError):
                continue
            if d in out:
                continue
            o, h, l, cl = c[1], c[2], c[3], c[4]
            if cl is None:
                continue
            out[d] = (o, h, l, cl)
        to = frm - timedelta(days=1)
    return out


def _valid(y: int, m: int, d: int) -> bool:
    try:
        date(y, m, d)
        return True
    except ValueError:
        return False


def upsert(conn, code: str, display_name: str, series: dict[date, tuple]) -> int:
    """Upsert a full series for one index, deriving prev_close / pct_change."""
    if not series:
        return 0
    days = sorted(series.keys())
    rows = []
    prev_close = None
    for d in days:
        o, h, l, cl = series[d]
        pct = None
        if prev_close not in (None, 0):
            pct = (cl / prev_close - 1) * 100
        rows.append((code, d, o, h, l, cl, prev_close, pct, display_name))
        prev_close = cl

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO app.market_index_history
              (index_code, date, open, high, low, close, prev_close, pct_change, display_name)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (index_code, date) DO UPDATE SET
              open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
              close = EXCLUDED.close, prev_close = EXCLUDED.prev_close,
              pct_change = EXCLUDED.pct_change, display_name = EXCLUDED.display_name
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description="Deep index OHLC backfill from Upstox.")
    ap.add_argument("--codes", help="Comma-separated index_codes (default: all mapped).")
    ap.add_argument("--from", dest="frm", default="2005-01-01", help="Start date (YYYY-MM-DD).")
    ap.add_argument("--to", dest="to", default=None, help="End date (default: today).")
    ap.add_argument("--url", help="Postgres URL (default: APP_DB_URL from env/.env.local).")
    args = ap.parse_args()

    start = datetime.strptime(args.frm, "%Y-%m-%d").date()
    end = datetime.strptime(args.to, "%Y-%m-%d").date() if args.to else date.today()

    codes = (
        [c.strip().upper() for c in args.codes.split(",") if c.strip()]
        if args.codes
        else list(INDEX_MAP.keys())
    )
    unknown = [c for c in codes if c not in INDEX_MAP]
    if unknown:
        raise SystemExit(f"unknown code(s): {unknown}. Known: {list(INDEX_MAP)}")

    db_url = args.url or env_url("APP_DB_URL")
    print(f"▶ upstox index backfill  {start} → {end}  ({len(codes)} indices)")

    total = 0
    with psycopg.connect(db_url) as conn:
        for code in codes:
            name = INDEX_MAP[code]
            series = fetch_series(name, start, end)
            if not series:
                print(f"  {code:16s} → no data (skipped)")
                continue
            n = upsert(conn, code, name, series)
            lo, hi = min(series), max(series)
            print(f"  {code:16s} → {n:5d} rows  [{lo} … {hi}]")
            total += n

    print(f"✓ done — {total} rows upserted across {len(codes)} indices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
