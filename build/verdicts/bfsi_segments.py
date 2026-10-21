"""bfsi_nbfc's 185 names, sliced into peer sets by hand.

Why by hand: keyword matching on the business summaries put CHOLAFIN in
"brokers" and MANAPPURAM in "exchange infrastructure", because a 500-word
summary mentions everything the group has ever done and first-match wins on
the wrong clause. The segment is defined by the business that *dominates the
loan book*, which is a judgement, so it is recorded here as data rather than
re-derived by a regex that will drift.

The point of the slicing is pass 2. "Cheapest of the cluster" across 185 names
spanning a gold-loan lender, a railway financier and a dormant holding company
is not a claim, it is noise. Each list below is a pool a superlative can be
true of.

MISFILED is not a segment — it is a finding. Those names have no lending
business at all and are scored against NBFCs, so every pillar percentile they
carry was measured against the wrong peers.
"""

SEGMENTS = {

# The names you hold are all here. Big, diversified, genuinely comparable.
"large_diversified": [
    "ABCAPITAL", "BAJAJFINSV", "BAJFINANCE", "CENTRUM", "CHOLAFIN", "EDELWEISS",
    "FEDFINA", "HDBFS", "IIFL", "JIOFIN", "JMFINANCIL", "LTF", "M&MFIN",
    "MASFIN", "NORTHARC", "PAISALO", "PIRAMALFIN", "POONAWALLA", "RELIGARE",
    "SAMMAANCAP", "SHRIRAMFIN", "SUNDARMFIN", "TATACAP", "UGROCAP",
],

"housing_finance": [
    "AADHARHFC", "AAVAS", "APTUS", "BAJAJHFL", "CANFINHOME", "GICHSGFIN",
    "HOMEFIRST", "INDIASHLTR", "LICHSGFIN", "PNBHOUSING", "REPCOHOME", "SRGHFL",
],

# State-backed or sector-mandated lenders. Cost of funds and policy, not retail
# credit, is what moves these — mixing them with retail NBFCs breaks any
# margin or growth comparison.
"infra_psu_lenders": [
    "HUDCO", "IFCI", "IREDA", "IRFC", "PFC", "PFS", "RECLTD", "TFCILTD",
],

"gold_micro_msme": [
    "AFIL", "ARMANFIN", "AYE", "BAIDFIN", "CAPTRUST", "CGCL", "CREDITACC",
    "CSLFINANCE", "DCCL", "FIVESTAR", "FUSION", "INDOSTAR", "LAXMIINDIA",
    "MANAPPURAM", "MANBA", "MONEYBOXX", "MUFIN", "MUTHOOTCAP", "MUTHOOTFIN",
    "MUTHOOTMF", "SAHLIBHFI", "SATIN", "SBFC", "SGFIN", "SPANDANA", "TRU",
    "UYFINCORP",
],

"cards_payments_fintech": [
    "AKIKO", "DELPHIFX", "GATECH", "GYFTR", "KISSHT", "PML", "RELIABLE",
    "RNFI", "SBICARD",
],

# Fee income, not a loan book. Ratios that assume lending (NIM, credit cost,
# loan growth) are meaningless here, which is the whole reason they are split
# out rather than left with the NBFCs.
"capital_markets": [
    "AFSL", "AKCAPIT", "ALGOQUANT", "ARCIL", "ARYAMAN", "ASHIKA", "ASHIKAG",
    "AVONMORE", "BLBLIMITED", "CHOICEIN", "CRISIL", "PIONRINV", "PNBGILTS",
    "PRIMESECU", "THEINVEST", "VLSFINANCE", "WEALTH",
],

# Listed investment vehicles and group CICs. Their "revenue" is dividends and
# mark-to-market, so growth and margin metrics are arithmetic on a portfolio,
# not on a business. Expect most of this list to be data-blocked.
"holding_investment": [
    "3PLAND", "ADVIKCA", "AIIL", "ALFREDHE", "APOORVA", "ASSAMENT", "AVAILFC",
    "BAJAJHLDNG", "BENGALASM", "BFINVEST", "BLIL", "BLUECHIP", "CHOLAHLDNG",
    "CIFL", "CONSOFINVT", "CPCAP", "CREST", "DCMFINSERV", "DHUNINV", "ELCIDIN",
    "FINKURVE", "GFLLIMITED", "HBSL", "IITL", "INDPRUD", "JINDALPHOT", "JPOLYINVST",
    "JSWHL", "KICL", "KIRANVYPAR", "LFIC", "MAHSCOOTER", "MANCREDIT", "MASKINVEST",
    "NAHARCAP", "NBIFIN", "NDGL", "NSIL", "PILANIINVS", "RSDFIN", "SILINV",
    "SONAL", "STARTECK", "STEL", "SUMMITSEC", "TATAINVEST", "TCIFINANCE",
    "TEAMGTY", "TFL", "TSFINV", "VHL", "WELINV", "WILLAMAGOR", "ZSARACOM",
],

# No lending business at all. Scored against NBFCs regardless.
"MISFILED": [
    "BILVYAPAR", "BLAL", "FEDDERSHOL", "GKWLIMITED", "GRANDOAK", "HEXATRADEX",
    "MAHAPEXLTD", "MAXIND", "NDLVENTURE", "OSWALGREEN", "RANEHOLDIN", "SCILAL",
    "TAMBOLIIN", "THACKER", "TVSHLTD",
],

# No company overview AND no business summary — the segment cannot be assigned
# from the data at all. Naming them here rather than guessing a bucket, because
# a wrong peer set is worse than an absent one.
"NO_DESCRIPTION": [
    "GLFL", "HBPOR", "IBLFL", "KJMCFIN", "LADDERUP", "MUKESHB", "MYMUDRA",
    "NAGREEKCAP", "ODYCORP", "OPTIFIN", "PARASPETRO", "RHFL", "SUMEDHA",
    "TOYAMSL", "TRANSCOR", "USHAFIN", "VGCL", "VIJIFIN", "YOGI",
],

}

if __name__ == "__main__":
    import sys
    all_syms = [s for v in SEGMENTS.values() for s in v]
    dupes = {s for s in all_syms if all_syms.count(s) > 1}
    if dupes:
        raise SystemExit(f"a symbol is in two segments: {sorted(dupes)}")

    expected = {line.split("|", 1)[0] for line in
                open("build/verdicts/bfsi_desc.txt", encoding="utf-8") if line.strip()}
    missing = expected - set(all_syms)
    extra = set(all_syms) - expected
    if missing or extra:
        raise SystemExit(f"segment/cluster mismatch: missing={sorted(missing)} "
                         f"extra={sorted(extra)}")

    for name, syms in SEGMENTS.items():
        print(f"{name:<24} {len(syms):>3}")
    print(f"{'TOTAL':<24} {len(all_syms):>3}")
