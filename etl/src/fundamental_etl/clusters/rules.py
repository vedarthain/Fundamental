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

# ---------------------------------------------------------------------------
# Whitelists & heuristics for subdivided clusters (Industrials, Consumer, Materials, Services)
# ---------------------------------------------------------------------------

WIRES_CABLES = {
    "POLYCAB", "KEI", "RRKABEL", "FINCABLES", "DYNAMIC", "CORDO", "PARACABLES", "BBL",
    "UNIVERSAL", "SURANAT&P", "CMI", "RELICAB", "CYBERTECH"
}

DEFENSE_SHIPBUILDERS = {
    "MAZDOCK", "COCHINSHIP", "SWANDEF", "TONBO", "GRSE"
}

FERROUS_CG = {
    "SHYAMMETL", "GALLANTT", "GPIL", "MSPSTEEL", "PRAKASH", "SALASAR"
}

CAP_GOODS_EMS = {
    "SYRMA", "KAYNES", "AVALON", "CYIENTDLM", "DCXINDIA", "CPPLUS", "INDOMIM", "IKIO",
    "CENTUM", "ZETWERK", "PGEL", "AMBER", "DIXON", "SGS", "VINDHYATEL"
}

CAP_GOODS_PIPES = {
    "WELCORP", "APLAPOLLO", "ASTRAL", "SUPREMEIND", "JINDALSAW", "RATNAMANI", "FINPIPE",
    "PRINCEPIPE", "SURANI", "MANINDS", "VENUSPIPES", "HITECH", "MAHSEAMLES", "SURYA",
    "JTLIND", "GOODLUCK", "RAMASTEEL", "BHARATWIRE", "ELECTCAST", "TIIL", "PRAKASHSTL"
}

CAP_GOODS_PRECISION = {
    "TIMKEN", "SKFINDIA", "AIAENG", "GRINDWELL", "CARBORUNIV", "HAPPYFORGE", "PTCIL",
    "SCHAEFFLER", "ROLEXFORG", "MMFL", "SANSERA", "CRAFTSMAN", "RAMKRISNA", "BALUFORGE",
    "WENDT", "HARSHA", "MENONBE", "NRBBEARING"
}

PACKAGING_CONTAINERS = {
    "MOLDTEK", "AGI", "TIMETECHNO", "POLYPLEX", "TCPLPACK", "HUHTAMAKI", "EPL", "MANAKSIA",
    "JINDALPOLY", "UFLEX", "COSMOFIRST", "ESTER", "BIL", "HINDTIN", "TINPLATE", "CANPACK"
}

CONSUMER_JEWELLERY = {
    "TITAN", "KALYANKJIL", "LALITHAA", "PCJEWELLER", "SKYGOLD", "THANGAMAYL", "BLUESTONE",
    "PNGJL", "SENCO", "TBZ", "GOLDIAM", "VAIBHAVGBL", "DPABHUSHAN", "MOTISONS", "RBZJEWEL",
    "RADHIKAJWE", "KANANIIND", "MOHITIND"
}

CONSUMER_FOOTWEAR = {
    "METROBRAND", "BATAINDIA", "RELAXO", "CAMPUS", "REDTAPE", "MIRZAINT", "KHADIM", "LIBERTSHOE"
}

CONSUMER_BUILDING_HOME = {
    "ASIANPAINT", "BERGEPAINT", "KANSAINER", "JSWDULUX", "AKZOINDIA", "INDIGOPNTS", "SIRCA",
    "KAJARIACER", "CENTURYPLY", "CERA", "STYLAMIND", "GREENPLY", "GREENPANEL", "GREENLAM",
    "SOMANYCERA", "ORIENTBELL", "NITCO", "EXXARO", "AEROFLEX", "HINDWAREAP"
}

TEXTILES_APPAREL = {
    "PAGEIND", "RAYMONDLSL", "LUXIND", "DOLLAR", "KKCL", "GOKEX", "PGIL", "KITEX", "SPAL",
    "CANTABIL", "VIPIND", "RUPA", "ZODIACLOTH", "SPLIND", "SCANDENT", "MUFTI", "VEDANTFASH"
}

SERVICES_IT_BPO = {
    "FSL", "ECLERX", "HGS", "ONEPOINT", "FUSIONCX", "REDINGTON", "CNL"
}

SERVICES_COWORKING_REALTY = {
    "WEWORK", "SMARTWORKS", "AWFIS", "INDIQUBE", "NIRLON", "NESCO", "HEMIPROP", "EFCIL"
}

SERVICES_PORTS_LOGISTICS = {
    "DREDGECORP", "KMEW"
}

SERVICES_BEVERAGES = {
    "VINCOFE", "BNAGROCHEM"
}

MEDTECH_EXTRA = {
    "SMT"
}

MACHINERY_EXTRA = {
    "BONFIG", "RAVITA"
}

# Subdivided cluster whitelists (Migration 0090)
BFSI_HOUSING_FINANCE = {
    "AADHARHFC", "AAVAS", "APTUS", "BAJAJHFL", "CANFINHOME", "GICHSGFIN", "HOMEFIRST", 
    "HUDCO", "IBULHSGFIN", "INDIAHOME", "LICHSGFIN", "PNBHOUSING", "REPCOHOME", 
    "SRGHFL", "STARHFC", "CORPHFL", "INDHFL", "SAHARAHOUS", "MANRAJ", "VARDHMAN",
    "SAMMAANCAP", "RHFL", "CORALFINAC"
}

BFSI_GOLD_MFI = {
    "MUTHOOTFIN", "MANAPPURAM", "CREDITACC", "FUSION", "SPANDANA", "SATIN", 
    "MUTHOOTMF", "ARMANFIN", "FEDFINA", "MUTHOOTCAP", "ASCOM"
}

PHARMA_CDMO_APIS = {
    "DIVISLAB", "SYNGENE", "SUVENPHAR", "LAURUSLABS", "GRANULES", "GLAND", 
    "NEULANDLAB", "SIGACHI", "AARTIPHARM", "AARTIDRUGS", "INNOVA", "SMSPHARMA", 
    "SUPRIYA", "HIKAL", "SOLARA", "MOREPENLAB", "GUJTHEM", "KOPRAN", "BLISSGVS", 
    "MEDICAMEQ", "SYNCOMF", "CHEMBOND", "FERMENTA", "BALPHARMA", "ANCHOR",
    "AMRUTANJAN", "BACPHAR", "VENUSREM", "PANACEABIO", "COROMANDEL", "WOCKPHARMA",
    "DISHMAN", "DCAL", "SEQUENT", "ANUHPHR", "SUVEN", "NACLIND"
}

IT_ERD = {
    "TATAELXSI", "KPITTECH", "LTTS", "CYIENT", "TATATECH", "AXISCADES", 
    "EXPLEOSOL", "SASKEN", "CYIENTDLM", "VALIANTORG", "CIGNITITEC", "RSYSTEMS"
}

IT_SAAS_PRODUCTS = {
    "RATEGAIN", "INTELLECT", "TANLA", "ROUTE", "NEWGEN", "QUICKHEAL", "RAMCOSYS", 
    "SUBEXLTD", "NUCLEUS", "CEINFO", "ZAGGLE", "AFFLE", "NAZARA", "OFSS", "AURIONPRO", 
    "BLACKBOX", "GENESYS", "KSOLVES", "PROTEAN", "TRACXN", "YATRA", "EASEMYTRIP",
    "63MOONS", "ACCELYA", "AIRAN", "MOSCHIP", "NELCO", "SAKSOFT", "FIVESTAR"
}

AGRI_SUGAR = {
    "BALRAMCHIN", "SHREERENUK", "EIDPARRY", "TRIVENI", "DHAMPURSUG", "DWARIKESH", 
    "DALMIASUG", "AVADHSUGAR", "MAGADSUGAR", "UGARSUGAR", "UTTAMSUGAR", "BAJAJHIND", 
    "KCP", "KMCSUGAR", "PONNIERODE", "SAKTHISUG", "VISHWARAJ", "KOTHARISUG", 
    "RAJSREESUG", "MAWANA", "DCMSRIND", "BANARISUG", "PARASUGAR", "SIMBHAOLI"
}

FMCG_PACKAGED_FOODS = {
    "BRITANNIA", "NESTLEIND", "VBL", "TATACONSUM", "BIKAJI", "BECTORFOOD", "PRATAAP", 
    "ZYDUSWELL", "TASTYBITE", "LTFOODS", "KRBL", "VADILALIND", "HERITGFOOD", "DODLA", 
    "HATSUN", "PARAGMILK", "CCL", "GOKUL", "AVANTIFEED", "APEX", "WATERBASE", 
    "ADFFOODS", "ANNAPURNA", "BBTC", "BOPPANA", "SHEETAL", "POKARNA"
}

TRANSFORMERS_GRID = {
    "VOLTAMP", "TRIL", "APARINDS", "SHILCHAR", "SCHNEIDER", "KEC", "KALPATPOWR", 
    "TECHNOE", "GET&D", "POWERINDIA", "HITACHI", "TARAPUR", "MARSONS", "INDOTECH",
    "GVT&D", "CTRAN", "BBL", "JYOTISTRUC"
}

HOTELS_RESORTS = {
    "INDHOTEL", "EIHOTEL", "CHALET", "LEMONTREE", "SAMHI", "MHRIL", "ROHLTD", 
    "PARK", "ADVANIHOTR", "ORIENTHOT", "SINCLAIRS", "TAJGVK", "BENARAS", 
    "ASIANHOTNR", "AHLEAST", "AHLWEST", "BLUECOAST", "BRIGHOTEL", "BYKE", "ITDC",
    "ADVENTHTL", "APOLSINHOT", "KAMATHOTEL", "PRAVEG", "PALRED"
}

EDUCATION_SERVICES = {
    "APTECHT", "NIITLTD", "NIITMTS", "MPSLTD", "CLEDUCATE", "CAREERP", "NAVNETEDUL", 
    "ZEELEARN", "ARIHANTACA", "ADDICTIVE", "TREEHOUSE", "VAKRANGEE", "CCHHL", 
    "GLOBAL", "GTECJAINX", "DRONE", "DUGLOBAL", "EDUCOMP"
}

AUTO_TYRES = {
    "MRF", "APOLLOTYRE", "CEATLTD", "BALKRISIND", "JKTYRE", "TVSSRICHAK", 
    "GOODYEAR", "GOVIND", "DINDIGUL", "TIRUPATI", "RUBFILA", "GRP", "PIXTRANS",
    "ETML", "ITTL", "MODIRUBBER", "TOLINS", "VIAZ"
}

RAILWAY_INFRA = {
    "RVNL", "IRCON", "RAILTEL", "RITES", "TITAGARH", "JWL", "TEXRAIL", 
    "BCPL", "KERNEX", "COSMIC", "MICEL", "BEML", "DHARARAIL", "GPTINFRA"
}

REALTY_COMMERCIAL = {
    "AWFIS", "DEVX", "EFCIL", "INDIQUBE", "SMARTWORKS", "WEWORK", "NESCO", 
    "PHOENIXLTD", "PROZONER", "SBGLP"
}

DYES_PIGMENTS = {
    "BODALCHEM", "BHAGERIA", "KIRIINDUS", "ASAHISONG", "SUDARSCHEM", "VIDHIING", 
    "PODDARMENT", "DYNPRO", "CHEMCRUX", "AKSHARCHEM", "MAHICKRA", "VIPULLTD", 
    "MEGH", "VISHNU", "SHREERAMA"
}

SERVICES_STAFFING = {
    "AARVI", "ACEINTEG", "ALANKIT", "BLUSPRING", "CMSINFO", "KRYSTAL", 
    "QUESS", "RADIANTCMS", "SFML", "UDS", "COREIN", "CSSL", "DTL", "EMAPARTNER",
    "TEAMLEASE", "SIS", "FIRSTMERIT"
}

HOLDING_COMPANIES = {
    "BAJAJHLDNG", "AIIL", "TATAINVEST", "TVSHLTD", "CHOLAHLDNG", "JSWHL", "TSFINV", 
    "KAMAHOLD", "PILANIINVS", "NSIL", "RANEHOLDIN", "KICL", "ELCIDIN", "BFINVEST", 
    "BLIL", "VHL", "FEDDERSHOL", "INDPRUD", "STEL", "JPOLYINVST", "CONSOFINVT", 
    "WELINV", "DHUNINV", "SILINV", "NDGL", "MAHSCOOTER", "BENGALASM", "EASTRED", 
    "HBSTOCK", "MAXVIL", "KIRLOSIND"
}

CAP_GOODS_PUMPS_VALVES = {
    "ELGIEQUIP", "KIRLOSBROS", "KSB", "SHAKTIPUMP", "WPIL", "JASH", "OSWALPUMPS", 
    "HONDAPOWER", "YUKEN", "ROTO", "VELJAN", "MAZDA", "TRITONV", "LATTEYS", 
    "RAPPID", "ATAM", "DELTAMAGNT"
}


@dataclass(frozen=True)
class StockMeta:
    symbol: str
    sector: Optional[str]
    industry: Optional[str]
    market_cap_category: Optional[str]
    company_name: Optional[str] = None
    business_summary: Optional[str] = None


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


def _text(s: StockMeta) -> str:
    return f"{s.symbol} {s.company_name or ''} {s.business_summary or ''}".lower()


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
    Rule("bfsi_pvt_banks_large",
         lambda s: _industry(s) == "banks" and s.symbol in BFSI_PVT_BANKS_LARGE,
         "Banks industry AND symbol in large private banks list"),
    Rule("bfsi_sfb",
         lambda s: _industry(s) == "banks" and s.symbol in BFSI_SFB,
         "Banks industry AND symbol in Small Finance Bank list"),
    Rule("bfsi_pvt_banks_mid_small",
         lambda s: _industry(s) == "banks",
         "Banks industry (fallback — mid/small private banks)"),
    Rule("bfsi_rta_rating",
         lambda s: _industry(s) == "finance" and s.symbol in BFSI_RTA_RATING_FIN,
         "Finance industry AND symbol in ratings/analytics list"),
    Rule("bfsi_amc_wealth",
         lambda s: _industry(s) == "finance" and s.symbol in BFSI_AMC_WEALTH_FIN,
         "Finance industry AND symbol in merchant-banking/advisory list"),
    Rule("bfsi_broker",
         lambda s: _industry(s) == "finance" and s.symbol in BFSI_BROKER_FIN,
         "Finance industry AND symbol in broking/securities-dealing list"),
    Rule("bfsi_holding_companies",
         lambda s: s.symbol in HOLDING_COMPANIES or (
             (_industry(s) == "finance" or _sector(s) in ("financial services", "diversified"))
             and (
                 any(k in (s.company_name or "").lower() for k in ["holding company", "holdings company", "core investment company", "investment corporation", "investments and commercials", "investments and industries", "poly investment", "group holding"])
                 or any(k in (s.business_summary or "").lower() for k in ["core investment company", "unregistered cic", "holding company that holds", "promoter holding company", "holds strategic stake"])
             )
             and s.symbol not in ("CHOLAFIN", "BAJFINANCE", "SHRIRAMFIN", "M&MFIN", "SUNDARMFIN")
         ),
         "Holding Companies, CICs & Equity Investment Vehicles"),
    Rule("bfsi_nbfc",
         lambda s: s.symbol == "CHOLAFIN",
         "Cholamandalam Investment & Finance -> Diversified NBFC"),
    Rule("bfsi_housing_finance",
         lambda s: _industry(s) == "finance" and (s.symbol in BFSI_HOUSING_FINANCE or any(k in _text(s) for k in ["housing finance", "home finance", "housing fin", "home loan"])),
         "Housing Finance Companies (HFCs)"),
    Rule("bfsi_gold_microfinance",
         lambda s: _industry(s) == "finance" and (s.symbol in BFSI_GOLD_MFI or any(k in _text(s) for k in ["microfinance", "micro finance", "gold loan", "gold finance"])),
         "Gold Loan & Microfinance NBFCs"),
    Rule("bfsi_nbfc",
         lambda s: _industry(s) == "finance",
         "Finance industry (fallback — lenders)"),
    Rule("bfsi_insurance",
         lambda s: _industry(s) == "insurance",
         "Insurance industry"),
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
    Rule("it_erd_engineering",
         lambda s: _it_services_industry(s) and (s.symbol in IT_ERD or any(k in _text(s) for k in ["er&d", "engineering research", "product engineering", "embedded software", "automotive software", "aerospace engineering"])),
         "Engineering R&D & Embedded Systems"),
    Rule("it_software_products_saas",
         lambda s: _it_services_industry(s) and (s.symbol in IT_SAAS_PRODUCTS or any(k in _text(s) for k in ["saas", "software product", "fintech platform", "cloud platform", "cpaas"])),
         "Software Products, SaaS & Platforms"),
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
    Rule("pharma_cdmo_apis",
         lambda s: _industry(s) == "pharmaceuticals & biotechnology" and (s.symbol in PHARMA_CDMO_APIS or any(k in _text(s) for k in ["cdmo", "crams", "contract research", "active pharmaceutical ingredient", "api manufacturer", "bulk drug"])),
         "Pharma CDMO, CRAMS & Bulk APIs"),
    Rule("pharma",
         lambda s: _industry(s) == "pharmaceuticals & biotechnology",
         "Pharma & Biotech Formulations & Generics fallback"),
    Rule("health_services",
         lambda s: _industry(s) == "healthcare services",
         "Healthcare Services industry"),
    Rule("medtech",
         lambda s: _industry(s) == "healthcare equipment & supplies" or s.symbol in MEDTECH_EXTRA,
         "Healthcare Equipment industry + MedTech extra"),

    # ---- Tech / Services cross-overs ----
    Rule("it_services_midsmall",
         lambda s: s.symbol in SERVICES_IT_BPO or any(k in _text(s) for k in ["business process management", "bpm", "bpo", "technology products distribution"]) and _sector(s) in ("services", "capital goods"),
         "BPM / IT-enabled services from commercial services"),

    # ---- Real Estate & Infra ----
    Rule("realty_commercial_coworking",
         lambda s: (s.symbol in REALTY_COMMERCIAL or s.symbol in SERVICES_COWORKING_REALTY or any(k in _text(s) for k in ["co-working", "coworking", "it park", "office buildings", "exhibition center", "rental yield", "mall management", "retail mall"])) and _sector(s) in ("services", "realty"),
         "Commercial real estate & flexible co-working spaces"),
    Rule("transport_logistics",
         lambda s: s.symbol in SERVICES_PORTS_LOGISTICS,
         "Marine dredging & port logistics from services"),

    # ---- Consumer ----
    Rule("fmcg_diversified",
         lambda s: _industry(s) in ("diversified fmcg", "cigarettes & tobacco products"),
         "Diversified FMCG / Tobacco"),
    Rule("agri_sugar_biofuels",
         lambda s: _industry(s) in ("food products", "agricultural food & other products") and (s.symbol in AGRI_SUGAR or any(k in _text(s) for k in ["sugar", "distillery", "distilleries", "ethanol blending", "sugarcane"])),
         "Sugar Mills, Distilleries & Biofuels"),
    Rule("fmcg_packaged_foods",
         lambda s: _industry(s) in ("food products", "agricultural food & other products") and (s.symbol in FMCG_PACKAGED_FOODS or any(k in _text(s) for k in ["packaged food", "biscuit", "confectionery", "dairy", "milk", "ice cream", "beverage", "tea", "coffee", "snacks", "namkeen", "bakery", "ready to eat", "spices", "noodles", "pasta"])),
         "Branded Packaged Foods, Snacks, Dairy & Beverages"),
    Rule("fmcg_food_agri",
         lambda s: _industry(s) in ("food products", "agricultural food & other products"),
         "Agri Commodities, Edible Oils, Seeds & Feeds fallback"),
    Rule("fmcg_personal",
         lambda s: _industry(s) in ("personal products", "household products"),
         "Personal Care + Household"),
    Rule("fmcg_beverages",
         lambda s: _industry(s) == "beverages" or s.symbol in SERVICES_BEVERAGES,
         "Beverages"),

    # Consumer sub-clusters (Jewellery, Footwear, Building/Home, Appliances)
    Rule("consumer_jewellery",
         lambda s: _sector(s) == "consumer durables" and (s.symbol in CONSUMER_JEWELLERY or any(k in _text(s) for k in ["jewel", "gold", "diamond", "gem", "silver", "ornaments"])),
         "Consumer Durables -> Jewellery & Gems"),
    Rule("consumer_footwear",
         lambda s: _sector(s) == "consumer durables" and (s.symbol in CONSUMER_FOOTWEAR or any(k in _text(s) for k in ["footwear", "shoes", "sandals", "slippers", "boots"])),
         "Consumer Durables -> Footwear & Athleisure"),
    Rule("consumer_building_home",
         lambda s: _sector(s) == "consumer durables" and (s.symbol in CONSUMER_BUILDING_HOME or any(k in _text(s) for k in ["paint", "coating", "varnish", "ceramic", "tile", "sanitaryware", "plywood", "laminate", "veneer"])),
         "Consumer Durables -> Paints, Tiles, Ceramics & Interior Home Panels"),
    Rule("consumer_appliances",
         lambda s: _sector(s) == "consumer durables",
         "Consumer Durables -> Appliances & White Goods fallback"),

    Rule("retail",
         lambda s: _industry(s) == "retailing",
         "Retailing industry"),
    Rule("hospitality_hotels",
         lambda s: _industry(s) in ("leisure services", "other consumer services") and (s.symbol in HOTELS_RESORTS or any(k in _text(s) for k in ["hotel", "resort", "palace", "lodging", "hospitality chain"])),
         "Hotels, Luxury Resorts & Lodging"),
    Rule("education_training_services",
         lambda s: _industry(s) in ("leisure services", "other consumer services") and (s.symbol in EDUCATION_SERVICES or any(k in _text(s) for k in ["education", "learning", "training", "school", "coaching", "skill development", "edtech"])),
         "Education, EdTech & Skill Development"),
    Rule("leisure_hospitality",
         lambda s: _industry(s) in ("leisure services", "other consumer services"),
         "Dining, QSR, Tourism & Leisure fallback"),
    Rule("media_entertainment",
         lambda s: _sector(s) in ("media entertainment & publication", "media entertainment and publication"),
         "Media sector"),

    # ---- Industrials & Subdivided Capital Goods ----
    Rule("defense_aero",
         lambda s: _industry(s) == "aerospace & defense" or s.symbol in DEFENSE_SHIPBUILDERS or any(k in _text(s) for k in ["shipyard", "dock shipbuilders", "naval", "warship", "submarine", "military electro-optics"]),
         "Aerospace & Defense industry + Naval Shipbuilders"),
    Rule("auto_oem",
         lambda s: _industry(s) in ("automobiles",
                                    "agricultural commercial & construction vehicles"),
         "Auto OEMs + Agri/Construction Vehicles"),
    Rule("auto_tyres_rubber",
         lambda s: _industry(s) in ("auto components", "auto ancillaries") and (s.symbol in AUTO_TYRES or any(k in _text(s) for k in ["tyre", "tire", "rubber compound", "tread", "automotive rubber"])),
         "Tyres, Tubes & Automotive Rubber"),
    Rule("auto_components",
         lambda s: _industry(s) in ("auto components", "auto ancillaries"),
         "Auto Components (Powertrain, Transmission, Chassis, Lighting, Castings)"),

    Rule("electrical_wires_cables",
         lambda s: (_industry(s) == "electrical equipment" or _sector(s) == "capital goods") and (s.symbol in WIRES_CABLES or (any(k in _text(s) for k in ["wire", "cable", "conductor"]) and not any(k in _text(s) for k in ["wire rope", "strands", "tyre bead"]))),
         "Wires, Cables & Conductors"),
    Rule("electrical_transformers_grid",
         lambda s: (_industry(s) == "electrical equipment" or _sector(s) == "capital goods") and (s.symbol in TRANSFORMERS_GRID or any(k in _text(s) for k in ["transformer", "power transmission", "substation", "switchyard", "power grid"])),
         "Power Transformers, Transmission & Grid Equipment"),
    Rule("cap_goods_electrical",
         lambda s: _industry(s) == "electrical equipment",
         "Electrical Equipment, Switchgear & Motors fallback"),
    Rule("metals_ferrous",
         lambda s: s.symbol in FERROUS_CG or (any(k in _text(s) for k in ["sponge iron", "pellet", "billets", "tmt bars", "ingots"]) and _sector(s) == "capital goods"),
         "Ferrous metals & steel mills from capital goods"),

    Rule("cap_goods_pumps_valves",
         lambda s: s.symbol in CAP_GOODS_PUMPS_VALVES or (
             _sector(s) in ("capital goods", "industrials") and any(k in _text(s) for k in ["submersible pump", "centrifugal pump", "slurry pump", "industrial valve", "air compressor", "fluid handling"])
             and not any(k in _text(s) for k in ["tyre bead", "valve automation", "printed circuit"])
         ),
         "Industrial Pumps, Valves & Compressors"),
    Rule("packaging_containers",
         lambda s: _sector(s) == "capital goods" and (s.symbol in PACKAGING_CONTAINERS or any(k in _text(s) for k in ["packaging", "containers", "bottles", "tinplate", "flexible packaging", "cartons", "drums", "pails", "polyester film", "bopp film", "bopet film"])),
         "Capital Goods -> Packaging & Industrial Containers"),
    Rule("cap_goods_ems",
         lambda s: (_sector(s) == "capital goods" or s.symbol in CAP_GOODS_EMS) and (s.symbol in CAP_GOODS_EMS or any(k in _text(s) for k in ["electronic manufacturing services", "ems", "pcba", "contract manufacturing", "surveillance equipment", "iot solutions", "cctv"])),
         "Capital Goods -> EMS & Advanced Electronics"),
    Rule("cap_goods_pipes_building",
         lambda s: _sector(s) == "capital goods" and (s.symbol in CAP_GOODS_PIPES or any(k in _text(s) for k in ["pipe", "tube", "tubing", "fittings", "ductile iron", "plumbing"])),
         "Capital Goods -> Pipes, Tubes & Building Fittings"),
    Rule("cap_goods_precision_eng",
         lambda s: _sector(s) == "capital goods" and (s.symbol in CAP_GOODS_PRECISION or any(k in _text(s) for k in ["bearing", "abrasive", "grinding media", "grinding wheel", "forging", "casting", "foundry", "precision component"])),
         "Capital Goods -> Precision Bearings, Abrasives & Castings/Forgings"),
    Rule("cap_goods_machinery_equipment",
         lambda s: _sector(s) == "capital goods" or s.symbol in MACHINERY_EXTRA,
         "Capital Goods -> Machinery, Engines, Turbines, Compressors & Tools fallback"),

    Rule("transport_logistics",
         lambda s: _industry(s) in ("transport services", "transport infrastructure"),
         "Transport Services + Infra"),
    Rule("services_hr_staffing",
         lambda s: (_industry(s) in ("commercial services & supplies", "engineering services") or _sector(s) == "services") and (s.symbol in SERVICES_STAFFING or any(k in _text(s) for k in ["staffing", "manpower", "human resource", "recruitment", "payroll", "security service", "facility management", "cash management", "cash logistics"])),
         "Staffing, Security & Facility Management"),
    Rule("services_staffing_facilities",
         lambda s: _industry(s) in ("commercial services & supplies", "engineering services") or _sector(s) == "services",
         "Commercial B2B Services, Technical Consultancy & Supplies fallback"),

    # ---- Materials ----
    Rule("chemicals_agro",
         lambda s: _industry(s) == "fertilizers & agrochemicals",
         "Fertilizers & Agrochemicals"),
    Rule("chemicals_dyes_pigments",
         lambda s: _sector(s) == "chemicals" and (s.symbol in DYES_PIGMENTS or any(k in _text(s) for k in ["dye", "dyes", "pigment", "pigments", "colorant", "colorants", "colourant"])),
         "Dyes, Pigments & Colorants"),
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

    # Textiles subdivisions (Apparel/Retail vs Spinning/Commodity)
    Rule("textiles_apparel_retail",
         lambda s: _sector(s) == "textiles" and (s.symbol in TEXTILES_APPAREL or any(k in _text(s) for k in ["apparel", "garment", "readymade", "clothing", "innerwear", "hosiery", "knitwear", "brand", "fashion", "jeans", "shirts"])),
         "Textiles -> Apparel, Innerwear & Garment Exports"),
    Rule("textiles_spinning_yarn",
         lambda s: _sector(s) == "textiles",
         "Textiles -> Spinning Mills, Yarn & Commodity Fabric fallback"),

    # ---- Real Estate & Infra ----
    Rule("construction_railways_infra",
         lambda s: _sector(s) == "construction" and (s.symbol in RAILWAY_INFRA or any(k in _text(s) for k in ["railway", "railways", "rail infra", "rolling stock", "locomotive", "rail track", "metro rail"])),
         "Railway EPC, Metro Systems & Rolling Stock Infra"),
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
