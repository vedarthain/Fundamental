"""Screener.in company-profile blurb — the FALLBACK source for business_summary.

WHY THIS EXISTS

yfinance's longBusinessSummary covers 2,145 of 2,593 active symbols. The other
448 return nothing and always will — they are small caps Yahoo never wrote a
profile for, not transient failures. Tested live against 12 of those blanks,
Screener had a description for 12.

WHY IT IS A FALLBACK AND NOT THE SOURCE

The two are not the same kind of text:

    CENTUM  yfinance  1,953 chars   the company's own filed self-description
    ABAN    screener     87 chars   "Incorporated in 1986, Aban Offshore is in
                                     the business of offshore drilling services"

web/src/lib/businessSummary.ts mines this prose for segments, markets, former
names and HQ, and every one of those extractors needs several sentences to
work. Promoting Screener to primary would silently gut that feature across
2,145 symbols to fix 448. So: yfinance first, Screener only where yfinance
came back empty, and the row is labelled business_summary_source so nothing
downstream has to guess which it is holding.

WHAT THIS DOES NOT DO

It does not scrape on a schedule of its own and it does not re-scrape a symbol
that already has a Screener blurb unless asked. Screener is a shared resource
we already lean on for classification and shareholding; the polite version of
this feature only fetches what is actually missing.
"""
from __future__ import annotations

import html
import re

import httpx

from ..log import log
from .scraper import make_client

# The profile blurb is the first <p> inside div.company-profile. The looser
# fallback exists because Screener has more than one page template, but it is
# deliberately still anchored to a <p> — grabbing "the first paragraph-ish
# thing" off an arbitrary page is how you end up storing a cookie banner.
_PROFILE_RE = re.compile(
    r'<div class="company-profile".*?<p[^>]*>(.*?)</p>', re.S | re.I
)
_FALLBACK_RE = re.compile(r'<p[^>]*>(.*?)</p>', re.S | re.I)

# Screener footnote markers — "...drilling services[1]" — are references to its
# own source list, which we are not storing. Left in, they read as corrupted
# text on the stock page.
_FOOTNOTE_RE = re.compile(r'\[\d+\]')

# Below this, whatever matched is not a business description. Observed real
# blurbs run 87-345 characters; observed false positives (nav text, single
# labels) run under 40.
MIN_CHARS = 60


def _clean(raw: str) -> str:
    t = re.sub(r"<[^>]+>", "", raw)
    t = html.unescape(t)          # Screener emits &amp; in company names
    t = _FOOTNOTE_RE.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


def fetch_profile(client: httpx.Client, symbol: str) -> dict:
    """Fetch one symbol's profile blurb.

    Returns {"ok": bool, "summary": str | None}. As in business_info.fetch_one,
    `ok` False means the FETCH failed and the caller must not write; ok True
    with summary None means Screener genuinely has no blurb for this symbol.
    Conflating the two is what let a yfinance outage erase good prose.
    """
    last_err = None
    for path in (
        f"https://www.screener.in/company/{symbol}/consolidated/",
        f"https://www.screener.in/company/{symbol}/",
    ):
        try:
            r = client.get(path)
        except Exception as e:                      # network / timeout
            last_err = e
            continue
        if r.status_code == 404:
            # A real answer: Screener does not have this company. Not a failure.
            continue
        if r.status_code != 200:
            last_err = RuntimeError(f"HTTP {r.status_code}")
            continue
        m = _PROFILE_RE.search(r.text) or _FALLBACK_RE.search(r.text)
        if m:
            t = _clean(m.group(1))
            if len(t) >= MIN_CHARS:
                return {"ok": True, "summary": t}
    if last_err is not None:
        log.warning("screener_profile_error", symbol=symbol, error=str(last_err)[:120])
        return {"ok": False, "summary": None}
    return {"ok": True, "summary": None}


def make_profile_client() -> httpx.Client:
    """Reuse the authenticated Screener client — same cookies, same 429 handling."""
    return make_client()
