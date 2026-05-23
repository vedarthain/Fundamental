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


class RateLimited(Exception):
    """Screener returned HTTP 429. Carries the requested back-off seconds
    so the retry decorator can sleep the right amount before the next try.
    Subclass of plain Exception (not ScrapeError) so the caller's `except
    ScrapeError:` doesn't accidentally swallow it before the retry runs."""

    def __init__(self, retry_after: float, message: str):
        super().__init__(message)
        self.retry_after = retry_after


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
    # Browser-like default headers. Bot detectors usually look at the full
    # combination (UA + Accept + Accept-Language), not just User-Agent —
    # so we mirror what a real Chrome request would send.
    return httpx.Client(
        cookies={
            "sessionid": settings.screener_sessionid,
            "csrftoken": settings.screener_csrftoken,
        },
        headers={
            "User-Agent": settings.screener_user_agent,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,*/*;q=0.8"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        },
        timeout=30.0,
        follow_redirects=False,
    )


def _is_login_redirect(resp: httpx.Response) -> bool:
    return resp.status_code in (301, 302) and "/login" in resp.headers.get("location", "")


def _maybe_raise_429(resp: httpx.Response, url: str) -> None:
    """Treat soft + hard rate-limit signals as RateLimited so the @retry
    decorator can pause and try again.

    - 429 Too Many Requests: the proper rate-limit code.  Respects the
      Retry-After header when present; defaults to 60s otherwise.
    - 405 Method Not Allowed (POST endpoints only): Screener sometimes
      uses this as a SOFT throttle on the export endpoint when we're
      pushing too hard.  Observed empirically — symptom is sporadic 405s
      mixed with 429s during high-volume scrapes.  No Retry-After header,
      so we use a fixed 60s backoff.
    """
    if resp.status_code not in (405, 429):
        return
    # 30s default backoff (was 60s).  Faster recovery from soft throttles;
    # the @retry mechanism will simply pause again if Screener is still
    # limiting us, so we don't risk getting stuck — just sleep shorter.
    if resp.status_code == 405:
        retry_after = 30.0
        log.warning("rate_limited_405", url=url, retry_after=retry_after)
        raise RateLimited(retry_after, f"{resp.request.method} {url} returned HTTP 405 (treating as throttle, sleeping {retry_after}s)")
    raw = resp.headers.get("Retry-After", "30")
    try:
        retry_after = float(raw)
    except (TypeError, ValueError):
        retry_after = 30.0
    # Cap at 5 minutes — Screener's 429 windows are typically short; a
    # longer reported value usually means our IP has been deeper-throttled
    # and we'd rather give up than block the run for ages.
    retry_after = min(retry_after, 300.0)
    log.warning("rate_limited", url=url, retry_after=retry_after)
    raise RateLimited(retry_after, f"GET {url} returned HTTP 429 (sleeping {retry_after}s)")


# Smart wait policy used by both @retry decorators below. On a RateLimited
# exception we sleep the exact retry-after the server told us. On any other
# retryable error (httpx.TransportError) we fall back to exponential backoff.
_EXP_WAIT = wait_exponential(multiplier=1, min=2, max=10)

def _smart_wait(retry_state) -> float:
    outcome = retry_state.outcome
    exc = outcome.exception() if outcome else None
    if isinstance(exc, RateLimited):
        return exc.retry_after
    return _EXP_WAIT(retry_state)


@retry(
    stop=stop_after_attempt(5),
    wait=_smart_wait,
    retry=retry_if_exception_type((httpx.TransportError, RateLimited)),
    reraise=True,
)
def discover_export(
    client: httpx.Client,
    symbol: str,
    prefer: str = "consolidated",
) -> CompanyExportInfo:
    """Fetch the company page and extract export_id + CSRF token.

    `prefer="consolidated"` (default): try /consolidated/ first, fall back to standalone.
    `prefer="standalone"`: only try standalone (Screener's older/denser view for many stocks).
    """
    last_seen_status: str | None = None
    if prefer == "standalone":
        attempts = (("standalone", f"/company/{symbol}/"),)
    else:
        attempts = (
            ("consolidated", f"/company/{symbol}/consolidated/"),
            ("standalone",   f"/company/{symbol}/"),
        )
    for variant, path in attempts:
        url = BASE + path
        resp = client.get(url)
        if _is_login_redirect(resp):
            raise AuthFailed(f"Login redirect on {url} — Screener cookies expired")
        _maybe_raise_429(resp, url)
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
    stop=stop_after_attempt(5),
    wait=_smart_wait,
    retry=retry_if_exception_type((httpx.TransportError, RateLimited)),
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
    _maybe_raise_429(resp, url)
    if resp.status_code != 200:
        raise ScrapeError(f"POST {url} returned HTTP {resp.status_code}")
    ct = resp.headers.get("content-type", "")
    if "spreadsheet" not in ct and "officedocument" not in ct:
        raise ScrapeError(f"Expected xlsx, got content-type={ct}")
    return resp.content


def fetch_company_export(
    symbol: str,
    client: Optional[httpx.Client] = None,
    prefer: str = "consolidated",
) -> tuple[CompanyExportInfo, bytes]:
    """End-to-end: discover export_id, download xlsx. Returns (info, bytes)."""
    own_client = client is None
    cli = client or _client()
    try:
        info = discover_export(cli, symbol, prefer=prefer)
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
