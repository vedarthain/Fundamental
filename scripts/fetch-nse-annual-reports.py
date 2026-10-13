#!/usr/bin/env python3
"""
fetch-nse-annual-reports.py — annual-report filings from NSE (FREE).

WHY THIS EXISTS, given fetch-announcements.py already pulls filings
---------------------------------------------------------------------
fetch-announcements.py maps NSE symbol → BSE scrip code via ISIN and reads
BSE's feed. A company listed only on NSE has no BSE scrip code, so it is not
in BSE's scrip master, so that script cannot see it at all — not as an error,
simply as an absence. Measured 2026-10-12: 608 active symbols with an ISIN are
absent from BSE's active-equity master, and every one of them therefore had
zero annual-report filings on record and no company overview, because
build-overview-from-filing.mjs reads annual-report PDFs out of
app.announcement.

They are reachable: 48 of a random 50 of those 608 have annual reports on
NSE's own filings API.

So this is a second SOURCE for one row type, not a second copy of the feed.
It writes annual reports only, with source='nse', into the same table, and
build-overview-from-filing.mjs picks them up with no change — it filters on
`title ILIKE '%annual report%' AND pdf_url IS NOT NULL`, which these satisfy.

ENDPOINT (GET, browser headers + cookie jar):
  www.nseindia.com/api/annual-reports?index={equities|sme}&symbol=SYM
  → {"data":[{fromYr, toYr, broadcast_dttm, fileName, attFileSize, ...}]}

THREE THINGS THAT ARE NOT OBVIOUS, ALL MEASURED
-----------------------------------------------
1. BOTH index VALUES ARE REQUIRED, and the wrong one fails silently. Of the 48
   symbols above, 39 answered only on index=sme; on index=equities they return
   HTTP 200 with an empty list — indistinguishable from "this company has never
   filed". Trying only `equities` (the obvious choice for an equity symbol)
   would have found 9 of 48 and reported the rest as genuinely absent.

2. WARMUP MUST HIT A DEEP PAGE. GET / returns 403; the corporate-filings
   annual-reports page returns 200 and sets the three cookies the API checks.
   Priming on the homepage, which is the usual recipe, gets an empty cookie jar
   and then empty API results — again, a silent zero rather than an error.

3. THE BLOCK IS ENDPOINT-SPECIFIC, NOT IP-LEVEL. /api/quote-equity 403s from
   the same session that reads /api/annual-reports fine (docs/DATA_CONTRACTS.md
   line 80). So a 403 here is not evidence of being bot-walled generally, and
   routing around it is the wrong instinct.

The PDF host (nsearchives.nseindia.com) serves the file to a plain curl with
any Referer — verified against both a mainboard and an SME report — so
build-overview-from-filing.mjs needs no change to download these.

USAGE:
  etl/.venv/bin/python scripts/fetch-nse-annual-reports.py --missing 10
  etl/.venv/bin/python scripts/fetch-nse-annual-reports.py --symbols SAKAR,RILINFRA
  etl/.venv/bin/python scripts/fetch-nse-annual-reports.py          # all NSE-only
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import psycopg

REPO = Path(__file__).resolve().parent.parent

# The page whose cookies the API accepts. NOT the homepage — see note 2 above.
WARMUP = "https://www.nseindia.com/companies-listing/corporate-filings-annual-reports"
API = "https://www.nseindia.com/api/annual-reports?index={index}&symbol={symbol}"
# Order matters only for call count, not correctness: most NSE-only names in
# this universe are Emerge listings, so `sme` first would halve the requests.
# `equities` stays first because a mainboard symbol answering on `sme` would be
# the surprising case, and surprising cases are better found early than hidden
# by a lucky ordering.
INDEXES = ("equities", "sme")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    # Ask for no compression. The cost is bandwidth on a ~2 KB JSON; the
    # alternative is hand-rolling gzip detection for a body this small.
    "Accept-Encoding": "identity",
    "Referer": WARMUP,
}

# Keep only reports inside the consumer's window. build-overview-from-filing.mjs
# looks back 15 months, so an older report is a row nothing will ever read —
# and because fetch-announcements.py exempts annual reports from its KEEP_DAYS
# prune (it has to, or it would delete its own catch-up), an unbounded insert
# here would accumulate in a table that nothing evicts. That is §5 of CLAUDE.md
# exactly: data that gets seeded and then nothing maintains it. 480 days gives
# the consumer's 15 months a few weeks of slack.
KEEP_DAYS = 480


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


def make_session():
    """Opener with a primed cookie jar. Raises if the warmup gave us nothing —
    an unprimed session does not error, it returns empty lists forever."""
    cj = http.cookiejar.CookieJar()
    op = build_opener(HTTPCookieProcessor(cj))
    with op.open(Request(WARMUP, headers=HEADERS), timeout=30) as r:
        r.read()
    if len(cj) == 0:
        raise SystemExit(
            "ABORT: NSE warmup set no cookies. Every API call would return an "
            "empty list with HTTP 200, and the run would finish green having "
            "found nothing. Check whether the warmup URL still exists."
        )
    return op


def get_reports(op, symbol: str) -> list[dict]:
    """Annual reports for `symbol`, trying each index until one answers."""
    for index in INDEXES:
        req = Request(API.format(index=index, symbol=symbol), headers=HEADERS)
        with op.open(req, timeout=25) as r:
            body = json.loads(r.read())
        rows = body.get("data", []) if isinstance(body, dict) else body
        if rows:
            return rows
    return []


def parse_dttm(s: str):
    """NSE broadcast_dttm is '27-AUG-2026 13:27:04', in IST with no offset."""
    s = (s or "").strip()
    for fmt in ("%d-%b-%Y %H:%M:%S", "%d-%B-%Y %H:%M:%S"):
        try:
            naive = datetime.strptime(s.title(), fmt)
        except ValueError:
            continue
        return naive.replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
    return None


def build_rows(symbol: str, reports: list[dict], cutoff) -> list[tuple]:
    """→ list of (id, symbol, title, category, subcategory, headline,
                  published_at, pdf_url, bse_code).

    Tuple order is load-bearing: it must match the INSERT column list in
    main() position for position, the same contract as build_rows() in
    fetch-announcements.py. psycopg binds positionally and will cheerfully
    write a pdf_url into headline if the two drift.
    """
    out: list[tuple] = []
    for r in reports:
        url = (r.get("fileName") or "").strip()
        if not url:
            continue
        dt = parse_dttm(r.get("broadcast_dttm") or r.get("disseminationDateTime") or "")
        if dt is None or dt < cutoff:
            continue
        # The archive filename is NSE's own unique handle for the filing
        # (AR_30702_SAKAR_2025_2026_A_18392815_27082026132704). Prefixed with
        # the source so it can never collide with a BSE NEWSID, and stable
        # across runs so the ON CONFLICT upserts rather than duplicating.
        # app.company_overview.source_filing_id is a FK onto this id, so an
        # unstable id would orphan overviews on every run.
        nid = "nse:" + url.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        fy_from, fy_to = (r.get("fromYr") or "").strip(), (r.get("toYr") or "").strip()
        span = f" {fy_from}-{fy_to}" if fy_from and fy_to else ""
        # The literal words "Annual Report" are REQUIRED, not cosmetic. Both
        # the overview builder's query and fetch-announcements.py's prune
        # exemption match on `title ILIKE '%annual report%'`. Rename this and
        # the rows become invisible to the consumer and then get deleted.
        title = f"Annual Report{span}"
        out.append((nid, symbol, title, "Annual Report", "Annual Report",
                    (r.get("companyName") or "").strip() or None, dt, url, None))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch annual reports from NSE.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    ap.add_argument("--symbols", help="Comma-separated symbols only")
    ap.add_argument("--missing", type=int, help="Only first N symbols still lacking a report")
    ap.add_argument("--throttle", type=float, default=0.4, help="Seconds between NSE calls")
    ap.add_argument("--dry-run", action="store_true", help="Fetch and report, write nothing")
    args = ap.parse_args()

    url = args.url or env_url("APP_DB_URL")
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)

    with psycopg.connect(url) as conn:
        if args.symbols:
            symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        else:
            with conn.cursor() as cur:
                # Symbols with no annual report on record from ANY source.
                # Deliberately not "symbols absent from BSE's master": that
                # would need the 1.7 MB scrip master downloaded here purely to
                # exclude symbols BSE already covered, and a BSE-listed company
                # whose filing BSE somehow missed is still worth asking NSE for.
                # The condition is the absence being fixed, not a proxy for it.
                cur.execute(
                    """
                    SELECT u.symbol
                      FROM app.universe u
                     WHERE u.is_active
                       AND NOT EXISTS (
                             SELECT 1 FROM app.announcement a
                              WHERE a.symbol = u.symbol
                                AND a.title ILIKE '%annual report%')
                     ORDER BY u.symbol
                    """
                )
                symbols = [r[0] for r in cur.fetchall()]
            if args.missing:
                symbols = symbols[: args.missing]

        print(f"{len(symbols)} symbols to ask NSE about", file=sys.stderr)
        op = make_session()

        # answered counts symbols for which NSE returned a NON-EMPTY report
        # list, BEFORE the KEEP_DAYS filter. It is the only counter that
        # distinguishes "the endpoint is talking to us" from "these companies
        # have filed recently", and the guard at the bottom depends on it.
        found, written, empty, errors, answered = 0, 0, 0, 0, 0
        for i, sym in enumerate(symbols, 1):
            try:
                reports = get_reports(op, sym)
            except (HTTPError, URLError, TimeoutError, ValueError) as e:
                errors += 1
                print(f"  ! {sym}: {type(e).__name__}", file=sys.stderr)
                time.sleep(args.throttle)
                continue
            if reports:
                answered += 1
            rows = build_rows(sym, reports, cutoff)
            if not rows:
                empty += 1
                print(f"  - {sym}: {len(reports)} reports, none inside {KEEP_DAYS}d",
                      file=sys.stderr)
            else:
                found += 1
                newest = max(r[6] for r in rows)
                print(f"  ✓ {sym}: {len(rows)} report(s), newest {newest:%Y-%m-%d}",
                      file=sys.stderr)
                if not args.dry_run:
                    with conn.cursor() as cur:
                        cur.executemany(
                            """
                            INSERT INTO app.announcement
                              (id, symbol, title, category, subcategory, headline,
                               published_at, pdf_url, bse_code, source, fetched_at)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'nse', now())
                            ON CONFLICT (id) DO UPDATE SET
                              title        = EXCLUDED.title,
                              category     = EXCLUDED.category,
                              subcategory  = EXCLUDED.subcategory,
                              headline     = EXCLUDED.headline,
                              published_at = EXCLUDED.published_at,
                              pdf_url      = EXCLUDED.pdf_url,
                              fetched_at   = now()
                            """,
                            rows,
                        )
                    conn.commit()
                    written += len(rows)
            time.sleep(args.throttle)

    print(f"Done — {found}/{len(symbols)} symbols had a report inside {KEEP_DAYS}d "
          f"· {answered} answered with at least one report of any age "
          f"· {written} rows written · {empty} empty · {errors} errored.")

    # A run where EVERY symbol came back empty is the signature of a dead
    # session or a changed index parameter, not of a universe that has stopped
    # filing. make_session() catches the no-cookie case; this catches the
    # subtler one where cookies exist but the endpoint has moved on. Loud,
    # because the alternative is a green run that found nothing — the exact
    # failure shape this whole gap was hiding behind for months.
    #
    # THE CONDITION IS `answered`, NOT `found`, AND THE DIFFERENCE IS THE WHOLE
    # POINT. It was `found` until 2026-10-13, which counts symbols with a report
    # inside KEEP_DAYS — so a batch of companies whose newest filing is simply
    # old tripped the alarm. Measured that day on 100 symbols with no annual
    # report on file: it aborted with "0 returned an annual report", in a run
    # whose own log showed MADHAVBAUG returning 3 and MEP returning 9. NSE was
    # answering correctly; those companies just file late.
    #
    # That is this script's own stated failure mode turned on itself — a check
    # that cannot tell a broken instrument from a real absence, which is exactly
    # what it exists to prevent. `answered` is pre-filter, so it moves only when
    # NSE genuinely says nothing for everyone. A targeted --symbols backfill of
    # late filers is now a clean exit, and a dead cookie is still a loud one.
    if symbols and answered == 0 and errors == 0:
        raise SystemExit(
            f"ABORT: NSE returned an empty report list for all {len(symbols)} "
            f"symbols and nothing errored — not one report of any age. Verify "
            f"the API by hand before trusting this: a silent empty list is how "
            f"NSE reports a wrong `index` value or an unprimed cookie jar."
        )


if __name__ == "__main__":
    main()
