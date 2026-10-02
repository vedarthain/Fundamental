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
wall), and ETFs are ABSENT from it entirely rather than tagged. That absence is
the signal.

Note it is NOT a series filter. The file carries SERIES values EQ / BE / BZ
only; there is no 'ETF' series to exclude. Membership in the file is the test.

CORRECTION, 2026-09-27: RIGHTS ENTITLEMENTS ARE NOT ABSENT
----------------------------------------------------------
This file used to claim absence covered rights entitlements too. It does not,
and the claim was self-concealing. A rights entitlement IS in EQUITY_L for the
~2-week subscription window and drops out when it expires:

    CENTEXT-RE,Century Extrusions Limited-RE,BE,23-SEP-2026,…,INE281A20018,1

The five REs that motivated this module (DUCON-RE1, JAYKAY-RE1, KSHITIJ-RE,
RATNA-RE, VHLTD-RE1) all have a NULL listing_date in app.universe — they were
measured AFTER their windows closed, when they had already fallen out of the
file. So the absence rule appeared to catch rights entitlements while actually
only catching EXPIRED ones: cleanup after the damage, never prevention. It is
§5's failure exactly — a check whose passing condition arrives on its own.

The cost was one CI failure per NSE rights issue, forever. CENTEXT-RE was
onboarded 2026-09-26, Screener returned not_found (there is nothing to have a
page about), and coverage.fetch_failing_is_empty went red.

The discriminator that works was already in the row being read: the ISIN's
security-type digits. See _is_equity_isin().

WHAT KEEPS THIS CURRENT (§5)
----------------------------
coverage.fetch_failing_is_empty. A non-company admitted to the universe has no
Screener page, so it lands in fetch_failing and fails the nightly run — which
is how this defect surfaced in the first place. That check is the tripwire; no
new assertion is added here, because a second one testing the same thing would
be decoration.

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

# NSE EMERGE — the SME board. A SEPARATE file, not a series inside EQUITY_L.
#
# WHY THIS WAS ADDED (2026-10-02). Every SME IPO since July was invisible on the
# site: 24 of 24 NSE-listed SME issues in app.ipo had zero rows in
# golden.price_history and no app.universe membership. Two independent gates were
# doing it. The first was the bhavcopy series filter (scripts/refresh-ltp.py),
# which admitted EQ/BE/BZ/BL and so dropped series SM and ST — SME scrips are in
# the SAME sec_bhavdata_full file, just under those two series. The second is
# THIS module: sync-universe refuses to onboard a candidate that is absent from
# the master and has zero fundamentals, and a day-1 SME IPO is exactly that
# shape, so fixing the series filter alone would have moved the blockage one
# step later and looked like a different bug.
#
# EQUITY_L is mainboard-only — measured 2026-10-02, 2,593 rows, and none of
# COREIN / TEJA / METALIC / POOJALOGIS appear in it while all four trade.
SME_CSV_URL = "https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv"

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

# Same floor logic for the EMERGE file, sized to it: 575 rows on 2026-10-02.
# It gets its own constant rather than sharing one, because a single floor that
# both files must clear would have to be set low enough for the smaller file and
# would then stop protecting the larger one.
MIN_PLAUSIBLE_SME_ROWS = 300


class EquityMasterError(RuntimeError):
    """Raised when the master cannot be fetched or fails the sanity floor."""


def _parse_listing_date(raw: str) -> date | None:
    """'06-OCT-2008' → date(2008, 10, 6). None when absent or unparseable.

    THE TWO FILES DO NOT AGREE ON THE YEAR. EQUITY_L writes four digits
    ('29-NOV-1995'); the EMERGE file writes two ('30-Sep-26'), so %Y alone
    returned None for all 574 SME rows — silently, since None is also the
    legitimate "no date here" answer. That mattered beyond cosmetics:
    maturity_tier reserves 'new' for stocks listed within ~2 years and reads
    listing_date to do it, so every SME name would have been tiered purely on
    Screener history depth, and the §3c listing_date backfill would have had
    nothing to write.

    %y resolves 00-68 to 20xx, which is correct for every SME listing — the
    EMERGE board opened in 2012. Four-digit is tried first so nothing about the
    mainboard parse changes.
    """
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _is_equity_isin(isin: str) -> bool:
    """Is this ISIN an ORDINARY SHARE, as opposed to a rights entitlement?

    Characters 8-9 of an Indian ISIN are the security type: '01' is equity
    shares, '20' is a rights entitlement. INE281A01026 is Century Extrusions;
    INE281A20018 is the right to subscribe to it, which is a tradeable
    instrument for about two weeks and is not a company.

    A WHITELIST, deliberately. Excluding a known-bad '20' would require knowing
    the full security-type code list, which I do not; admitting only '01' means
    an unfamiliar code is excluded rather than silently onboarded. Measured on
    the 2026-09-27 file: 2584 rows are '01' and exactly one is '20'
    (CENTEXT-RE). Across the live active universe, 2576 members are '01', 24
    have no ISIN, and none are anything else — so this rule retires nothing
    real.

    A missing or malformed ISIN returns True. That preserves the existing
    admit-on-doubt tradeoff: the ISIN filter elsewhere deliberately admits an
    unknown-ISIN candidate rather than drop a day-1 IPO nobody has indexed yet,
    and this filter must not quietly reverse it.
    """
    isin = (isin or "").strip().upper()
    if len(isin) != 12:
        return True
    return isin[7:9] == "01"


def parse(raw_csv: str, board: str = "main") -> dict[str, dict]:
    """symbol → {name, series, isin, listing_date, board}.

    Several headers carry a LEADING SPACE in NSE's mainboard file (' SERIES',
    ' ISIN NUMBER', ' DATE OF LISTING'). Both spellings are accepted so a
    silent upstream cleanup doesn't empty every field at once.

    THE EMERGE FILE SPELLS ITS HEADERS WITH UNDERSCORES. Same columns, same
    order, different names: NAME_OF_COMPANY, SERIES, DATE_OF_LISTING,
    ISIN_NUMBER. This matters more than it looks: without the underscore
    spellings every SME row parses to an empty ISIN, and _is_equity_isin("")
    returns True by design (admit-on-doubt), so all 575 would be ADMITTED with
    no name and no listing_date rather than rejected loudly. A header-name miss
    here fails open, not closed — which is why both spellings are listed for
    every field instead of branching on `board`.
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
        if not _is_equity_isin(pick(row, " ISIN NUMBER", "ISIN NUMBER",
                                    "ISIN_NUMBER")):
            continue
        out[sym] = {
            "name": pick(row, "NAME OF COMPANY", "NAME_OF_COMPANY"),
            "series": pick(row, " SERIES", "SERIES"),
            "isin": pick(row, " ISIN NUMBER", "ISIN NUMBER", "ISIN_NUMBER"),
            "listing_date": _parse_listing_date(
                pick(row, " DATE OF LISTING", "DATE OF LISTING",
                     "DATE_OF_LISTING")),
            "board": board,
        }
    return out


def _get(url: str) -> str:
    try:
        resp = httpx.get(url, headers={"User-Agent": _UA}, timeout=30.0,
                         follow_redirects=True)
    except httpx.HTTPError as e:
        raise EquityMasterError(f"GET {url} failed: {e}") from e
    if resp.status_code != 200:
        raise EquityMasterError(f"GET {url} → HTTP {resp.status_code}")
    return resp.text


def fetch() -> dict[str, dict]:
    """Download and parse BOTH masters, unioned. Raises on any doubt.

    Raising rather than returning a partial map is deliberate: every caller
    uses this to decide what is NOT a listed equity, so an empty or truncated
    map does not mean "nothing is listed" — it means we do not know, and acting
    on it would retire real companies.

    WHY A FAILED EMERGE FETCH RAISES INSTEAD OF DEGRADING TO MAINBOARD-ONLY.
    The tempting fallback — "EQUITY_L loaded, EMERGE didn't, carry on with what
    we have" — is the most dangerous thing this module could do. non_equity()
    reads absence from the returned map as evidence, so a mainboard-only map
    makes every SME member of app.universe look absent; the ones without
    fundamentals yet would then be retired by a transient 403 on one file. One
    missing file must mean "we do not know", exactly as it already does for
    EQUITY_L, so both fetches are inside the same all-or-nothing contract and
    the caller's existing `master_ok=False` path (retire nothing, exclude
    nothing) covers the SME board for free.

    Overlap between the two files is not expected and not relied on; mainboard
    is applied last so a symbol appearing in both is labelled 'main'.
    """
    sme = parse(_get(SME_CSV_URL), board="sme")
    if len(sme) < MIN_PLAUSIBLE_SME_ROWS:
        raise EquityMasterError(
            f"SME_EQUITY_L.csv parsed to only {len(sme)} symbols "
            f"(floor {MIN_PLAUSIBLE_SME_ROWS}) — refusing to treat this as the "
            f"EMERGE master")

    main = parse(_get(CSV_URL), board="main")
    if len(main) < MIN_PLAUSIBLE_ROWS:
        raise EquityMasterError(
            f"EQUITY_L.csv parsed to only {len(main)} symbols "
            f"(floor {MIN_PLAUSIBLE_ROWS}) — refusing to treat this as the "
            f"listed-equity master")

    master = {**sme, **main}
    log.info("equity_master_loaded", symbols=len(master),
             main=len(main), sme=len(sme))
    return master


def sme_symbols(master: dict[str, dict]) -> set[str]:
    """Symbols the EMERGE master claims, for stamping app.universe.is_sme."""
    return {s for s, r in master.items() if r.get("board") == "sme"}


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
