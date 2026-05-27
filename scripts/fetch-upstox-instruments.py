#!/usr/bin/env python3
"""
fetch-upstox-instruments.py — daily Upstox instrument master sync.

Downloads Upstox's NSE instrument dump (a gzipped JSON array), filters
to plain equity rows (instrument_type='EQ'), and upserts the
symbol → instrument_key mapping into app.upstox_instrument.

WHY:
  Upstox's quote/LTP API needs an instrument_key (e.g.
  "NSE_EQ|INE002A01018") rather than a bare symbol. We can't derive it
  from "RELIANCE" alone — it embeds the ISIN. So we materialise the
  mapping once a day from their published master file.

SOURCE:
  https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
  Updated daily by Upstox at ~06:00 IST.

USAGE:
  # Local
  etl/.venv/bin/python scripts/fetch-upstox-instruments.py

  # Prod
  etl/.venv/bin/python scripts/fetch-upstox-instruments.py --url "$PROD_URL"

  # Dry-run (no DB writes; useful when first investigating the dump)
  etl/.venv/bin/python scripts/fetch-upstox-instruments.py --dry-run

COST (Rule #1):
  - 1 HTTP GET (~3 MB gzipped, ~25 MB decoded)
  - 1 batched INSERT … ON CONFLICT for ~2,200 rows
  - Total wall time: ~5-10s. Free.
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json, application/octet-stream;q=0.9, */*;q=0.5",
    "Accept-Encoding": "gzip",
}


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


def fetch_dump() -> list[dict]:
    """Download + decompress + JSON-parse the NSE instrument master."""
    req = Request(URL, headers=HEADERS)
    try:
        with urlopen(req, timeout=60) as r:
            raw = r.read()
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        raise SystemExit(f"fetch failed: {e}")
    # urllib auto-decodes gzip if Content-Encoding is set; if not, decode
    # manually based on magic bytes.
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    try:
        data = json.loads(raw.decode("utf-8"))
    except ValueError as e:
        raise SystemExit(f"JSON parse failed: {e}")
    if not isinstance(data, list):
        raise SystemExit(f"unexpected JSON shape (top-level {type(data).__name__})")
    return data


def filter_equities(raw_rows: list[dict]) -> list[dict]:
    """Keep only plain NSE equity rows. Drops F&O, indices, bonds, ETFs.

    Filter rules:
      - segment must be NSE_EQ (cash equity segment)
      - instrument_type must be EQ (equity, not futures/options/INDEX)
      - tradingsymbol must be non-empty and ASCII (NSE symbols are)
    """
    out: list[dict] = []
    for r in raw_rows:
        if not isinstance(r, dict):
            continue
        if r.get("segment") != "NSE_EQ":
            continue
        if r.get("instrument_type") != "EQ":
            continue
        sym = (r.get("trading_symbol") or r.get("tradingsymbol") or "").strip()
        if not sym:
            continue
        key = (r.get("instrument_key") or "").strip()
        if not key:
            continue
        out.append({
            "symbol":         sym.upper(),
            "instrument_key": key,
            "isin":           (r.get("isin") or "").strip() or None,
            "name":           (r.get("name") or "").strip() or None,
        })
    return out


def upsert(conn: psycopg.Connection, rows: list[dict]) -> tuple[int, int]:
    """Returns (inserted_or_updated, deleted_stale)."""
    if not rows:
        return (0, 0)
    written = 0
    with conn.cursor() as cur:
        # Batch via unnest for speed.  ~2,200 rows is small but no reason
        # to do per-row INSERTs.
        cur.execute(
            """
            INSERT INTO app.upstox_instrument (symbol, instrument_key, isin, name, updated_at)
            SELECT s, k, i, n, NOW()
              FROM unnest(%s::text[], %s::text[], %s::text[], %s::text[]) AS x(s, k, i, n)
            ON CONFLICT (symbol) DO UPDATE
              SET instrument_key = EXCLUDED.instrument_key,
                  isin           = EXCLUDED.isin,
                  name           = EXCLUDED.name,
                  updated_at     = NOW()
            """,
            (
                [r["symbol"]         for r in rows],
                [r["instrument_key"] for r in rows],
                [r["isin"]           for r in rows],
                [r["name"]           for r in rows],
            ),
        )
        written = cur.rowcount or 0

        # Drop rows whose symbol disappeared from Upstox's dump (delisted
        # or otherwise gone). Stale rows would lead to "instrument not
        # found" errors on the LTP API. Compare via ANY() rather than
        # NOT IN to keep the plan index-friendly.
        symbols = [r["symbol"] for r in rows]
        cur.execute(
            "DELETE FROM app.upstox_instrument WHERE NOT (symbol = ANY(%s))",
            (symbols,),
        )
        deleted = cur.rowcount or 0
    return (written, deleted)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print row count + sample rows but write nothing.")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    started = datetime.now()
    print(f"fetching {URL}")
    raw = fetch_dump()
    print(f"  decoded {len(raw):,} total instruments")

    rows = filter_equities(raw)
    print(f"  filtered to {len(rows):,} NSE equity rows")

    if args.dry_run:
        print("dry-run — sample 5 rows:")
        for r in rows[:5]:
            print(f"  {r['symbol']:12} {r['instrument_key']:35} {r['isin'] or '-':14} {r['name'] or ''}")
        return

    url = args.url or env_url("APP_DB_URL", required=True)
    assert url is not None
    with psycopg.connect(url) as conn:
        written, deleted = upsert(conn, rows)
        conn.commit()

    took = (datetime.now() - started).total_seconds()
    print(f"upserted {written:,} rows; pruned {deleted:,} stale rows; {took:.1f}s")


if __name__ == "__main__":
    main()
