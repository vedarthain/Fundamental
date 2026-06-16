#!/usr/bin/env python3
"""
fetch-news.py — aggregate market headlines from broadcaster RSS + tag to stocks.

Free, no API key, no quota: pulls RSS from major Indian financial outlets,
dedups by URL, stores headline + summary + source link only (never full text),
and best-effort tags each headline to the stocks it mentions.

Tagging uses CLEAN company names from the BSE scrip master (ISIN ⋈
app.universe.isin) — our app.universe.company_name is polluted (some rows are
just "SYMBOL.NS"), so we don't rely on it. A headline maps to 0..N symbols;
matching is whole-word, case-insensitive, with a stoplist for ambiguous tokens.

USAGE:
  etl/.venv/bin/python scripts/fetch-news.py
Runs on a short cron (RSS is free) — keep ~30 days, prune the rest.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError

import psycopg

REPO = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# Free RSS feeds confirmed fetchable (HTTP 200 + valid <item>s as of 2026-06).
# Skips any that 403/404/ParseError at runtime — one bad feed never kills the
# rest. Broadened beyond the original 4 for wider per-stock coverage.
FEEDS: dict[str, str] = {
    "Economic Times":     "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "LiveMint":           "https://www.livemint.com/rss/markets",
    "Hindu BusinessLine": "https://www.thehindubusinessline.com/markets/feeder/default.rss",
    # marketreports.xml went stale/ParseError → use the high-volume latestnews feed.
    "Moneycontrol":       "https://www.moneycontrol.com/rss/latestnews.xml",
    "CNBC-TV18":          "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml",
    "NDTV Profit":        "https://feeds.feedburner.com/ndtvprofit-latest",
}

KEEP_DAYS = 30

# Drop obvious non-market noise that the broader "latest" feeds (NDTV Profit,
# CNBC, Moneycontrol) carry — sports, entertainment, lifestyle, viral. Keeps the
# wider sources without polluting a market-news page with FIFA / box-office junk.
DENY_RE = re.compile(
    r"\b(fifa|world cup|football|premier league|la ?liga|uefa|"
    r"cricket|\bipl\b|\bt20\b|\bodi\b|test match|ranji|"
    r"box ?office|bollywood|hollywood|movie|film review|web series|\bott\b|"
    r"celebrity|actor|actress|singer|horoscope|zodiac|astrolog|"
    r"lottery|admit card|exam result|recipe|viral video|trailer|teaser|"
    r"grand prix|olympics|tennis|badminton|kabaddi)\b",
    re.I,
)

SCRIP_MASTER = ("https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"
                "?Group=&Scripcode=&industry=&segment=Equity&status=Active")
TAG_HEADERS = {"User-Agent": UA, "Accept": "application/json",
               "Referer": "https://www.bseindia.com/", "Origin": "https://www.bseindia.com"}

# Single-word company names too generic to match on their own.
STOP = {"INDIA", "BANK", "POWER", "MOTORS", "FINANCE", "STEEL", "INFRA", "AUTO",
        "OIL", "GAS", "GLOBAL", "DOLLAR", "FOCUS", "RETAIL", "SPECTRUM", "TREND",
        "TRENT", "IDEA", "PRIME", "FUTURE", "ZEN", "UNITED", "CENTURY", "EXCEL"}
# Only strip a TRAILING corporate suffix — keep the rest so the phrase stays
# multi-word + specific ("Dollar Industries", not "Dollar").
NAME_SUFFIX = re.compile(r"\s+(limited|ltd\.?|corporation|corp\.?|company|co\.?)\s*$", re.I)


def get(url: str, headers: dict | None = None, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw


def strip_html(s: str) -> str:
    # Feeds put HTML-encoded content in CDATA, so titles arrive like
    # "Vedanta Iron &amp; Steel". Unescape entities (handles entity-encoded
    # tags), strip any real tags, then unescape once more for double-encoded
    # cases (&amp;amp; → &).
    s = html.unescape(s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def parse_pub(s: str):
    try:
        return parsedate_to_datetime(s)
    except (TypeError, ValueError):
        return None


def fetch_feed(name: str, url: str) -> list[dict]:
    try:
        raw = get(url, {"User-Agent": UA, "Accept": "application/rss+xml,application/xml,*/*"})
        root = ET.fromstring(raw)
    except (HTTPError, URLError, ET.ParseError, TimeoutError) as e:
        print(f"  ! {name}: {type(e).__name__}", file=sys.stderr)
        return []
    out = []
    for it in root.findall(".//item"):
        def txt(tag):
            e = it.find(tag)
            return (e.text or "").strip() if e is not None else ""
        link = txt("link")
        title = strip_html(txt("title"))
        if not link or not title:
            continue
        if DENY_RE.search(title):
            continue  # sports / entertainment / lifestyle noise
        out.append({
            "source": name,
            "title": title,
            "summary": strip_html(txt("description"))[:400] or None,
            "url": link.split("?")[0],
            "published_at": parse_pub(txt("pubDate")),
        })
    return out


def build_name_index(conn) -> list[tuple[re.Pattern, str]]:
    """[(compiled whole-word pattern, symbol)] from clean BSE names + symbols."""
    with conn.cursor() as cur:
        cur.execute("SELECT symbol, isin FROM app.universe WHERE is_active AND isin IS NOT NULL")
        uni = {r[1].upper(): r[0] for r in cur.fetchall() if r[1]}
    isin_name: dict[str, str] = {}
    try:
        import json
        data = json.loads(get(SCRIP_MASTER, TAG_HEADERS, timeout=45).decode("utf-8", "replace"))
        for row in data:
            isin = (row.get("ISIN_NUMBER") or "").strip().upper()
            nm = (row.get("Scrip_Name") or "").strip()
            if isin and nm:
                isin_name[isin] = nm
    except Exception as e:
        print(f"  ! scrip master fetch failed ({type(e).__name__}); tagging by symbol only",
              file=sys.stderr)

    index: list[tuple[re.Pattern, str]] = []
    for isin, sym in uni.items():
        nm = isin_name.get(isin)
        if not nm:
            continue  # no clean name → skip (don't tag on the bare ticker)
        clean = NAME_SUFFIX.sub("", nm).strip()
        clean = re.sub(r"^the\s+", "", clean, flags=re.I)
        clean = re.sub(r"[^A-Za-z0-9 &]", " ", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        words = clean.split()
        # Multi-word names are specific; a single word is only kept if it's
        # long enough AND not a common English word (STOP).
        if len(words) >= 2 or (len(clean) >= 5 and clean.upper() not in STOP):
            try:
                index.append((re.compile(rf"\b{re.escape(clean)}\b", re.I), sym))
            except re.error:
                continue
    index.sort(key=lambda t: -len(t[0].pattern))  # prefer longer/specific
    return index


def tag(text: str, index) -> set[str]:
    hits = set()
    for pat, sym in index:
        if pat.search(text):
            hits.add(sym)
    return hits


def main() -> None:
    ap = argparse.ArgumentParser(description="Aggregate market news from RSS + tag to stocks.")
    ap.add_argument("--url", help="Postgres URL (default APP_DB_URL)")
    args = ap.parse_args()
    url = args.url or os.environ.get("APP_DB_URL")
    if not url:
        for line in (REPO / ".env.local").read_text().splitlines():
            if line.startswith("APP_DB_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")

    items = []
    for name, feed in FEEDS.items():
        got = fetch_feed(name, feed)
        print(f"  {name}: {len(got)} items", file=sys.stderr)
        items.extend(got)
    # Dedup by canonical url across feeds.
    by_id: dict[str, dict] = {}
    for it in items:
        nid = hashlib.sha256(it["url"].encode()).hexdigest()[:32]
        by_id.setdefault(nid, it)

    # Retry the whole DB phase: Neon occasionally hands out a fresh pooled
    # connection that drops on the first query ("SSL connection has been closed
    # unexpectedly"), or drops mid-run on a compute cold-start. The RSS items
    # are already fetched and every write is idempotent (ON CONFLICT), so a
    # reconnect-and-retry is safe and cheap.
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            n_news, n_tags = persist(url, by_id)
            print(f"Done — {n_news} headlines, {n_tags} stock tags.")
            return
        except psycopg.OperationalError as e:
            last_err = e
            print(f"  ! DB connection issue ({type(e).__name__}: {str(e).strip()[:80]}); "
                  f"retry {attempt}/3 in 5s…", file=sys.stderr)
            time.sleep(5)
    raise SystemExit(f"DB unavailable after 3 attempts: {last_err}")


def persist(url: str, by_id: dict[str, dict]) -> tuple[int, int]:
    """Insert/refresh headlines + tags + prune. Raises OperationalError on a
    dropped connection so main() can retry."""
    with psycopg.connect(
        url,
        connect_timeout=15,
        # TCP keepalives so an idle stretch (e.g. the BSE scrip-master fetch in
        # build_name_index) doesn't let the connection get silently reaped.
        keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5,
    ) as conn:
        index = build_name_index(conn)
        print(f"  name index: {len(index)} match phrases", file=sys.stderr)
        n_news = n_tags = 0
        with conn.cursor() as cur:
            for nid, it in by_id.items():
                cur.execute("""
                    INSERT INTO app.news (id, source, title, summary, url, published_at, fetched_at)
                    VALUES (%s,%s,%s,%s,%s,%s, now())
                    ON CONFLICT (id) DO UPDATE SET
                      title=EXCLUDED.title, summary=EXCLUDED.summary, fetched_at=now()
                """, (nid, it["source"], it["title"], it["summary"], it["url"], it["published_at"]))
                n_news += 1
                syms = tag(f"{it['title']} {it.get('summary') or ''}", index)
                for sym in syms:
                    cur.execute(
                        "INSERT INTO app.news_stock (news_id, symbol) VALUES (%s,%s) "
                        "ON CONFLICT DO NOTHING", (nid, sym))
                    n_tags += 1
            # Prune old.
            cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
            cur.execute("DELETE FROM app.news WHERE COALESCE(published_at, fetched_at) < %s", (cutoff,))
        conn.commit()
    return n_news, n_tags


if __name__ == "__main__":
    main()
