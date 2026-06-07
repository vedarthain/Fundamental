#!/usr/bin/env python3
"""
fetch-corporate-actions.py — populate app.corporate_action from BSE.

WHY BSE: it responds reliably to server fetches (dividends/splits/bonus/rights/
buybacks by scrip code) where NSE's dynamic /api/ 403s behind its anti-bot
wall. We map our NSE symbols → BSE scrip codes via ISIN, using BSE's own scrip
master ⋈ app.universe.isin.

ENDPOINTS (all GET, browser headers + bseindia Referer):
  - scrip master : /api/ListofScripData/w?...segment=Equity&status=Active
                   → [{SCRIP_CD, ISIN_NUMBER, scrip_id, ...}]  (ISIN → code map)
  - per-stock CA : /api/CorporateAction/w?scripcode=CODE
                   → {"Table":[{purpose_name, BCRD_from, Amount}]}

USAGE:
  # Local (default APP_DB_URL from .env.local):
  etl/.venv/bin/python scripts/fetch-corporate-actions.py
  # A sample while testing:
  etl/.venv/bin/python scripts/fetch-corporate-actions.py --limit 30
  # Explicit DB:
  etl/.venv/bin/python scripts/fetch-corporate-actions.py --url "$URL"

Actions change infrequently, so a weekly cron is plenty (its own workflow,
off the price critical path).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg

REPO = Path(__file__).resolve().parent.parent

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
    "Accept-Language": "en-US,en;q=0.9",
}
SCRIP_MASTER = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
                "?Group=&Scripcode=&industry=&segment=Equity&status=Active")
CA_URL = "https://api.bseindia.com/BseIndiaAPI/api/CorporateAction/w?scripcode={code}"


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


def get_json(url: str, timeout: int = 12):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8", "replace"))


def normalise_type(purpose: str) -> str:
    p = (purpose or "").lower()
    if "dividend" in p:                      return "dividend"
    if "split" in p:                         return "split"
    if "bonus" in p:                         return "bonus"
    if "right" in p:                         return "rights"
    if "buy" in p and "back" in p:           return "buyback"
    return "other"


def parse_date(s: str):
    """BSE BCRD_from is like '05 Jun 2026'."""
    for fmt in ("%d %b %Y", "%d-%b-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


def build_isin_to_code() -> dict[str, str]:
    """ISIN → BSE scrip code from the active-equity scrip master."""
    data = get_json(SCRIP_MASTER, timeout=45)  # ~1.7 MB download
    out: dict[str, str] = {}
    for row in data:
        isin = (row.get("ISIN_NUMBER") or "").strip().upper()
        code = str(row.get("SCRIP_CD") or "").strip()
        if isin and code:
            out[isin] = code
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch corporate actions from BSE.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    ap.add_argument("--limit", type=int, help="Only process the first N symbols (testing)")
    ap.add_argument("--throttle", type=float, default=0.4, help="Seconds between BSE calls")
    args = ap.parse_args()

    url = args.url or env_url("APP_DB_URL")

    print("Loading BSE scrip master (ISIN → code)…", file=sys.stderr)
    isin_to_code = build_isin_to_code()
    print(f"  {len(isin_to_code)} active BSE equity scrips", file=sys.stderr)

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT symbol, isin FROM app.universe "
                "WHERE is_active AND isin IS NOT NULL ORDER BY symbol"
            )
            universe = cur.fetchall()
        if args.limit:
            universe = universe[: args.limit]

        mapped = [(sym, isin_to_code[isin.upper()]) for sym, isin in universe
                  if isin and isin.upper() in isin_to_code]
        print(f"Mapped {len(mapped)}/{len(universe)} symbols to BSE codes", file=sys.stderr)

        total_actions = 0
        ok = 0
        for i, (sym, code) in enumerate(mapped, 1):
            try:
                data = get_json(CA_URL.format(code=code))
            except (HTTPError, URLError, TimeoutError) as e:
                print(f"  ! {sym} ({code}): {type(e).__name__}", file=sys.stderr)
                continue
            rows = data.get("Table", []) if isinstance(data, dict) else []
            actions = []
            for r in rows:
                purpose = (r.get("purpose_name") or "").strip()
                ex = parse_date(r.get("BCRD_from") or "")
                if not purpose or ex is None:
                    continue
                amount = r.get("Amount")
                actions.append((sym, normalise_type(purpose), ex, purpose,
                                amount if isinstance(amount, (int, float)) else None,
                                json.dumps(r), code))
            if actions:
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO app.corporate_action
                          (symbol, action_type, ex_date, purpose, amount, details, bse_code, fetched_at)
                        VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s, now())
                        ON CONFLICT (symbol, ex_date, purpose) DO UPDATE SET
                          action_type = EXCLUDED.action_type,
                          amount      = EXCLUDED.amount,
                          details     = EXCLUDED.details,
                          bse_code    = EXCLUDED.bse_code,
                          fetched_at  = now()
                        """,
                        actions,
                    )
                conn.commit()
                total_actions += len(actions)
                ok += 1
            if i % 100 == 0:
                print(f"  …{i}/{len(mapped)} symbols, {total_actions} actions", file=sys.stderr)
            time.sleep(args.throttle)

    print(f"Done — {total_actions} actions across {ok} symbols "
          f"(of {len(mapped)} mapped).")


if __name__ == "__main__":
    main()
