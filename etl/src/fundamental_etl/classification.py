"""Fill app.universe.sector / .industry from Screener's company page.

WHY THIS EXISTS
---------------
`sync-universe` enriches a new listing's identity by LEFT JOINing golden.stocks
(cli.py, the `SELECT DISTINCT ON (l.sym) ... s.sector, s.industry` block). That
join has always matched — but for every symbol onboarded after the original
seed it matches a row that is itself empty, so the enrichment faithfully copies
NULL.

The empty rows come from `scripts/refresh-ltp.py::upsert_golden_stocks`, which
inserts EVERY symbol in the daily bhavcopy into golden.stocks so the FK on
price_history is satisfied. It deliberately fills only the NOT NULL columns
(symbol, exchange, company_name, is_active) and leaves sector/industry/isin/
listing_date for "the weekly sync-neon.sh" — but sync-neon.sh syncs app.* and
golden.price_history and has never touched golden.stocks. So nothing has
enriched that table since the initial import:

    golden.stocks:  2,964 rows,  2,163 with sector   (frozen at the seed)
    app.universe:   2,634 active, 2,150 clustered

That 2,163 boundary is the same fingerprint as app.screener_meta's 2,150 — both
are one-off seeds that no recurring job maintains. This module is the recurring
job for the classification half.

WHY SCREENER AND NOT NSE
------------------------
NSE's own per-symbol classification endpoint is not reachable:

    /api/quote-equity?symbol=X      403 Access Denied   (the one with industryInfo)
    /api/equity-meta-info?symbol=X  404 (endpoint retired)

The wall is endpoint-specific, not IP-level — /api/results-comparision returns
200 from the same session, which is why nse/results.py still works. NSE's
unwalled bulk CSVs on nsearchives carry the right taxonomy but only cover index
members: Nifty Total Market is 755 names and hit 3 of the 484 symbols this was
built for (0.6%), which is structural — the cohort is by definition everything
outside the top 755.

Screener's company page carries the SAME classification. Its breadcrumb links
to /market/IN03/IN0301/IN030103/IN030103001/ — NSE's four-level
macro / sector / industry / basicIndustry hierarchy, codes and all. Levels 2
and 3 reproduce golden.stocks.sector and .industry EXACTLY: 12 of 12 on both
levels across a probe spanning banks, pharma, IT, realty, metals, chemicals,
power, cement, retail and defence.

That matters more than convenience. The alternative sources all speak a
different dialect (Yahoo's "Specialty Chemicals", BSE's own groups), which
would need a hand-maintained mapping table into the vocabulary clusters/rules.py
expects — and every NSE reclassification would silently rot it. Here there is
no mapping at all: the strings are already the target vocabulary.

We also already hold an authenticated Screener session, already GET these exact
pages weekly for shareholding, and 444 of the 484 returned last_status='ok' on
the most recent fetch. This adds no new dependency and no new failure mode.

ONE NORMALIZATION, AND WHY IT IS NOT COSMETIC
---------------------------------------------
Screener renders the sector level as 'Oil, Gas & Consumable Fuels'; the rows
golden seeded say 'Oil Gas & Consumable Fuels'. Same NSE label, different comma
convention. clusters/rules.py normalizes with strip().lower() only (`_norm`), so
the two spellings are NOT equal to the rule engine.

Writing Screener's spelling as-is would put two variants of one sector into a
column the UI groups by. The Scanner's sector rail would grow a duplicate row,
the reviewed-counter denominator would drift, and any rule keyed on that sector
would match only half its members. We strip commas to match the convention
already in the table — the existing 2,163 rows are the reference, not us.
"""
from __future__ import annotations

import html as htmllib
import re
import time
from datetime import datetime, timezone

import httpx

from .db import app_conn
from .log import log
from .screener.scraper import _client, NotFound, AuthFailed, ScrapeError

BASE = "https://www.screener.in"

# Screener's classification breadcrumb. The href encodes depth by path segment
# count: IN03 = macro, IN03/IN0301 = sector, .../IN030103 = industry,
# .../IN030103001 = basic industry. We capture the anchor text at each depth.
_CRUMB = re.compile(
    r'<a[^>]+href="(/market/IN[0-9]+(?:/IN[0-9]+)*/)"[^>]*>\s*(.*?)\s*</a>',
    re.S,
)
_TAGS = re.compile(r"<[^>]+>")

# Depth (segment count after stripping the surrounding slashes) of the two
# levels we store. Named rather than inlined because the off-by-one here is
# genuinely easy to get wrong: '/market/IN03/' strips to 'IN03' and counts ZERO
# slashes, so the macro level is depth 1 in this scheme, not 0.
SECTOR_DEPTH = 2
INDUSTRY_DEPTH = 3


def _clean(raw: str) -> str:
    """Anchor innerHTML → the stored label.

    Strips nested markup, unescapes entities, collapses whitespace, and drops
    commas so the result matches the comma-free convention already in
    app.universe / golden.stocks. See the module docstring on why that last
    step is load-bearing.
    """
    txt = htmllib.unescape(_TAGS.sub("", raw))
    txt = txt.replace(",", "")
    return re.sub(r"\s+", " ", txt).strip()


def parse_classification(html: str) -> dict[str, str | None]:
    """Extract {'sector', 'industry'} from a Screener company page.

    Returns None for a level whose breadcrumb link is absent rather than
    guessing from a neighbouring level — a half-known classification that looks
    complete is how a stock ends up silently peer-ranked against the wrong
    cluster.
    """
    levels: dict[int, str] = {}
    for href, inner in _CRUMB.findall(html):
        depth = href.strip("/").count("/")
        label = _clean(inner)
        if label:
            levels[depth] = label
    return {
        "sector": levels.get(SECTOR_DEPTH),
        "industry": levels.get(INDUSTRY_DEPTH),
    }


def fetch_one(symbol: str, client: httpx.Client) -> dict[str, str | None]:
    """Fetch + parse classification for one symbol.

    Tries /consolidated/ then the plain page, mirroring shareholding.fetch_one —
    the breadcrumb is identical on both, but which one exists varies by company.
    """
    for path in (f"/company/{symbol}/consolidated/", f"/company/{symbol}/"):
        url = BASE + path
        resp = client.get(url)
        if resp.status_code == 404:
            continue
        if resp.status_code in (301, 302) and "/login" in resp.headers.get("location", ""):
            raise AuthFailed(f"Login redirect on {url}")
        if resp.status_code != 200:
            raise ScrapeError(f"GET {url} → HTTP {resp.status_code}")
        found = parse_classification(resp.text)
        if found["sector"] or found["industry"]:
            return found
    return {"sector": None, "industry": None}


def fetch_many(
    only: list[str] | None = None,
    skip_existing: bool = True,
    throttle_s: float = 1.5,
) -> dict:
    """Backfill classification for many symbols.

    Default scope is exactly the rows that need it — active symbols whose
    sector OR industry is NULL. That makes the command self-terminating: once a
    symbol is classified it drops out of the work list forever, so this is safe
    to run on every weekly cycle and costs nothing when there is nothing to do.

    `skip_existing=False` (--refresh) re-fetches everything, for when NSE
    reclassifies and the stored labels need to catch up.
    """
    counts = {"ok": 0, "skipped": 0, "partial": 0, "no_data": 0, "error": 0}

    with app_conn() as conn:
        with conn.cursor() as cur:
            if only:
                cur.execute(
                    "SELECT symbol, sector, industry FROM app.universe "
                    "WHERE symbol = ANY(%s) AND is_active ORDER BY symbol",
                    (only,),
                )
            else:
                cur.execute(
                    "SELECT symbol, sector, industry FROM app.universe "
                    "WHERE is_active ORDER BY symbol"
                )
            rows = cur.fetchall()

    if skip_existing:
        targets = [r["symbol"] for r in rows if not r["sector"] or not r["industry"]]
        counts["skipped"] = len(rows) - len(targets)
    else:
        targets = [r["symbol"] for r in rows]

    log.info("plan", total=len(targets), skipped=counts["skipped"])

    with _client() as scrape:
        for i, sym in enumerate(targets, 1):
            try:
                found = fetch_one(sym, scrape)
            except (NotFound, AuthFailed, ScrapeError) as e:
                counts["error"] += 1
                log.error("scrape_error", symbol=sym, error=str(e)[:120])
                continue
            except Exception as e:
                counts["error"] += 1
                log.error("unexpected_error", symbol=sym, error=str(e)[:120])
                continue

            if not found["sector"] and not found["industry"]:
                counts["no_data"] += 1
                log.warning("no_classification", symbol=sym)
            else:
                if not found["sector"] or not found["industry"]:
                    counts["partial"] += 1
                    log.warning("partial_classification", symbol=sym, **found)
                else:
                    counts["ok"] += 1

                # COALESCE on the SET side, not a WHERE guard: a symbol whose
                # sector is known but industry is not must still get its
                # industry filled on a later run. Writing NULL over a value we
                # already hold would be a regression, so the incoming NULL
                # loses and the stored value wins.
                with app_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE app.universe
                               SET sector   = COALESCE(%s, sector),
                                   industry = COALESCE(%s, industry),
                                   synced_at = %s
                             WHERE symbol = %s
                            """,
                            (found["sector"], found["industry"],
                             datetime.now(timezone.utc), sym),
                        )
                        if cur.rowcount != 1:
                            # Same tripwire as screener_meta's _assert_wrote. A
                            # write that touched no rows is a failed write, and
                            # the five-month silent gap this module exists to
                            # repair is what happens when nobody checks.
                            raise RuntimeError(
                                f"classification UPDATE for {sym} affected "
                                f"{cur.rowcount} rows, expected 1"
                            )
                    conn.commit()

            if i % 25 == 0:
                log.info("progress", done=i, n=len(targets), **counts)
            if i < len(targets):
                time.sleep(throttle_s)

    return counts
