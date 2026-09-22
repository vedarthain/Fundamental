"""Fetch and persist company officers (CEO/MD list) via yfinance.

yfinance's `Ticker.info` includes a `companyOfficers` field — a list of dicts
with name + title + (sometimes) age, yearBorn, totalPay. We store the full list
as JSONB and pick the most senior officer (CEO > MD > Chairman > Director) to
populate ceo_name / ceo_title for fast access on the stock page.

Same history and same three fixes as business_info.py — read that module's
docstring first. In short: this ran once on 2026-05-05 and never again, and
the old write path turned a transient yfinance failure into "this company has
no CEO", stamped fresh. A stale CEO is a wrong fact on the stock page, not a
missing one, so the no-write-on-failure rule matters more here than there.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

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
    info: dict = {}
    ok = True
    try:
        # Construction inside the try — see business_info.fetch_one.
        info = yf.Ticker(symbol + ".NS").info or {}
    except Exception as e:
        ok = False
        log.warning("yfinance_error", symbol=symbol, error=str(e)[:120])
    if not info:
        ok = False

    officers = _normalize_officers(info.get("companyOfficers"))
    ceo_name, ceo_title = _pick_main(officers)
    return {
        "ok": ok,
        "symbol": symbol,
        "ceo_name": ceo_name,
        "ceo_title": ceo_title,
        "officers": officers,
    }


def _is_stale(fetched_at, max_age_days: int | None) -> bool:
    if max_age_days is None:
        return False
    if fetched_at is None:
        return True
    return fetched_at < datetime.now(timezone.utc) - timedelta(days=max_age_days)


def _still_behind(max_age_days: int | None) -> int:
    """Rows STILL blank or stale after the run. Re-queried, not counted."""
    with app_conn() as conn:
        with conn.cursor() as cur:
            if max_age_days is None:
                cur.execute(
                    "SELECT count(*) AS n FROM app.universe "
                    "WHERE is_active AND ceo_name IS NULL"
                )
            else:
                cur.execute(
                    "SELECT count(*) AS n FROM app.universe WHERE is_active AND "
                    "(ceo_name IS NULL OR officers_fetched_at IS NULL "
                    " OR officers_fetched_at < now() - (%s || ' days')::interval)",
                    (str(max_age_days),),
                )
            return cur.fetchone()["n"]


def fetch_many(
    only: list[str] | None = None,
    skip_existing: bool = True,
    throttle_s: float = 1.5,
    max_age_days: int | None = None,
    limit: int | None = None,
) -> dict:
    """Fetch officers for many symbols. Selection policy mirrors business_info —
    including `limit`, which drains oldest-first so the run is time-bounded and
    the timestamps stay spread instead of re-clumping. See that module."""
    import json
    counts = {"ok": 0, "skipped": 0, "no_officers": 0, "error": 0, "stale_selected": 0}
    counts["behind_before"] = _still_behind(max_age_days)

    with app_conn() as conn:
        with conn.cursor() as cur:
            if only:
                cur.execute(
                    "SELECT symbol, ceo_name, officers_fetched_at FROM app.universe "
                    "WHERE symbol = ANY(%s)",
                    (only,),
                )
            else:
                cur.execute(
                    "SELECT symbol, ceo_name, officers_fetched_at FROM app.universe "
                    "WHERE is_active "
                    "ORDER BY officers_fetched_at ASC NULLS FIRST, symbol"
                )
            rows = cur.fetchall()

    targets: list[str] = []
    for r in rows:
        if only or not skip_existing:
            targets.append(r["symbol"])
        elif not r["ceo_name"]:
            targets.append(r["symbol"])
        elif _is_stale(r["officers_fetched_at"], max_age_days):
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

        # No write on a failed fetch. An overwritten CEO is a wrong fact on
        # the stock page, which is worse than a blank one.
        if not data["ok"]:
            counts["error"] += 1
            log.warning("fetch_failed_no_write", symbol=sym)
            if i < len(targets):
                time.sleep(throttle_s)
            continue

        with app_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE app.universe
                    SET ceo_name = COALESCE(%s, ceo_name),
                        ceo_title = COALESCE(%s, ceo_title),
                        key_officers = COALESCE(%s::jsonb, key_officers),
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

    counts["still_behind"] = _still_behind(max_age_days)
    return counts
