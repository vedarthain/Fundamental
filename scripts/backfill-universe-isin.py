#!/usr/bin/env python3
"""
backfill-universe-isin.py — repair polluted company_name / missing ISIN in
app.universe from NSE's authoritative equity list.

WHY: a handful of rows (the original sync missed them) carry a Yahoo-style
"<SYMBOL>.NS" company_name and a NULL ISIN — e.g. INFY, TCS, RELIANCE,
ICICIBANK, HDFCBANK. That single bad row breaks three things:
  1. Search by name — "Infosys" can't match company_name "INFY.NS".
  2. Announcements + BSE corporate actions — those fetchers map NSE→BSE via
     ISIN (`WHERE isin IS NOT NULL`), so a NULL-ISIN stock is skipped entirely.
  3. The displayed name (masked by displayCompanyName, but the data is wrong).

SOURCE: NSE's free archive CSV (symbol, name, ISIN). Not the blocked dynamic
API — this is a static file.
  https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv

We only touch rows that are actually polluted (name LIKE '%.NS' OR isin null/
empty), matched by symbol — good rows are left untouched.

USAGE:
  etl/.venv/bin/python scripts/backfill-universe-isin.py            # apply
  etl/.venv/bin/python scripts/backfill-universe-isin.py --dry-run  # preview
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen

import psycopg

REPO = Path(__file__).resolve().parent.parent
CSV_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def env_url(name: str) -> str:
    v = os.environ.get(name)
    if v:
        return v
    p = REPO / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{name} not set — pass --url or add to .env.local")


def load_nse_map() -> dict[str, tuple[str, str]]:
    """symbol → (clean name, ISIN) from NSE's EQUITY_L.csv."""
    req = Request(CSV_URL, headers={"User-Agent": UA})
    with urlopen(req, timeout=30) as r:
        raw = r.read().decode("utf-8", "replace")
    out: dict[str, tuple[str, str]] = {}
    for row in csv.DictReader(io.StringIO(raw)):
        # Header has leading spaces on some columns (" ISIN NUMBER").
        sym = (row.get("SYMBOL") or "").strip()
        name = (row.get("NAME OF COMPANY") or "").strip()
        isin = (row.get(" ISIN NUMBER") or row.get("ISIN NUMBER") or "").strip()
        if sym and name and isin:
            out[sym] = (name, isin)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill universe company_name/ISIN from NSE.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = ap.parse_args()
    url = args.url or env_url("APP_DB_URL")

    print("Downloading NSE EQUITY_L.csv…", file=sys.stderr)
    nse = load_nse_map()
    print(f"  {len(nse)} NSE symbols", file=sys.stderr)

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT symbol, company_name, isin FROM app.universe
                 WHERE company_name LIKE '%.NS' OR isin IS NULL OR isin = ''
                 ORDER BY symbol
                """
            )
            polluted = cur.fetchall()
        print(f"{len(polluted)} polluted rows to repair", file=sys.stderr)

        fixed, skipped = 0, []
        for sym, old_name, old_isin in polluted:
            ref = nse.get(sym)
            if not ref:
                skipped.append(sym)
                continue
            name, isin = ref
            print(f"  {sym}: '{old_name}'→'{name}', isin '{old_isin or '∅'}'→'{isin}'")
            if not args.dry_run:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE app.universe SET company_name=%s, isin=%s WHERE symbol=%s",
                        (name, isin, sym),
                    )
            fixed += 1
        if not args.dry_run:
            conn.commit()

    verb = "would fix" if args.dry_run else "fixed"
    print(f"Done — {verb} {fixed} rows."
          + (f" Skipped (not in NSE list): {skipped}" if skipped else ""))


if __name__ == "__main__":
    main()
