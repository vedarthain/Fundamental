#!/usr/bin/env python3
"""metals_nonferrous_mining — the six tracked names, 2026-10-21 snapshot.

Twelve choices this batch forced, each one a guard below rather than a note.

CHOICE 1 — the cluster's readings are thin. A dividend yield exists on sixteen
rows, a trailing earnings multiple on nineteen, a net-debt-to-EBITDA ratio on
twenty, out of a veteran bucket of 24. None is banned outright — unlike media's
peg, each is load-bearing somewhere here — but any point ranking one of them
carries THINREAD in the SAME point. Guard 20 recomputes all three counts.

CHOICE 2 — NRL is not in the same measurement as the other five. It is mid
tier, its cohort is 40 rows drawn from every tier of the cluster, and its
score_status is partial-cluster-mixed-tiers. Its ranks and the other rows'
ranks are different instruments. MIXED is mandatory on that row (guard 2 and
guard 25) and its three-year quality metrics, read by seven peers, are banned
from the prose entirely — a denominator of seven is not a rank.

CHOICE 3 — the band is four-valued here, not three. Usable on HINDALCO, MMP and
VEDL; more than five times wide on LLOYDSME (4.08-2133.56x) and NATIONALUM;
and too short to be a band at all on NRL, which has four years of history.
Guard 9 recomputes the state and refuses the wrong refusal.

CHOICE 4 — LLOYDSME's ten annual rows span sixteen fiscal years. FY2014 through
FY2019 are absent from the pack. Every "ten-year" or "decade" phrasing is
therefore false on that row and is banned there; GAP says so instead, and
guard 23 recomputes the missing years rather than trusting this docstring.

CHOICE 5 — VEDL's sales fell from ₹143,727cr to ₹62,717cr in one year while
operating margin rose from 24.6% to 29.6%. Whatever rev_cagr_5y and np_cagr_5y
measure on that row, it is not a declining trade. RESHAPE sits in the same
point as either rank; guard 24 recomputes the step. The prose names no cause
for it, because the pack carries none.

CHOICE 6 — two rows carry the pack's below-EBIT flag: net profit outran
operating profit by 84% on MMP and 20% on VEDL over the TTM. A PE or a trailing
net figure on that base is not a PE on operations. BELOWEBIT is required in the
same point as either, both directions checked against the live flag (guard 26).

CHOICE 7 — HINDALCO's cash flag is earned, which makes it the opposite of the
media batch's. Operating cash fell from ₹24,410cr to ₹10,250cr against a record
operating profit while borrowings rose from ₹65,642cr to ₹99,165cr. CASHDET
says so; no other row may call its cash a deterioration (guard 11).

CHOICE 8 — NRL's prior-years cash mean is negative (-1.365), so "fell to" and
"recovered to" are both meaningless on it. The row states the four cash rows
themselves instead.

CHOICE 9 — momentum on every row here is scored on 96 of its declared 100,
tech_net_score_scaled being NULL for the whole universe. Uniform, so it changes
no ranking; MOM96 states it once per row (guard 16).

CHOICE 10 — NRL's valuation pillar is scored on 90 of 100, dividend yield being
absent. Not uniform, so it sits in the same point as the figure (guard 21).

CHOICE 11 — ema_stack_bull is 0.000 on four rows and tied across 21 of the 23
that carry it. Banned, not caveated (guard 17).

CHOICE 12 — delivery_data holds 13 sessions for five rows and none at all for
NRL. Any percentage off it is a single-day print. Banned (guard 6).
"""
import json
import re

PACK = "/tmp/metals6.json"
OUT = "build/verdicts/metals-6-verdicts.json"
SOURCE_REPORT = "metals nonferrous mining — 6 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = PRICE_ASOF = "2026-10-21"

HELD = {"HINDALCO", "LLOYDSME", "NATIONALUM"}
EMIT = {"HINDALCO", "LLOYDSME", "MMP", "NATIONALUM", "NRL", "VEDL"}

STATUS = {
    "HINDALCO": "full", "LLOYDSME": "full", "MMP": "full",
    "NATIONALUM": "full", "NRL": "partial-cluster-mixed-tiers",
    "VEDL": "full",
}

# CHOICE 2. Two different buckets, so two different cohort sentences.
VET = ("Peered against 24 peers in the veteran tier of this cluster — every "
       "rank below is read against that bucket and no other. ")
MID = ("Peered against 40 peers, and that is the finding rather than a "
       "footnote: NRL is the one row here the scorer could not place in a "
       "bucket of its own maturity, so its cohort is drawn from every tier of "
       "the cluster at once and its score_status reads "
       "partial-cluster-mixed-tiers. A rank on this row and a rank on any "
       "other row in this batch are not the same measurement, and no sentence "
       "below compares them. ")
TIER_SENTENCE = {"veteran": VET, "mid": MID}

# CHOICE 1. Required in the same point as any rank on the three thin readings.
THINREAD = ("Thin reading: a dividend yield exists on sixteen of these rows, a "
            "trailing earnings multiple and an EV/EBITDA on nineteen each and "
            "a net-debt-to-EBITDA ratio on twenty, so a rank on any of them "
            "places the row among those peers rather than in the cluster. ")
THIN_READS = {"div_yield": 16, "pe_ttm": 19, "ev_ebitda_ttm": 19,
              "net_debt_ebitda": 20}

# CHOICE 9. Uniform across the platform, so it changes no ranking.
MOM96 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 4 of momentum's 100 points in this "
         "cluster, so every momentum percentile here is scored on 96 points "
         "out of a declared 100. It is uniform, so it changes no ranking — "
         "but the pillar is narrower than the scorecard claims.")

# CHOICE 7. Earned on one row and refused everywhere else.
CASHDET = ("The pack flags the cash and the flag is right. Operating cash fell "
           "to 0.294 of operating profit in FY2026 from a prior-years mean of "
           "0.804, and the two sides of that are both in the annual rows: "
           "₹10,250cr of operating cash against a record ₹34,880cr of "
           "operating profit, while borrowings rose from ₹65,642cr to "
           "₹99,165cr in the same year. A record operating year that collects "
           "under a third of itself and funds the difference is a "
           "deterioration in collection, not a level to read a multiple off. ")

# CHOICE 4. LLOYDSME's record has a six-year hole in the middle of it.
GAP = ("The annual record on this row is not a decade. The pack holds ten "
       "rows, and they run FY2011 to FY2013 and then FY2020 to FY2026 — "
       "FY2014 through FY2019 are absent entirely. Nothing below is stated "
       "as a ten-year or a since-inception rate, because no such series "
       "exists here to state one from. ")
GAP_SYM = "LLOYDSME"
GAP_BANNED = ("ten-year", "ten year", "decade", "last ten years",
              "across the ten")

# CHOICE 5. VEDL's sales halved in a year while the margin went up.
RESHAPE = ("Sales on this row fell from ₹143,727cr to ₹62,717cr in one year "
           "while the operating margin rose from 24.6% to 29.6%, and the next "
           "year came in at ₹78,437cr. A revenue line that halves while "
           "margin improves records a change in what the entity contains, and "
           "the pack carries no explanation of what changed. The five-year "
           "compound rates below are arithmetic across that step and are not "
           "measurements of a shrinking trade. ")
RESHAPE_SYM = "VEDL"
RESHAPE_FIELDS = ("rev_cagr_5y", "np_cagr_5y")

# CHOICE 6. The flag two rows carry, and what it disqualifies.
BELOWEBIT = ("The pack flags this row for earnings made below the operating "
             "line: net profit outran operating profit over the trailing "
             "twelve months, so an earnings multiple on that base is not a "
             "multiple on operations and the trailing net growth is not "
             "operating growth. ")
BELOWEBIT_SYMS = {"MMP": 0.835, "VEDL": 0.197}
BELOWEBIT_FIELDS = ("pe_ttm", "ttm_np_pct")

# CHOICE 8. A negative prior mean cannot be a level anything falls from.
NEGMEAN = ("The pack's collection ratio on this row is read against a "
           "prior-years mean of -1.365, which is not a level anything can "
           "fall to or recover from. The four cash rows themselves are "
           "what the pack supports: minus ₹17.15cr, minus ₹11.07cr, minus "
           "₹18.67cr and then ₹18.31cr, the first positive operating cash "
           "year the pack holds for this company. ")
NEGMEAN_SYM = "NRL"

# CHOICE 2, second half. NRL's three-year quality metrics are read by seven.
SEVEN = ("np_cagr_3y", "rev_cagr_3y", "op_margin_trend_3y")
SEVEN_SYM = "NRL"

NOVERDICT = ("Four fiscal years of history, a cohort assembled from every tier "
             "of the cluster because its own tier has too few rows to rank "
             "against, operating cash negative in three of those four years, "
             "and no delivery row in the pack at all. What follows is what can "
             "be said; a recommendation is not among it. ")
NOVERDICT_SYM = "NRL"

# Metrics NULL for >=95% of the universe in this snapshot.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "cfo_pat_latest",
        "roce_latest", "op_margin_latest", "book_value_cagr_5y", "np_cagr_7y",
        "roe_excess_13_10y", "roe_excess_13_7y", "roe_excess_13_5y",
        "book_value_cagr_10y", "p_aum")

# Plain-English phrases naming columns THIS cluster does not carry. Guard 10
# cannot see them because they are not tags.
BANNED_PHRASES = ("working capital day", "debt-to-equity", "debt to equity",
                  "profit consistency", "cash-to-profit", "price-to-aum",
                  "loan book", "inventory day", "receivable day",
                  "dividend payout", "interest coverage")
PHRASE_EXEMPT = (CASHDET, NEGMEAN, BELOWEBIT)

EMAFLAT = "ema_stack_bull"
CODE_ALLOW = {"metals_nonferrous_mining", "full",
              "partial-cluster-mixed-tiers", "tech_net_score_scaled"}

# CHOICE 3, four-valued: None = usable, else the reason it cannot price a row.
BAND_RATIO_MAX = 5.0
BAND_MIN_N = 5
BAND_REASON = {"HINDALCO": None, "MMP": None, "VEDL": None,
               "LLOYDSME": "wide", "NATIONALUM": "wide", "NRL": "short"}
BANDWIDE = ("Its own earnings band is too wide to price it — the high is more "
            "than five times the low, which records an earnings denominator "
            "passing near zero in some year of the window rather than a range "
            "a price can sit inside. ")
NOBAND = ("The pack cannot build an own-history earnings band for this row: it "
          "has fewer than five annual multiples to build one from. ")

# CHOICE 11.
MOM96_SYMS = EMIT

# Per row: negative-operating-cash years, the row count they are out of, the
# latest ratio as a level, and whether "deterioration" is earned — None if it
# is, otherwise the reason it is refused.
CASHYRS = {
    "HINDALCO": (0, 10, 0.294, None),
    "LLOYDSME": (3, 10, 0.471, "the record has a six-year hole in it"),
    "MMP": (0, 10, 0.816, "the pack raises no cash flag on this row"),
    "NATIONALUM": (1, 10, 0.812, "the pack raises no cash flag on this row"),
    "NRL": (3, 4, 1.072, "the prior-years mean is negative"),
    "VEDL": (0, 10, 1.704, "the pack raises no cash flag on this row"),
}
CASH_FLAGGED = {"HINDALCO"}
NEGWORD = {0: "no", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
           6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
NOZERO = "no negative operating cash year"

TTM_FIELDS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct")
WINDOW_BATCH = ["2025-09-30", "2026-06-30"]

# CHOICE 10. Only NRL is renormalised, and only on valuation.
PILLAR_WEIGHT = {"NRL": [("valuation", "scored on 90 points rather than the declared 100")]}

# CHOICE 1. The veteran bucket's thinnest reading is 16, so a denominator under
# it is fabricated or imported. NRL's own bucket legitimately goes lower, which
# is why the floor is per row rather than per batch.
DENOM_FLOOR = {"veteran": 16, "mid": 26}

_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
_CODE_RX = re.compile(r"<code>([a-z0-9_-]+)</code>")
_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}

SPEC: dict[str, dict] = {

"HINDALCO": {
  "verdict": "HOLD — composite 67, ninth of 24, on a record operating year "
             "that collected ₹10,250cr of cash against ₹34,880cr of operating "
             "profit while borrowings rose ₹33,523cr",
  "confidence": "medium",
  "trigger": "cash_from_operating recovering above ₹20,000cr with borrowings "
             "flat -> the collection year was working capital and the hold is "
             "an add; a second year under 0.40 of operating profit with "
             "borrowings higher again -> the aluminium cycle is being funded "
             "rather than earned",
  "evidence": ["roce_3y", "ebitda_margin_3y", "net_debt_ebitda", "opm_now",
               "ttm_op_pct"],
  "points": [
  "<b>Held — HINDALCO is in your portfolio.</b> Hindalco Industries, ₹199,599cr by market cap in this bucket — the Aditya Birla Group's integrated aluminium and copper producer, with the Novelis rolling business inside it; <code>promoter_pct</code> is 34.67%, 23rd of 24, the second-lowest promoter holding in the bucket. " + VET + "Composite 67 is ninth of 24, valuation 66 is eighth of 24 and momentum 62 is seventh of 24; quality 43 is tied 17th of 24 in a two-way tie spanning positions 17 to 18. Its own ten-year band runs 5.71-23.04x with an average of 12.13x, narrow enough to price the row.",
  "<b>Scale without returns: every capital-return reading sits in the middle of the bucket.</b> <code>roce_3y</code> 11.31% is 16th of 24 and <code>roce_5y</code> 12.17% is 15th of 24, with <code>ebitda_margin_3y</code> 15.69% at tenth of 24 and <code>ebitda_margin_5y</code> 15.68% at ninth of 24 — the largest company in this batch earns a mid-pack return on the capital it employs. <code>roe_avg_above_threshold_10y</code> 0.100 is tied 15th of 24 in a five-way tie spanning positions 15 to 19, <code>roe_avg_above_threshold_7y</code> 0.143 is tied 13th of 24 in a six-way tie spanning positions 13 to 18 and <code>roe_avg_above_threshold_5y</code> 0.200 is tied 13th of 24 in a six-way tie spanning positions 13 to 18: the average return on equity cleared the bar in one year out of ten, and in one year out of the most recent five. <code>np_growth_above_inflation_10y</code> 0.333 is tied 23rd of 24 in a two-way tie spanning positions 23 to 24, <code>np_growth_above_inflation_7y</code> 0.333 is tied 22nd of 24 in a three-way tie spanning positions 22 to 24 and <code>np_growth_above_inflation_5y</code> 0.250 is tied 20th of 24 in a five-way tie spanning positions 20 to 24 — profit beat inflation in three comparisons of the nine. <code>asset_turnover</code> 0.798 is 11th of 24 and <code>capex_intensity_3y</code> 0.080 is tenth of 24.",
  "<b>The cash line broke in the year the operating line peaked.</b> " + CASHDET + "There is no negative operating cash year in the ten annual rows the pack holds, which is what makes FY2026 legible as a break rather than a pattern: operating cash ran ₹19,208cr, ₹24,056cr and ₹24,410cr across the three years before it. Net profit fell from ₹16,001cr to ₹13,391cr on sales that rose from ₹238,496cr to ₹274,944cr. <code>net_debt_ebitda</code> 2.062 is sixth of 20 — the fourth most levered balance sheet in this batch on that reading — and <code>fcf_yield</code> -0.46% is 15th of 24, which is the same fact arriving from the price side. " + THINREAD,
  "<b>The twelve months grew and the chart has not paid for it.</b> <code>ttm_sales_pct</code> +20.28% is 13th of 23 and <code>ttm_op_pct</code> +27.00% is eighth of 19, while <code>ttm_np_pct</code> -3.14% is 17th of 21 — the operating line is growing and the net line is not, which on this row is interest on the new borrowing. <code>opm_now</code> 13.84% is 11th of 24 against <code>opm_prev</code> 13.11% at 11th of 23, so the margin is steady rather than stepping. The quarter was strong: <code>sales_yoy_q</code> +32.06% is 14th of 24 and <code>np_yoy_q</code> +75.15% is ninth of 24. " + THINREAD + "On price, <code>pe_ttm</code> 12.17x is 12th of 19 and <code>pb</code> 1.461 is 18th of 23, with <code>ev_ebitda_ttm</code> 5.710x at 15th of 19 and <code>ev_sales_ttm</code> 0.961 at 19th of 24. The chart is mid-pack on the year — <code>ret_12m_rel</code> +10.93% is eighth of 22, <code>ret_6m_rel</code> -9.19% is 12th of 23, <code>ret_3m_rel</code> +0.33% is fourth of 23 — and the close held above its 200-day EMA on 92.86% of the last 252 sessions at third of 22. Ownership is institutional and rising on the foreign side: <code>fii_pct</code> 31.41% is first of 22 and has risen from 27.18%, <code>dii_pct</code> 19.82% is first of 22 but has fallen from 25.41% across the same stretch, and <code>shareholders</code> 699,601 is sixth of 24 on a public float of 13.26%. " + MOM96,
  "<i>HINDALCO is a hold on evidence that got worse in the year the headline numbers got better. The operating record is real: ₹274,944cr of sales and ₹34,880cr of operating profit are both records, <code>ttm_op_pct</code> +27.00% at eighth of 19 says the trailing year grew, and the price has not re-rated for it. Against that, the collection fell to 0.294 of operating profit from a prior mean of 0.804, borrowings rose ₹33,523cr in the same year, and <code>roce_3y</code> 11.31% at 16th of 24 says the capital base has never earned much. The foreign holding — <code>fii_pct</code> 31.41%, first of 22 — is the other side of the argument — someone is buying the scale. A second year collecting under a third of operating profit would convert this from a cycle position into a funding problem, and that is the one number to watch. Confidence is medium.</i>",
  ],
},

"LLOYDSME": {
  "verdict": "WATCH — momentum 75, second of 24, on sales that went from "
             "₹6,721cr to ₹17,113cr in one year and borrowings that went from "
             "₹1,073cr to ₹20,716cr with it",
  "confidence": "low",
  "trigger": "a second year of operating profit above ₹6,000cr with "
             "borrowings flat or lower -> the expansion is self-funding and "
             "the quality percentile is real; operating profit falling with "
             "borrowings above ₹20,000cr -> the balance sheet is carrying a "
             "commodity bet",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "ttm_op_pct",
               "net_debt_ebitda"],
  "points": [
  "<b>Held — LLOYDSME is in your portfolio.</b> Lloyds Metals and Energy, ₹101,549cr by market cap in this bucket — iron ore mining, a mine-developer-operator contract, sponge iron and a copper line, scaling from mining into metal; <code>promoter_pct</code> is 61.63%, 11th of 24, down from 65.69% two years ago. " + VET + "Composite 71 is eighth of 24, momentum 75 is second of 24 and quality 64 is fifth of 24; valuation 29 is 19th of 24. " + GAP + BANDWIDE,
  "<b>The operating ranks are near the top of the bucket and almost all of them are one year old.</b> <code>roce_3y</code> 34.38% is second of 24, <code>opm_now</code> 36.80% is fourth of 24 against <code>opm_prev</code> 29.94% at fifth of 23, <code>ebitda_margin_3y</code> 32.46% is seventh of 24 and <code>op_margin_trend_7y</code> 0.0524 is fifth of 24. <code>roce_5y</code> 19.95% is eighth of 24 — the five-year reading is half the three-year one, which is the shape of a business that has just arrived. The annual rows are the argument: sales ₹6,521.65cr, ₹6,721.05cr and then ₹17,112.67cr; operating profit ₹1,728.53cr, ₹1,955.74cr and then ₹6,205.29cr; net profit ₹1,242.93cr, ₹1,455.24cr and then ₹3,680.85cr. Two years before that, FY2023 lost ₹288.55cr. <code>np_growth_above_inflation_5y</code> 0.750 is tied fourth of 24 in a seven-way tie spanning positions 4 to 10 and <code>np_growth_above_inflation_7y</code> 0.667 is tied fifth of 24 in an 11-way tie spanning positions 5 to 15.",
  "<b>Borrowings went up nineteen times in the year the profit tripled.</b> Borrowings on the annual rows ran ₹33.13cr, ₹1,073.26cr and then ₹20,716.36cr, so the capital behind the step change is debt rather than retained profit, and <code>net_debt_ebitda</code> 2.217 is fifth of 20 — the third most levered reading in this batch. " + THINREAD + "Operating cash was negative in three separate years of the record, most recently at minus ₹516.44cr, and the latest year collected 0.471 of operating profit — ₹2,921.32cr against ₹6,205.29cr. <code>fcf_yield</code> -6.71% is 23rd of 24 and <code>capex_intensity_3y</code> 0.669 is third of 24: this is a company spending every rupee it earns and more. The framing the pack would normally reach for — a collection ratio falling away from a stable prior mean — does not apply here, because this row's record has a six-year hole in it and there is no stable prior mean to fall from.",
  "<b>Every trailing figure on this row is a multiple, not a percentage change.</b> <code>ttm_sales_pct</code> +230.21% is first of 23, <code>ttm_op_pct</code> +305.81% is first of 19 and <code>ttm_np_pct</code> +210.66% is second of 21 — a trailing year that more than tripled the one before it, on a base that includes the pre-expansion quarters. <code>sales_yoy_q</code> +208.55% is second of 24 and <code>np_yoy_q</code> +169.11% is third of 24. " + THINREAD + "On price it is expensive on assets and mid-pack on earnings: <code>pb</code> 7.321 is third of 23, <code>ev_sales_ttm</code> 5.414 is fifth of 24, <code>ev_ebitda_ttm</code> 13.691x is eighth of 19 and <code>pe_ttm</code> 21.31x is eighth of 19. The chart has paid for the growth: <code>ret_12m_rel</code> +43.08% is fourth of 22, <code>ret_6m_rel</code> +10.69% is fifth of 23, <code>ret_3m_rel</code> -0.44% is fifth of 23 and the close held above its 200-day EMA on 72.22% of the last 252 sessions at ninth of 22. Ownership is the quiet signal: <code>promoter_pct</code> fell from 65.69% to 61.63% across the series while <code>shareholders</code> 126,658, 11th of 24, rose from 37,806 — the promoter sold into a register that grew more than threefold. <code>fii_pct</code> 1.85% is 15th of 22 and <code>dii_pct</code> 2.18% is 12th of 22. " + MOM96,
  "<i>LLOYDSME is the row in this batch where the numbers are the most impressive and the least readable. Sales tripled, operating profit tripled, <code>roce_3y</code> 34.38% is second of 24 and <code>opm_now</code> 36.80% is fourth of 24 — on the current year this is the best operating business here. Everything that would let you check whether it is repeatable is missing: the pack holds no FY2014 through FY2019, the earnings band spans more than five hundred times from low to high, borrowings went from ₹1,073.26cr to ₹20,716.36cr to fund it, and the promoter reduced from 65.69% to 61.63% while the shareholder register more than tripled. A held position here is a bet that iron ore volumes and the copper line hold up long enough for the debt to be repaid out of operations. Nothing in the pack settles that, and the quality percentile of 64 at fifth of 24 is reading a single year as if it were a record. Confidence is low.</i>",
  ],
},

"MMP": {
  "verdict": "WATCH — momentum 88, first of 24, on a trailing net profit that "
             "grew 126% while operating profit grew 23% and the annual net "
             "line fell from ₹38.88cr to ₹31.01cr",
  "confidence": "low",
  "trigger": "operating profit above ₹80cr with the net line following it -> "
             "the trailing gap was timing and the momentum is earned; another "
             "year of operating profit near ₹65cr -> the three-year step was "
             "the aluminium price and not the business",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "asset_turnover",
               "net_debt_ebitda"],
  "points": [
  "<b>Not held — MMP is on your watchlist.</b> MMP Industries, ₹1,200cr by market cap in this bucket — aluminium powder, paste and conductor products out of five works units in Maharashtra, the smallest veteran in this batch by some distance; <code>promoter_pct</code> is 74.49%, second of 24, and unchanged at that level through every period in the series. " + VET + "Momentum 88 is first of 24 and composite 62 is tenth of 24; valuation 38 is 16th of 24 and quality 43 is tied 17th of 24 in a two-way tie spanning positions 17 to 18. Its own eight-year band runs 8.01-20.44x with an average of 14.15x, the narrowest band in this batch.",
  "<b>A real ten-year growth record attached to a return profile that has not moved.</b> Sales went from ₹203.22cr to ₹824.00cr across the ten annual rows and operating profit from ₹20.78cr to ₹65.27cr, with <code>rev_cagr_5y</code> 16.44% at seventh of 24. But <code>roce_3y</code> 11.69% is 15th of 24 and <code>roce_5y</code> 11.84% is 16th of 24 — four times the sales and the same return on capital. <code>opm_now</code> 8.36% is 17th of 24 against <code>opm_prev</code> 8.22% at 14th of 23, <code>ebitda_margin_3y</code> 9.79% is 15th of 24 and <code>op_margin_trend_7y</code> -0.0054 is 20th of 24: the margin has drifted down across the window, which is what a converter of someone else's metal looks like. <code>asset_turnover</code> 1.319 is fifth of 24 — it turns its assets faster than anything else here and earns less on them. <code>roe_avg_above_threshold_5y</code> 0.000 is tied 19th of 24 in a six-way tie spanning positions 19 to 24 and <code>roe_avg_above_threshold_7y</code> 0.000 is tied 19th of 24 in a six-way tie spanning positions 19 to 24.",
  "<b>The trailing net figure is not an operating figure.</b> " + BELOWEBIT + "The annual rows say the opposite of the trailing ones: net profit fell from ₹38.88cr to ₹31.01cr in FY2026 while operating profit was flat at ₹65.27cr against ₹64.26cr. <code>ttm_np_pct</code> +126.48% is fourth of 21 and <code>ttm_op_pct</code> +23.42% is ninth of 19, and the difference between those two is the gap the flag is naming. <code>pe_ttm</code> 23.94x is fifth of 19 — the second most expensive trailing multiple in this batch — and it is divided into that base. " + THINREAD + "There is no negative operating cash year in the ten annual rows and the latest collected 0.816 of operating profit, so the cash itself is not the question; what the earnings are made of is.",
  "<b>The chart leads the whole cohort on every window and the ownership has not moved with it.</b> <code>ret_12m_rel</code> +73.31% is first of 22, <code>ret_6m_rel</code> +97.69% is first of 23 and <code>ret_3m_rel</code> +73.17% is first of 23 — first on all three readings, which no other row here manages on even one. The close held above its 200-day EMA on 53.17% of the last 252 sessions at 15th of 22, so the move is recent rather than established. <code>np_yoy_q</code> +353.23% is first of 24 and <code>sales_yoy_q</code> +26.90% is 15th of 24. " + THINREAD + "On price, <code>pb</code> 3.463 is eighth of 23, <code>ev_ebitda_ttm</code> 16.395x is seventh of 19 and <code>ev_sales_ttm</code> 1.583 is 15th of 24; <code>net_debt_ebitda</code> 2.501 is fourth of 20, and borrowings rose from ₹40.76cr to ₹184.52cr across the ten annual rows. Ownership is almost entirely promoter and retail: <code>fii_pct</code> 0.02% is 20th of 22, <code>dii_pct</code> 0.00% is 22nd of 22, and <code>shareholders</code> 11,202 is 22nd of 24 on a public float of 25.49%. " + MOM96,
  "<i>MMP is a momentum reading in search of an operating one. It is first of 24 on all three relative-return windows and first of 24 on the quarterly profit change, and the price has moved accordingly. Underneath, the annual net line fell from ₹38.88cr to ₹31.01cr, operating profit was flat, <code>opm_now</code> 8.36% at 17th of 24 is a thin margin that has drifted thinner across seven years, and <code>roce_3y</code> 11.69% at 15th of 24 is the same return on capital it earned at a quarter of the size. The pack's flag is explicit that the trailing net growth sits below the operating line. A 23.94x trailing multiple on that base, with no institutional holder of any size, is a position taken on the aluminium cycle and the free float rather than on the business. Confidence is low.</i>",
  ],
},

"NATIONALUM": {
  "verdict": "HOLD — composite 100, first of 24, on ₹7,928cr of operating "
             "profit, ₹6,438cr of operating cash and ₹59.83cr of borrowings, "
             "with no earnings-quality flag of any kind",
  "confidence": "medium",
  "trigger": "operating margin holding above 40% for a second year -> the "
             "alumina spread is structural and the composite is earned; "
             "operating profit below ₹5,000cr -> the two record years were the "
             "price of alumina and nothing else",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "net_debt_ebitda",
               "div_yield"],
  "points": [
  "<b>Held — NATIONALUM is in your portfolio.</b> National Aluminium Company, ₹57,285cr by market cap in this bucket — the Government of India's integrated bauxite, alumina and aluminium producer with its own captive power, and the only row in this batch carrying no blocker at all; <code>promoter_pct</code> is 51.28%, 18th of 24, and unchanged across every period in the series. " + VET + "Composite 100 is first of 24, quality 77 is first of 24 and valuation 79 is fifth of 24; momentum 60 is eighth of 24. " + BANDWIDE,
  "<b>The best capital returns in the bucket, on a balance sheet that is net cash.</b> <code>roce_3y</code> 31.58% is third of 24 and <code>roce_5y</code> 28.06% is third of 24, with <code>opm_now</code> 47.33% at third of 24 against <code>opm_prev</code> 45.46% at second of 23, <code>ebitda_margin_3y</code> 41.56% at third of 24 and <code>ebitda_margin_5y</code> 36.77% at fifth of 24. <code>op_margin_trend_7y</code> 0.0554 is fourth of 24, so the margin has widened across the window rather than spiked at the end of it. <code>net_debt_ebitda</code> -0.912 is 19th of 20 — the reading is negative because the company holds more cash than debt, and borrowings on the latest annual row are ₹59.83cr against ₹7,928.03cr of operating profit. " + THINREAD + "<code>np_growth_above_inflation_10y</code> 0.778 is tied second of 24 in a two-way tie spanning positions 2 to 3 and <code>np_growth_above_inflation_7y</code> 0.833 is tied second of 24 in a three-way tie spanning positions 2 to 4; <code>roe_avg_above_threshold_5y</code> 0.600 is tied seventh of 24 in a four-way tie spanning positions 7 to 10.",
  "<b>Two record years in a row, and the cash arrived with them.</b> Operating profit ran ₹2,801.42cr, ₹7,507.91cr and ₹7,928.03cr across the last three annual rows and operating cash ₹2,719.32cr, ₹5,806.11cr and ₹6,437.97cr — the collection ratio of 0.812 in FY2026 is in line with a prior-years mean of 0.752, which is why the pack raises no flag. Operating cash was negative in one year of the ten annual rows, FY2020 at minus ₹348.56cr, which was also the only year operating profit fell below ₹500cr. Sales rose from ₹16,787.63cr to ₹17,843.05cr while operating profit rose ₹420cr, so the margin did the work rather than the volume. <code>fcf_yield</code> 6.74% is third of 24. " + THINREAD + "<code>div_yield</code> 3.69% is third of 16 — on the cash-return measures it is near the front of the bucket.",
  "<b>Priced as a commodity producer at the top of its spread.</b> " + THINREAD + "<code>pe_ttm</code> 8.49x is 16th of 19, <code>ev_ebitda_ttm</code> 4.944x is 16th of 19, <code>pb</code> 2.652 is ninth of 23 and <code>ev_sales_ttm</code> 2.531 is 12th of 24 — cheap on earnings and on cash flow, mid-pack on assets, which is the standard shape for a cyclical the market will not extrapolate. The twelve months grew modestly: <code>ttm_sales_pct</code> +9.02% is 16th of 23, <code>ttm_op_pct</code> +13.50% is 12th of 19 and <code>ttm_np_pct</code> +17.83% is tenth of 21, with <code>sales_yoy_q</code> +39.28% at 13th of 24 and <code>np_yoy_q</code> +90.87% at seventh of 24. The chart is split: <code>ret_12m_rel</code> +43.68% is third of 22 while <code>ret_6m_rel</code> -22.40% is 17th of 23 and <code>ret_3m_rel</code> -1.98% is ninth of 23, and the close held above its 200-day EMA on 88.49% of the last 252 sessions at fifth of 22 — the year was strong and the last six months gave part of it back. Ownership is institutional on both sides: <code>fii_pct</code> 21.99% is second of 22 and has risen from 10.43% across the series, <code>dii_pct</code> 11.22% is third of 22 and has fallen from 19.12% over the same stretch, and <code>shareholders</code> 948,915 is fourth of 24 on a public float of 15.52%. " + MOM96,
  "<i>NATIONALUM is the only row in this batch whose percentile needs no caveat underneath it. Composite 100 and quality 77 are both first of 24, <code>roce_3y</code> 31.58% is third of 24, <code>opm_now</code> 47.33% is third of 24, the collection ratio is in line with its own history, borrowings are ₹59.83cr against ₹7,928.03cr of operating profit, and the pack raises no flag of any kind. The uncomfortable part is what the record rests on: operating margin went from 21.3% to 44.7% to 47.3% across three years on sales that moved far less, so almost all of the improvement is the alumina spread rather than volume or cost. At 8.49x trailing earnings the market has already decided the spread is temporary. Holding this is a judgement on alumina prices, which no number in the pack can settle, and the margin is the one line to watch. Confidence is medium.</i>",
  ],
},

"NRL": {
  "verdict": "WATCH — no verdict. Momentum 88 at tied third of 38 on four fiscal "
             "years of history, a cohort assembled from every tier of the "
             "cluster, and operating cash negative in three of those four "
             "years",
  "confidence": "low",
  "trigger": "a second year of positive operating cash with the same "
             "volumes -> the FY2026 cash was the business and not the "
             "borrowing; operating cash negative again -> the growth is being "
             "funded by the working-capital line",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "asset_turnover",
               "pe_ttm"],
  "points": [
  "<b>Not held — NRL is on your watchlist.</b> Nupur Recyclers, ₹1,130cr by market cap in this bucket — a non-ferrous metal recycler in Ghaziabad, listed in January 2023, and the pack's own business description of it is a single line; <code>promoter_pct</code> is 73.6%, sixth of 37, and has risen from 72.53% across the series. " + MID + NOVERDICT + "Momentum 88 is tied third of 38 in a two-way tie spanning positions 3 to 4, composite 54 is tied 19th of 38 in a two-way tie spanning positions 19 to 20, quality 51 is 24th of 40; valuation 16 is 37th of 40 and is scored on 90 points rather than the declared 100, the missing 10 being dividend yield, which this row does not have. " + NOBAND,
  "<b>Four annual rows, and three of them have negative operating cash.</b> " + NEGMEAN + "Sales across those four rows ran ₹186.84cr, ₹240.08cr, ₹158.31cr and ₹215.94cr — not a trend, a pattern of a trading business whose year depends on scrap availability — with operating profit ₹12.76cr, ₹7.12cr, ₹15.62cr and ₹17.08cr. <code>opm_now</code> 9.10% is 17th of 33 against <code>opm_prev</code> 8.55% at 14th of 32, and <code>ebitda_margin_3y</code> 7.84% is 21st of 38: a thin converter's margin, in the middle of a cohort that is not its own tier. <code>roce_3y</code> 15.14% is 19th of 38 and <code>asset_turnover</code> 1.091 is 20th of 39. The three-year growth readings this row would otherwise lead on are read by seven peers and are not quoted here at all.",
  "<b>Priced as a growth company on a record that cannot support the word.</b> <code>pe_ttm</code> 65.84x is fourth of 32 and <code>ev_ebitda_ttm</code> 44.693x is third of 31 — the second and third most demanding readings in this batch — with <code>pb</code> 8.424 at seventh of 38. <code>fcf_yield</code> -1.80% is 26th of 37. The twelve months did grow: <code>ttm_sales_pct</code> +40.64% is 12th of 32, <code>ttm_op_pct</code> +49.63% is ninth of 28 and <code>ttm_np_pct</code> +26.92% is 14th of 30, with <code>sales_yoy_q</code> +55.60% at ninth of 34 and <code>np_yoy_q</code> +83.05% at 12th of 34. <code>net_debt_ebitda</code> 1.190 is 18th of 35 and borrowings rose from ₹0.44cr to ₹33.43cr across the four rows.",
  "<b>The chart is the loudest thing on this row and the register is shrinking underneath it.</b> <code>ret_6m_rel</code> +206.56% is second of 35, <code>ret_12m_rel</code> +150.58% is second of 31 and <code>ret_3m_rel</code> +64.05% is third of 36 — a stock that has roughly tripled relative to the market inside a year. The close held above its 200-day EMA on 41.67% of the last 252 sessions at 19th of 26, so most of that move is recent. Against it, <code>shareholders</code> 19,074 is 28th of 37 and has fallen from 21,770 eighteen months ago while the promoter added — the float is concentrating as the price rises, which is a thinner market than the returns suggest. <code>fii_pct</code> 0.41% is tied 25th of 32 in a two-way tie spanning positions 25 to 26 and <code>dii_pct</code> 0.00% is tied 30th of 31 in a two-way tie spanning positions 30 to 31: no institution of any size holds this. The pack holds no delivery row for the symbol at all, so accumulation and churn cannot be separated here even in principle. " + MOM96,
  "<i>NRL is a no-verdict row and the reasons are structural rather than a matter of degree. Four fiscal years of history, a cohort borrowed from every tier of the cluster because its own has too few rows to rank against, operating cash negative in three of those four years with a prior-years mean of -1.365, no dividend yield so the valuation pillar is scored on 90 points rather than the declared 100, no delivery row at all, and no institutional holder above half a per cent. What is real: ₹215.94cr of sales and ₹17.08cr of operating profit in FY2026, the first positive operating cash year at ₹18.31cr, and <code>ret_12m_rel</code> +150.58% at second of 31. At 65.84x trailing earnings the price has already assumed the pattern continues. Every one of those is a reason to keep watching and none is a reason to act. Confidence is low.</i>",
  ],
},

"VEDL": {
  "verdict": "WATCH — valuation 92, tied first of 24, on 4.77x trailing "
             "earnings and a 14.17% dividend yield, against a sales line that "
             "fell from ₹143,727cr to ₹62,717cr in one year",
  "confidence": "low",
  "trigger": "two years of sales near ₹78,000cr with operating margin above "
             "29% -> the reshaped entity is the business and the multiple is "
             "real; operating cash below ₹25,000cr or the dividend cut -> the "
             "yield was the return of capital and not the earnings",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "net_debt_ebitda",
               "div_yield"],
  "points": [
  "<b>Not held — VEDL is on your watchlist.</b> Vedanta Limited, ₹93,810cr by market cap in this bucket — zinc, lead, silver, aluminium, oil and gas, power and iron ore under one listed entity; <code>promoter_pct</code> is 54.72%, 17th of 24, down from 59.31% across the series. " + VET + "Valuation 92 is tied first of 24 in a two-way tie spanning positions 1 to 2, composite 96 is second of 24 and momentum 66 is fifth of 24; quality 60 is tenth of 24. Its own nine-year band runs 2.65-8.62x with an average of 4.30x, narrow enough to price the row.",
  "<b>The cheapest earnings and the highest cash return in the bucket.</b> " + BELOWEBIT + "<code>pe_ttm</code> 4.77x is 18th of 19, <code>ev_ebitda_ttm</code> 3.808x is 18th of 19, <code>div_yield</code> 14.17% is first of 16 and <code>fcf_yield</code> 67.12% is first of 24 — on four separate price readings this is the cheapest or the most generous row in the cohort. " + THINREAD + "<code>pb</code> 1.889 is 15th of 23 and <code>ev_sales_ttm</code> 1.384 is 16th of 24. A 14.17% yield is not a dividend a business pays out of a normal year, and the pack does not say what it was paid out of — borrowings on the annual rows fell from ₹91,479cr to ₹32,947cr in the same year, which is where ₹39,499cr of operating cash went.",
  "<b>Real capital returns, on a revenue line that is not comparable with its own history.</b> " + RESHAPE + "<code>rev_cagr_5y</code> -12.32% is 23rd of 24 and <code>np_cagr_5y</code> -1.93% is 16th of 19, and neither reading describes the trade. What is comparable: <code>roce_3y</code> 28.34% is fourth of 24, <code>roce_5y</code> 27.78% is fourth of 24, <code>ebitda_margin_3y</code> 34.70% is fifth of 24 and <code>ebitda_margin_5y</code> 35.02% is sixth of 24 — the capital returns are the second best in this batch and they hold across both windows. <code>opm_now</code> 30.93% is sixth of 24 against <code>opm_prev</code> 27.96% at sixth of 23. <code>roe_avg_above_threshold_10y</code> 0.600 is tied sixth of 24 in a two-way tie spanning positions 6 to 7 and <code>roe_avg_above_threshold_5y</code> 0.800 is tied fifth of 24 in a two-way tie spanning positions 5 to 6: the average return on equity cleared the bar in six years out of ten, which only one other row here manages.",
  "<b>The trailing net line outran the operating line, and the balance sheet moved more than either.</b> " + BELOWEBIT + "<code>ttm_np_pct</code> +35.09% is eighth of 21 against <code>ttm_op_pct</code> +12.86% at 14th of 19, and <code>ttm_sales_pct</code> +2.02% is 20th of 23 — the twelve months barely grew at the top line. There is no negative operating cash year in the ten annual rows, and FY2026 collected 1.704 of operating profit, ₹39,499cr against ₹23,183cr, against a prior-years mean of 1.220 — the cash on this row arrives ahead of the reported profit rather than behind it. " + THINREAD + "<code>net_debt_ebitda</code> 1.062 is tenth of 20. The quarter was strong: <code>sales_yoy_q</code> +53.64% is eighth of 24 and <code>np_yoy_q</code> +71.84% is 11th of 24. The chart has noticed the yield: <code>ret_12m_rel</code> +45.34% is second of 22, <code>ret_6m_rel</code> -0.65% is eighth of 23 and <code>ret_3m_rel</code> -1.98% is eighth of 23, with the close above its 200-day EMA on 96.03% of the last 252 sessions at second of 22 — effectively the whole year spent above the average. Ownership is the counter-signal: <code>promoter_pct</code> fell from 59.31% to 54.72%, <code>fii_pct</code> 15.78% is fourth of 22 and rising from 10.23%, <code>dii_pct</code> 10.83% is fifth of 22 and falling from 14.78%, and <code>shareholders</code> 2,601,130 is first of 24 — the largest retail register in the cohort by a wide margin — on a public float of 18.45%. " + MOM96,
  "<i>VEDL carries valuation 92, tied first of 24, and is the hardest row in this batch to read on history. 4.77x trailing earnings, a 14.17% dividend yield, a 67.12% free-cash yield, and <code>roce_3y</code> 28.34% at fourth of 24 holding across both windows — on the current entity the operating evidence is strong and the price is not paying for it. The problems are all about what the current entity is: sales fell from ₹143,727cr to ₹62,717cr in one year while margin rose, so no five-year rate here measures a trade; the pack's flag says the trailing net growth sits below the operating line; the promoter reduced from 59.31% to 54.72%; and a yield that size is usually a return of capital rather than a share of earnings, with borrowings falling ₹58,532cr in the same year to suggest exactly that. Two years of sales near ₹78,000cr at this margin would make the multiple something the record could support. Until then it is a yield, not a verdict. Confidence is low.</i>",
  ],
},

}


def guards(spec: dict, pack: dict) -> list[str]:
    errs: list[str] = []
    for sym, v in spec.items():
        p = pack[sym]
        pts = v["points"]
        p0 = pts[0]
        pr = p["peer_ranks"]
        tier = pr["cohort"]["tier"]
        n = pr["cohort"]["n"]
        allprose = pts + [v["trigger"], v["verdict"]]
        joined = " ".join(pts)
        live = (p.get("metrics") or {}).get("cluster_metrics") or {}
        mranks = pr.get("metrics") or {}
        annual = p.get("annual") or []
        eq = p.get("earnings_quality") or {}

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. CHOICE 2. Two buckets in one batch, so the cohort sentence is the
        #    row's own and the stated count has to be the bucket the scorer
        #    actually used rather than the cluster size.
        want = TIER_SENTENCE.get(tier)
        if want is None:
            errs.append(f"{sym}: tier={tier} has no cohort sentence")
        elif want not in p0:
            errs.append(f"{sym}: tier={tier} but point one does not carry the "
                        f"{tier} cohort sentence")
        for other_tier, text in TIER_SENTENCE.items():
            if other_tier != tier and text in joined:
                errs.append(f"{sym}: is {tier} but carries the {other_tier} "
                            f"cohort sentence")
        stated = re.search(r"[Pp]eered against (\d+) peers", p0)
        if not stated:
            errs.append(f"{sym}: point one states no cohort size")
        elif int(stated.group(1)) != n:
            errs.append(f"{sym}: point one says {stated.group(1)} peers, "
                        f"peer_ranks says {n}")

        # 3. Five rows are `full` and one is not, which is the whole of
        #    CHOICE 2 — so the status is asserted rather than assumed.
        st = p["scores"]["score_status"]
        if st != STATUS[sym]:
            errs.append(f"{sym}: score_status={st}, STATUS says "
                        f"{STATUS[sym]} — the cohort sentence is wrong")

        # 4. Held vs watchlist, measured not recalled.
        held = sym in HELD
        says_held = p0.startswith("<b>Held —")
        if held != says_held:
            errs.append(f"{sym}: in HELD={held} but point one says "
                        f"{'held' if says_held else 'not held'}")

        # 5. Dead metrics may not be argued from.
        for pt in pts:
            for d in DEAD:
                if d in pt:
                    errs.append(f"{sym}: prose names dead metric '{d}'")
            if "tech_net_score_scaled" in pt and MOM96 not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside MOM96")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. CHOICE 12. Five rows hold 13 sessions and NRL holds none, so any
        #    percentage off the delivery table is a single-day print. Naming the
        #    absence is allowed; quoting a figure next to it is not.
        for pt in allprose:
            if "delivery_pct" in pt:
                errs.append(f"{sym}: names delivery_pct, a single-day print")
            for m in re.finditer(r"deliver", pt, re.I):
                win = pt[max(0, m.start() - 60):m.end() + 90]
                if re.search(r"\d+(?:\.\d+)?\s*%", win):
                    errs.append(f"{sym}: quotes a figure beside delivery off "
                                f"{(p.get('delivery') or {}).get('sessions')} "
                                f"sessions — a single-day print")

        # 7. np_consistency is an index 0-2, never a pass rate.
        for pt in pts:
            if re.search(r"np_consistency\w*</code>\s*[\d.]+\s*(?:of|in)\s",
                         pt):
                errs.append(f"{sym}: np_consistency written as a pass rate")

        # 8. Every evidence key must resolve non-NULL in THIS row's own
        #    cluster_metrics or verdict-load.py rejects the whole row. div_yield
        #    is NULL on NRL and live on two others; pe_ttm is live everywhere
        #    here but on part of the bucket.
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics "
                            f"(tier={tier})")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")

        # 9. CHOICE 3, four-valued. A band whose high is more than
        #    BAND_RATIO_MAX times its low records an earnings denominator
        #    passing near zero rather than a range a price can sit inside. A
        #    band built from fewer than BAND_MIN_N years is arithmetically
        #    narrow and still not a band — NRL's 22.71-86.35x is 3.8x wide on
        #    four readings. Those are two different sentences, and the rows with
        #    a usable band must state it correctly so the ban cannot quietly
        #    become "nobody quotes a band".
        band = p.get("pe_band") or {}
        lo, hi, avg, bn = (band.get("lo"), band.get("hi"), band.get("avg"),
                           band.get("n"))
        if not band or not lo:
            state = "absent"
        elif (bn or 0) < BAND_MIN_N:
            state = "short"
        elif (hi / lo) > BAND_RATIO_MAX:
            state = "wide"
        else:
            state = None
        if BAND_REASON.get(sym) != state:
            errs.append(f"{sym}: BAND_REASON says {BAND_REASON.get(sym)!r}, "
                        f"the pack's band is {lo}-{hi} (n={bn}) which reads "
                        f"{state!r}")
        if state:
            need = BANDWIDE if state == "wide" else NOBAND
            other = NOBAND if state == "wide" else BANDWIDE
            if need not in p0:
                errs.append(f"{sym}: band is {state} and point one does not "
                            f"carry the sentence saying so")
            if other in joined:
                errs.append(f"{sym}: band is {state} but the prose carries the "
                            f"other refusal")
            for pt in allprose:
                if re.search(r"own \w+-year band", pt):
                    errs.append(f"{sym}: quotes its own band, which is "
                                f"{state} and cannot price the row")
                for fig in (lo, hi, avg):
                    if fig is not None and f"{fig:.2f}x" in pt:
                        errs.append(f"{sym}: states band figure {fig:.2f}x on "
                                    f"a row whose band is banned")
        else:
            for text in (BANDWIDE, NOBAND):
                if text in joined:
                    errs.append(f"{sym}: refuses its band, which is {lo}-{hi} "
                                f"on n={bn} and inside the {BAND_RATIO_MAX}x "
                                f"limit")
            got = 0
            for pt in allprose:
                for yr, blo, bhi, bavg in re.findall(
                        r"own (\w+)-year band runs ([\d.]+)-([\d.]+)x"
                        r" with an average of ([\d.]+)x", pt):
                    got += 1
                    if _YEAR_WORD.get(yr.lower()) != bn:
                        errs.append(f"{sym}: says {yr}-year band, pack n={bn}")
                    if (abs(float(blo) - lo) > 0.005
                            or abs(float(bhi) - hi) > 0.005):
                        errs.append(f"{sym}: band {blo}-{bhi} vs pack "
                                    f"{lo}-{hi}")
                    if abs(float(bavg) - avg) > 0.005:
                        errs.append(f"{sym}: band average {bavg} vs pack {avg}")
            if not got:
                errs.append(f"{sym}: band is usable ({lo}-{hi}x, n={bn}) but "
                            f"no point states it")

        # 10. Every <code> key in prose must exist and be non-NULL in THIS
        #     row's cluster_metrics. Guard 18 is the half this cannot see.
        for i, pt in enumerate(pts):
            for k in _CODE_RX.findall(pt):
                if k in CODE_ALLOW:
                    continue
                if k not in live:
                    errs.append(f"{sym}: point {i + 1} names <code>{k}</code>, "
                                f"not a metric of this row (tier={tier})")
                elif live[k] is None:
                    errs.append(f"{sym}: point {i + 1} names <code>{k}</code>, "
                                f"NULL in the pack")

        # 11. CHOICE 7. The pack's cash flag is a one-year ratio with a lumpy
        #     denominator, so the claim is made on the count of negative
        #     operating-cash years and the count is recomputed here — out of the
        #     row's own number of annual rows, which is four on NRL and ten on
        #     the rest. One row has earned the word "deterioration"; every other
        #     row stores the reason it is refused, so a second refusal cannot
        #     borrow the first one's excuse.
        yrs = [r for r in annual if r.get("cash_from_operating") is not None]
        want_neg, want_rows, want_ratio, refused = CASHYRS[sym]
        if len(yrs) != want_rows:
            errs.append(f"{sym}: CASHYRS counts out of {want_rows} annual cash "
                        f"rows, the pack holds {len(yrs)}")
        neg = sum(1 for r in yrs if r["cash_from_operating"] < 0)
        if neg != want_neg:
            errs.append(f"{sym}: CASHYRS says {want_neg} negative "
                        f"operating-cash years, the annual rows say {neg}")
        phrase = NOZERO if not neg else f"negative in {NEGWORD[neg]}"
        if phrase not in joined:
            errs.append(f"{sym}: no point states the cash count ('{phrase}')")
        gotr = eq.get("cfo_op_latest")
        if gotr is None or abs(float(gotr) - want_ratio) > 0.0005:
            errs.append(f"{sym}: CASHYRS says cfo_op_latest={want_ratio}, pack "
                        f"says {gotr}")
        cashflags = [f for f in (eq.get("flags") or [])
                     if "cash conversion" in f]
        if sym in CASH_FLAGGED:
            if not cashflags:
                errs.append(f"{sym}: in CASH_FLAGGED but the pack now carries "
                            f"no cash-conversion flag")
            if CASHDET not in joined:
                errs.append(f"{sym}: flagged on cash but carries no CASHDET "
                            f"sentence")
            if refused:
                errs.append(f"{sym}: is flagged and also refused as "
                            f"'{refused}' — pick one")
        else:
            if cashflags:
                errs.append(f"{sym}: pack carries {len(cashflags)} "
                            f"cash-conversion flag(s) but is not in "
                            f"CASH_FLAGGED")
            if CASHDET in joined:
                errs.append(f"{sym}: carries the CASHDET sentence with no flag")
            if not refused:
                errs.append(f"{sym}: is neither flagged nor given a reason for "
                            f"refusing the word")
        scrubbed = [pt.replace(CASHDET, " ") for pt in allprose]
        said = [i + 1 for i, pt in enumerate(scrubbed)
                if re.search(r"deteriorat", pt, re.I)]
        if said:
            errs.append(f"{sym}: point(s) {said} call the cash number a "
                        f"deterioration outside CASHDET"
                        + (f", refused here as '{refused}'" if refused else ""))

        # 12. Every row's TTM window is the same quarter pair here, so a rerun
        #     that moves one off the batch has to fail rather than leave three
        #     rows silently incomparable.
        win = (p.get("ttm_vs_prior") or {}).get("window")
        if win != WINDOW_BATCH:
            errs.append(f"{sym}: TTM window {win} is not the batch window "
                        f"{WINDOW_BATCH} and no point says so")

        # 14. CHOICE 1. The veteran bucket's thinnest reading is 16, so a
        #     denominator under it on those rows is fabricated or carried in
        #     from the previous cluster. NRL's own bucket legitimately reads
        #     lower, which is why the floor is the row's and not the batch's.
        floor = DENOM_FLOOR[tier]
        for pt in allprose:
            for d in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                if int(d) < floor:
                    errs.append(f"{sym}: states a denominator of {d}; nothing "
                                f"ranked against this row's {tier} bucket is "
                                f"read by fewer than {floor} peers")

        # 15. CHOICE 2. The label is the finding, so the headline carries it,
        #     point one carries the explanation, and no other row may use it.
        if NOVERDICT in p0:
            if sym != NOVERDICT_SYM:
                errs.append(f"{sym}: carries NOVERDICT but NOVERDICT_SYM is "
                            f"{NOVERDICT_SYM}")
            if not v["verdict"].startswith("WATCH — no verdict"):
                errs.append(f"{sym}: carries NOVERDICT but the headline does "
                            f"not say so")
        else:
            if sym == NOVERDICT_SYM:
                errs.append(f"{sym}: is NOVERDICT_SYM but point one carries no "
                            f"explanation")
            if "no verdict" in v["verdict"]:
                errs.append(f"{sym}: headline says 'no verdict' but point one "
                            f"carries no explanation")

        # 16. CHOICE 9. MOM96 exactly once per row — 96, not 95: this cluster
        #     gives tech_net_score_scaled 4 of momentum's 100 points.
        if sym in MOM96_SYMS:
            got = sum(MOM96 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM96 appears {got}x in the points, "
                            f"expected exactly 1")

        # 17. CHOICE 11. ema_stack_bull is tied across most of the rows that
        #     carry it on either reading. Banned, not caveated.
        for pt in allprose:
            if EMAFLAT in pt:
                errs.append(f"{sym}: names {EMAFLAT}, which is tied across "
                            f"most of the cohort on either reading")

        # 18. The half guard 10 cannot see. These phrases resolve, in the ranks
        #     checker's own vocabulary, to columns this cluster does not carry —
        #     so a sentence lifted from realty or bfsi reads perfectly and
        #     attributes its rank to nothing.
        scrub = joined + " " + v["trigger"] + " " + v["verdict"]
        for ex in PHRASE_EXEMPT:
            scrub = scrub.replace(ex, " ")
        low = scrub.lower()
        for ph in BANNED_PHRASES:
            if ph in low:
                errs.append(f"{sym}: prose says '{ph}', which names a column "
                            f"metals_nonferrous_mining does not carry")

        # 19. No figure for a metric that is NULL on this row.
        for key, word in (("promoter_pct", r"promoter"),
                          ("dii_pct", r"domestic institution|\bDII\b")):
            if live.get(key) is None and any(
                    re.search(word, pt) for pt in allprose):
                errs.append(f"{sym}: names {key} in the prose but it is NULL "
                            f"in the pack")

        # 20. CHOICE 1, and the defining constraint of this cluster. Four
        #     readings sit on part of the veteran bucket, so a rank on any of
        #     them is a position among those rows. Allowed, but only with
        #     THINREAD in the SAME point — and the counts are recomputed against
        #     the pack, so a snapshot that fills them in fails the build and
        #     tells me to rewrite the caveat rather than leaving a stale one.
        if tier == "veteran":
            for k, wantof in THIN_READS.items():
                gotof = (mranks.get(k) or {}).get("of")
                if gotof is not None and gotof != wantof:
                    errs.append(f"{sym}: THIN_READS says {k} is read by "
                                f"{wantof} peers, the pack says {gotof} — "
                                f"rewrite THINREAD")
            for i, pt in enumerate(pts):
                if any(f"<code>{k}</code>" in pt for k in THIN_READS) \
                        and THINREAD not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks a reading carried "
                                f"by part of the bucket without THINREAD in "
                                f"the same point")
            if THINREAD in joined and not any(
                    f"<code>{k}</code>" in joined for k in THIN_READS):
                errs.append(f"{sym}: carries THINREAD but ranks none of the "
                            f"thin readings")
        elif THINREAD in joined:
            errs.append(f"{sym}: carries THINREAD, which counts the veteran "
                        f"bucket, on a {tier}-tier row")

        # 21. CHOICE 10. A pillar percentile computed on part of its declared
        #     weight may be quoted only alongside what is missing underneath it.
        #     Unlike MOM96 this is NOT uniform, so the renormalisation sits in
        #     the SAME point and the figure is banned from headline and trigger.
        for pillar, phr in PILLAR_WEIGHT.get(sym, []):
            rx = re.compile(rf"\b{pillar}\s+(?:of\s+)?\d+", re.I)
            for i, pt in enumerate(pts):
                m = rx.search(pt)
                if m and phr not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes "
                                f"'{m.group(0)}' without naming the "
                                f"renormalisation ('{phr}')")
            for where, text in (("verdict", v["verdict"]),
                                ("trigger", v["trigger"])):
                m = rx.search(text)
                if m:
                    errs.append(f"{sym}: {where} quotes '{m.group(0)}', a "
                                f"pillar scored on part of its weight, with "
                                f"no room for the caveat")

        # 23. CHOICE 4. LLOYDSME's ten annual rows span sixteen fiscal years.
        #     The missing ones are recomputed from period_end rather than
        #     trusted, and every decade phrasing is false on that row.
        fys = sorted(int(r["period_end"][:4]) for r in annual
                     if r.get("period_end"))
        missing = [y for y in range(min(fys), max(fys) + 1)
                   if y not in set(fys)] if fys else []
        if sym == GAP_SYM:
            if GAP not in p0:
                errs.append(f"{sym}: point one does not carry GAP")
            if not missing:
                errs.append(f"{sym}: GAP_SYM but the annual rows now run "
                            f"unbroken {min(fys)}-{max(fys)}")
                missing = [0]
            # GAP states the hole as a run and the segments either side of it,
            # so the four endpoints and the shape are checked rather than every
            # year being named.
            for y in (min(fys), max(fys), missing[0], missing[-1]):
                if f"FY{y}" not in GAP:
                    errs.append(f"{sym}: GAP does not name FY{y}, an endpoint "
                                f"of the record it describes")
            if missing != list(range(missing[0], missing[-1] + 1)):
                errs.append(f"{sym}: the pack skips {missing}, which is not "
                            f"one run, and GAP describes it as one")
            low2 = (joined + v["trigger"] + v["verdict"]).lower()
            for ph in GAP_BANNED:
                if low2.replace(GAP.lower(), " ").count(ph):
                    errs.append(f"{sym}: says '{ph}' on a row whose record "
                                f"skips FY{missing[0]}-FY{missing[-1]}")
        else:
            if missing:
                errs.append(f"{sym}: annual rows skip {missing} and no point "
                            f"says so")
            if GAP in joined:
                errs.append(f"{sym}: carries GAP, which belongs to {GAP_SYM}")

        # 24. CHOICE 5. VEDL's sales halved in one year while margin rose, so
        #     no five-year compound rate on that row measures a trade. The step
        #     is recomputed as the largest one-year fall in the sales series.
        sales = [(r["period_end"], r["sales"]) for r in annual
                 if r.get("sales") is not None]
        steps = [(sales[i - 1][1] - sales[i][1], sales[i - 1][1], sales[i][1])
                 for i in range(1, len(sales))]
        if sym == RESHAPE_SYM:
            drop_, was, now = max(steps, key=lambda t: t[0])
            for fig in (was, now):
                if f"₹{fig:,.0f}cr" not in RESHAPE:
                    errs.append(f"{sym}: RESHAPE does not name ₹{fig:,.0f}cr, "
                                f"a term of the step it explains")
            if drop_ <= 0:
                errs.append(f"{sym}: RESHAPE_SYM but no year-on-year fall in "
                            f"the sales series")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in RESHAPE_FIELDS) \
                        and RESHAPE not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks a five-year "
                                f"compound rate computed across the step "
                                f"without RESHAPE in the same point")
        elif RESHAPE in joined:
            errs.append(f"{sym}: carries RESHAPE, which belongs to "
                        f"{RESHAPE_SYM}")

        # 25. CHOICE 2, second half. NRL's three-year quality readings are
        #     ranked against seven peers. Seven is not a rank, so they are
        #     banned from the prose outright rather than caveated.
        if sym == SEVEN_SYM:
            for k in SEVEN:
                gotof = (mranks.get(k) or {}).get("of")
                if gotof is not None and gotof >= DENOM_FLOOR[tier]:
                    errs.append(f"{sym}: SEVEN bans {k} but the pack now reads "
                                f"it against {gotof} peers — lift the ban")
                for pt in allprose:
                    if f"<code>{k}</code>" in pt:
                        errs.append(f"{sym}: names <code>{k}</code>, read by "
                                    f"{gotof} peers and banned here")

        # 26. CHOICE 6. Two rows carry the pack's below-EBIT flag. A PE or a
        #     trailing net figure on that base is not a figure on operations, so
        #     BELOWEBIT sits in the SAME point as either — and the gap is
        #     recomputed against the pack in both directions.
        livegap = eq.get("np_over_op_gap")
        flagged_below = any("operating line" in f or "below" in f.lower()
                            for f in (eq.get("flags") or []))
        if sym in BELOWEBIT_SYMS:
            wantgap = BELOWEBIT_SYMS[sym]
            if livegap is None or abs(float(livegap) - wantgap) > 0.0005:
                errs.append(f"{sym}: BELOWEBIT_SYMS says np_over_op_gap="
                            f"{wantgap}, pack says {livegap}")
            if not flagged_below:
                errs.append(f"{sym}: in BELOWEBIT_SYMS but the pack raises no "
                            f"below-the-operating-line flag")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in BELOWEBIT_FIELDS) \
                        and BELOWEBIT not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes a figure on the "
                                f"flagged earnings base without BELOWEBIT in "
                                f"the same point")
        else:
            if flagged_below:
                errs.append(f"{sym}: pack flags earnings below the operating "
                            f"line but the row is not in BELOWEBIT_SYMS")
            if BELOWEBIT in joined:
                errs.append(f"{sym}: carries BELOWEBIT with no flag to earn it")

        # 27. CHOICE 8. NRL's prior-years cash mean is negative, so no sentence
        #     on that row may treat the ratio as a fall from a level. NEGMEAN
        #     states the four rows instead, and its figures are the pack's.
        if sym == NEGMEAN_SYM:
            pm = eq.get("cfo_op_prior_mean")
            if pm is None or pm >= 0:
                errs.append(f"{sym}: NEGMEAN_SYM but the prior-years mean is "
                            f"{pm}")
            elif f"{pm}" not in NEGMEAN:
                errs.append(f"{sym}: NEGMEAN states a prior mean the pack does "
                            f"not carry ({pm})")
            if NEGMEAN not in joined:
                errs.append(f"{sym}: prior mean is {pm} and no point says so")
            for r in yrs:
                c = r["cash_from_operating"]
                txt = (f"minus ₹{abs(c):,.2f}cr" if c < 0 else f"₹{c:,.2f}cr")
                if txt not in NEGMEAN:
                    errs.append(f"{sym}: NEGMEAN does not state "
                                f"{r['period_end']}'s cash ({txt})")
        elif NEGMEAN in joined:
            errs.append(f"{sym}: carries NEGMEAN, which belongs to "
                        f"{NEGMEAN_SYM}")

    return errs


def main() -> None:
    pack_raw = json.load(open(PACK))
    pack = {d["symbol"]: d for d in pack_raw["symbols"]}

    missing = set(SPEC) - set(pack)
    if missing:
        raise SystemExit(f"pack is missing {sorted(missing)} — rebuild {PACK}")
    if set(SPEC) != EMIT:
        raise SystemExit(f"SPEC/EMIT disagree: {set(SPEC) ^ EMIT}")

    errs = guards(SPEC, pack)
    if errs:
        print(f"GUARD FAILED ({len(errs)}):")
        for e in errs:
            print("  " + e)
        raise SystemExit(1)

    out = []
    for sym, v in SPEC.items():
        out.append({
            "symbol": sym,
            "verdict": v["verdict"],
            "confidence": v["confidence"],
            "points": v["points"],
            "trigger_text": v["trigger"],
            "evidence": {k: pack[sym]["metrics"]["cluster_metrics"][k]
                         for k in v["evidence"]},
            "snapshot_date": SNAPSHOT,
            "price_asof": PRICE_ASOF,
            "model": MODEL,
            "source_report": SOURCE_REPORT,
            "rank_waivers": v.get("rank_waivers", []),
        })

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"guards passed -> {OUT} ({len(out)} verdicts)")
    for o in out:
        print(f"  {o['symbol']:<12}{o['verdict'][:84]}")


if __name__ == "__main__":
    main()
