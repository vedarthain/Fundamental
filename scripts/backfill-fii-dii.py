#!/usr/bin/env python3
"""
backfill-fii-dii.py — One-off historical backfill for app.fii_dii_flow.

WHY THIS EXISTS:
  The live fetch-fii-dii.py only ingests TODAY (NSE's /api/fiidiiTradeReact
  doesn't accept a date param). On a fresh deploy that means the FII/DII
  chart shows a single bar until the daily action accumulates a week of
  history. This script pulls the last ~30 sessions from Moneycontrol's
  daily activity page in one shot so the chart is useful from day one.

SOURCE:
  https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php

  Moneycontrol aggregates NSE-published FII/DII numbers. The HTML table
  has been stable for years and lists ~30 sessions in descending date
  order. Numbers match NSE's official figures within rounding.

  Rows we tag as source='moneycontrol' so we can tell backfilled rows
  apart from the live-API-sourced ones in audit queries.

USAGE:
  etl/.venv/bin/python scripts/backfill-fii-dii.py

  # Custom limit (default: ingest everything the page returns):
  etl/.venv/bin/python scripts/backfill-fii-dii.py --max-rows 10

  # Target prod Neon:
  etl/.venv/bin/python scripts/backfill-fii-dii.py --url "$PROD_URL"

COST (Rule #1): one HTTP GET + N tiny upserts. Free.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


URL = "https://www.moneycontrol.com/markets/fii-dii-data/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
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


def fetch_page() -> str:
    req = Request(URL, headers=HEADERS)
    with urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def _f(token) -> float | None:
    """Parse a Moneycontrol number cell — comma-grouped, occasional dash."""
    if token is None or token == "":
        return None
    if isinstance(token, (int, float)):
        return float(token)
    s = str(token).replace(",", "").replace("\xa0", "").strip()
    if not s or s in {"-", "--"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(token: str) -> date | None:
    """Moneycontrol embeds ISO ('2026-05-26') in the JSON, but historical
    rows occasionally fall back to 'DD-Mon-YYYY'.  Accept both."""
    s = token.strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_next_data(html_text: str) -> list[dict]:
    """Moneycontrol's /markets/fii-dii-data/ is a Next.js page; the daily
    data lives in the __NEXT_DATA__ <script> blob as JSON.  This is more
    reliable than scraping rendered HTML — the JSON shape has been stable
    across Moneycontrol's frontend re-skins.

    Fields we use:
       date    — YYYY-MM-DD
       fiiCM   — FII Cash Market NET, ₹ Cr (string with commas)
       diiCM   — DII Cash Market NET, ₹ Cr

    Moneycontrol only ships NET (no buy/sell breakdown), so those columns
    end up NULL on backfilled rows. The live API path still populates
    them when daily fetch-fii-dii.py runs.
    """
    m = re.search(r'__NEXT_DATA__"[^>]*>(\{.*?\})</script>', html_text, re.DOTALL)
    if not m:
        return []
    try:
        payload = json.loads(m.group(1))
    except ValueError:
        return []
    block = (
        payload.get("props", {})
        .get("pageProps", {})
        .get("FiiDiiData", {})
        .get("fiiDiiData")
    )
    if not isinstance(block, list):
        return []
    out: list[dict] = []
    for row in block:
        if not isinstance(row, dict):
            continue
        d = _parse_date(row.get("date", ""))
        if d is None:
            continue
        fii_net = _f(row.get("fiiCM"))
        dii_net = _f(row.get("diiCM"))
        if fii_net is None and dii_net is None:
            continue
        out.append({
            "date":     d,
            "fii_buy":  None,
            "fii_sell": None,
            "fii_net":  fii_net,
            "dii_buy":  None,
            "dii_sell": None,
            "dii_net":  dii_net,
        })
    return out


def upsert(conn: psycopg.Connection, rows: list[dict], source: str) -> int:
    written = 0
    with conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO app.fii_dii_flow
                  (date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (date) DO UPDATE SET
                  fii_buy  = COALESCE(EXCLUDED.fii_buy,  app.fii_dii_flow.fii_buy),
                  fii_sell = COALESCE(EXCLUDED.fii_sell, app.fii_dii_flow.fii_sell),
                  fii_net  = COALESCE(EXCLUDED.fii_net,  app.fii_dii_flow.fii_net),
                  dii_buy  = COALESCE(EXCLUDED.dii_buy,  app.fii_dii_flow.dii_buy),
                  dii_sell = COALESCE(EXCLUDED.dii_sell, app.fii_dii_flow.dii_sell),
                  dii_net  = COALESCE(EXCLUDED.dii_net,  app.fii_dii_flow.dii_net),
                  source   = CASE
                               WHEN app.fii_dii_flow.source = 'nse_api' THEN app.fii_dii_flow.source
                               ELSE EXCLUDED.source
                             END,
                  fetched_at = now()
            """, (
                r["date"],
                r["fii_buy"], r["fii_sell"], r["fii_net"],
                r["dii_buy"], r["dii_sell"], r["dii_net"],
                source,
            ))
            written += 1
    return written


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--max-rows", type=int, default=None,
                   help="Cap the number of historical rows to ingest "
                        "(default: ingest everything Moneycontrol returns).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    url = args.url or env_url("APP_DB_URL", required=True)
    assert url is not None

    print(f"fetching {URL}")
    try:
        html_text = fetch_page()
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        raise SystemExit(f"fetch failed: {e}")

    rows = parse_next_data(html_text)
    if args.max_rows:
        rows = rows[: args.max_rows]
    if not rows:
        raise SystemExit(
            "parsed 0 rows — Moneycontrol may have changed their layout. "
            "Inspect the page manually and update parse_table()."
        )
    print(f"parsed {len(rows)} rows (oldest {rows[-1]['date']}, newest {rows[0]['date']})")

    with psycopg.connect(url) as conn:
        written = upsert(conn, rows, source="moneycontrol")
        conn.commit()
    print(f"upserted {written} rows.")


if __name__ == "__main__":
    main()
