"""Fetch and persist company business descriptions via yfinance.

yfinance aggregates 'longBusinessSummary' from companies' own regulatory filings
(BSE/NSE disclosures for Indian tickers). This is the company's filed self-description,
not third-party narration.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import yfinance as yf

from .db import app_conn
from .log import log


def fetch_one(symbol: str) -> dict:
    """Fetch business info for one symbol. Symbol expected without .NS suffix."""
    t = yf.Ticker(symbol + ".NS")
    info = {}
    try:
        info = t.info or {}
    except Exception as e:
        log.warning("yfinance_error", symbol=symbol, error=str(e)[:120])
    return {
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


def fetch_many(
    only: list[str] | None = None,
    skip_existing: bool = True,
    throttle_s: float = 1.5,
) -> dict:
    """Fetch business info for many symbols. Idempotent — skips ones already populated."""
    counts = {"ok": 0, "skipped": 0, "no_summary": 0, "error": 0}

    with app_conn() as conn:
        with conn.cursor() as cur:
            if only:
                cur.execute(
                    """SELECT symbol, business_summary FROM app.universe WHERE symbol = ANY(%s)""",
                    (only,),
                )
            else:
                cur.execute(
                    """SELECT symbol, business_summary FROM app.universe
                       WHERE is_active ORDER BY symbol"""
                )
            rows = cur.fetchall()

    targets = [
        r["symbol"] for r in rows
        if not skip_existing or not r["business_summary"]
    ]
    log.info("plan", total=len(targets))

    for i, sym in enumerate(targets, 1):
        try:
            data = fetch_one(sym)
        except Exception as e:
            counts["error"] += 1
            log.error("fetch_error", symbol=sym, error=str(e)[:120])
            continue

        with app_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE app.universe
                    SET business_summary = %s,
                        website = %s,
                        employees = %s,
                        business_info_fetched_at = %s
                    WHERE symbol = %s
                    """,
                    (
                        data["business_summary"],
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

    return counts
