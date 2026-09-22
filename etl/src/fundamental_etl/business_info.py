"""Fetch and persist company business descriptions via yfinance.

yfinance aggregates 'longBusinessSummary' from companies' own regulatory filings
(BSE/NSE disclosures for Indian tickers). This is the company's filed self-description,
not third-party narration.

WHY THIS FILE IS SHAPED THE WAY IT IS
-------------------------------------
Until 2026-09-22 this ran exactly once, by hand, on 2026-05-04. Every row in
app.universe carried that one timestamp and no other: 2,150 populated, 443
active symbols permanently blank, and every symbol onboarded after that date
landing NULL forever. `fetch-business-info` existed as a CLI command but no
workflow in .github/workflows called it. That is CLAUDE.md §5 verbatim —
seeded once, nothing maintains it.

Two things had to change before it could be put on a schedule, because
scheduling the old code would have been worse than leaving it frozen:

1. A FAILED FETCH WAS INDISTINGUISHABLE FROM AN EMPTY ONE, AND OVERWROTE.
   fetch_one() swallowed its own yfinance exception, returned info={}, and the
   caller then UPDATEd business_summary = NULL and stamped
   business_info_fetched_at = now(). Under --refresh (which any periodic
   refresh must use) a transient yfinance outage would have wiped good prose
   off every symbol it touched and marked the wreckage fresh. counts["error"]
   could never fire, because the exception never reached the caller; the loss
   would have been logged as "no_summary" and the job would have exited 0.

   So fetch_one now returns ok=False on failure, a failed fetch writes nothing
   at all, and a successful fetch that happens to carry no summary COALESCEs
   rather than nulls. NULL here means "never fetched", never "has no summary".

2. THE ONLY CHOICES WERE "SKIP EVERYTHING POPULATED" OR "REFETCH ALL 2,593".
   Neither is a refresh policy. skip_existing=True can never update a row that
   already has text — which is precisely how it stayed frozen for 141 days —
   and --refresh re-pulls the whole universe at 1.5s/call. max_age_days is the
   missing middle: take the blanks and the genuinely stale, leave the rest.

And so it cannot go silent again: fetch_many re-counts what is STILL missing
or stale after the run and returns it. The CLI exits non-zero on that number.
Run against production today it would report 2,150 — the check fails on the
bug it was written for, per CLAUDE.md §4.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import yfinance as yf

from .db import app_conn
from .log import log
from .screener.profile import fetch_profile

# One authenticated Screener client for the whole run. Built lazily so a run
# with --no-screener-fallback never touches the cookies, and so a missing
# SCREENER_SESSIONID is an error only for the runs that actually need it.
_SCREENER_CLIENT = None


def _screener_client():
    global _SCREENER_CLIENT
    if _SCREENER_CLIENT is None:
        from .screener.profile import make_profile_client
        _SCREENER_CLIENT = make_profile_client()
    return _SCREENER_CLIENT


def fetch_one(symbol: str) -> dict:
    """Fetch business info for one symbol. Symbol expected without .NS suffix.

    The `ok` key is the whole point: False means the fetch FAILED and the
    caller must not write. An empty `info` counts as a failure too — yfinance
    returns {} for rate-limited and unknown tickers alike, and neither is
    evidence that a company stopped describing itself.
    """
    info = {}
    ok = True
    try:
        # Ticker() construction is inside the try on purpose. It is normally
        # inert, but yfinance has moved session/curl setup into it before now,
        # and an exception there would escape a try that only wrapped .info.
        info = yf.Ticker(symbol + ".NS").info or {}
    except Exception as e:
        ok = False
        log.warning("yfinance_error", symbol=symbol, error=str(e)[:120])
    if not info:
        ok = False
    return {
        "ok": ok,
        "symbol": symbol,
        "business_summary": (info.get("longBusinessSummary") or "").strip() or None,
        "website": (info.get("website") or "").strip() or None,
        "employees": _safe_int(info.get("fullTimeEmployees")),
    }


def _safe_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _is_stale(fetched_at, max_age_days: int | None) -> bool:
    """True when this row is old enough to be worth re-pulling."""
    if max_age_days is None:
        return False
    if fetched_at is None:
        return True
    return fetched_at < datetime.now(timezone.utc) - timedelta(days=max_age_days)


def _still_behind(max_age_days: int | None) -> int:
    """Rows that are STILL blank or stale. Measured after the run, not before.

    This is the number that must be zero for the job to have done its job. It
    is deliberately re-queried from the database rather than derived from the
    loop counters — a counter can only report what the loop believed it did.
    """
    with app_conn() as conn:
        with conn.cursor() as cur:
            if max_age_days is None:
                cur.execute(
                    "SELECT count(*) AS n FROM app.universe "
                    "WHERE is_active AND business_summary IS NULL"
                )
            else:
                cur.execute(
                    "SELECT count(*) AS n FROM app.universe WHERE is_active AND "
                    "(business_summary IS NULL OR business_info_fetched_at IS NULL "
                    " OR business_info_fetched_at < now() - (%s || ' days')::interval)",
                    (str(max_age_days),),
                )
            return cur.fetchone()["n"]


def fetch_many(
    only: list[str] | None = None,
    skip_existing: bool = True,
    throttle_s: float = 1.5,
    max_age_days: int | None = None,
    limit: int | None = None,
    screener_fallback: bool = False,
) -> dict:
    """Fetch business info for many symbols.

    Selection, in order of precedence:
      only=[...]            -> exactly those symbols
      skip_existing=False   -> every active symbol (the --refresh escape hatch)
      max_age_days=N        -> blanks PLUS anything last fetched over N days ago
      default               -> blanks only

    `limit` takes the OLDEST-first slice of that selection, and it does two
    jobs. It bounds the runtime of a scheduled run — a full 2,593-symbol pass
    at 1.5s throttle is over two hours, and two of these back to back crowds
    the Actions 6h cap. And it breaks up the thundering herd: the 2026-05-04
    freeze left every row carrying one identical timestamp, so an unbounded
    age-based refresh would re-stamp them all identically again and they would
    all fall due on the same day forever. Draining oldest-first spreads the
    timestamps out and keeps them spread.

    A failed fetch writes nothing. A successful fetch never nulls a field it
    did not receive a value for. See the module docstring for what happened
    when neither of those was true.
    """
    counts = {"ok": 0, "skipped": 0, "no_summary": 0, "error": 0, "stale_selected": 0}
    counts["screener_ok"] = 0
    counts["screener_none"] = 0
    counts["behind_before"] = _still_behind(max_age_days)

    with app_conn() as conn:
        with conn.cursor() as cur:
            if only:
                cur.execute(
                    """SELECT symbol, business_summary, business_info_fetched_at
                       FROM app.universe WHERE symbol = ANY(%s)""",
                    (only,),
                )
            else:
                # NULLS FIRST is the ordering that makes `limit` correct:
                # never-fetched rows are further behind than merely stale ones
                # and must drain first.
                cur.execute(
                    """SELECT symbol, business_summary, business_info_fetched_at
                       FROM app.universe WHERE is_active
                       ORDER BY business_info_fetched_at ASC NULLS FIRST, symbol"""
                )
            rows = cur.fetchall()

    targets: list[str] = []
    for r in rows:
        if only or not skip_existing:
            targets.append(r["symbol"])
        elif not r["business_summary"]:
            targets.append(r["symbol"])
        elif _is_stale(r["business_info_fetched_at"], max_age_days):
            targets.append(r["symbol"])
            counts["stale_selected"] += 1
        else:
            counts["skipped"] += 1
    counts["eligible"] = len(targets)
    if limit is not None and len(targets) > limit:
        targets = targets[:limit]
    counts["selected"] = len(targets)
    log.info("plan", total=len(targets), of=len(rows), **counts)

    for i, sym in enumerate(targets, 1):
        try:
            data = fetch_one(sym)
        except Exception as e:
            counts["error"] += 1
            log.error("fetch_error", symbol=sym, error=str(e)[:120])
            continue

        # The write is skipped entirely on a failed fetch. Writing NULLs here
        # and stamping them fresh is the bug this module was rewritten for.
        if not data["ok"]:
            counts["error"] += 1
            log.warning("fetch_failed_no_write", symbol=sym)
            if i < len(targets):
                time.sleep(throttle_s)
            continue

        # Fallback, tried ONLY when yfinance succeeded and had nothing. A
        # yfinance FAILURE never reaches here, so a Yahoo outage can't quietly
        # rewrite the universe in Screener's shorter voice.
        source = "yfinance" if data["business_summary"] else None
        if screener_fallback and not data["business_summary"]:
            sc = fetch_profile(_screener_client(), sym)
            if sc["ok"] and sc["summary"]:
                data["business_summary"] = sc["summary"]
                source = "screener"
                counts["screener_ok"] += 1
            elif sc["ok"]:
                counts["screener_none"] += 1

        with app_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE app.universe
                    SET business_summary = COALESCE(%s, business_summary),
                        -- COALESCE, not CASE: a run that found no summary at
                        -- all leaves the existing label alone rather than
                        -- blanking it. The ::text cast is required — psycopg
                        -- sends an untyped NULL and Postgres cannot infer the
                        -- parameter's type from COALESCE alone.
                        business_summary_source =
                            COALESCE(%s::text, business_summary_source),
                        website = COALESCE(%s, website),
                        employees = COALESCE(%s, employees),
                        business_info_fetched_at = %s
                    WHERE symbol = %s
                    """,
                    (
                        data["business_summary"],
                        source,
                        data["website"],
                        data["employees"],
                        datetime.now(timezone.utc),
                        sym,
                    ),
                )
            conn.commit()

        if data["business_summary"]:
            counts["ok"] += 1
        else:
            counts["no_summary"] += 1
            log.warning("empty_summary", symbol=sym)

        if i % 25 == 0:
            log.info("progress", done=i, n=len(targets), **counts)

        if i < len(targets):
            time.sleep(throttle_s)

    counts["still_behind"] = _still_behind(max_age_days)
    return counts
