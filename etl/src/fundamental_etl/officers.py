"""Fetch and persist company officers (CEO/MD list) via yfinance.

yfinance's `Ticker.info` includes a `companyOfficers` field — a list of dicts
with name + title + (sometimes) age, yearBorn, totalPay. We store the full list
as JSONB and pick the most senior officer (CEO > MD > Chairman > Director) to
populate ceo_name / ceo_title for fast access on the stock page.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import yfinance as yf

from .db import app_conn
from .log import log


# Title priority for picking the "main" officer to highlight on the stock page.
# Higher index = higher priority. We match by substring, case-insensitive.
# We compute the highest-priority match per title (not the first match), so
# "MD, CEO & Chairman" wins over "Executive Director". Pure "Director" is
# omitted because nearly every officer's title contains it.
TITLE_PRIORITY: list[str] = [
    "executive director",
    "chairperson",
    "founder",
    "chairman",
    "promoter",
    "managing director",
    "md",
    "chief executive",
    "ceo",
]


def _normalize_officers(raw: object) -> list[dict]:
    """Validate + light-cleanse the yfinance officers list."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        title = (item.get("title") or "").strip()
        if not name:
            continue
        cleaned = {"name": name, "title": title or None}
        # Optional fields — keep when present.
        for k in ("age", "yearBorn", "fiscalYear"):
            if item.get(k) is not None:
                cleaned[k] = item[k]
        out.append(cleaned)
    return out


def _pick_main(officers: list[dict]) -> tuple[str | None, str | None]:
    """Return (name, title) of the officer with the highest-priority title.

    Falls back to the first officer if no titles match the priority list.
    """
    if not officers:
        return None, None
    best_idx = -1
    best: dict | None = None
    for o in officers:
        title_l = (o.get("title") or "").lower()
        # Highest-priority keyword matching this title.
        matched = -1
        for i, kw in enumerate(TITLE_PRIORITY):
            if kw in title_l and i > matched:
                matched = i
        if matched > best_idx:
            best_idx = matched
            best = o
    chosen = best or officers[0]
    return chosen.get("name"), chosen.get("title")


def fetch_one(symbol: str) -> dict:
    """Fetch officers for one symbol. Symbol expected without .NS suffix."""
    t = yf.Ticker(symbol + ".NS")
    info: dict = {}
    try:
        info = t.info or {}
    except Exception as e:
        log.warning("yfinance_error", symbol=symbol, error=str(e)[:120])

    officers = _normalize_officers(info.get("companyOfficers"))
    ceo_name, ceo_title = _pick_main(officers)
    return {
        "symbol": symbol,
        "ceo_name": ceo_name,
        "ceo_title": ceo_title,
        "officers": officers,
    }


def fetch_many(
    only: list[str] | None = None,
    skip_existing: bool = True,
    throttle_s: float = 1.5,
) -> dict:
    """Fetch officers for many symbols. Idempotent — by default skips already-populated."""
    import json
    counts = {"ok": 0, "skipped": 0, "no_officers": 0, "error": 0}

    with app_conn() as conn:
        with conn.cursor() as cur:
            if only:
                cur.execute(
                    "SELECT symbol, ceo_name FROM app.universe WHERE symbol = ANY(%s)",
                    (only,),
                )
            else:
                cur.execute(
                    "SELECT symbol, ceo_name FROM app.universe WHERE is_active ORDER BY symbol"
                )
            rows = cur.fetchall()

    targets = [
        r["symbol"] for r in rows if not skip_existing or not r["ceo_name"]
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
                    SET ceo_name = %s,
                        ceo_title = %s,
                        key_officers = %s::jsonb,
                        officers_fetched_at = %s
                    WHERE symbol = %s
                    """,
                    (
                        data["ceo_name"],
                        data["ceo_title"],
                        json.dumps(data["officers"]) if data["officers"] else None,
                        datetime.now(timezone.utc),
                        sym,
                    ),
                )
            conn.commit()

        if data["ceo_name"]:
            counts["ok"] += 1
        else:
            counts["no_officers"] += 1

        if i % 25 == 0:
            log.info("progress", done=i, n=len(targets), **counts)

        if i < len(targets):
            time.sleep(throttle_s)

    return counts
