#!/usr/bin/env python3
"""
intraday-refresh-ltp.py — pull live LTPs from Upstox during market hours.

Used as the 15- or 30-minute intraday tick alongside the daily bhavcopy
job. Bhavcopy stays the EOD source of truth (and the one that writes
authoritative OHLC into golden.price_history). This script ONLY refreshes
the current_price column in:
    - app.screener_meta             (drives /stock and watchlist surfaces)
    - app.cluster_stocks_panel_cache (drives /sectors and /market mover lists)

Flow:
  1. Load access_token from app.upstox_session.  Bail if missing/expired.
  2. Pull symbol → instrument_key from app.upstox_instrument JOIN
     app.universe WHERE is_active.
  3. Chunk into batches of 200 (well under Upstox's 500/call limit).
  4. GET /v2/market-quote/ltp per batch with Bearer auth.
  5. Map instrument_key back to symbol and bulk-update both price tables.

USAGE:
  # Local (uses .env.local for APP_DB_URL)
  etl/.venv/bin/python scripts/intraday-refresh-ltp.py

  # Prod
  APP_DB_URL="$PROD_URL" etl/.venv/bin/python scripts/intraday-refresh-ltp.py

  # Dry-run — fetch + log counts, no DB writes
  etl/.venv/bin/python scripts/intraday-refresh-ltp.py --dry-run

EXIT CODES:
  0  — success (or no-op if token expired with --tolerate-expired)
  1  — fatal (config / network / Upstox error)
  2  — token missing or expired (reauth required at /api/upstox/login)

COST (Rule #1):
  ~11 Upstox HTTP calls + 1 UPDATE (~2k rows) per run.  Wall time ~3-5s.
  Stays well inside Upstox's 500/min rate limit (each run uses ~11 calls).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import psycopg


LTP_ENDPOINT = "https://api.upstox.com/v2/market-quote/ltp"
BATCH_SIZE = 200  # safely below Upstox's per-call limit


def env_url(name: str, required: bool = True) -> str | None:
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


# ----------------------- Upstox client ------------------------------------

def fetch_ltp_batch(token: str, instrument_keys: list[str]) -> dict[str, float]:
    """Returns {instrument_key: last_price} for a batch of up to 500."""
    qs = urlencode({"instrument_key": ",".join(instrument_keys)})
    req = Request(f"{LTP_ENDPOINT}?{qs}", headers={
        "Accept":        "application/json",
        "Api-Version":   "2.0",
        "Authorization": f"Bearer {token}",
    })
    try:
        with urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        # Upstox returns 401 when the access token is invalid/expired.
        # Bubble up — caller exits with code 2 so an operator knows to
        # reauth.
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Upstox HTTP {e.code}: {body[:300]}") from e
    except (URLError, TimeoutError, OSError) as e:
        raise RuntimeError(f"Upstox fetch failed: {e}") from e
    try:
        payload = json.loads(body)
    except ValueError as e:
        raise RuntimeError(f"Upstox returned non-JSON: {body[:200]}") from e
    if payload.get("status") != "success":
        raise RuntimeError(f"Upstox status != success: {body[:300]}")

    # Upstox returns data keyed by either "NSE_EQ:SYMBOL" or
    # "NSE_EQ|ISIN".  Each value carries `instrument_token` which is the
    # canonical "NSE_EQ|ISIN" form — we use THAT as the lookup key
    # because that's what we requested by.
    out: dict[str, float] = {}
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return out
    for v in data.values():
        if not isinstance(v, dict):
            continue
        key = v.get("instrument_token") or v.get("instrument_key")
        price = v.get("last_price")
        if not isinstance(key, str) or not isinstance(price, (int, float)):
            continue
        out[key] = float(price)
    return out


# ----------------------- DB I/O -------------------------------------------

def load_token(conn: psycopg.Connection) -> tuple[str | None, datetime | None]:
    """Returns (access_token, expires_at). Either may be None if the
    upstox_session row hasn't been populated yet."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT access_token, expires_at FROM app.upstox_session WHERE id = 1
        """)
        row = cur.fetchone()
    if not row:
        return (None, None)
    return (row[0], row[1])


def load_instrument_map(conn: psycopg.Connection) -> list[tuple[str, str]]:
    """Returns [(symbol, instrument_key), ...] for active-universe symbols
    that have a Upstox mapping."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT i.symbol, i.instrument_key
              FROM app.upstox_instrument i
              JOIN app.universe u ON u.symbol = i.symbol AND u.is_active
        """)
        return list(cur.fetchall())


def write_prices(conn: psycopg.Connection, sym_to_price: dict[str, float]) -> tuple[int, int]:
    """Updates both screener_meta and the latest snapshot of the panel cache.
    Returns (rows_meta, rows_panel)."""
    if not sym_to_price:
        return (0, 0)
    syms   = list(sym_to_price.keys())
    prices = [sym_to_price[s] for s in syms]

    with conn.cursor() as cur:
        # screener_meta.current_price
        cur.execute(
            """
            UPDATE app.screener_meta sm
               SET current_price = up.price,
                   updated_at    = NOW()
              FROM unnest(%s::text[], %s::float[]) AS up(sym, price)
             WHERE sm.symbol = up.sym
            """,
            (syms, prices),
        )
        rows_meta = cur.rowcount or 0

        # cluster_stocks_panel_cache.current_price for latest snapshot
        cur.execute(
            """
            UPDATE app.cluster_stocks_panel_cache c
               SET current_price = up.price
              FROM unnest(%s::text[], %s::float[]) AS up(sym, price)
             WHERE c.symbol = up.sym
               AND c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
            """,
            (syms, prices),
        )
        rows_panel = cur.rowcount or 0

    return (rows_meta, rows_panel)


# ----------------------- main ---------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--dry-run", action="store_true",
                   help="Fetch + log counts but write nothing.")
    p.add_argument("--tolerate-expired", action="store_true",
                   help="Exit 0 instead of 2 when no valid token (useful in "
                        "GH Action so a missed reauth doesn't fail the job).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    app_url = args.url or env_url("APP_DB_URL", required=True)
    assert app_url is not None

    started = datetime.now()
    with psycopg.connect(app_url) as conn:
        token, expires_at = load_token(conn)
        if not token:
            print("no upstox access_token in DB — admin must visit "
                  "/api/upstox/login first", file=sys.stderr)
            sys.exit(0 if args.tolerate_expired else 2)
        if expires_at and expires_at < datetime.now(timezone.utc):
            print(f"upstox token expired at {expires_at} — admin must "
                  "re-auth via /api/upstox/login", file=sys.stderr)
            sys.exit(0 if args.tolerate_expired else 2)

        mapping = load_instrument_map(conn)
        if not mapping:
            print("no instrument mapping rows — run scripts/fetch-upstox-instruments.py first",
                  file=sys.stderr)
            sys.exit(1)

        # Reverse lookup table: instrument_key -> symbol (so we can map the
        # API response back to OUR canonical symbol).
        key_to_sym = {k: s for s, k in mapping}
        all_keys = [k for _, k in mapping]
        print(f"fetching LTPs for {len(all_keys):,} instruments "
              f"(in {(len(all_keys) + BATCH_SIZE - 1) // BATCH_SIZE} batches of {BATCH_SIZE})")

        # Fetch in chunks.
        sym_to_price: dict[str, float] = {}
        misses = 0
        for i in range(0, len(all_keys), BATCH_SIZE):
            chunk = all_keys[i : i + BATCH_SIZE]
            try:
                resp = fetch_ltp_batch(token, chunk)
            except RuntimeError as e:
                # If the very first batch fails with 401, halt — the rest
                # will all fail the same way. For mid-run failures we keep
                # what we have rather than rolling back.
                if i == 0 and "401" in str(e):
                    print(f"upstox auth rejected: {e}", file=sys.stderr)
                    sys.exit(0 if args.tolerate_expired else 2)
                print(f"batch {i // BATCH_SIZE} failed: {e}", file=sys.stderr)
                continue
            for k in chunk:
                if k in resp:
                    sym = key_to_sym.get(k)
                    if sym:
                        sym_to_price[sym] = resp[k]
                else:
                    misses += 1

        print(f"got {len(sym_to_price):,} prices, {misses:,} instrument_keys had no quote")

        if args.dry_run:
            for s in list(sym_to_price.items())[:5]:
                print(f"  {s[0]:12} {s[1]}")
            print("dry-run — no DB writes")
            return

        rows_meta, rows_panel = write_prices(conn, sym_to_price)
        conn.commit()

    took = (datetime.now() - started).total_seconds()
    print(f"wrote screener_meta={rows_meta}, panel_cache={rows_panel}; {took:.1f}s")


if __name__ == "__main__":
    main()
