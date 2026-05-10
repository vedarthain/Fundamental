"""Scrape and persist quarterly shareholding patterns from Screener company pages.

The Screener xlsx export does NOT contain shareholding data — that's only
shown on the company HTML page. We make one GET per stock to
`/company/{SYMBOL}/consolidated/` (falling back to /standalone/ on 404),
then regex-parse the Shareholding Pattern table.

The table has 5 categories (Promoters / FIIs / DIIs / Government / Public)
across ~12 quarters of history. We upsert into app.shareholding_pattern,
keyed by (symbol, period_end). Idempotent — re-running rewrites the same rows.
"""
from __future__ import annotations

import calendar
import html as htmllib
import re
import time
from datetime import date, datetime, timezone

import httpx

from .db import app_conn
from .log import log
from .screener.scraper import _client, NotFound, AuthFailed, ScrapeError


BASE = "https://www.screener.in"

# Map row label → DB column. Trailing "+" comes from the expand-link Screener
# adds to drill into sub-categories; we strip it before matching.
LABEL_COLUMNS: dict[str, str] = {
    "promoters":   "promoter_pct",
    "fiis":        "fii_pct",
    "diis":        "dii_pct",
    "government":  "government_pct",
    "public":      "public_pct",
}

MONTHS_3 = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}


def _quarter_end(label: str) -> date | None:
    """'Mar 2026' → date(2026, 3, 31). Returns None for non-quarter labels."""
    m = re.match(r"^([A-Za-z]{3})\s+(\d{4})$", label.strip())
    if not m:
        return None
    mon = MONTHS_3.get(m.group(1).lower())
    if mon is None:
        return None
    yr = int(m.group(2))
    last_day = calendar.monthrange(yr, mon)[1]
    return date(yr, mon, last_day)


def _parse_pct(s: str) -> float | None:
    """'19.07%' → 19.07. None for missing/blank cells."""
    s = (s or "").strip().replace(",", "")
    if not s or s in ("-", "—"):
        return None
    s = s.rstrip("%").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _parse_count(s: str) -> int | None:
    """'47,65,728' → 4765728. Indian-style comma-separated counts."""
    s = (s or "").strip().replace(",", "").replace(".", "")
    if not s or not s.isdigit():
        return None
    return int(s)


def parse_shareholding(html: str) -> list[dict]:
    """Extract quarterly shareholding rows from a Screener company-page HTML.

    Returns a list of dicts, one per (period_end), with the 5 category
    percentages and shareholders count where available. We focus on the
    quarterly table only; the annual table covers older history but uses
    the same Mar dates that already appear in the quarterly rows for
    overlapping years.
    """
    idx = html.find('id="shareholding"')
    if idx == -1:
        # Fallback: literal "Shareholding" in body text.
        idx = html.find("Shareholding")
        if idx == -1:
            return []
    chunk = html[idx : idx + 12000]

    # Take only the FIRST table inside the shareholding section (quarterly).
    # The annual table follows but its period labels overlap (Mar YYYY appears
    # in both); we don't want to double-process.
    tbl_match = re.search(r"<table\b[^>]*>(.*?)</table>", chunk, re.S)
    if not tbl_match:
        return []
    tbl = tbl_match.group(1)

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tbl, re.S)
    if not rows:
        return []

    def cells(tr: str) -> list[str]:
        cs = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)
        return [
            htmllib.unescape(re.sub(r"<[^>]+>", "", c)).replace("\xa0", "").strip()
            for c in cs
        ]

    header = cells(rows[0])
    # First cell of header is empty; the rest are quarter labels.
    period_dates: list[date | None] = [_quarter_end(h) for h in header[1:]]

    # Aggregate per-period dict.
    bucket: dict[date, dict] = {}
    for tr in rows[1:]:
        c = cells(tr)
        if len(c) < 2:
            continue
        label_raw = c[0].rstrip("+").strip().lower()
        # Match exactly one of our known labels.
        col = None
        for kw, dbcol in LABEL_COLUMNS.items():
            if label_raw.startswith(kw):
                col = dbcol
                break
        is_count = "shareholder" in label_raw and col is None

        for i, val in enumerate(c[1:]):
            d = period_dates[i] if i < len(period_dates) else None
            if d is None:
                continue
            row = bucket.setdefault(
                d,
                {
                    "period_end": d,
                    "promoter_pct": None,
                    "fii_pct": None,
                    "dii_pct": None,
                    "government_pct": None,
                    "public_pct": None,
                    "shareholders": None,
                },
            )
            if col:
                row[col] = _parse_pct(val)
            elif is_count:
                row["shareholders"] = _parse_count(val)

    # Drop rows where every percentage is missing — likely a header row glitch.
    out: list[dict] = []
    for d in sorted(bucket.keys()):
        row = bucket[d]
        if any(row[k] is not None for k in ("promoter_pct", "fii_pct", "dii_pct", "public_pct")):
            out.append(row)
    return out


def fetch_one(symbol: str, client: httpx.Client) -> list[dict]:
    """Fetch + parse shareholding for one symbol. Empty list on no-data."""
    for path in (f"/company/{symbol}/consolidated/", f"/company/{symbol}/"):
        url = BASE + path
        resp = client.get(url)
        if resp.status_code == 404:
            continue
        if resp.status_code in (301, 302) and "/login" in resp.headers.get("location", ""):
            raise AuthFailed(f"Login redirect on {url}")
        if resp.status_code != 200:
            raise ScrapeError(f"GET {url} → HTTP {resp.status_code}")
        html = resp.text
        rows = parse_shareholding(html)
        if rows:
            return rows
    return []


def fetch_many(
    only: list[str] | None = None,
    skip_existing: bool = True,
    throttle_s: float = 1.5,
) -> dict:
    """Fetch shareholding for many symbols. Idempotent — by default skips
    symbols that already have at least one row in shareholding_pattern."""
    counts = {"ok": 0, "skipped": 0, "no_data": 0, "error": 0, "rows_written": 0}

    with app_conn() as conn:
        with conn.cursor() as cur:
            if only:
                cur.execute(
                    "SELECT symbol FROM app.universe WHERE symbol = ANY(%s) AND is_active",
                    (only,),
                )
            else:
                cur.execute(
                    "SELECT symbol FROM app.universe WHERE is_active ORDER BY symbol"
                )
            all_syms = [r["symbol"] for r in cur.fetchall()]

            if skip_existing:
                cur.execute("SELECT DISTINCT symbol FROM app.shareholding_pattern")
                done = {r["symbol"] for r in cur.fetchall()}
                targets = [s for s in all_syms if s not in done]
                counts["skipped"] = len(all_syms) - len(targets)
            else:
                targets = all_syms

    log.info("plan", total=len(targets), skipped=counts["skipped"])

    with _client() as scrape:
        for i, sym in enumerate(targets, 1):
            try:
                rows = fetch_one(sym, scrape)
            except (NotFound, AuthFailed, ScrapeError) as e:
                counts["error"] += 1
                log.error("scrape_error", symbol=sym, error=str(e)[:120])
                continue
            except Exception as e:
                counts["error"] += 1
                log.error("unexpected_error", symbol=sym, error=str(e)[:120])
                continue

            if not rows:
                counts["no_data"] += 1
                if i % 25 == 0:
                    log.info("progress", done=i, n=len(targets), **counts)
                if i < len(targets):
                    time.sleep(throttle_s)
                continue

            now = datetime.now(timezone.utc)
            with app_conn() as conn:
                with conn.cursor() as cur:
                    for r in rows:
                        cur.execute(
                            """
                            INSERT INTO app.shareholding_pattern
                              (symbol, period_end, promoter_pct, fii_pct, dii_pct,
                               government_pct, public_pct, shareholders, parsed_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (symbol, period_end) DO UPDATE SET
                              promoter_pct   = EXCLUDED.promoter_pct,
                              fii_pct        = EXCLUDED.fii_pct,
                              dii_pct        = EXCLUDED.dii_pct,
                              government_pct = EXCLUDED.government_pct,
                              public_pct     = EXCLUDED.public_pct,
                              shareholders   = EXCLUDED.shareholders,
                              parsed_at      = EXCLUDED.parsed_at
                            """,
                            (
                                sym, r["period_end"],
                                r["promoter_pct"], r["fii_pct"], r["dii_pct"],
                                r["government_pct"], r["public_pct"],
                                r["shareholders"], now,
                            ),
                        )
                conn.commit()

            counts["ok"] += 1
            counts["rows_written"] += len(rows)

            if i % 25 == 0:
                log.info("progress", done=i, n=len(targets), **counts)
            if i < len(targets):
                time.sleep(throttle_s)

    return counts
