"""Pass 2 for the gold_micro_msme batch: every rank, superlative, count and
derived figure in the prose, re-measured against the whole 27-name peer set.

Why this exists rather than eyeballing: four of the fourteen errors in the PSU
batch were superlatives that silently excluded the two worst names, because the
claim was formed while reading a table that had been sorted and truncated. The
only defence is to recompute the rank over the full set, including the NULLs.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/check_gold_27.py
"""

import json

PACK = "/tmp/gold_pack.json"
VERDICTS = "build/verdicts/gold-27-verdicts.json"

pack = json.load(open(PACK))
ROWS = {r["symbol"]: r for r in pack["symbols"]}
CM = {s: ((r.get("metrics") or {}).get("cluster_metrics") or {})
      for s, r in ROWS.items()}
SC = {s: (r.get("scores") or {}) for s, r in ROWS.items()}
V = {r["symbol"]: r for r in json.load(open(VERDICTS))}
BODY = {s: " ".join(r["points"]) + " " + r["verdict"] + " " + r["trigger_text"]
        for s, r in V.items()}

FAIL = []
CHECKED = 0


def fail(msg):
    FAIL.append(msg)


def ranked(field, reverse=True):
    """Symbols carrying a non-NULL value, best first. reverse=True -> high is
    rank 1."""
    vals = [(s, CM[s][field]) for s in CM
            if CM[s].get(field) is not None]
    vals.sort(key=lambda kv: kv[1], reverse=reverse)
    return vals


def rank_of(sym, field, reverse=True):
    r = ranked(field, reverse)
    for i, (s, _) in enumerate(r, 1):
        if s == sym:
            return i, len(r)
    return None, len(r)


# --------------------------------------------------------- 1. universe counts
# Every "of the N names with a reading" in the prose.
COUNTS = {
    "pe_ttm": 23, "loan_book_cagr_3y": 26, "opm_now": 26, "opm_prev": 26,
    "ret_12m_rel": 25, "pct_above_200ema_252d": 21, "earnings_yield_trend": 19,
    "book_value_cagr_10y": 16, "np_consistency_10y": 16, "div_yield": 9,
    "np_cagr_3y": 4, "np_consistency_5y": 7, "np_consistency_3y": 4,
    "roe_excess_13_10y": 16, "np_growth_above_inflation_10y": 16,
    "promoter_pct": 25, "fii_pct": 26, "shareholders": 26,
    "roe_5y": 23, "roe_7y": 23, "equity_to_assets": 27, "roe_3y": 27,
    "roa_3y": 27, "pb": 27, "p_aum": 27, "sales_yoy_q": 27, "np_yoy_q": 27,
}
for f, n in COUNTS.items():
    CHECKED += 1
    got = len([s for s in CM if CM[s].get(f) is not None])
    if got != n:
        fail(f"count: {f} has {got} non-null readings, prose/spec assumes {n}")

# --------------------------------------------- 2. derived gearing (1/e_to_a)
# Prose states "about Xx gearing" or "Xx assets to equity". Recompute.
GEARING = {
    "MUTHOOTFIN": 4.40, "CSLFINANCE": 2.25, "FIVESTAR": 2.22, "SATIN": 4.63,
    "ARMANFIN": 2.90, "SGFIN": 2.45, "UYFINCORP": 1.05, "MANAPPURAM": 4.20,
    "CREDITACC": 4.15, "CGCL": 4.41, "SBFC": 2.73, "AFIL": 1.96,
    "MUTHOOTCAP": 4.89, "MANBA": 4.51, "LAXMIINDIA": 4.66, "BAIDFIN": 2.46,
    "DCCL": 3.11, "AYE": 3.60, "SAHLIBHFI": 1.40, "MUFIN": 3.71,
    "MUTHOOTMF": 4.23,
}
for s, claimed in GEARING.items():
    CHECKED += 1
    e = CM[s]["equity_to_assets"]
    real = 1.0 / e
    if abs(round(real, 2) - claimed) > 0.011:
        fail(f"gearing: {s} equity_to_assets {e*100:.2f}% -> {real:.2f}x, "
             f"prose says {claimed}x")

# ----------------------------------------------------- 3. rank / superlatives
# (symbol, field, claimed rank, high-is-best)
RANKS = [
    # MUTHOOTFIN
    ("MUTHOOTFIN", "roe_3y", 1, True), ("MUTHOOTFIN", "roe_5y", 1, True),
    ("MUTHOOTFIN", "roe_7y", 1, True),
    ("MUTHOOTFIN", "roe_excess_13_5y", 1, True),
    ("MUTHOOTFIN", "roe_excess_13_7y", 1, True),
    ("MUTHOOTFIN", "roe_excess_13_10y", 1, True),
    ("MANAPPURAM", "roe_excess_13_10y", 2, True),
    ("MUTHOOTFIN", "roa_3y", 5, True),
    # CSLFINANCE
    ("CSLFINANCE", "pe_ttm", 1, False),
    ("CSLFINANCE", "div_yield", 1, True),
    ("CSLFINANCE", "roe_3y", 3, True), ("CSLFINANCE", "roe_5y", 6, True),
    ("CSLFINANCE", "np_growth_above_inflation_5y", 1, True),
    ("CSLFINANCE", "np_growth_above_inflation_7y", 1, True),
    # FIVESTAR
    ("FIVESTAR", "roe_3y", 2, True),
    ("FIVESTAR", "promoter_pct", 25, True),   # lowest of 25
    ("FIVESTAR", "fii_pct", 1, True), ("FIVESTAR", "dii_pct", 1, True),
    ("FIVESTAR", "book_value_cagr_10y", 2, True),
    # SATIN
    ("SATIN", "roe_3y", 5, True), ("SATIN", "p_aum", 25, True),  # 3rd lowest
    ("SATIN", "earnings_yield_trend", 3, True),
    ("SATIN", "equity_to_assets", 24, True),  # 4th most levered
    ("SATIN", "ret_12m_rel", 3, True),
    # ARMANFIN
    ("ARMANFIN", "roe_5y", 3, True), ("ARMANFIN", "roe_7y", 3, True),
    ("ARMANFIN", "ttm_np_pct", 1, True),
    ("ARMANFIN", "promoter_pct", 24, True),   # 2nd lowest of 25
    ("ARMANFIN", "book_value_cagr_10y", 3, True),
    # SGFIN
    ("SGFIN", "loan_book_cagr_3y", 1, True), ("SGFIN", "np_cagr_5y", 1, True),
    ("SGFIN", "book_value_cagr_10y", 1, True), ("SGFIN", "opm_now", 1, True),
    ("SGFIN", "roe_3y", 17, True), ("SGFIN", "ret_12m_rel", 1, True),
    ("SGFIN", "pe_ttm", 3, True),             # 3rd highest
    # UYFINCORP
    ("UYFINCORP", "roa_3y", 1, True), ("UYFINCORP", "sales_yoy_q", 1, True),
    ("UYFINCORP", "book_value_cagr_10y", 15, True),  # 2nd lowest of 16
    # MANAPPURAM
    ("MANAPPURAM", "roe_7y", 2, True), ("MANAPPURAM", "roe_5y", 4, True),
    ("MANAPPURAM", "roe_excess_13_7y", 2, True),
    ("MANAPPURAM", "roe_3y", 9, True),
    ("MANAPPURAM", "shareholders", 1, True),
    ("MANAPPURAM", "pct_above_200ema_252d", 2, True),
    # CREDITACC
    ("CREDITACC", "roe_3y", 4, True), ("CREDITACC", "roe_5y", 5, True),
    ("CREDITACC", "loan_book_cagr_3y", 19, True),
    # CGCL
    ("CGCL", "loan_book_cagr_3y", 3, True), ("CGCL", "pb", 2, True),
    # SBFC
    ("SBFC", "np_cagr_7y", 1, True), ("SBFC", "np_cagr_5y", 4, True),
    # AFIL
    ("AFIL", "roa_3y", 6, True), ("AFIL", "loan_book_cagr_3y", 7, True),
    ("AFIL", "equity_to_assets", 3, True),    # 3rd least levered
    # MUTHOOTCAP
    ("MUTHOOTCAP", "pb", 27, True), ("MUTHOOTCAP", "p_aum", 27, True),
    ("MUTHOOTCAP", "np_cagr_7y", 16, True),   # worst of 16
    ("MUTHOOTCAP", "earnings_yield_trend", 1, True),
    ("MUTHOOTCAP", "equity_to_assets", 26, True),  # 2nd most levered
    ("MANAPPURAM", "np_consistency_10y", 1, True),
    ("BAIDFIN", "np_consistency_10y", 2, True),
    # MANBA
    ("MANBA", "np_consistency_5y", 1, True), ("MANBA", "promoter_pct", 1, True),
    ("MANBA", "roe_3y", 6, True), ("MANBA", "loan_book_cagr_3y", 4, True),
    # LAXMIINDIA
    ("LAXMIINDIA", "np_cagr_3y", 2, True), ("LAXMIINDIA", "roe_3y", 8, True),
    ("LAXMIINDIA", "loan_book_cagr_3y", 8, True),
    # BAIDFIN
    # DCCL
    ("DCCL", "np_cagr_3y", 1, True), ("DCCL", "pe_ttm", 2, False),
    ("DCCL", "pb", 26, True), ("DCCL", "div_yield", 2, True),
    # AYE
    ("AYE", "np_consistency_3y", 1, True),
    ("AYE", "loan_book_cagr_3y", 5, True),
    ("AYE", "ret_6m_rel", 3, True),
    # SAHLIBHFI
    ("SAHLIBHFI", "roa_3y", 2, True), ("SAHLIBHFI", "shareholders", 26, True),
    ("SAHLIBHFI", "p_aum", 2, True),
    # MUFIN
    ("MUFIN", "pb", 1, True), ("MUFIN", "p_aum", 1, True),
    ("MUFIN", "pe_ttm", 2, True), ("MUFIN", "roe_3y", 20, True),
    ("MUFIN", "roa_3y", 20, True),
    ("MUFIN", "pct_above_200ema_252d", 1, True),
    # MUTHOOTMF
    ("MUTHOOTMF", "roe_3y", 21, True), ("MUTHOOTMF", "roa_3y", 22, True),
    ("MUTHOOTMF", "fii_pct", 2, True), ("MUTHOOTMF", "np_yoy_q", 1, True),
    ("MUTHOOTMF", "np_cagr_7y", 2, True),
    # MONEYBOXX
    ("MONEYBOXX", "pe_ttm", 1, True), ("MONEYBOXX", "np_consistency_10y", 16, True),
    ("MONEYBOXX", "loan_book_cagr_3y", 2, True),
    ("MONEYBOXX", "ret_12m_rel", 24, True),   # 2nd worst of 25
    # INDOSTAR
    ("INDOSTAR", "ttm_np_pct", 20, True), ("INDOSTAR", "np_yoy_q", 27, True),
    ("INDOSTAR", "book_value_cagr_10y", 14, True),
    ("INDOSTAR", "earnings_yield_trend", 2, True),
    # SPANDANA
    ("SPANDANA", "ttm_sales_pct", 24, True),  # 3rd steepest fall of 26
    # CAPTRUST
    ("CAPTRUST", "roe_excess_13_5y", 16, True),
    ("CAPTRUST", "roe_excess_13_7y", 16, True),
    ("CAPTRUST", "roe_excess_13_10y", 16, True),
    ("CAPTRUST", "book_value_cagr_10y", 16, True),
    ("CAPTRUST", "ret_3m_rel", 1, True), ("CAPTRUST", "ret_6m_rel", 1, True),
    # TRU
    ("TRU", "roe_3y", 27, True), ("TRU", "sales_yoy_q", 27, True),
    ("TRU", "ttm_sales_pct", 26, True), ("TRU", "loan_book_cagr_3y", 26, True),
    ("TRU", "book_value_cagr_5y", 7, True),   # worst of 7
    ("TRU", "ret_12m_rel", 25, True),
    ("TRU", "earnings_yield_trend", 19, True),
    ("TRU", "equity_to_assets", 27, True),    # thinnest capital
]
# joint-best / joint-worst claims: the prose says "joint", so assert the tie
JOINT = [
    ("CSLFINANCE", "np_growth_above_inflation_10y", True),
    ("CAPTRUST", "np_growth_above_inflation_10y", False),
]
for sym, field, hi in JOINT:
    CHECKED += 1
    vals = ranked(field, hi)
    extreme = vals[0][1]
    tied = [s for s, v in vals if v == extreme]
    if sym not in tied:
        fail(f"joint: {sym}.{field} not at the extreme; tied set={tied}")
    elif len(tied) < 2:
        fail(f"joint: {sym}.{field} is a sole extreme, prose says joint")

for sym, field, claimed, hi in RANKS:
    CHECKED += 1
    got, n = rank_of(sym, field, hi)
    if got != claimed:
        best = ranked(field, hi)[:3]
        fail(f"rank: {sym}.{field} is {got} of {n}, prose claims {claimed}. "
             f"top3={[(s, round(v, 2)) for s, v in best]}")

# -------------------------------------------- 4. composite / pillar extremes
CHECKED += 1
comps = {s: SC[s].get("composite_pct") for s in SC}
if max(comps, key=lambda s: comps[s]) != "CSLFINANCE":
    fail(f"CSLFINANCE claimed highest composite; actual "
         f"{max(comps, key=lambda s: comps[s])} {max(comps.values())}")
CHECKED += 1
if min(comps, key=lambda s: comps[s]) != "CAPTRUST":
    fail(f"CAPTRUST claimed lowest composite; actual "
         f"{min(comps, key=lambda s: comps[s])}")
CHECKED += 1
quals = {s: SC[s].get("quality_pct") for s in SC}
if max(quals, key=lambda s: quals[s]) != "FIVESTAR":
    fail(f"FIVESTAR claimed highest quality pillar; actual "
         f"{max(quals, key=lambda s: quals[s])} {max(quals.values())}")
CHECKED += 1
vals_ = {s: SC[s].get("valuation_pct") for s in SC}
if min(vals_, key=lambda s: vals_[s]) != "SBFC":
    fail(f"SBFC claimed lowest valuation pillar; actual "
         f"{min(vals_, key=lambda s: vals_[s])}")
CHECKED += 1
moms = {s: SC[s].get("momentum_pct") for s in SC}
if max(moms, key=lambda s: moms[s]) != "UYFINCORP":
    fail(f"UYFINCORP claimed highest momentum pillar; actual "
         f"{max(moms, key=lambda s: moms[s])}")
CHECKED += 1
# CGCL: "lowest valuation pillar of any name growing its book above 30%"
fast = [s for s in CM if (CM[s].get("loan_book_cagr_3y") or -9) > 0.30]
if min(fast, key=lambda s: vals_[s]) != "CGCL":
    fail(f"CGCL claimed lowest valuation pillar among >30% book growers; "
         f"actual {min(fast, key=lambda s: vals_[s])}")
CHECKED += 1
# INDOSTAR: "third-lowest composite of the 27"
order = sorted(comps, key=lambda s: comps[s])
if order[2] != "INDOSTAR":
    fail(f"INDOSTAR claimed 3rd-lowest composite; actual 3rd-lowest "
         f"is {order[2]} (order {order[:5]})")
CHECKED += 1
# TRU: "smallest and lowest-quality"
caps = {s: (CM[s].get("market_cap") or (ROWS[s].get("metrics") or {}).get("market_cap"))
        for s in CM}
if min(caps, key=lambda s: caps[s]) != "TRU":
    fail(f"TRU claimed smallest market cap; actual {min(caps, key=lambda s: caps[s])}")
CHECKED += 1
qorder = sorted(quals, key=lambda s: quals[s])
if qorder[1] != "TRU" or qorder[0] != "CAPTRUST":
    fail(f"TRU claimed 2nd-lowest quality behind CAPTRUST; actual {qorder[:3]}")
CHECKED += 1
if max(caps, key=lambda s: caps[s]) != "MUTHOOTFIN":
    fail(f"MUTHOOTFIN claimed largest; actual {max(caps, key=lambda s: caps[s])}")
CHECKED += 1
# BAIDFIN: "fourth-smallest by market cap"
if sorted(caps, key=lambda s: caps[s])[3] != "BAIDFIN":
    fail(f"BAIDFIN claimed 4th-smallest; actual "
         f"{sorted(caps, key=lambda s: caps[s])[:5]}")

# ------------------------------------------- 5. hurdle-clearing-on-all-3 set
CHECKED += 1
clear3 = sorted(s for s in CM
                if all((CM[s].get(f) or -9) > 0
                       for f in ("roe_excess_13_5y", "roe_excess_13_7y",
                                 "roe_excess_13_10y")))
if clear3 != sorted(["MUTHOOTFIN", "MANAPPURAM", "ARMANFIN", "FIVESTAR"]):
    fail(f"the 'only four names clear 13% on every window' claim in FIVESTAR, "
         f"ARMANFIN, MANAPPURAM and CREDITACC is wrong: actual set {clear3}")

# -------------------------------------------- 6. negative-on-both-quarterlies
CHECKED += 1
both_neg = sorted(s for s in CM
                  if (CM[s].get("sales_yoy_q") or 1) < 0
                  and (CM[s].get("np_yoy_q") or 1) < 0)
if both_neg != ["MONEYBOXX", "TRU"]:
    fail(f"MONEYBOXX's 'one of only two names negative on both' is wrong: "
         f"actual {both_neg}")
CHECKED += 1
neg_sales_q = sorted(s for s in CM if (CM[s].get("sales_yoy_q") or 1) < 0)
if len(neg_sales_q) != 5:
    fail(f"BAIDFIN's 'one of only five negative quarterly sales readings' is "
         f"wrong: {len(neg_sales_q)} names {neg_sales_q}")

# --------------------------------------- 7. zero-sessions-above-200EMA claim
CHECKED += 1
zero_ema = sorted(s for s in CM
                  if CM[s].get("pct_above_200ema_252d") == 0)
if zero_ema != ["AFIL", "TRU"]:
    fail(f"AFIL's 'only TRU shares that' is wrong: actual {zero_ema}")

# ------------------------------------------ 8. cross-symbol quoted figures
# A figure belonging to another company, printed inside this row.
CROSS = [
    ("MUTHOOTFIN", "UYFINCORP", "roa_3y", 11.55), ("MUTHOOTFIN", "SAHLIBHFI", "roa_3y", 8.05),
    ("MUTHOOTFIN", "FIVESTAR", "roa_3y", 7.18), ("MUTHOOTFIN", "CSLFINANCE", "roa_3y", 6.00),
    ("MUTHOOTFIN", "MANAPPURAM", "roe_excess_13_10y", 4.64),
    ("FIVESTAR", "MUTHOOTFIN", "roe_3y", 20.82),
    ("MANAPPURAM", "MUTHOOTFIN", "roe_7y", 21.64),
    ("MANAPPURAM", "MUTHOOTFIN", "pe_ttm", 9.52),
    ("MANAPPURAM", "MUTHOOTFIN", "roe_3y", 20.82),
    ("SAHLIBHFI", "MUTHOOTFIN", "roa_3y", 4.64),
    ("SAHLIBHFI", "MUTHOOTFIN", "roe_3y", 20.82),
    ("CREDITACC", "ARMANFIN", "pb", 1.99),
    ("MONEYBOXX", "MUFIN", "pe_ttm", 68.35),
    ("FUSION", "SATIN", "pb", 0.88), ("FUSION", "SATIN", "pe_ttm", 6.13),
    ("MUTHOOTCAP", "SATIN", "p_aum", 0.18),
]
PCT_FIELDS = {"roa_3y", "roe_3y", "roe_5y", "roe_7y", "roe_excess_13_5y",
              "roe_excess_13_7y", "roe_excess_13_10y", "loan_book_cagr_3y",
              "div_yield", "equity_to_assets", "sales_yoy_q", "np_yoy_q"}
for host, owner, field, claimed in CROSS:
    CHECKED += 1
    raw = CM[owner][field]
    real = raw * 100 if field in PCT_FIELDS else raw
    dp = len(str(claimed).split(".")[1]) if "." in str(claimed) else 0
    if round(real, dp) != claimed:
        fail(f"cross-quote: {host}'s row prints {owner}.{field} as {claimed}, "
             f"actual {real:.4f}")
    if str(claimed) not in BODY[host]:
        fail(f"cross-quote: {claimed} not found in {host}'s prose at all")

# ---------------------------------------------- 9. inflation pass-rate strings
# "beat inflation in A of the last B years, C of D and E of F" with the
# denominator rule: 5y->4, 7y->6, 10y->9.
INFL = {
    "MUTHOOTFIN": (3, 4, 7), "CSLFINANCE": (4, 6, 8), "FIVESTAR": (3, 5, 8),
    "SATIN": (2, 3, 5), "ARMANFIN": (3, 4, 7), "MANAPPURAM": (2, 3, 5),
    "CREDITACC": (3, 4, 6), "CGCL": (3, 5, 8), "SAHLIBHFI": (4, 5, 7),
    "UYFINCORP": (2, 3, 3), "MUTHOOTCAP": (2, 2, 4), "BAIDFIN": (3, 4, 6),
    "SGFIN": (3, 4, 5), "INDOSTAR": (2, 3, 4), "MONEYBOXX": (2, 3, 4),
    "CAPTRUST": (1, 2, 3),
}
for sym, (a, b, c) in INFL.items():
    for frac, num, den in (("np_growth_above_inflation_5y", a, 4),
                           ("np_growth_above_inflation_7y", b, 6),
                           ("np_growth_above_inflation_10y", c, 9)):
        CHECKED += 1
        v = CM[sym].get(frac)
        if v is None:
            fail(f"inflation: {sym}.{frac} is NULL but prose states {num}/{den}")
            continue
        real = v * den
        if abs(real - num) > 0.02:
            fail(f"inflation: {sym}.{frac} {v:.4f} x {den} = {real:.2f}, "
                 f"prose states {num} of {den}")
        if abs(real - round(real)) > 0.02:
            fail(f"inflation: {sym}.{frac} x {den} is not an integer "
                 f"({real:.3f}) — wrong denominator")
    CHECKED += 1
    want = f"{a} of the last 4 years, {b} of 6 and {c} of 9"
    if want not in BODY[sym]:
        fail(f"inflation: {sym} prose does not carry the string {want!r}")

# ---------------------------------- 10. names claimed to have no reading at all
ABSENT = {
    "AYE": ["pct_above_200ema_252d", "ret_12m_rel", "opm_now", "opm_prev",
            "roe_5y", "roe_excess_13_5y", "np_growth_above_inflation_5y"],
    "SAHLIBHFI": ["pct_above_200ema_252d", "ret_12m_rel"],
    "DCCL": ["pct_above_200ema_252d", "promoter_pct", "fii_pct", "dii_pct",
             "shareholders", "roe_5y", "roe_excess_13_5y",
             "np_growth_above_inflation_5y"],
    "LAXMIINDIA": ["pct_above_200ema_252d", "roe_5y", "roe_7y",
                   "roe_excess_13_5y", "np_growth_above_inflation_5y"],
    "SGFIN": ["pct_above_200ema_252d"],
    "MONEYBOXX": ["pct_above_200ema_252d"],
    "MUFIN": ["loan_book_cagr_3y", "roe_5y", "roe_7y", "roe_excess_13_5y",
              "np_growth_above_inflation_5y"],
    "MUTHOOTMF": ["ttm_np_pct", "roe_excess_13_5y",
                  "np_growth_above_inflation_5y"],
    "INDOSTAR": ["pe_ttm"], "SPANDANA": ["pe_ttm"], "TRU": ["pe_ttm"],
    "CAPTRUST": ["pe_ttm"],
    "AFIL": ["roe_excess_13_5y", "np_growth_above_inflation_5y"],
    "SBFC": ["roe_excess_13_5y", "np_growth_above_inflation_5y"],
    "MANBA": ["roe_excess_13_5y", "np_growth_above_inflation_5y"],
    "FUSION": ["roe_excess_13_5y", "np_growth_above_inflation_5y"],
}
for sym, fields in ABSENT.items():
    for f in fields:
        CHECKED += 1
        if CM[sym].get(f) is not None:
            fail(f"absence: {sym}.{f} is claimed absent but has value "
                 f"{CM[sym][f]}")

# ---------------------------------------------- 11. band-quoting consistency
BAND_QUOTABLE = {"MUTHOOTFIN", "MANAPPURAM", "ARMANFIN", "CREDITACC", "UYFINCORP"}
for s in CM:
    CHECKED += 1
    band = ROWS[s].get("pe_band") or {}
    ok = (band.get("n") or 0) >= 8 and (band.get("lo") or 0) >= 4.0
    if ok != (s in BAND_QUOTABLE):
        fail(f"band: {s} n={band.get('n')} lo={band.get('lo')} -> rule says "
             f"quotable={ok}, BAND_QUOTABLE says {s in BAND_QUOTABLE}")

# ---------------------------------------------------------- 12. evidence keys
for s, r in V.items():
    CHECKED += 1
    for k, v in r["evidence"].items():
        if v is None:
            fail(f"evidence: {s}.{k} is NULL in the stored evidence")
        if CM[s].get(k) != v:
            fail(f"evidence: {s}.{k} stored {v} but pack has {CM[s].get(k)}")

print(f"{CHECKED} claims re-measured, {len(FAIL)} wrong")
for f in FAIL:
    print("  ! " + f)
