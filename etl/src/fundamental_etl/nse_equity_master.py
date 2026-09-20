"""NSE's official listed-equity master (EQUITY_L.csv).

WHY THIS EXISTS
---------------
app.universe had 40 active members that are not companies: ~34 ETFs
(NIFTYAXIS, GOLDAXIS, SILVERAXIS, GSEC10ADD, BANK10BETF, MOMETAL …), 5 rights
entitlements (DUCON-RE1, JAYKAY-RE1, KSHITIJ-RE, RATNA-RE, VHLTD-RE1) and
MANBRO. All 40 have zero rows in app.fundamentals_annual, so no sector label
could ever make them scoreable — they sat permanently in the 'insufficient'
maturity tier, which is why that counter was a constant 42 rather than a signal.

sync-universe already tries to exclude funds, by ISIN prefix (INF = fund unit,
INE = company). That filter is correct but these 40 slip under it: they have no
ISIN at all, in golden OR in app.upstox_instrument, and the filter deliberately
admits an unknown-ISIN candidate rather than risk dropping a day-1 IPO whose
ISIN nobody has indexed yet. That tradeoff is right. It just needs a second,
independent signal for the case where the ISIN is simply absent.

WHY THIS SOURCE
---------------
EQUITY_L.csv is NSE's own list of listed equities. It is a static file on
nsearchives (not the bot-walled dynamic API — see classification.py for that
wall), and ETFs and rights entitlements are ABSENT from it entirely rather than
tagged. That absence is the signal.

Note it is NOT a series filter. The file carries SERIES values EQ / BE / BZ
only; there is no 'ETF' series to exclude. Membership in the file is the test.

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
Absence from EQUITY_L does NOT by itself mean "not a company". 17 active
universe members are absent from it while carrying 10-19 years of
fundamentals — EDUCOMP, ORTEL, QUINTEGRA, NAGAFERT, CEREBRAINT and others.
Those are real companies that NSE has delisted or suspended, and two of them
(SELMC, SILLYMONKS) are currently scored and live on the site.

So the rule implemented here is the CONJUNCTION:

    absent from EQUITY_L  AND  zero rows in app.fundamentals_annual

which selects exactly the 40 and nothing else. Whether delisted companies
should stay in the universe is a separate product question about what the site
shows, not a data-hygiene fix, and it must not ride along silently with this
one. `delisted_but_real()` exists to REPORT that population, never to retire it.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime

import httpx

from .log import log

CSV_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"

# nsearchives serves the static CSVs to a plain client, but a default httpx
# User-Agent gets a 403 — the same edge rules that wall the dynamic API apply
# here, just less aggressively.
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# A sane floor for "the file downloaded correctly". The real file is ~2,578
# rows; anything under this is a truncated response, an error page that happens
# to parse, or NSE serving a stub — all of which would look like "thousands of
# symbols are not listed equities" and retire the entire universe if trusted.
MIN_PLAUSIBLE_ROWS = 1500


class EquityMasterError(RuntimeError):
    """Raised when the master cannot be fetched or fails the sanity floor."""


def _parse_listing_date(raw: str) -> date | None:
    """'06-OCT-2008' → date(2008, 10, 6). None when absent or unparseable."""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d-%b-%Y").date()
    except ValueError:
        return None


def parse(raw_csv: str) -> dict[str, dict]:
    """symbol → {name, series, isin, listing_date, face_value}.

    Several headers carry a LEADING SPACE in NSE's file (' SERIES',
    ' ISIN NUMBER', ' DATE OF LISTING'). Both spellings are accepted so a
    silent upstream cleanup doesn't empty every field at once.
    """
    def pick(row: dict, *names: str) -> str:
        for n in names:
            v = row.get(n)
            if v:
                return v.strip()
        return ""

    out: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(raw_csv)):
        sym = pick(row, "SYMBOL")
        if not sym:
            continue
        out[sym] = {
            "name": pick(row, "NAME OF COMPANY"),
            "series": pick(row, " SERIES", "SERIES"),
            "isin": pick(row, " ISIN NUMBER", "ISIN NUMBER"),
            "listing_date": _parse_listing_date(
                pick(row, " DATE OF LISTING", "DATE OF LISTING")),
        }
    return out


def fetch() -> dict[str, dict]:
    """Download and parse the master. Raises EquityMasterError on any doubt.

    Raising rather than returning a partial map is deliberate: every caller
    uses this to decide what is NOT a listed equity, so an empty or truncated
    map does not mean "nothing is listed" — it means we do not know, and acting
    on it would retire real companies.
    """
    try:
        resp = httpx.get(CSV_URL, headers={"User-Agent": _UA}, timeout=30.0,
                         follow_redirects=True)
    except httpx.HTTPError as e:
        raise EquityMasterError(f"GET {CSV_URL} failed: {e}") from e
    if resp.status_code != 200:
        raise EquityMasterError(f"GET {CSV_URL} → HTTP {resp.status_code}")

    master = parse(resp.text)
    if len(master) < MIN_PLAUSIBLE_ROWS:
        raise EquityMasterError(
            f"EQUITY_L.csv parsed to only {len(master)} symbols "
            f"(floor {MIN_PLAUSIBLE_ROWS}) — refusing to treat this as the "
            f"listed-equity master")
    log.info("equity_master_loaded", symbols=len(master))
    return master


def _absent(master: dict[str, dict], symbols) -> set[str]:
    return {s for s in symbols if s.upper() not in master}


def non_equity(master: dict[str, dict], symbols,
               fundamental_rows: dict[str, int]) -> list[str]:
    """The CONJUNCTION: absent from EQUITY_L AND zero fundamentals_annual rows.

    This is the only set safe to retire. `fundamental_rows` must be a count per
    symbol; a symbol MISSING from that map counts as zero, so the caller has to
    pass counts for every symbol it is asking about — pass the full map, not
    just the non-zero entries.
    """
    return sorted(s for s in _absent(master, symbols)
                  if fundamental_rows.get(s, 0) == 0)


def delisted_but_real(master: dict[str, dict], symbols,
                      fundamental_rows: dict[str, int]) -> list[str]:
    """Absent from EQUITY_L but carrying fundamentals — REPORT ONLY.

    These are real operating companies that NSE has delisted or suspended
    (EDUCOMP, ORTEL, NAGAFERT …). Some are currently scored and live on the
    site. Whether the universe should keep showing them is a product question,
    deliberately not answered here: nothing in this codebase retires this list.
    """
    return sorted(s for s in _absent(master, symbols)
                  if fundamental_rows.get(s, 0) > 0)
