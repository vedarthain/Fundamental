"""Screener.in scraper.

Two-step flow per ticker:
  1. GET  /company/{TICKER}/consolidated/   → parse out export_id + csrf token
  2. POST /user/company/export/{export_id}/ → returns xlsx bytes

Falls back to /company/{TICKER}/ (standalone) if /consolidated/ 404s — common for
companies without consolidated financials (no subsidiaries).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from ..config import settings
from ..log import log

BASE = "https://www.screener.in"

_RE_EXPORT_ID = re.compile(r'formaction="/user/company/export/(\d+)/"')
_RE_CSRF = re.compile(r'name="csrfmiddlewaretoken" value="([^"]+)"')


class ScrapeError(Exception):
    """Generic scrape failure."""


class NotFound(ScrapeError):
    """Company page returns 404 on both consolidated and standalone."""


class AuthFailed(ScrapeError):
    """Cookie session is no longer valid (login redirect or 403)."""


@dataclass
class CompanyExportInfo:
    symbol: str
    variant: str  # "consolidated" or "standalone"
    export_id: str
    csrf_token: str
    referer: str


def _client() -> httpx.Client:
    return httpx.Client(
        cookies={
            "sessionid": settings.screener_sessionid,
            "csrftoken": settings.screener_csrftoken,
        },
        headers={"User-Agent": settings.screener_user_agent},
        timeout=30.0,
        follow_redirects=False,
    )


def _is_login_redirect(resp: httpx.Response) -> bool:
    return resp.status_code in (301, 302) and "/login" in resp.headers.get("location", "")


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(httpx.TransportError),
    reraise=True,
)
def discover_export(client: httpx.Client, symbol: str) -> CompanyExportInfo:
    """Fetch the company page and extract export_id + CSRF token.

    Tries /consolidated/ first, falls back to standalone /.
    """
    last_seen_status: str | None = None
    for variant, path in (("consolidated", f"/company/{symbol}/consolidated/"),
                          ("standalone", f"/company/{symbol}/")):
        url = BASE + path
        resp = client.get(url)
        if _is_login_redirect(resp):
            raise AuthFailed(f"Login redirect on {url} — Screener cookies expired")
        if resp.status_code == 404:
            last_seen_status = "404"
            continue
        if resp.status_code != 200:
            raise ScrapeError(f"GET {url} returned HTTP {resp.status_code}")

        html = resp.text
        m_export = _RE_EXPORT_ID.search(html)
        m_csrf = _RE_CSRF.search(html)
        if not m_export:
            if "Logout" not in html:
                raise AuthFailed(f"No Logout link on {url} — not authenticated")
            # Page loaded, auth ok, but no export button. Common case: small companies
            # have no consolidated view, so /consolidated/ shows a placeholder. Fall through
            # to /standalone/ on the next loop iteration.
            last_seen_status = "no_export_button"
            continue
        if not m_csrf:
            raise ScrapeError(f"CSRF token missing on {url}")

        return CompanyExportInfo(
            symbol=symbol,
            variant=variant,
            export_id=m_export.group(1),
            csrf_token=m_csrf.group(1),
            referer=url,
        )

    if last_seen_status == "no_export_button":
        raise ScrapeError(f"Export button missing on both consolidated and standalone for {symbol}")
    raise NotFound(f"No company page found for {symbol} (tried consolidated + standalone)")


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(httpx.TransportError),
    reraise=True,
)
def download_export(client: httpx.Client, info: CompanyExportInfo) -> bytes:
    """POST the export form and return xlsx bytes."""
    url = f"{BASE}/user/company/export/{info.export_id}/"
    next_path = info.referer.removeprefix(BASE)
    resp = client.post(
        url,
        data={
            "csrfmiddlewaretoken": info.csrf_token,
            "next": next_path,
        },
        headers={
            "Referer": info.referer,
            "Origin": BASE,
        },
    )
    if _is_login_redirect(resp):
        raise AuthFailed(f"Login redirect on POST {url} — Screener cookies expired")
    if resp.status_code != 200:
        raise ScrapeError(f"POST {url} returned HTTP {resp.status_code}")
    ct = resp.headers.get("content-type", "")
    if "spreadsheet" not in ct and "officedocument" not in ct:
        raise ScrapeError(f"Expected xlsx, got content-type={ct}")
    return resp.content


def fetch_company_export(symbol: str, client: Optional[httpx.Client] = None) -> tuple[CompanyExportInfo, bytes]:
    """End-to-end: discover export_id, download xlsx. Returns (info, bytes)."""
    own_client = client is None
    cli = client or _client()
    try:
        info = discover_export(cli, symbol)
        log.debug("discovered_export", symbol=symbol, variant=info.variant, export_id=info.export_id)
        data = download_export(cli, info)
        log.debug("downloaded_export", symbol=symbol, bytes=len(data))
        return info, data
    finally:
        if own_client:
            cli.close()


def make_client() -> httpx.Client:
    """Public helper so callers can re-use a session across many requests."""
    return _client()
