"""Rule-based cluster assignment.

Maps each NSE stock to one of the 41 peer clusters defined in db/migrations/0003_seed_clusters.sql.
The rule engine considers (sector, industry, market_cap_category, symbol) and applies the first
matching rule from an ordered list.

The mapping reflects docs/sector-clusters.md exactly. Edit cases here when adding overrides.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

# Hardcoded PSU bank list (these become bfsi_psu_banks regardless of market cap).
PSU_BANKS = {
    "SBIN", "PNB", "BANKBARODA", "CANBK", "BANKINDIA", "INDIANB", "UCOBANK",
    "CENTRALBK", "MAHABANK", "UNIONBANK", "IOB", "PSB", "JKBANK",
}

# Capital-markets split: NSE's industry classification dumps AMCs, brokers,
# exchanges, depositories, RTAs, and rating agencies all under "Capital Markets"
# — but their unit economics differ wildly. We segregate via symbol whitelists
# so peer percentiles compare like-for-like. Whitelists are intentionally
# explicit (no fuzzy name match) to avoid silent reclassification when listings
# change. Anything in "capital markets" industry but not in a whitelist falls
# to the broker bucket.

BFSI_AMC_WEALTH = {
    # Pure-play AMCs
    "HDFCAMC", "ICICIAMC", "UTIAMC", "ABSLAMC", "NAM-INDIA", "CRAMC",
    # Wealth managers / advisory
    "360ONE", "NUVAMA", "ANANDRATHI", "PRUDENT", "DAMCAPITAL",
}

BFSI_EXCHANGE = {
    # Stock + commodity + energy exchanges, and central depositories
    "BSE", "MCX", "IEX", "CDSL",
}

BFSI_RTA_RATING = {
    # Registrar/transfer agents
    "CAMS", "KFINTECH",
    # Credit rating agencies
    "ICRA", "CARERATING",
}

# ---------------------------------------------------------------------------
# NSE FILES THESE AS "Finance". THEY ARE NOT LENDERS.
#
# The three whitelists above are reached only by the `_industry(s) ==
# "capital markets"` rules below. But NSE's basic-industry label for a
# merchant bank, a broker with an attached NBFC, or a ratings firm is very
# often **"Finance"**, not "Capital Markets" — verified 2026-10-22, all 16 of
# the names in build/verdicts/bfsi_segments.py's `capital_markets` segment
# carry industry = 'Finance' in app.universe. So every one of them fell
# through to the `bfsi_nbfc` fallback and was scored on `_lender_quality`:
# ranked against 182 balance-sheet lenders on `loan_book_cagr_3y`, `roa_3y`,
# `equity_to_assets` and the 13% bank-ROE track.
#
# CRISIL has no loan book. It was being percentiled on loan growth.
#
# This is not a scorecard gap — `bfsi_broker`, `bfsi_amc_wealth` and
# `bfsi_rta_rating` already exist and already score the right things
# (`roce_*`, `op_margin_*`, `cfo_pat_3y`, `fcf_yield`, no `p_aum`). The only
# defect was the routing, which keyed on an industry string these companies
# do not carry. Hence: same clusters, same scorecards, one extra predicate.
#
# WHY SYMBOL LISTS AND NOT A SMARTER PREDICATE
#
# There is no string in (sector, industry, market_cap_category) that separates
# "Finance" the lender from "Finance" the merchant bank. The distinction lives
# in the business description, which is prose. Matching on prose would
# silently reclassify a company when Screener rewrites a sentence — the exact
# failure the comment above this block warns about for the Capital Markets
# whitelists. Explicit beats fuzzy here for the same reason it does there.
#
# WHAT KEEPS THIS CURRENT  (CLAUDE.md §5)
#
# Nothing automatic, and pretending otherwise would be worse than saying so.
# These three sets are hand-maintained exactly like PSU_BANKS and
# BFSI_PVT_BANKS_LARGE: a name is added when someone reads its business
# description, which in practice happens when a verdict batch is written.
# A new listing that is a broker filed under "Finance" will land in
# `bfsi_nbfc` and be scored as a lender until a human notices.
#
# The countable version of that gap — a DQ assertion over
# `app.company_overview` descriptions of unwhitelisted `bfsi_nbfc` members
# matching /broking|merchant bank|rating|investment bank/ — is the follow-up
# this block is asking for. It does not exist yet. Until it does, this is a
# seeded list, and §5 says to name that rather than leave it implied.
#
# TWO NAMES DELIBERATELY LEFT IN bfsi_nbfc
#
# PNBGILTS and ARCIL are in the capital_markets segment and are NOT moved.
# Both take principal risk on a leveraged debt book — PNBGILTS underwrites and
# trades government securities, ARCIL acquires distressed loan pools — so
# `pb`, `roa_3y` and `equity_to_assets` describe them better than
# `fcf_yield` and `op_margin_3y` do. Moving them would swap one wrong peer
# group for another. They stay, and the reason is recorded here so the next
# pass does not "finish the job" by moving them.

# Ratings and analytics filed as Finance. Economics are the rating oligopoly's
# (subscription + mandate fees, no balance sheet), i.e. ICRA's and
# CARERATING's, not an NBFC's.
BFSI_RTA_RATING_FIN = {
    "CRISIL",
}

# Merchant banking / corporate advisory / investment banking filed as Finance.
# Fee revenue off a mandate pipeline with no loan book — the AMC-wealth
# scorecard's shape (pe_ttm + fcf_yield + earnings_yield_trend, no pb). The
# precedent already in BFSI_AMC_WEALTH is DAMCAPITAL, a pure i-bank.
BFSI_AMC_WEALTH_FIN = {
    "AKCAPIT", "ARYAMAN", "PRIMESECU", "PIONRINV", "THEINVEST",
}

# Broking and securities dealing filed as Finance, including the several that
# run a small NBFC alongside the brokerage. Transaction-driven and cyclical,
# which is why bfsi_broker carries momentum 30 and keeps `pb` in valuation —
# a broker's book is real, it is just not a loan book.
BFSI_BROKER_FIN = {
    "WEALTH", "CHOICEIN", "ASHIKAG", "AVONMORE", "AFSL",
    "ALGOQUANT", "BLBLIMITED", "VLSFINANCE",
}

# Private banks split: large-cap top tier vs Small Finance Banks vs the rest.
# Comparing HDFCBANK (₹11.8L Cr) against an SFB like UJJIVANSFB (₹10K Cr)
# on the same scorecard treats them as peers — but their business models
# (universal franchise vs microfinance-heavy recovering book) and ROE math
# (12-17% steady vs 8% inflecting to 15%) make peer comparison meaningless.
# Anything in "banks" industry but not PSU and not in either of these two
# whitelists falls to the mid/small private banks bucket.

BFSI_PVT_BANKS_LARGE = {
    # Top tier private banks — universal franchise, large-cap, structurally
    # different from regional banks. Membership intentionally narrow.
    "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK",
}

BFSI_SFB = {
    # Small Finance Banks + listed Payments Banks. Microfinance-heavy books
    # with mostly post-2017 listing history. Recovering from MFI cycle lows.
    "UJJIVANSFB", "AUBANK", "EQUITASBNK", "JSFB", "ESAFSFB",
    "SURYODAY", "UTKARSHBNK", "CAPITALSFB", "FINOPB",
}


@dataclass(frozen=True)
class StockMeta:
    symbol: str
    sector: Optional[str]
    industry: Optional[str]
    market_cap_category: Optional[str]


@dataclass(frozen=True)
class Rule:
    cluster_id: str
    predicate: Callable[[StockMeta], bool]
    description: str = ""


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


# Helpers for predicates --------------------------------------------------

def _sector(s: StockMeta) -> str:
    return _norm(s.sector)


def _industry(s: StockMeta) -> str:
    return _norm(s.industry)


def _is_large_cap(s: StockMeta) -> bool:
    return (s.market_cap_category or "").lower() == "large_cap"


# IT services: large vs mid/small split
def _it_services_industry(s: StockMeta) -> bool:
    ind = _industry(s)
    return ind in ("it - software", "it - services", "it-software", "it-services")


# Ordered rule list. First match wins. -----------------------------------
RULES: list[Rule] = [
    # ---- Financials ----
    Rule("bfsi_psu_banks",
         lambda s: _industry(s) == "banks" and s.symbol in PSU_BANKS,
         "Banks industry AND symbol in PSU list"),
    # Private banks split: top-tier large-cap > SFBs > mid/small fallback.
    Rule("bfsi_pvt_banks_large",
         lambda s: _industry(s) == "banks" and s.symbol in BFSI_PVT_BANKS_LARGE,
         "Banks industry AND symbol in large private banks list"),
    Rule("bfsi_sfb",
         lambda s: _industry(s) == "banks" and s.symbol in BFSI_SFB,
         "Banks industry AND symbol in Small Finance Bank list"),
    Rule("bfsi_pvt_banks_mid_small",
         lambda s: _industry(s) == "banks",
         "Banks industry (fallback — mid/small private banks)"),
    # Capital-markets businesses NSE files as "Finance". These MUST precede
    # the bfsi_nbfc fallback — that is the whole fix. See the long note on
    # BFSI_RTA_RATING_FIN above for why the industry string cannot do this.
    Rule("bfsi_rta_rating",
         lambda s: _industry(s) == "finance" and s.symbol in BFSI_RTA_RATING_FIN,
         "Finance industry AND symbol in ratings/analytics list"),
    Rule("bfsi_amc_wealth",
         lambda s: _industry(s) == "finance" and s.symbol in BFSI_AMC_WEALTH_FIN,
         "Finance industry AND symbol in merchant-banking/advisory list"),
    Rule("bfsi_broker",
         lambda s: _industry(s) == "finance" and s.symbol in BFSI_BROKER_FIN,
         "Finance industry AND symbol in broking/securities-dealing list"),
    Rule("bfsi_nbfc",
         lambda s: _industry(s) == "finance",
         "Finance industry (fallback — lenders)"),
    Rule("bfsi_insurance",
         lambda s: _industry(s) == "insurance",
         "Insurance industry"),
    # Capital Markets is split via symbol whitelists, in priority order.
    # The broker rule is the fallback — anything in the industry that didn't
    # match a more specific bucket lands here.
    Rule("bfsi_amc_wealth",
         lambda s: _industry(s) == "capital markets" and s.symbol in BFSI_AMC_WEALTH,
         "Capital Markets AND symbol in AMC/wealth list"),
    Rule("bfsi_exchange",
         lambda s: _industry(s) == "capital markets" and s.symbol in BFSI_EXCHANGE,
         "Capital Markets AND symbol in exchange/depository list"),
    Rule("bfsi_rta_rating",
         lambda s: _industry(s) == "capital markets" and s.symbol in BFSI_RTA_RATING,
         "Capital Markets AND symbol in RTA/rating list"),
    Rule("bfsi_broker",
         lambda s: _industry(s) == "capital markets",
         "Capital Markets industry (fallback — brokers)"),
    Rule("bfsi_fintech",
         lambda s: _industry(s) == "financial technology (fintech)",
         "Fintech industry"),

    # ---- Tech ----
    Rule("it_services_large",
         lambda s: _it_services_industry(s) and _is_large_cap(s),
         "IT Software/Services AND large_cap"),
    Rule("it_services_midsmall",
         lambda s: _it_services_industry(s),
         "IT Software/Services AND not large_cap"),
    Rule("it_hardware",
         lambda s: _industry(s) == "it - hardware" or _industry(s) == "it-hardware",
         "IT Hardware industry"),
    Rule("telecom",
         lambda s: _sector(s) == "telecommunication",
         "Telecommunication sector"),

    # ---- Healthcare ----
    Rule("pharma",
         lambda s: _industry(s) == "pharmaceuticals & biotechnology",
         "Pharma & Biotech industry"),
    Rule("health_services",
         lambda s: _industry(s) == "healthcare services",
         "Healthcare Services industry"),
    Rule("medtech",
         lambda s: _industry(s) == "healthcare equipment & supplies",
         "Healthcare Equipment industry"),

    # ---- Consumer (FMCG sub-buckets first because Consumer has many industries) ----
    Rule("fmcg_diversified",
         lambda s: _industry(s) in ("diversified fmcg", "cigarettes & tobacco products"),
         "Diversified FMCG / Tobacco"),
    Rule("fmcg_food_agri",
         lambda s: _industry(s) in ("food products", "agricultural food & other products"),
         "Food + Agri Food"),
    Rule("fmcg_personal",
         lambda s: _industry(s) in ("personal products", "household products"),
         "Personal Care + Household"),
    Rule("fmcg_beverages",
         lambda s: _industry(s) == "beverages",
         "Beverages"),

    # Consumer durables / retail / leisure
    Rule("consumer_durables",
         lambda s: _sector(s) == "consumer durables",
         "Consumer Durables sector"),
    Rule("retail",
         lambda s: _industry(s) == "retailing",
         "Retailing industry"),
    Rule("leisure_hospitality",
         lambda s: _industry(s) in ("leisure services", "other consumer services"),
         "Leisure / Other Consumer Services"),
    Rule("media_entertainment",
         lambda s: _sector(s) in ("media entertainment & publication", "media entertainment and publication"),
         "Media sector"),

    # ---- Industrials ----
    Rule("defense_aero",
         lambda s: _industry(s) == "aerospace & defense",
         "Aerospace & Defense industry"),
    Rule("auto_oem",
         lambda s: _industry(s) in ("automobiles",
                                    "agricultural commercial & construction vehicles"),
         "Auto OEMs + Agri/Construction Vehicles"),
    Rule("auto_components",
         lambda s: _industry(s) in ("auto components", "auto ancillaries"),
         "Auto Components industry (incl. legacy 'AUTO ANCILLARIES')"),
    Rule("cap_goods_electrical",
         lambda s: _industry(s) == "electrical equipment",
         "Electrical Equipment industry"),
    Rule("cap_goods_industrial",
         lambda s: _sector(s) == "capital goods",
         "Capital Goods (rest)"),
    Rule("transport_logistics",
         lambda s: _industry(s) in ("transport services", "transport infrastructure"),
         "Transport Services + Infra"),
    Rule("services_commercial",
         lambda s: _industry(s) in ("commercial services & supplies", "engineering services"),
         "Commercial Services + Engineering Services"),
    # Catch-all SERVICES sector (legacy uppercase rows)
    Rule("services_commercial",
         lambda s: _sector(s) == "services",
         "Services sector fallback"),

    # ---- Materials ----
    Rule("chemicals_agro",
         lambda s: _industry(s) == "fertilizers & agrochemicals",
         "Fertilizers & Agrochemicals"),
    Rule("chemicals_specialty",
         lambda s: _sector(s) == "chemicals",
         "Chemicals (rest)"),
    Rule("metals_ferrous",
         lambda s: _industry(s) == "ferrous metals",
         "Ferrous Metals"),
    Rule("metals_nonferrous_mining",
         lambda s: _sector(s) == "metals & mining",
         "Metals & Mining (rest)"),
    Rule("cement",
         lambda s: _industry(s) in ("cement & cement products", "other construction materials")
                   or _sector(s) == "construction materials",
         "Construction Materials sector"),
    Rule("paper_forest",
         lambda s: _sector(s) == "forest materials",
         "Forest Materials sector"),
    Rule("textiles",
         lambda s: _sector(s) == "textiles",
         "Textiles sector"),

    # ---- Real Estate & Infra ----
    Rule("realty",
         lambda s: _sector(s) == "realty",
         "Realty sector"),
    Rule("construction",
         lambda s: _sector(s) == "construction",
         "Construction sector"),

    # ---- Energy & Utilities ----
    Rule("gas_distribution",
         lambda s: _industry(s) == "gas",
         "Gas industry"),
    Rule("oil_refining",
         lambda s: _industry(s) in ("petroleum products", "oil", "consumable fuels"),
         "Petroleum + Oil + Consumable Fuels"),
    Rule("power",
         lambda s: _sector(s) in ("power", "utilities") or _industry(s) == "other utilities",
         "Power + Utilities"),

    # ---- Diversified ----
    Rule("diversified",
         lambda s: _sector(s) == "diversified",
         "Diversified sector"),
]


def assign(stock: StockMeta) -> tuple[str, str]:
    """Return (cluster_id, matched_rule_description). Falls back to 'unclassified'."""
    for r in RULES:
        try:
            if r.predicate(stock):
                return r.cluster_id, r.description
        except Exception:
            continue
    return "unclassified", "no rule matched"
