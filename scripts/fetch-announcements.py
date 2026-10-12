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

CATCH-UP (why two windows, not one)
-----------------------------------
A FETCH_DAYS window only accumulates history for a symbol that was already
being fetched. A symbol that joins the mapped set today starts its history
today, and the annual report it filed four months ago is never asked for by
any future run — the window has already moved past it. Nothing backfills, so
the hole is permanent.

That is not hypothetical: sync-universe backfilling app.universe.isin from
EQUITY_L made ~443 symbols fetchable for the first time, and on 2026-10-12,
246 symbols had announcements but not one annual-report filing at any age.
Replaying the exact 30-day production window that *contained* their filing
returned it (AHLWEST 2026-05-26, ACGL 2026-06-29, AFIL 2026-07-11) — the
fetcher was never broken, it was simply never pointed at those days. That
matters downstream: build-overview-from-filing.mjs reads annual-report PDFs
from this table, so a missing filing is a company with no overview.

So the window is per-symbol: CATCHUP_DAYS for a symbol with no annual-report
row yet, FETCH_DAYS for everyone else. It is the same single API call either
way — a wider strPrevDate costs nothing extra — and it self-heals, because
the condition that widens the window is the absence the widening fixes. Once
a filing lands the symbol drops back to the 30-day window on the next run.

And KEEP_DAYS exempts annual reports, because pruning at 180 days would have
deleted every row this catch-up exists to fetch, in the same run that fetched
it. Annual reports are the one row type read a year after filing.

USAGE:
  etl/.venv/bin/python scripts/fetch-announcements.py            # full universe
  etl/.venv/bin/python scripts/fetch-announcements.py --limit 30 # sample
  etl/.venv/bin/python scripts/fetch-announcements.py --symbols ABB,ACGL
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

from bse_headers import BSE_HEADERS

REPO = Path(__file__).resolve().parent.parent

# How far back each run asks BSE for, and how long we retain rows.
FETCH_DAYS = 30
KEEP_DAYS = 180
# Window for a symbol that has no annual-report row yet (see the module
# docstring).
#
# 365 IS A HARD CEILING IMPOSED BY BSE, AND IT FAILS SILENTLY. Measured on
# 2026-10-12 against scrip 533221: 365 days → 46 rows, 366 → {"Table":[]}.
# Not an HTTP error, not a truncation warning — an empty result that is
# indistinguishable from "this company has filed nothing in a year". The first
# version of this constant was 400 and would have fetched nothing at all for
# every symbol while reporting a clean run, which is precisely the shape of
# failure the exit guard at the end of main() cannot see. Do not raise it.
#
# Consequence worth knowing: the consumer (build-overview-from-filing.mjs)
# reads a 15-month window, so a company whose only annual report is 13 months
# old is reachable by the consumer and NOT by this fetcher. BSE's ceiling, not
# ours. Such a symbol stays uncovered until it files again.
CATCHUP_DAYS = 365
# Matched against app.announcement.title to decide whether a symbol still
# needs the catch-up window, and to exempt a row from the KEEP_DAYS prune.
# One constant for both so the test and the retention can never disagree about
# what an annual report is.
ANNUAL_REPORT_LIKE = "%annual report%"
# Cap rows per symbol per run so a chatty filer can't bloat the table.
MAX_PER_SYMBOL = 40
# Cap for a catch-up symbol. BSE returns rows NEWEST FIRST and serves at most
# 50 on pageno=1, so a 365-day window puts the annual report deep in the list
# — measured index 22 (AHLWEST), 30 (AFIL), 31 (ABB). Trimming at 40 would cut
# exactly the old end this window exists to reach, and the symbol would come
# back next run still "needing catch-up", re-fetching 365 days forever and
# never keeping the row. 50 takes everything page 1 will give.
MAX_PER_SYMBOL_CATCHUP = 50
# Failure ceilings — see the exit guard at the end of main() for why these
# numbers and not others. Both are measured against the healthy run of
# 2026-09-22: 0/2,041 fetch errors, 2,041/2,148 symbols mapped.
MAX_ERROR_FRACTION = 0.05
MIN_MAPPED_FRACTION = 0.50

# Shared with fetch-corporate-actions.py and fetch-news.py. Do not inline a
# copy here — BSE's edge rejected the old set on 2026-09-26 and three separate
# copies is why that outage hit three jobs. See scripts/bse_headers.py.
HEADERS = BSE_HEADERS
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


def build_rows(sym: str, code: str, table: list, cap: int = MAX_PER_SYMBOL) -> list[tuple]:
    """→ list of (id, symbol, title, category, subcategory, headline,
                  published_at, pdf_url, bse_code).

    The tuple order here is load-bearing: it must match the column list in the
    INSERT in main() exactly, position for position. They are edited together
    or not at all — psycopg binds by position and will happily write a
    subcategory into `headline` if these two drift.
    """
    out: list[tuple] = []
    for r in table[:cap]:
        nid = str(r.get("NEWSID") or "").strip()
        title = (r.get("NEWSSUB") or "").strip()
        if not nid or not title:
            continue
        dt = parse_dt(r.get("NEWS_DT") or r.get("DT_TM") or "")
        attach = (r.get("ATTACHMENTNAME") or "").strip()
        pdf = PDF_BASE.format(name=attach) if attach else None
        headline = (r.get("HEADLINE") or "").strip() or None
        category = (r.get("CATEGORYNAME") or "").strip() or None
        # SUBCATNAME is the field that makes this feed usable. CATEGORYNAME
        # puts 51k of 80k rows in one "Company Update" bucket; SUBCATNAME is
        # what separates "Award of Order / Receipt of Order" from "Newspaper
        # Publication" inside it. BSE sends both on every row; we used to keep
        # only the coarse one. See db/migrations/0072.
        subcat = (r.get("SUBCATNAME") or "").strip() or None
        out.append((nid, sym, title[:400], category, subcat, headline, dt, pdf, code))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch corporate announcements from BSE.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    ap.add_argument("--limit", type=int, help="Only first N mapped symbols (testing)")
    ap.add_argument("--throttle", type=float, default=0.4, help="Seconds between BSE calls")
    ap.add_argument("--max-minutes", type=float, default=None,
                    help="Stop cleanly after this many minutes (resumable next run)")
    ap.add_argument("--symbols", help="Comma-separated symbols only (backfill/testing)")
    args = ap.parse_args()

    url = args.url or env_url("APP_DB_URL")
    today = datetime.now(timezone.utc).date()
    frm = (today - timedelta(days=FETCH_DAYS)).strftime("%Y%m%d")
    frm_catchup = (today - timedelta(days=CATCHUP_DAYS)).strftime("%Y%m%d")
    to = today.strftime("%Y%m%d")
    only = {s.strip().upper() for s in args.symbols.split(",")} if args.symbols else None

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
                SELECT u.symbol, u.isin,
                       NOT EXISTS (
                         SELECT 1 FROM app.announcement a
                          WHERE a.symbol = u.symbol AND a.title ILIKE %s
                       ) AS needs_catchup
                  FROM app.universe u
                  LEFT JOIN app.announcement_fetch f ON f.symbol = u.symbol
                 WHERE u.is_active AND u.isin IS NOT NULL
                 ORDER BY f.fetched_at ASC NULLS FIRST, u.symbol
                """,
                (ANNUAL_REPORT_LIKE,),
            )
            universe = cur.fetchall()
        if only:
            universe = [r for r in universe if r[0].upper() in only]
        if args.limit:
            universe = universe[: args.limit]

        mapped = [(sym, isin_to_code[isin.upper()], catchup)
                  for sym, isin, catchup in universe
                  if isin and isin.upper() in isin_to_code]
        n_catchup = sum(1 for _, _, c in mapped if c)
        print(f"Mapped {len(mapped)}/{len(universe)} symbols to BSE codes "
              f"· window {frm}–{to} · {n_catchup} on catch-up from {frm_catchup}",
              file=sys.stderr)

        # A degraded scrip master is a 200 with too few rows, not an exception.
        # Measured healthy: 2,041 of 2,148 mapped (95%) on 2026-09-22. The floor
        # is deliberately far below that — it is here to catch a truncated or
        # empty master, not to police normal ISIN churn.
        #
        # --symbols is exempt, and only --symbols. The floor's premise is "this
        # run was asked for the whole universe, so a low mapped fraction means
        # the master is broken". An explicitly named subset breaks that premise:
        # asking for the 860 symbols that lack an annual report maps 252,
        # because ~600 of them are NSE-only and are not in BSE's master at all.
        # That is the expected answer, not a degraded master — the guard fired
        # on it and aborted a correct run. --limit is NOT exempt: it slices the
        # universe ordering, so its mapped fraction should still look normal.
        if args.symbols:
            print(f"  (mapped-fraction floor skipped: explicit --symbols subset)",
                  file=sys.stderr)
        elif universe and len(mapped) < MIN_MAPPED_FRACTION * len(universe):
            raise SystemExit(
                f"ABORT: only {len(mapped)}/{len(universe)} symbols mapped to BSE codes "
                f"(floor {MIN_MAPPED_FRACTION:.0%}). The scrip master returned 200 but is "
                f"truncated or empty — continuing would sweep a fraction of the universe "
                f"and exit 0, which looks identical to a healthy run."
            )

        start = time.monotonic()
        total, ok, errors, attempted = 0, 0, 0, 0
        for i, (sym, code, catchup) in enumerate(mapped, 1):
            if args.max_minutes and (time.monotonic() - start) / 60 >= args.max_minutes:
                print(f"  ⏱ {args.max_minutes:.0f}m budget reached at {i-1}/{len(mapped)} "
                      f"— stopping cleanly (resumes next run).", file=sys.stderr)
                break
            attempted += 1
            try:
                # Short per-call timeout: a slow/hanging BSE response otherwise
                # burns 15s each and balloons the run past the job timeout.
                data = get_json(
                    ANN_URL.format(code=code, frm=frm_catchup if catchup else frm, to=to),
                    # A 400-day window returns more rows than a 30-day one and
                    # BSE is slower about it. 8s is the measured floor for the
                    # narrow window; giving the wide one the same budget would
                    # time out exactly the symbols this catch-up is for.
                    timeout=20 if catchup else 8,
                )
            except (HTTPError, URLError, TimeoutError, ValueError) as e:
                # Don't mark fetched — leave it high-priority for next run.
                # Counted, not just printed: see the exit guard at the end of
                # main(). Swallowing these one at a time is how a total BSE
                # blackout used to finish green.
                errors += 1
                print(f"  ! {sym} ({code}): {type(e).__name__}", file=sys.stderr)
                time.sleep(args.throttle)
                continue
            table = data.get("Table", []) if isinstance(data, dict) else []
            rows = build_rows(
                sym, code, table,
                MAX_PER_SYMBOL_CATCHUP if catchup else MAX_PER_SYMBOL,
            )
            with conn.cursor() as cur:
                if rows:
                    cur.executemany(
                        """
                        INSERT INTO app.announcement
                          (id, symbol, title, category, subcategory, headline,
                           published_at, pdf_url, bse_code, source, fetched_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'bse', now())
                        -- subcategory is in the UPDATE list, not just the
                        -- INSERT: rows already in the table from before
                        -- migration 0072 are re-fetched by the rolling
                        -- 30-day window and must pick the field up. Leaving
                        -- it out would have backfilled nothing while looking
                        -- like it worked.
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
            # Annual reports are EXEMPT. The catch-up above exists to fetch
            # filings 4–12 months old; an unqualified prune at KEEP_DAYS=180
            # would delete most of them in the same run that fetched them, and
            # the symbol would be re-queued for catch-up on the next run — a
            # fetch/delete loop that burns a 365-day BSE call every night and
            # leaves the table exactly as empty as before. These are the one
            # row type read long after filing: build-overview-from-filing.mjs
            # looks back 15 months.
            cur.execute(
                "DELETE FROM app.announcement "
                " WHERE published_at < %s AND title NOT ILIKE %s",
                (cutoff, ANNUAL_REPORT_LIKE),
            )
        conn.commit()

    print(f"Done — {total} announcements across {ok} symbols (of {len(mapped)} mapped) "
          f"· {errors}/{attempted} fetches errored.")

    # THE POINT OF THIS BLOCK.
    #
    # Every per-symbol failure above is caught and `continue`d, which is correct
    # for one flaky scrip and catastrophic for all of them. On 2026-09-19 and
    # 2026-09-24 api.bseindia.com began answering 403 to everything. The 24th
    # crashed in build_isin_to_code() and went red — but only by luck: that call
    # is the one uncaught one. Had the block started a few symbols later, the
    # loop would have absorbed 2,041 consecutive 403s, printed "Done — 0
    # announcements across 0 symbols", and exited 0. A green tick on a job that
    # fetched nothing, feeding app.announcement, which is now the input to the
    # filing-sourced overview builder. That is CLAUDE.md section 5 exactly: a
    # check that cannot fail.
    #
    # The threshold is set from measurement, not intuition. The healthy run of
    # 2026-09-22 errored on 0 of 2,041 fetches — the normal rate is literally
    # zero, so 5% is two orders of magnitude of headroom and still rejects the
    # blackout (100%) outright. A fix must fail on the bug it fixes; this one
    # does, and the margin means it will not cry wolf on a slow BSE night.
    if attempted and errors / attempted > MAX_ERROR_FRACTION:
        raise SystemExit(
            f"FAILED: {errors}/{attempted} fetches errored "
            f"({errors / attempted:.0%}, ceiling {MAX_ERROR_FRACTION:.0%}). "
            f"BSE is refusing us — check for a 403 from api.bseindia.com. "
            f"Announcements are NOT up to date."
        )
    # Zero attempts is not success either. It means the budget expired before a
    # single symbol, or the universe query returned nothing.
    if not attempted:
        raise SystemExit("FAILED: 0 symbols attempted — nothing was fetched.")


if __name__ == "__main__":
    main()
