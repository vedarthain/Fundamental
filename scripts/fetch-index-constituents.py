#!/usr/bin/env python3
"""
fetch-index-constituents.py — seed app.index_constituent from NSE's per-index
"list" CSVs.

NSE publishes one membership CSV per index at:
  https://nsearchives.nseindia.com/content/indices/ind_nifty<name>list.csv
  (with an archives.nseindia.com fallback)
Columns: "Company Name","Industry","Symbol","Series","ISIN Code".

We pull each index in INDEX_CSV, parse Symbol + Company Name, and REPLACE that
index's rows atomically (delete-then-insert in one transaction) so a rebalance
that drops or adds names is reflected exactly. Symbols are stored bare (no
".NS") to match app.screener_meta.symbol.

USAGE:
  # Refresh all indices against APP_DB_URL (env or .env.local):
  etl/.venv/bin/python scripts/fetch-index-constituents.py

  # A subset:
  etl/.venv/bin/python scripts/fetch-index-constituents.py --only NIFTYIT,NIFTYBANK

  # Explicit DB:
  etl/.venv/bin/python scripts/fetch-index-constituents.py --url "$PROD_URL"

Cost: ~14 small CSV fetches + one delete/insert batch per index. Membership
changes only on NSE's semi-annual rebalance, so weekly (or monthly) is ample.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


# index_code → NSE list-CSV basename. Codes match market_index_history.
INDEX_CSV: dict[str, str] = {
    "NIFTY50":          "ind_nifty50list.csv",
    "NIFTYBANK":        "ind_niftybanklist.csv",
    "NIFTY100":         "ind_nifty100list.csv",
    "NIFTY200":         "ind_nifty200list.csv",
    "NIFTY500":         "ind_nifty500list.csv",
    "NIFTYNEXT50":      "ind_niftynext50list.csv",
    "NIFTYMIDCAP100":   "ind_niftymidcap100list.csv",
    "NIFTYSMALLCAP100": "ind_niftysmallcap100list.csv",
    "NIFTYIT":          "ind_niftyitlist.csv",
    "NIFTYAUTO":        "ind_niftyautolist.csv",
    "NIFTYFMCG":        "ind_niftyfmcglist.csv",
    "NIFTYPHARMA":      "ind_niftypharmalist.csv",
    "NIFTYENERGY":      "ind_niftyenergylist.csv",
    "NIFTYMETAL":       "ind_niftymetallist.csv",
    "NIFTYREALTY":      "ind_niftyrealtylist.csv",
}

CSV_URL_TEMPLATES = [
    "https://nsearchives.nseindia.com/content/indices/{name}",
    "https://archives.nseindia.com/content/indices/{name}",
]

# NSE blocks default User-Agents; mimic a browser.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


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


def fetch_csv(basename: str) -> str | None:
    """Fetch one index list CSV. Returns text or None on failure."""
    for tmpl in CSV_URL_TEMPLATES:
        url = tmpl.format(name=basename)
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=30) as r:
                if r.status == 200:
                    return r.read().decode("utf-8-sig", errors="replace")
        except (HTTPError, URLError, TimeoutError) as e:
            print(f"  · {url} failed: {e}", file=sys.stderr)
            continue
    return None


def parse_members(text: str) -> list[tuple[str, str | None]]:
    """Parse (symbol, company_name) pairs from an NSE list CSV. Tolerates
    header/column variations by matching on lowercased header names."""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    # Map normalised header → actual key.
    norm = {h.strip().lower(): h for h in reader.fieldnames}
    sym_key = norm.get("symbol")
    name_key = norm.get("company name") or norm.get("company")
    if not sym_key:
        return []
    out: list[tuple[str, str | None]] = []
    for row in reader:
        sym = (row.get(sym_key) or "").strip().upper()
        if not sym:
            continue
        name = (row.get(name_key) or "").strip() if name_key else None
        out.append((sym, name or None))
    return out


def replace_index(conn: psycopg.Connection, code: str, members: list[tuple[str, str | None]]) -> int:
    """Atomically replace one index's membership. Returns rows written."""
    if not members:
        # Never wipe an index to zero on a transient empty parse — skip.
        print(f"  ! {code}: 0 members parsed — skipping (kept existing rows)", file=sys.stderr)
        return 0
    with conn.cursor() as cur:
        cur.execute("DELETE FROM app.index_constituent WHERE index_code = %s", (code,))
        cur.executemany(
            """
            INSERT INTO app.index_constituent (index_code, symbol, company_name, refreshed_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (index_code, symbol) DO UPDATE SET
              company_name = EXCLUDED.company_name,
              refreshed_at = now()
            """,
            [(code, sym, name) for sym, name in members],
        )
    return len(members)


def main() -> None:
    p = argparse.ArgumentParser(description="Seed app.index_constituent from NSE list CSVs.")
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--only", help="Comma-separated index_codes to refresh (default: all)")
    args = p.parse_args()

    url = args.url or env_url("APP_DB_URL", required=True)
    codes = list(INDEX_CSV)
    if args.only:
        wanted = {c.strip().upper() for c in args.only.split(",")}
        codes = [c for c in codes if c in wanted]
        unknown = wanted - set(INDEX_CSV)
        if unknown:
            print(f"Unknown codes ignored: {', '.join(sorted(unknown))}", file=sys.stderr)

    total = 0
    with psycopg.connect(url) as conn:
        for code in codes:
            basename = INDEX_CSV[code]
            text = fetch_csv(basename)
            if text is None:
                print(f"  ! {code}: CSV fetch failed — skipping", file=sys.stderr)
                continue
            members = parse_members(text)
            n = replace_index(conn, code, members)
            if n:
                print(f"  ✓ {code}: {n} constituents")
                total += n
        conn.commit()

    print(f"Done — {total} constituent rows across {len(codes)} indices.")


if __name__ == "__main__":
    main()
