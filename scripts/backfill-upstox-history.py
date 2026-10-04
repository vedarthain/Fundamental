#!/usr/bin/env python3
"""
backfill-upstox-history.py — deep daily OHLCV backfill for EQUITIES from Upstox.

WHY THIS EXISTS
---------------
The Graph tab renders "no price history" for a symbol that has fewer bars than
a chart needs. Measured on prod 2026-10-04, that was not a rendering bug and not
a handful of edge cases:

    476 symbols with exactly 1 bar
    554 with 6-60
    236 with 61-250
  2,170 with 250+

Only 2,170 of 3,457 symbols in golden.price_history_1d had a usable series.

The 476 are the SME cohort. refresh-ltp.py's series whitelist was widened to
admit {SM, ST} on 2026-10-02, so from that day forward they get a bar a day —
but a daily feed only ever grows forward. A symbol that listed in 2024 and
started being ingested in 2026 has a two-year hole that no amount of waiting
fills. ESCONET listed 2024-02-23 and held exactly one close.

WHY UPSTOX AND NOT NSE OR YFINANCE
----------------------------------
NSE's bhavcopy is the daily driver and a terrible backfiller: one HTTP request
per TRADING DAY, so two years of history is ~500 requests that return every
symbol — and you still cannot reach back past the archive's retention.

Upstox's historical-candle endpoint is the inverse: one request returns a whole
multi-year series for one symbol, and it is PUBLIC — no access token, no daily
reauth, nothing that expires. Verified live 2026-10-04: SLONE returned 552 daily
candles reaching back to 2024-05-10, which is its actual listing date.

THE 403 THAT IS NOT A 403
-------------------------
Upstox rejects the default Python-urllib User-Agent with HTTP 403 — on every
key, including ones that work perfectly from a browser. It reads as an auth or
entitlement failure and it is neither. fetch-index-history-upstox.py already
carries the same header with the same note; this file repeats it rather than
importing, because a shared helper between two standalone scripts is a worse
trade than one duplicated constant.

WHAT IT WILL NOT DO
-------------------
1. It never overwrites an existing bar. Every insert is ON CONFLICT DO NOTHING,
   so a symbol already carrying yfinance or bhavcopy history keeps it and only
   the gaps are filled. Re-running is free and idempotent.
2. It only touches symbols that already exist in golden.stocks. The FK on
   price_history would reject anything else, and inventing a stocks row from a
   price feed is how golden.stocks ended up full of empty rows in the first
   place (see classification.py's header).
3. adj_close := close. Upstox's daily candle is not split/dividend adjusted and
   carries no adjustment factor. Writing close into adj_close matches what
   refresh-ltp.py already does for bhavcopy rows, so the two sources agree
   rather than disagreeing invisibly. For a symbol whose chart is currently
   EMPTY this is strictly better than nothing; for one with deep yfinance
   history, point 1 means we are not displacing adjusted data with unadjusted.

USAGE
  # Dry run — show what would be fetched, touch nothing:
  etl/.venv/bin/python scripts/backfill-upstox-history.py --dry-run

  # Backfill every symbol with fewer than 60 bars, against prod:
  set -a && . ./.env.local && set +a
  etl/.venv/bin/python scripts/backfill-upstox-history.py \
      --app-url "$NEON_APP_URL" --golden-url "$NEON_GOLDEN_URL"

  # Specific names:
  etl/.venv/bin/python scripts/backfill-upstox-history.py --only SLONE,ESCONET

COST
  One request per symbol per 8-year chunk. 476 symbols listed since ~2020 is
  ~476 requests at 0.25s throttle — about two minutes.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg

UPSTOX_HIST = "https://api.upstox.com/v2/historical-candle/{key}/day/{to}/{frm}"

# See "THE 403 THAT IS NOT A 403" above. This is load-bearing, not cosmetic.
HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
}

# Upstox caps the span of one request. fetch-index-history-upstox.py measured
# 10.5yr failing and 10yr working; 8 keeps clear of the edge so a long history
# is never silently truncated at the far end.
CHUNK_YEARS = 8

# golden.price_history stores symbols yfinance-style ('SBIN.NS'). Same constant
# as refresh-ltp.py::YF_SUFFIX — a mismatch here writes rows nothing can read.
YF_SUFFIX = ".NS"

# Distinguishes these rows from 'yfinance' and 'nse_bhavcopy' in audit queries.
DATA_SOURCE = "upstox"


def env_url(name: str) -> str | None:
    import os
    v = os.environ.get(name)
    if v:
        return v
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def fetch_chunk(key: str, frm: date, to: date) -> list[list] | None:
    """Day candles for one instrument over [frm, to].

    Returns [] for "the API answered and there is nothing there" and None for
    "the request failed". The caller must not treat those the same: an empty
    list means stop walking back, an error means this symbol's result is
    unknown and must not be recorded as complete.
    """
    url = UPSTOX_HIST.format(
        key=urllib.parse.quote(key, safe=""), to=to.isoformat(), frm=frm.isoformat()
    )
    try:
        with urlopen(Request(url, headers=HEADERS), timeout=45) as r:
            body = json.loads(r.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 404:
            return []
        print(f"    http {e.code} [{frm}..{to}]: {e.reason}", file=sys.stderr)
        return None
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        print(f"    err [{frm}..{to}]: {e}", file=sys.stderr)
        return None
    if body.get("status") != "success":
        return None
    return body.get("data", {}).get("candles", []) or []


def fetch_series(key: str, frm: date, to: date, throttle: float) -> list[list] | None:
    """Walk back in CHUNK_YEARS windows until a chunk comes back empty."""
    out: list[list] = []
    cursor_to = to
    while cursor_to > frm:
        cursor_frm = max(frm, cursor_to - timedelta(days=int(CHUNK_YEARS * 365.25)))
        chunk = fetch_chunk(key, cursor_frm, cursor_to)
        if chunk is None:
            return None
        if not chunk:
            break
        out.extend(chunk)
        cursor_to = cursor_frm - timedelta(days=1)
        if cursor_to > frm:
            time.sleep(throttle)
    return out


def targets(app_conn, golden_conn, only: list[str] | None, max_bars: int) -> list[tuple[str, str]]:
    """Return [(symbol, instrument_key)] worth backfilling.

    Starts from app.universe (the source of truth for what we cover) INNER
    JOINed to app.upstox_instrument, because a symbol with no instrument_key
    cannot be fetched at all — and surfacing that as a count is more useful than
    silently returning fewer rows.
    """
    with app_conn.cursor() as cur:
        if only:
            cur.execute(
                "SELECT u.symbol, i.instrument_key FROM app.universe u "
                "JOIN app.upstox_instrument i ON i.symbol = u.symbol "
                "WHERE u.symbol = ANY(%s) ORDER BY u.symbol",
                (only,),
            )
        else:
            cur.execute(
                "SELECT u.symbol, i.instrument_key FROM app.universe u "
                "JOIN app.upstox_instrument i ON i.symbol = u.symbol "
                "WHERE u.is_active ORDER BY u.symbol"
            )
        candidates = cur.fetchall()

    if only:
        return [(r[0], r[1]) for r in candidates]

    # Bar counts live in the OTHER database, so this cannot be one join.
    with golden_conn.cursor() as cur:
        cur.execute(
            "SELECT symbol, COUNT(*) FROM golden.price_history_1d "
            "WHERE symbol = ANY(%s) GROUP BY symbol",
            ([s + YF_SUFFIX for s, _ in candidates],),
        )
        have = {r[0]: r[1] for r in cur.fetchall()}

    return [
        (sym, key) for sym, key in candidates
        if have.get(sym + YF_SUFFIX, 0) < max_bars
    ]


def write_bars(conn, symbol: str, candles: list[list]) -> int:
    """Insert candles for one symbol. Returns rows actually written."""
    rows = []
    for c in candles:
        try:
            d = datetime.fromisoformat(c[0]).date()
            o, h, lo, cl, vol = c[1], c[2], c[3], c[4], c[5]
        except (ValueError, IndexError, TypeError):
            continue
        # A candle with no close is not a bar. Writing it would put a NULL into
        # the column every return calculation divides by.
        if cl is None:
            continue
        rows.append((symbol + YF_SUFFIX, "1d", d, o, h, lo, cl, cl, vol, DATA_SOURCE))
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO golden.price_history
                (symbol, interval, date, open, high, low, close, adj_close,
                 volume, data_source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, interval, date) DO NOTHING
            """,
            rows,
        )
        written = cur.rowcount
    conn.commit()
    return max(written, 0)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--app-url", help="app DB URL (defaults to APP_DB_URL)")
    p.add_argument("--golden-url", help="golden DB URL (defaults to GOLDEN_DB_URL)")
    p.add_argument("--only", help="comma-separated symbols; ignores --max-bars")
    p.add_argument("--max-bars", type=int, default=60,
                   help="backfill symbols holding fewer than this many daily bars")
    p.add_argument("--from", dest="frm", default="2000-01-01")
    p.add_argument("--throttle", type=float, default=0.25)
    p.add_argument("--limit", type=int, help="stop after N symbols")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    app_url = args.app_url or env_url("APP_DB_URL")
    golden_url = args.golden_url or env_url("GOLDEN_DB_URL")
    if not app_url or not golden_url:
        raise SystemExit("need both an app and a golden DB URL")

    frm = date.fromisoformat(args.frm)
    # Yesterday, not today: an intraday candle for the current session would be
    # stored as a complete daily bar and then never corrected, because every
    # insert here is DO NOTHING.
    to = date.today() - timedelta(days=1)
    only = [s.strip().upper() for s in args.only.split(",")] if args.only else None

    with psycopg.connect(app_url) as app_conn, psycopg.connect(golden_url) as gconn:
        todo = targets(app_conn, gconn, only, args.max_bars)
        if args.limit:
            todo = todo[: args.limit]
        print(f"backfill-upstox-history: {len(todo)} symbol(s) to fetch "
              f"[{frm} .. {to}], max_bars={args.max_bars}")
        if args.dry_run:
            for sym, key in todo[:20]:
                print(f"  would fetch {sym:<14} {key}")
            if len(todo) > 20:
                print(f"  … and {len(todo) - 20} more")
            return

        ok = written_total = empty = failed = 0
        for i, (sym, key) in enumerate(todo, 1):
            candles = fetch_series(key, frm, to, args.throttle)
            if candles is None:
                failed += 1
                print(f"  [{i}/{len(todo)}] {sym:<14} FAILED")
            elif not candles:
                empty += 1
                print(f"  [{i}/{len(todo)}] {sym:<14} no candles")
            else:
                n = write_bars(gconn, sym, candles)
                written_total += n
                ok += 1
                print(f"  [{i}/{len(todo)}] {sym:<14} {len(candles):>5} candles → "
                      f"{n:>5} new rows")
            if i < len(todo):
                time.sleep(args.throttle)

        print(f"done: ok={ok} empty={empty} failed={failed} rows_written={written_total}")

        # Fail loud. A backfill that fetched nothing for everything is a dead
        # script reporting success — the shape of failure this repo keeps
        # rediscovering. Guarded on todo so a caught-up no-op run still exits 0.
        if todo and ok == 0:
            print("::error:: every symbol failed or returned nothing — "
                  "check the User-Agent header and the instrument keys",
                  file=sys.stderr)
            raise SystemExit(1)


if __name__ == "__main__":
    main()
