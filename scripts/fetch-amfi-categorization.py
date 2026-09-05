#!/usr/bin/env python3
"""
fetch-amfi-categorization.py — populate app.universe.market_cap_category from
AMFI's official SEBI market-cap categorisation list.

AMFI publishes a semi-annual XLSX (~Jan & Jul, for the six months ended 31 Dec /
30 Jun) that assigns every listed company to one of three SEBI buckets:
  Large Cap  = rank 1–100 by 6-month avg market cap
  Mid Cap    = rank 101–250
  Small Cap  = rank 251+
This is the SAME list every mutual fund and screener uses, so it is the
authoritative source for a stock's cap tier. We adopt its three buckets verbatim
(no homegrown "micro_cap" — that would reintroduce the unsourced problem this
fetcher exists to fix).

The file's host/path moves between periods (old
amfiindia.com/Themes/Theme1/downloads/, new portal.amfiindia.com/spages/), so we
DISCOVER the current file by scraping the listing page rather than hardcoding a
URL:
  https://www.amfiindia.com/otherdata/categorisation-of-stocks

We parse (NSE Symbol, ISIN, Categorization) and UPDATE app.universe by NSE symbol,
falling back to ISIN when the symbol doesn't match. Names not in AMFI's list
(illiquid / recently listed) are left NULL — NULL is honest.

USAGE:
  # Refresh against APP_DB_URL (env or .env.local):
  etl/.venv/bin/python scripts/fetch-amfi-categorization.py

  # Explicit DB / file (skip discovery):
  etl/.venv/bin/python scripts/fetch-amfi-categorization.py --url "$PROD_URL"
  etl/.venv/bin/python scripts/fetch-amfi-categorization.py --xlsx-url https://…/File.xlsx

  # Dry run (parse + report, no writes):
  etl/.venv/bin/python scripts/fetch-amfi-categorization.py --dry-run

Cost: one listing-page fetch + one XLSX download (~600 KB) + one batched UPDATE.
The list only changes twice a year, so a monthly cron is ample; on days with no
new file it simply re-applies the same categorisation (idempotent).
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg
from openpyxl import load_workbook

LISTING_URL = "https://www.amfiindia.com/otherdata/categorisation-of-stocks"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

# AMFI's "Categorization as per SEBI Circular…" values → our enum.
CATEGORY_MAP = {
    "large cap": "large_cap",
    "mid cap": "mid_cap",
    "small cap": "small_cap",
}

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "july": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10,
    "nov": 11, "dec": 12,
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


def _file_date(url: str) -> tuple[int, int]:
    """Extract a (year, month) sort key from an AMFI filename. The date is the
    period end, e.g. '30Jun2026' or '…sixmonthsended31Dec2024'. Returns (0, 0)
    when unparseable so it sorts last."""
    m = re.search(r"(\d{1,2})\s*([A-Za-z]{3,4})\s*(\d{4})", url)
    if not m:
        return (0, 0)
    mon = MONTHS.get(m.group(2).lower())
    if not mon:
        return (0, 0)
    return (int(m.group(3)), mon)


def discover_xlsx_url() -> str | None:
    """Scrape the listing page and return the newest AverageMarketCapitalization
    XLSX link (by period-end date in the filename)."""
    try:
        req = Request(LISTING_URL, headers=HEADERS)
        with urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as e:
        print(f"  ! listing page fetch failed: {e}", file=sys.stderr)
        return None
    links = re.findall(
        r'href=["\']([^"\']*AverageMarketCapitalization[^"\']*\.xlsx)["\']',
        html,
        re.I,
    )
    links = list(dict.fromkeys(links))  # de-dupe, keep order
    if not links:
        return None
    newest = max(links, key=_file_date)
    return newest


def download_xlsx(url: str) -> bytes:
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=60) as r:
        return r.read()


def parse_categorization(data: bytes) -> list[tuple[str, str | None, str]]:
    """Parse (nse_symbol, isin, category_enum) rows from the AMFI XLSX. Skips
    rows without an NSE symbol or a recognised category."""
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)

    # Locate the header row (has "NSE Symbol" and a "Categorization…" column).
    header: list[str] | None = None
    for raw in rows_iter:
        cells = [str(c).strip() if c is not None else "" for c in raw]
        low = [c.lower() for c in cells]
        if any("nse symbol" in c for c in low) and any("categoriz" in c for c in low):
            header = low
            break
    if header is None:
        raise SystemExit("Could not find header row (NSE Symbol / Categorization) in XLSX.")

    def col(pred) -> int | None:
        for i, h in enumerate(header):
            if pred(h):
                return i
        return None

    i_sym = col(lambda h: "nse symbol" in h)
    i_isin = col(lambda h: h == "isin" or h.startswith("isin"))
    i_cat = col(lambda h: "categoriz" in h)
    if i_sym is None or i_cat is None:
        raise SystemExit("XLSX missing NSE Symbol or Categorization column.")

    out: list[tuple[str, str | None, str]] = []
    for raw in rows_iter:
        cells = [str(c).strip() if c is not None else "" for c in raw]
        if len(cells) <= max(i_sym, i_cat):
            continue
        sym = cells[i_sym].strip().upper()
        cat_raw = cells[i_cat].strip().lower()
        cat = CATEGORY_MAP.get(cat_raw)
        if not sym or not cat:
            continue
        isin = (cells[i_isin].strip().upper() if i_isin is not None and i_isin < len(cells) else "") or None
        out.append((sym, isin, cat))
    return out


def apply_categories(
    conn: psycopg.Connection, rows: list[tuple[str, str | None, str]]
) -> tuple[int, int]:
    """UPDATE app.universe.market_cap_category by symbol, ISIN fallback.
    Returns (matched_by_symbol, matched_by_isin)."""
    by_sym = 0
    by_isin = 0
    with conn.cursor() as cur:
        for sym, isin, cat in rows:
            cur.execute(
                "UPDATE app.universe SET market_cap_category = %s WHERE symbol = %s",
                (cat, sym),
            )
            if cur.rowcount:
                by_sym += cur.rowcount
                continue
            if isin:
                cur.execute(
                    """UPDATE app.universe SET market_cap_category = %s
                       WHERE isin = %s AND (market_cap_category IS DISTINCT FROM %s)""",
                    (cat, isin, cat),
                )
                if cur.rowcount:
                    by_isin += cur.rowcount
    return by_sym, by_isin


def main() -> None:
    p = argparse.ArgumentParser(description="Populate app.universe.market_cap_category from AMFI.")
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env / .env.local)")
    p.add_argument("--xlsx-url", help="Skip discovery; download this XLSX directly")
    p.add_argument("--dry-run", action="store_true", help="Parse and report; do not write")
    args = p.parse_args()

    xlsx_url = args.xlsx_url or discover_xlsx_url()
    if not xlsx_url:
        raise SystemExit("Could not discover AMFI categorisation XLSX — check the listing page.")
    print(f"Source: {xlsx_url}")

    data = download_xlsx(xlsx_url)
    rows = parse_categorization(data)
    if not rows:
        raise SystemExit("Parsed 0 categorised rows — aborting (bad file or schema change).")

    dist: dict[str, int] = {}
    for _, _, cat in rows:
        dist[cat] = dist.get(cat, 0) + 1
    print(f"Parsed {len(rows)} categorised NSE names: " +
          ", ".join(f"{k}={v}" for k, v in sorted(dist.items())))

    if args.dry_run:
        print("Dry run — no writes.")
        return

    url = args.url or env_url("APP_DB_URL", required=True)
    with psycopg.connect(url) as conn:
        by_sym, by_isin = apply_categories(conn, rows)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT market_cap_category, count(*) FROM app.universe GROUP BY 1 ORDER BY 1"
            )
            after = cur.fetchall()

    print(f"Updated: {by_sym} by symbol, {by_isin} by ISIN fallback "
          f"({len(rows) - by_sym - by_isin} unmatched in universe).")
    print("universe.market_cap_category now: " +
          ", ".join(f"{c or 'NULL'}={n}" for c, n in after))


if __name__ == "__main__":
    main()
