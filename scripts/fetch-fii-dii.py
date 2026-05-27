#!/usr/bin/env python3
"""
fetch-fii-dii.py — Daily FII / DII cash-market flow ingest.

Pulls NSE's daily FII/DII (Foreign / Domestic Institutional Investor) net
flow numbers and upserts into app.fii_dii_flow. These two figures are
the single most-discussed daily indicator in Indian financial media;
giving them a home unblocks the "FII/DII trend" card on /market.

Source endpoints, in fallback order:
  1. https://www.nseindia.com/api/fiidiiTradeReact   (live JSON, today only)
  2. https://nsearchives.nseindia.com/content/equities/fii_stats_DDMMYYYY.xls
     (historical XLS — used when backfilling)

The XLS path is XML-based "spreadsheetML" but NSE has shipped both .xls
and .csv variants over time; we accept either if present. For a fresh
daily ingest the JSON endpoint is enough.

Numbers are stored in ₹ CRORES to match the NSE display surface.

USAGE:
  # Today's flow:
  etl/.venv/bin/python scripts/fetch-fii-dii.py

  # Specific date (only the live API path works for "today"; older dates
  # need the historical XLS archive):
  etl/.venv/bin/python scripts/fetch-fii-dii.py --date 2026-05-23

  # Against prod:
  etl/.venv/bin/python scripts/fetch-fii-dii.py --url "$PROD_URL"

Cost (Rule #1): one tiny upsert per day. Free.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


# ----------------------- Config -------------------------------------------

# NSE live JSON. Requires a couple of warmup cookies to be set; we do that
# by hitting the human-facing page first and re-using the cookie jar.
NSE_HOME = "https://www.nseindia.com/"
NSE_FII_DII = "https://www.nseindia.com/api/fiidiiTradeReact"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/reports/fii-dii",
}


# ----------------------- Helpers ------------------------------------------

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


def _fetch_with_cookies(url: str, cookies: dict[str, str]) -> bytes:
    """GET `url` carrying the cookies. Returns body bytes."""
    headers = dict(HEADERS)
    if cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as r:
        return r.read()


def _warmup_cookies() -> dict[str, str]:
    """Hit the NSE home page to receive the session cookies their API
    requires. Returns a dict of {name: value} to send on subsequent calls."""
    req = Request(NSE_HOME, headers=HEADERS)
    try:
        with urlopen(req, timeout=15) as r:
            raw = r.headers.get_all("Set-Cookie") or []
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        print(f"  warmup failed: {e}", file=sys.stderr)
        return {}
    out: dict[str, str] = {}
    for sc in raw:
        # Set-Cookie header looks like: "name=value; Path=/; HttpOnly"
        first = sc.split(";", 1)[0]
        if "=" in first:
            k, v = first.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def fetch_today_json() -> list[dict] | None:
    """Fetch today's FII/DII JSON from the live NSE API.

    Returns the raw list (NSE returns a JSON array, two objects: one for
    FII, one for DII) or None on failure.
    """
    cookies = _warmup_cookies()
    try:
        body = _fetch_with_cookies(NSE_FII_DII, cookies)
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        print(f"  fetch failed: {e}", file=sys.stderr)
        return None
    try:
        data = json.loads(body.decode("utf-8", errors="replace"))
    except ValueError:
        print("  response wasn't JSON (NSE bot wall?)", file=sys.stderr)
        return None
    if not isinstance(data, list):
        print(f"  unexpected shape: {type(data).__name__}", file=sys.stderr)
        return None
    return data


def _f(v) -> float | None:
    """Parse a possibly-formatted number into a float, or None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace(" ", "").strip()
    if not s or s in {"-", "--"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_nse_response(items: list[dict]) -> tuple[date, dict] | None:
    """Pull out (date, {fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net})
    from NSE's two-element JSON array.

    NSE returns objects with keys roughly: category (FII/DII or full name),
    date, buyValue, sellValue, netValue. Names have shifted historically;
    we look up by case-insensitive substring."""
    if not items:
        return None
    d_seen: date | None = None
    flows: dict[str, float | None] = {
        "fii_buy": None, "fii_sell": None, "fii_net": None,
        "dii_buy": None, "dii_sell": None, "dii_net": None,
    }
    for it in items:
        # Find the date (any key with 'date' in name).
        for k, v in it.items():
            if "date" in k.lower() and isinstance(v, str):
                try:
                    d_seen = datetime.strptime(v.strip(), "%d-%b-%Y").date()
                except ValueError:
                    try:
                        d_seen = datetime.strptime(v.strip(), "%Y-%m-%d").date()
                    except ValueError:
                        pass
                break
        category = ""
        for k, v in it.items():
            if "category" in k.lower():
                category = str(v).upper()
                break
        prefix = None
        if "FII" in category or "FPI" in category or "FOREIGN" in category:
            prefix = "fii"
        elif "DII" in category or "DOMESTIC" in category:
            prefix = "dii"
        if not prefix:
            continue
        buy = sell = net = None
        for k, v in it.items():
            kl = k.lower()
            if "buy" in kl and "value" in kl:
                buy = _f(v)
            elif "sell" in kl and "value" in kl:
                sell = _f(v)
            elif "net" in kl and "value" in kl:
                net = _f(v)
        # If net is missing, derive it.
        if net is None and buy is not None and sell is not None:
            net = buy - sell
        flows[f"{prefix}_buy"]  = buy
        flows[f"{prefix}_sell"] = sell
        flows[f"{prefix}_net"]  = net
    if d_seen is None:
        return None
    return d_seen, flows


def upsert(conn: psycopg.Connection, d: date, flows: dict, source: str) -> None:
    with conn.cursor() as cur:
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
              source   = EXCLUDED.source,
              fetched_at = now()
        """, (
            d,
            flows.get("fii_buy"), flows.get("fii_sell"), flows.get("fii_net"),
            flows.get("dii_buy"), flows.get("dii_sell"), flows.get("dii_net"),
            source,
        ))


# ----------------------- CLI ----------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--date", help="Specific ISO date — only useful for "
                                  "overriding the date stamp on today's API "
                                  "fetch (the JSON API doesn't accept a date "
                                  "parameter; this lets you correct mismatches).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    url = args.url or env_url("APP_DB_URL", required=True)
    assert url is not None

    items = fetch_today_json()
    if not items:
        raise SystemExit("could not fetch FII/DII from NSE")
    parsed = parse_nse_response(items)
    if not parsed:
        raise SystemExit("could not parse FII/DII response")
    d, flows = parsed
    if args.date:
        d = datetime.strptime(args.date, "%Y-%m-%d").date()
    print(f"date={d}  flows={flows}")

    with psycopg.connect(url) as conn:
        upsert(conn, d, flows, source="nse_api")
        conn.commit()
    print("done.")


if __name__ == "__main__":
    main()
