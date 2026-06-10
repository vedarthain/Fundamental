#!/usr/bin/env python3
"""
fetch-announcements.py — per-stock corporate announcements from BSE (FREE).

Populates app.announcement with the "Announcements" feed (SEBI disclosures,
newspaper publications, investor presentations, board outcomes, general
updates). BSE's public API responds to server fetches where NSE's /api/ 403s
behind anti-bot. We map NSE symbol → BSE scrip code via ISIN (BSE scrip master
⋈ app.universe.isin) — the same mapping the BSE corporate-actions fetcher uses.

Because it's free, this runs DAILY for the whole universe and spends zero
indianapi quota (which we reserve for corporate actions).

ENDPOINT (GET, browser headers + bseindia Referer):
  /api/AnnSubCategoryGetData/w?strScrip=CODE&strPrevDate=YYYYMMDD&
    strToDate=YYYYMMDD&strCat=-1&strType=C&strSearch=P&pageno=1
  → {"Table":[{NEWSID, NEWSSUB, NEWS_DT, CATEGORYNAME, HEADLINE,
               ATTACHMENTNAME, ...}]}

We keep a rolling KEEP_DAYS window; each run fetches the last FETCH_DAYS and
upserts on NEWSID (so history accumulates beyond a single fetch window).

USAGE:
  etl/.venv/bin/python scripts/fetch-announcements.py            # full universe
  etl/.venv/bin/python scripts/fetch-announcements.py --limit 30 # sample
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg

REPO = Path(__file__).resolve().parent.parent

# How far back each run asks BSE for, and how long we retain rows.
FETCH_DAYS = 30
KEEP_DAYS = 180
# Cap rows per symbol per run so a chatty filer can't bloat the table.
MAX_PER_SYMBOL = 40

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
ANN_URL = ("https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
           "?pageno=1&strCat=-1&strSearch=P&strType=C"
           "&strScrip={code}&strPrevDate={frm}&strToDate={to}")
# Known-good public link form for the filing PDF.
PDF_BASE = "https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname={name}"


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


def get_json(url: str, timeout: int = 15):
    req = Request(url, headers=HEADERS)
    with urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8", "replace"))


def parse_dt(s: str):
    """BSE NEWS_DT is ISO-ish, e.g. '2026-06-08T22:12:24.38'."""
    s = (s or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
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


def build_rows(sym: str, code: str, table: list) -> list[tuple]:
    """→ list of (id, symbol, title, category, headline, published_at, pdf_url, bse_code)."""
    out: list[tuple] = []
    for r in table[:MAX_PER_SYMBOL]:
        nid = str(r.get("NEWSID") or "").strip()
        title = (r.get("NEWSSUB") or "").strip()
        if not nid or not title:
            continue
        dt = parse_dt(r.get("NEWS_DT") or r.get("DT_TM") or "")
        attach = (r.get("ATTACHMENTNAME") or "").strip()
        pdf = PDF_BASE.format(name=attach) if attach else None
        headline = (r.get("HEADLINE") or "").strip() or None
        category = (r.get("CATEGORYNAME") or "").strip() or None
        out.append((nid, sym, title[:400], category, headline, dt, pdf, code))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch corporate announcements from BSE.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    ap.add_argument("--limit", type=int, help="Only first N mapped symbols (testing)")
    ap.add_argument("--throttle", type=float, default=0.4, help="Seconds between BSE calls")
    ap.add_argument("--max-minutes", type=float, default=None,
                    help="Stop cleanly after this many minutes (resumable next run)")
    args = ap.parse_args()

    url = args.url or env_url("APP_DB_URL")
    today = datetime.now(timezone.utc).date()
    frm = (today - timedelta(days=FETCH_DAYS)).strftime("%Y%m%d")
    to = today.strftime("%Y%m%d")

    print("Loading BSE scrip master (ISIN → code)…", file=sys.stderr)
    isin_to_code = build_isin_to_code()
    print(f"  {len(isin_to_code)} active BSE equity scrips", file=sys.stderr)

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Least-recently-fetched first (never-fetched → NULLS FIRST), so a
            # timed-out run or re-run continues instead of restarting at "A".
            # Symbols whose fetch errored aren't marked, so they stay high
            # priority and get retried first next run.
            cur.execute(
                """
                SELECT u.symbol, u.isin
                  FROM app.universe u
                  LEFT JOIN app.announcement_fetch f ON f.symbol = u.symbol
                 WHERE u.is_active AND u.isin IS NOT NULL
                 ORDER BY f.fetched_at ASC NULLS FIRST, u.symbol
                """
            )
            universe = cur.fetchall()
        if args.limit:
            universe = universe[: args.limit]

        mapped = [(sym, isin_to_code[isin.upper()]) for sym, isin in universe
                  if isin and isin.upper() in isin_to_code]
        print(f"Mapped {len(mapped)}/{len(universe)} symbols to BSE codes "
              f"· window {frm}–{to}", file=sys.stderr)

        start = time.monotonic()
        total, ok = 0, 0
        for i, (sym, code) in enumerate(mapped, 1):
            if args.max_minutes and (time.monotonic() - start) / 60 >= args.max_minutes:
                print(f"  ⏱ {args.max_minutes:.0f}m budget reached at {i-1}/{len(mapped)} "
                      f"— stopping cleanly (resumes next run).", file=sys.stderr)
                break
            try:
                # Short per-call timeout: a slow/hanging BSE response otherwise
                # burns 15s each and balloons the run past the job timeout.
                data = get_json(ANN_URL.format(code=code, frm=frm, to=to), timeout=8)
            except (HTTPError, URLError, TimeoutError, ValueError) as e:
                # Don't mark fetched — leave it high-priority for next run.
                print(f"  ! {sym} ({code}): {type(e).__name__}", file=sys.stderr)
                time.sleep(args.throttle)
                continue
            table = data.get("Table", []) if isinstance(data, dict) else []
            rows = build_rows(sym, code, table)
            with conn.cursor() as cur:
                if rows:
                    cur.executemany(
                        """
                        INSERT INTO app.announcement
                          (id, symbol, title, category, headline, published_at,
                           pdf_url, bse_code, source, fetched_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'bse', now())
                        ON CONFLICT (id) DO UPDATE SET
                          title        = EXCLUDED.title,
                          category     = EXCLUDED.category,
                          headline     = EXCLUDED.headline,
                          published_at = EXCLUDED.published_at,
                          pdf_url      = EXCLUDED.pdf_url,
                          fetched_at   = now()
                        """,
                        rows,
                    )
                # Mark fetched regardless of whether rows resulted, so the
                # resumable ordering advances past empty-history stocks too.
                cur.execute(
                    "INSERT INTO app.announcement_fetch (symbol, fetched_at) "
                    "VALUES (%s, now()) ON CONFLICT (symbol) DO UPDATE SET fetched_at = now()",
                    (sym,),
                )
            conn.commit()
            if rows:
                total += len(rows)
                ok += 1
            if i % 100 == 0:
                print(f"  …{i}/{len(mapped)} symbols, {total} announcements", file=sys.stderr)
            time.sleep(args.throttle)

        # Prune old rows so the table stays a rolling window.
        cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM app.announcement WHERE published_at < %s", (cutoff,))
        conn.commit()

    print(f"Done — {total} announcements across {ok} symbols (of {len(mapped)} mapped).")


if __name__ == "__main__":
    main()
