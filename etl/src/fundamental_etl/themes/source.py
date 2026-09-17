"""Read the Financial Express sector/theme taxonomy.

The pages are Next.js App Router routes. The stock table looks JS-rendered —
stripping HTML tags yields only chrome — but it is in fact fully server-rendered
into the RSC flight payload, emitted as a series of `self.__next_f.push([1,"…"])`
calls. Concatenating the decoded JSON string fragments reconstitutes the payload,
and the theme catalogue plus every constituent falls out of it with no browser,
no auth and no API key.

What the source does NOT carry, on either the list page or the individual stock
page, is an NSE symbol or an ISIN. The only identity is a display name. That is
the single fact that shapes the whole importer: see resolve.py.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Optional

import httpx

BASE = "https://www.financialexpress.com"

# Plain desktop Chrome UA. The site serves the full payload to it without a
# cookie or a bot challenge; an obviously-automated UA is the kind of thing that
# gets a 403 later, so we look like a browser.
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

_PUSH_RE = re.compile(r'self\.__next_f\.push\(\[1,(".*?")\]\)', re.S)

# The catalogue, as rendered into the "Select Sector" dropdown.
_CAT_RE = re.compile(r'\{"id":(\d+),"label":"([^"]+)","url":"([^"]+)"\}')

# One constituent row. `trend` (an ~80-point sparkline) and `volume` follow but
# we deliberately do not capture them — we import membership, not market data.
_STOCK_RE = re.compile(
    r'\{"name":"([^"]+)","urlName":"(market/[^"]+)","itemId":"([^"]+)"'
)

# Index rows (BSE Sensex, Nifty 50) are injected into the same array as a
# comparison line. They are not constituents and would otherwise be imported as
# members of every theme.
_INDEX_MARKER = "indian-indices"


@dataclass(frozen=True)
class Category:
    source_id: int
    label: str
    slug: str


@dataclass(frozen=True)
class SourceStock:
    name: str
    url_name: str
    item_id: str


def client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": _UA},
        timeout=45.0,
        follow_redirects=True,
    )


def _flight(html: str) -> str:
    """Reassemble the RSC flight payload from its push() fragments."""
    parts: list[str] = []
    for frag in _PUSH_RE.findall(html):
        try:
            parts.append(json.loads(frag))
        except json.JSONDecodeError:
            # A single malformed fragment must not lose the whole page; the
            # regexes below tolerate gaps.
            continue
    return "".join(parts)


def fetch_categories(c: httpx.Client, seed_slug: str = "waste-management") -> list[Category]:
    """The full theme catalogue.

    Every sector page embeds the complete dropdown, so any one page is a seed
    for the whole taxonomy. Deduped by source_id because the payload repeats the
    list once per render slot.
    """
    html = c.get(f"{BASE}/market/sector/{seed_slug}-stocks/").text
    buf = _flight(html)
    seen: dict[int, Category] = {}
    for sid, label, slug in _CAT_RE.findall(buf):
        seen.setdefault(int(sid), Category(int(sid), label, slug))
    return [seen[k] for k in sorted(seen)]


def fetch_members(c: httpx.Client, slug: str) -> list[SourceStock]:
    """Constituents of one theme.

    Most themes live at `/market/sector/<slug>-stocks/`, a handful at
    `/market/sector/<slug>/`. We try both rather than maintain an exception
    list, and return empty if neither yields rows — an empty theme is recorded
    as such, not treated as a failure, because two categories genuinely have no
    constituents upstream.
    """
    for suffix in ("-stocks", ""):
        buf = _flight(c.get(f"{BASE}/market/sector/{slug}{suffix}/").text)
        out: list[SourceStock] = []
        seen: set[str] = set()
        for name, url_name, item_id in _STOCK_RE.findall(buf):
            if name in seen or _INDEX_MARKER in url_name:
                continue
            seen.add(name)
            out.append(SourceStock(name, url_name, item_id))
        if out:
            return out
    return []


def crawl(
    c: httpx.Client,
    cats: list[Category],
    throttle: float = 0.4,
    log: Optional[object] = None,
) -> dict[str, list[SourceStock]]:
    out: dict[str, list[SourceStock]] = {}
    for i, cat in enumerate(cats, 1):
        out[cat.slug] = fetch_members(c, cat.slug)
        if log is not None:
            log.info("theme_fetched", i=i, n=len(cats), slug=cat.slug,
                     stocks=len(out[cat.slug]))
        time.sleep(throttle)
    return out
