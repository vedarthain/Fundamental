"""NSE authoritative quarterly-results fallback.

Screener is the primary fundamentals source, but for a handful of symbols
(mostly post-2023 IPOs) Screener's export ships with an empty Quarters section
and no fresh annuals — so the stock has *no latest result* on the site and,
worse, gets scored off stale pre-IPO annuals. For those gap symbols the NSE
corporate-filings API is the authoritative source of the missing quarters.

Endpoint (public, but Akamai-bot-walled):
    GET /api/results-comparision?symbol=SYM
returns the last ~5 filed quarters under `resCmpData`, plus `bankNonBnking`
('Y' bank / 'N' non-bank) which selects the P&L field layout.

IMPORTANT — this will NOT work from Vercel or GitHub-Actions IPs. NSE's Akamai
edge returns 403 to datacenter ranges. It runs from a residential/desktop IP
(the operator's machine) only. That's fine: this is a manual, occasional
gap-fill, not part of the weekly automated pipeline.

UNITS: NSE files values in ₹ **lakh**; our schema (matching Screener) is in
₹ **crore**. We divide by 100. Verified against BLUEJET Q3FY25:
net_sale 31838.24 lakh → ₹318.38 cr; net_profit 9898.31 lakh → ₹98.98 cr.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

import httpx

from ..log import log
from ..screener.parser import ParsedExport

BASE = "https://www.nseindia.com"
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Lakh → crore.
_LAKH_TO_CRORE = 100.0


class NSEFetchError(Exception):
    """NSE endpoint unreachable, bot-walled, or returned no data."""


def make_nse_client() -> httpx.Client:
    """A browser-shaped client. NSE requires a real UA + priming GET so Akamai
    issues the cookies the API endpoint checks for."""
    return httpx.Client(
        headers={
            "User-Agent": _UA,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        },
        timeout=30.0,
        follow_redirects=True,
    )


def _prime(client: httpx.Client, symbol: str) -> None:
    """Hit the get-quote page so Akamai sets the cookies the API checks."""
    client.get(f"{BASE}/get-quote/equity/{symbol}")


def _f(row: dict, *keys: str) -> Optional[float]:
    """First non-null NSE numeric field across `keys`, converted lakh→crore.
    NSE ships numbers as strings ('31838.24') or None."""
    for k in keys:
        raw = row.get(k)
        if raw in (None, "", "-"):
            continue
        try:
            return float(raw) / _LAKH_TO_CRORE
        except (TypeError, ValueError):
            continue
    return None


def _parse_dt(v: Optional[str]) -> Optional[date]:
    """NSE dates look like '31-DEC-2024'."""
    if not v:
        return None
    try:
        return datetime.strptime(v.strip(), "%d-%b-%Y").date()
    except ValueError:
        return None


def _map_nonbank_row(row: dict) -> Optional[tuple[date, dict[str, float]]]:
    """Map one non-banking NSE result row to our quarterly schema (₹ cr).

    Operating-profit basis matches Screener's convention: expenses EXCLUDE
    interest, depreciation and other income; operating_profit = sales - expenses.
    NSE's re_oth_tot_exp is total expenses (incl. dep + interest), so we back
    those two out to get the Screener-comparable expense base.
    """
    period_end = _parse_dt(row.get("re_to_dt"))
    if period_end is None:
        return None

    sales = _f(row, "re_net_sale")
    other_income = _f(row, "re_oth_inc_new", "re_oth_inc")
    pbt = _f(row, "re_pro_loss_bef_tax")
    tax = _f(row, "re_tax", "re_curr_tax")
    net_profit = _f(row, "re_net_profit", "re_proloss_ord_act", "re_con_pro_loss")
    interest = _f(row, "re_int_new", "re_int_expd")
    depreciation = _f(row, "re_depr_und_exp")
    tot_exp = _f(row, "re_oth_tot_exp")

    cols: dict[str, float] = {}
    if sales is not None:
        cols["sales"] = sales
    if other_income is not None:
        cols["other_income"] = other_income
    if pbt is not None:
        cols["profit_before_tax"] = pbt
    if tax is not None:
        cols["tax"] = tax
    if net_profit is not None:
        cols["net_profit"] = net_profit
    if interest is not None:
        cols["interest"] = interest
    if depreciation is not None:
        cols["depreciation"] = depreciation

    # Screener-comparable operating expenses / operating profit.
    if tot_exp is not None:
        expenses = tot_exp - (depreciation or 0.0) - (interest or 0.0)
        cols["expenses"] = expenses
        if sales is not None:
            cols["operating_profit"] = sales - expenses

    if not cols:
        return None
    return period_end, cols


def fetch_nse_results(
    symbol: str,
    client: Optional[httpx.Client] = None,
) -> ParsedExport:
    """Fetch the last few filed quarters from NSE and return a ParsedExport with
    only `quarterly` populated (in ₹ cr). Annuals are NOT sourced from NSE.

    Raises NSEFetchError on 403 (bot wall), non-200, or empty/banking payloads
    we don't map. Banking companies use a different P&L layout (re_int_earned
    as revenue) that we deliberately don't reconstruct — mis-mapping a bank's
    interest income as sales would corrupt scores far worse than a missing card.
    """
    own = client is None
    cli = client or make_nse_client()
    try:
        _prime(cli, symbol)
        resp = cli.get(
            f"{BASE}/api/results-comparision",
            params={"symbol": symbol},
            headers={"Referer": f"{BASE}/get-quote/equity/{symbol}"},
        )
        if resp.status_code == 403:
            raise NSEFetchError(
                f"NSE returned 403 for {symbol} — Akamai bot wall (run from a "
                "residential IP, not a datacenter/CI host)"
            )
        if resp.status_code != 200:
            raise NSEFetchError(f"NSE returned HTTP {resp.status_code} for {symbol}")

        payload = resp.json()
        if payload.get("bankNonBnking") == "Y":
            raise NSEFetchError(
                f"{symbol} is a banking entity — NSE bank P&L layout not mapped; "
                "skipping to avoid corrupting scores"
            )
        rows = payload.get("resCmpData") or []
        if not rows:
            raise NSEFetchError(f"NSE returned no quarterly rows for {symbol}")

        out = ParsedExport()
        for row in rows:
            mapped = _map_nonbank_row(row)
            if mapped is None:
                continue
            period_end, cols = mapped
            out.quarterly[period_end] = cols

        if not out.quarterly:
            raise NSEFetchError(f"Mapped 0 quarters for {symbol} from NSE payload")

        log.info("nse_results_fetched", symbol=symbol, quarters=len(out.quarterly))
        return out
    except httpx.HTTPError as e:
        raise NSEFetchError(f"NSE request failed for {symbol}: {e}") from e
    finally:
        if own:
            cli.close()
