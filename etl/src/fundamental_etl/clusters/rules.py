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
    Rule("bfsi_pvt_banks",
         lambda s: _industry(s) == "banks",
         "Banks industry (rest)"),
    Rule("bfsi_nbfc",
         lambda s: _industry(s) == "finance",
         "Finance industry"),
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
