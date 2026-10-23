#!/usr/bin/env python3
"""leisure_hospitality — the five tracked names, 2026-10-21 snapshot.

Thirteen choices this batch forced, each one a guard below rather than a note.

CHOICE 1 — one tier, one bucket, one weighting. All five rows are veteran and
peer against 62, and the scorecard weights quality 40 / valuation 30 /
momentum 30 on every one of them. That removes the cross-tier problem the last
two batches turned on, and replaces it with a quieter one: the PILLAR
denominators are not the cohort size. Quality and momentum are read across 62,
valuation and the composite across 61, market capitalisation across 62. A
"of 62" pasted onto a valuation figure would be wrong by one and invisible.
Guard 2.

CHOICE 2 — the floor is 27, and two readings fall under it on their own rows.
<code>np_cagr_5y</code> is carried by 25 rows of the 62 and
<code>div_yield</code> by 26, so a placing among 25 peers inside a 62-row
bucket reads as a placing in leisure_hospitality and is not one. Those figures
are QUOTED and given no ordinal. The set is recomputed PER ROW, because
LEMONTREE and UFBL carry neither column and MPSLTD carries only the first —
one shared SUBFLOOR_KEYS tuple would have asserted BLS's shape against all
five. Guards 14 and 14b.

CHOICE 3 — the band is three-valued here and all three values occur. Usable on
LEMONTREE alone (35.01-120.38x on five readings, average 66.02x); too wide on
BLS (0.87-41.16x), GLOBAL (0.08-17.82x) and MPSLTD (6.51-32.72x); absent on
UFBL, which has no band at all. MPSLTD is the uncomfortable one: its ratio is
5.026, over the 5.0 line by 0.026. The threshold is not negotiated downward to
keep a sentence — a band whose high is five times its low records an earnings
denominator passing near zero somewhere in the window, and 5.026 records that
as surely as 47.3 does. Guard 9.

CHOICE 4 — UFBL gets no verdict, and the reason is that its valuation
percentile exists only because its earnings do not. Net profit was negative in
eight years of the ten annual rows and over the trailing twelve months too, so
<code>pe_ttm</code> is NULL, <code>ttm_np_pct</code> is NULL, there is no
earnings band, and the valuation pillar is scored on 68 of its declared 100
points — the trailing earnings multiple is 22 of those points and the dividend
yield another 10. A valuation reading of 65, tied 13th of 61, computed without
the earnings multiple is not a cheap-or-dear reading of the price, and saying
"13th of 61 on valuation" would be the single most misleading number on the
page. Guards 15 and 21, plus NOEARN.

CHOICE 5 — momentum is scored on 95 of its declared 100 on four rows and on 85
on the fifth. <code>tech_net_score_scaled</code> is NULL for every row in the
snapshot and carries 5 of momentum's 100 points in this cluster — 5, not the 6
of construction and not the 7 of the batch before it, so the figure is read off
the pack and never carried forward. UFBL loses another 10 on top, because
<code>pct_above_200ema_252d</code> is NULL for it. So this caveat is NOT
uniform here, which is the opposite of the last batch. Guard 16.

CHOICE 6 — GLOBAL is the one row the pack flags, and the flag is the margin
step: the operating margin went 44.71% to 38.16% in one year, a 6.55-point
fall, while sales rose 29.8%. Operating profit went ₹34.91cr to ₹35.79cr on
sales of ₹72.28cr to ₹93.85cr — the growth arrived and the margin paid for it.
STEPFLAG sits in the same point as either margin term. Guard 22.

CHOICE 7 — the trailing earnings multiple is thin. A <code>pe_ttm</code>
exists on 41 of these 62 rows, a trailing net change on 49, an EV/EBITDA on 50
and a trailing operating change on 52. None is banned — each is load-bearing
somewhere here — but any point ranking one carries THINREAD in the same point,
because a rank on it places the row among those peers rather than across the
bucket. Guard 20.

CHOICE 8 — the shareholding filings are not aligned: the pack holds periods
2026-06-30 and 2026-09-30 across this bucket with 61 rows of the 62 filed. An
ownership rank is therefore read across the rows that filed, in two different
months, and any point quoting one says so. Guard 24.

CHOICE 9 — delivery_data holds 13 sessions for four rows and ZERO rows for
UFBL. Any percentage off 13 sessions is a single-day print; UFBL has not even
that. Naming the absence is allowed; quoting a figure beside it is not.
Guard 6.

CHOICE 10 — <code>ema_stack_bull</code> is banned outright rather than
caveated, and the reason is not thinness. It is a binary: 1.0 on GLOBAL and
LEMONTREE, which puts them in an 11-way tie across positions 1 to 11, and 0.0
on the other three, which puts them in a 48-way tie across positions 12 to 59.
Neither group has an order inside it. The sort position of one identical flag
among 48 is not a rank, and the tie-span machinery would happily print it as
one for the 11. Guard 17.

CHOICE 11 — this cluster's columns are not construction's and not cement's.
Forty metrics, and the ones it DOES carry include asset turnover, the EBITDA
margin in both windows, net debt to EBITDA, return on capital and book value —
so none of those is banned here, though some were elsewhere. What it does NOT
carry: inventory days, receivable days, working capital days, cash conversion,
capex intensity, interest coverage, the loan book, return on assets, equity to
assets, debt-to-equity, the PEG and any three- or five-year return on equity.
Those phrases resolve, in the ranks checker's own vocabulary, to columns that
are not here, and guard 10 cannot see them because they are not tags.
Guard 18.

CHOICE 12 — UFBL's price series begins 2025-10-03 though the symbol listed
2021-04-07. The pack holds 274 bars for it against the roughly 450 a 252-day
window above a 200-day EMA needs, which is why
<code>pct_above_200ema_252d</code> is NULL and why momentum 82, second of 62,
rests on thirteen months of price rather than on the three years the other
four rows have. PRICEHIST states it on that row and the bar count is read off
the pack. Guard 28.

CHOICE 13 — two of these five are not leisure or hospitality businesses.
GLOBAL is Global Education Limited, which sells educational and consultancy
services; MPSLTD is MPS Limited, a publishing-technology and content-production
business founded in 1892. They sit in this cluster because the classifier put
them in Consumer Services, and the ranks below are therefore real readings
against a bucket that is the wrong comparison set for both. No sentence on
either row uses hotel, guest, occupancy or hospitality language, and both rows
say what the business actually is. There is no guard that can catch a wrong
cluster; there is a guard that the prose never calls either one a hotel.
Guard 29.
"""
import json
import re

PACK = "/tmp/leisure5.json"
OUT = "build/verdicts/leisure-5-verdicts.json"
SOURCE_REPORT = "leisure_hospitality — 5 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = PRICE_ASOF = "2026-10-21"

HELD: set[str] = set()
EMIT = {"BLS", "GLOBAL", "LEMONTREE", "MPSLTD", "UFBL"}

STATUS = {s: "full" for s in EMIT}

# CHOICE 1. One tier, one weighting — but the pillar denominators are not the
# cohort size, which is the trap this shape replaces the cross-tier one with.
VET = ("Peered against 62 peers in the veteran tier of this cluster, where the "
       "scorecard weights quality 40, valuation 30 and momentum 30 — every "
       "rank below is read against that bucket and no other, and the pillar "
       "denominators inside it are not all 62: quality and momentum are read "
       "across 62 rows, valuation and the composite across 61. ")
TIER_SENTENCE = {"veteran": VET}
TIER_N = {"veteran": 62}
PILLAR_WEIGHTS = {"veteran": {"q": 40, "v": 30, "m": 30}}

# CHOICE 7. Required in the same point as any rank on the thin readings. The
# counts are recomputed, so a filled-in snapshot fails the build.
THINREAD = ("Thin reading: a trailing earnings multiple exists on 41 of these "
            "62 rows, a trailing net change on 49, an EV/EBITDA on 50 and a "
            "trailing operating change on 52, so a rank on any of them places "
            "the row among those peers rather than across the bucket. ")
THIN_READS = {"pe_ttm": 41, "ttm_np_pct": 49, "ev_ebitda_ttm": 50,
              "ttm_op_pct": 52}

# CHOICE 2. The two readings thin enough to lose the ordinal entirely. The
# figure may be stated; the position may not.
SUBFLOOR = ("Ranks withheld: a five-year profit CAGR is carried by 25 rows of "
            "the 62 and a dividend yield by 26, both under the floor this "
            "batch uses, so where either appears below it appears as a figure "
            "with no position — a placing among 25 peers is not a placing in "
            "this cluster. ")

# CHOICE 5. Not uniform: four rows on 95, UFBL on 85.
MOM95 = ("<code>tech_net_score_scaled</code> is NULL for every row in this "
         "snapshot and carries 5 of momentum's 100 points in this cluster, so "
         "the momentum percentile here is scored on 95 points out of a "
         "declared 100. It is the same 5 points on four of these five rows, so "
         "it changes no ranking between them — but the pillar is narrower than "
         "the scorecard claims.")
MOM85 = ("Momentum on this row is scored on 85 of its declared 100 points: "
         "<code>tech_net_score_scaled</code> is NULL for every row in the "
         "snapshot and carries 5 points, and the share of sessions above the "
         "200-day EMA carries another 10 which this row cannot supply either. "
         "So its momentum reading is not the same measurement as the other "
         "four rows', and the gap is in the direction of the missing data.")
MOM_WEIGHT = {"BLS": 95, "GLOBAL": 95, "LEMONTREE": 95, "MPSLTD": 95,
              "UFBL": 85}

# CHOICE 6. The one flagged row, and the size of the step.
STEPFLAG = ("The pack flags this row's operating margin for the size of the "
            "step: 44.71% in the prior twelve months to 38.16% in the trailing "
            "ones, a fall of 6.55 points, while sales rose 29.8% from "
            "₹72.28cr to ₹93.85cr and operating profit went ₹34.91cr to "
            "₹35.79cr. A move that size is a mix change, an acquisition or a "
            "one-off rather than an operating trend, and the pack carries no "
            "split of which. ")
STEPFLAG_SYM = "GLOBAL"
STEPFLAG_FIELDS = ("opm_now", "opm_prev")

# CHOICE 4. The whole reason UFBL has no verdict.
NOEARN = ("There is no earnings denominator on this row to price. Net profit "
          "was negative in eight years of the ten annual rows and over the "
          "trailing twelve months as well, so the trailing earnings multiple "
          "is NULL, the trailing net change is NULL, the pack can build no "
          "earnings band, "
          "and the valuation pillar is scored on 68 of its declared 100 "
          "points — the trailing earnings multiple is 22 of those points and "
          "the dividend yield another 10. What is left underneath the "
          "valuation reading is the asset and enterprise side alone. ")
NOEARN_SYM = "UFBL"

NOVERDICT = ("A valuation reading of 65, tied 13th of 61 in a three-way tie "
             "spanning positions 13 to 15, that exists only because the "
             "earnings do not: two thirds of that pillar is the earnings "
             "multiple and the dividend yield, and this row has neither. Below "
             "it sits a quality reading of 37, tied 43rd of 62 in a two-way tie "
             "spanning positions 43 to 44, built on return on capital under 5% "
             "in both windows and an average return on equity that has not "
             "cleared its bar once in ten years, and a momentum reading on "
             "thirteen months of price. What follows is what can be said; a "
             "recommendation is not among it. ")
NOVERDICT_SYM = "UFBL"

# CHOICE 12. The price series is thirteen months old, not five years.
PRICEHIST = ("The price history here is not the cohort's. The pack holds 274 "
             "daily bars for this symbol, beginning 2025-10-03, though it "
             "listed on 2021-04-07 — the other four rows carry 700. A 252-day "
             "window measured against a 200-day EMA needs roughly 450 bars, "
             "which is why that reading is NULL here, and the relative returns "
             "below are computed inside those thirteen months rather than "
             "across the window the rest of the bucket is read over. ")
PRICEHIST_SYM = "UFBL"
PRICEHIST_BARS = 274
PRICEHIST_MIN = 450

# CHOICE 8. The filings are in two different months and one row of 62 is absent.
SHAREALIGN = ("The shareholding filings in this bucket are not aligned: the "
              "pack holds periods 2026-06-30 and 2026-09-30 across it with 61 "
              "rows of the 62 filed, so an ownership rank here is read across "
              "those rows in two different months. ")
SHAREALIGN_KEYS = ("promoter_pct", "fii_pct", "dii_pct", "shareholders")

# Metrics NULL for >=95% of every tier in this snapshot, plus the tier-scoped
# ones, measured from the pack's own sanity block rather than carried over.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "book_value_cagr_5y",
        "cfo_pat_latest", "np_cagr_7y", "op_margin_latest", "roce_latest",
        "roe_excess_13_10y")

# CHOICE 11. Plain-English phrases naming columns THIS cluster does not carry.
# Guard 10 cannot see them because they are not tags. Note that asset
# turnover, the EBITDA margin, net debt to EBITDA, return on capital and book
# value ARE carried here and are deliberately absent from this list.
BANNED_PHRASES = ("inventory day", "receivable day", "collection cycle",
                  "working capital days", "cash conversion",
                  "capex intensity", "interest coverage", "loan book",
                  "price-to-aum", "return on assets", "equity to assets",
                  "debt-to-equity", "dividend payout", "earnings yield trend",
                  "margin trend", "three-year return on equity",
                  "five-year return on equity", "PEG")

EMAFLAT = "ema_stack_bull"
CODE_ALLOW = {"leisure_hospitality", "full", "tech_net_score_scaled"}

# CHOICE 13. Neither of these two is a hospitality business and the prose on
# them may not pretend otherwise.
NOT_HOSPITALITY = {"GLOBAL", "MPSLTD"}
HOSPITALITY_WORDS = ("hotel", "guest", "occupancy", "hospitality",
                     "room night", "restaurant", "resort")
# The two sentences that are allowed to contain the word, because they are the
# disclaimer and the cluster key itself. Scrubbed before guard 29 looks.
HOSPITALITY_EXEMPT = ("not a leisure or hospitality business",
                      "<code>leisure_hospitality</code>")

# CHOICE 3: None = usable, else the reason it cannot price a row.
BAND_RATIO_MAX = 5.0
BAND_MIN_N = 5
BAND_REASON = {"BLS": "wide", "GLOBAL": "wide", "LEMONTREE": None,
               "MPSLTD": "wide", "UFBL": "absent"}
BANDWIDE = ("Its own earnings band is too wide to price it — the high is more "
            "than five times the low, which records an earnings denominator "
            "passing near zero in some year of the window rather than a range "
            "a price can sit inside. ")
NOBAND = ("The pack can build no own-history earnings band for this row at "
          "all. ")

# Per row: negative-operating-cash years, the row count they are out of, and
# the latest ratio as a level. Every figure recomputed from the annual rows.
CASHYRS = {
    "BLS": (0, 10, 1.064),
    "GLOBAL": (2, 10, 0.493),
    "LEMONTREE": (0, 10, 0.785),
    "MPSLTD": (0, 10, 0.834),
    "UFBL": (0, 10, 1.156),
}
# Nothing in this batch carries a cash-conversion flag, so the word is banned
# on all five rows rather than permitted on one.
CASH_FLAGGED: set[str] = set()
DETERIORATION = "deterioration"
NEGWORD = {0: "no", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
           6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
NOZERO = "no negative operating cash year"

# Years in which net profit was negative. Two rows have them and three do not,
# and the count is recomputed, so a restatement moves the claim.
LOSSYRS = {"BLS": 0, "GLOBAL": 0, "LEMONTREE": 4, "MPSLTD": 0, "UFBL": 8}

TTM_FIELDS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct")
WINDOW_BATCH = ["2025-09-30", "2026-06-30"]

# CHOICE 4 and CHOICE 5. Pillars scored on part of their declared weight. The
# caveat sits in the SAME point as the figure and the figure is banned from
# headline and trigger. Momentum is handled by guard 16 instead, because its
# shortfall is a property of the cluster rather than of the row.
PILLAR_WEIGHT = {
    "LEMONTREE": [("quality",
                   "scored on 91 points rather than the declared 100, the "
                   "missing 9 being the five-year profit CAGR, which is NULL "
                   "for this row"),
                  ("valuation",
                   "scored on 90 points rather than the declared 100, the "
                   "missing 10 being the dividend yield, which this row does "
                   "not pay")],
    "MPSLTD": [("valuation",
                "scored on 90 points rather than the declared 100, the missing "
                "10 being the dividend yield, which this row does not pay")],
    "UFBL": [("quality",
              "scored on 91 points rather than the declared 100, the missing 9 "
              "being the five-year profit CAGR, which is NULL for this row"),
             ("valuation",
              "scored on 68 of its declared 100 points")],
}

# CHOICE 2. One tier, one floor.
DENOM_FLOOR = {"veteran": 27}

# A tie covering more than a third of the bucket is not a rank.
TIE_DIVISOR = 3

PILLAR_WORD = {"quality_pct": "Quality", "valuation_pct": "Valuation",
               "momentum_pct": "Momentum", "composite_pct": "Composite"}

_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
_CODE_RX = re.compile(r"<code>([a-z0-9_-]+)</code>")
_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}

SPEC: dict[str, dict] = {

"BLS": {
  "verdict": "WATCH — quality 80, second of 62, and composite 95, fourth of "
             "61, on return on capital of 29.76%, sixth of 60, agreeing with "
             "the five-year reading, against a price the market has marked "
             "down 23.45% against the index over twelve months",
  "confidence": "medium",
  "trigger": "the operating margin holding above 27% for another two quarters "
             "with sales still compounding -> the markdown was a de-rating "
             "rather than a warning and the cheap multiples are the "
             "opportunity; the visa-contract renewals slipping or the margin "
             "stepping down again -> the earnings base is contract-dependent "
             "and the multiple is cheap for a reason",
  "evidence": ["roce_3y", "roce_5y", "rev_cagr_5y", "ebitda_margin_3y",
               "pe_ttm"],
  "points": [
  "<b>Not held — BLS is on your watchlist.</b> BLS International Services "
  "runs outsourced visa, passport and consular processing for diplomatic "
  "missions, and sits in this platform's <code>leisure_hospitality</code> "
  "cluster at a market capitalisation of ₹8,971.85cr, seventh of 62. " + VET +
  "On the scorecard, quality 80 is second of 62, composite 95 is fourth of 61, "
  "valuation 65 is tied 13th of 61 in a three-way tie spanning positions 13 to "
  "15 and momentum 39 is tied 40th of 62 in a three-way tie spanning positions "
  "40 to 42. " + BANDWIDE,

  "<b>Both capital-return windows agree, and so does the growth.</b> "
  "<code>roce_3y</code> 29.76% is sixth of 60 and <code>roce_5y</code> 27.35% "
  "is fifth of 62 — the two windows agree, which is what the quality pillar is "
  "reading. <code>rev_cagr_5y</code> 37.05% is ninth of 60, and the annual "
  "sales line reads ₹634.89cr, ₹789.05cr, ₹803.83cr, ₹786.14cr, ₹478.37cr, "
  "₹849.89cr, ₹1,516.19cr, ₹1,676.81cr, ₹2,193.30cr and ₹2,998.22cr across the "
  "ten annual rows: a hole in the middle where the borders closed, and a "
  "near-quadrupling after it. <code>ebitda_margin_3y</code> 29.09% is 30th of "
  "61 against <code>ebitda_margin_5y</code> 23.35% at 33rd of 61, so the "
  "three-year window is the wider one. <code>opm_now</code> 27.28% is 22nd of "
  "59 against <code>opm_prev</code> 29.05% at 21st of 59 — the trailing twelve "
  "months stepped the margin down by 1.77 points, which the pack does not "
  "flag. <code>asset_turnover</code> 0.797 is 16th of 62 and "
  "<code>net_debt_ebitda</code> -0.866 is 45th of 53: there is more cash than "
  "debt, on borrowings that went ₹95.41cr to ₹430.58cr while sales went "
  "₹634.89cr to ₹2,998.22cr. " + SUBFLOOR + "<code>np_cagr_5y</code> 57.62% is "
  "one of them and is quoted here as a figure only.",

  "<b>The track-record columns are the strongest part of the row, and most of "
  "them are ties.</b> <code>roe_avg_above_threshold_5y</code> 1.000 is tied "
  "first of 62 in a four-way tie spanning positions 1 to 4, "
  "<code>roe_avg_above_threshold_7y</code> 0.714 is tied fifth of 62 in a "
  "two-way tie spanning positions 5 to 6 and "
  "<code>roe_avg_above_threshold_10y</code> 0.800 is tied fourth of 62 in a "
  "two-way tie spanning positions 4 to 5 — the average return on equity "
  "cleared its bar in eight years of the ten. "
  "<code>np_growth_above_inflation_5y</code> 1.000 is tied first of 62 in a "
  "five-way tie spanning positions 1 to 5, "
  "<code>np_growth_above_inflation_7y</code> 0.833 is tied first of 62 in a "
  "five-way tie spanning positions 1 to 5 and "
  "<code>np_growth_above_inflation_10y</code> 0.778 is tied second of 62 in a "
  "five-way tie spanning positions 2 to 6. "
  "<code>np_consistency_10y</code> 1.510 is 12th of 62. On the cash side, "
  "<code>cfo_ebitda_3y</code> 1.006 is seventh of 56 and "
  "<code>cfo_ebitda_5y</code> 1.140 is sixth of 56: more cash arrived than "
  "EBITDA was reported in both windows. There is no negative operating cash "
  "year in the ten annual rows, and operating cash came in at 1.064 of "
  "operating profit in FY2026 against a prior-years mean of 1.289.",

  "<b>The price is cheap on every reading this bucket can rank.</b> " +
  THINREAD + "<code>pe_ttm</code> 12.71x is 37th of 41, <code>pb</code> 3.642 "
  "is 19th of 56, <code>ev_ebitda_ttm</code> 8.557x is 36th of 50 and "
  "<code>ev_sales_ttm</code> 2.587 is 44th of 59 — the earnings and "
  "enterprise multiples sit near the back of their readings while the asset "
  "multiple sits in the middle, which is what the valuation pillar is picking "
  "up. <code>fcf_yield</code> 2.20% is 32nd of 62 and "
  "<code>div_yield</code> 1.147% is quoted without a position. "
  "<code>ttm_sales_pct</code> +31.81% is fourth of 58, "
  "<code>ttm_op_pct</code> +23.79% is 11th of 52 and "
  "<code>ttm_np_pct</code> +24.91% is tenth of 49, so the trailing sales, "
  "operating and net changes all point the same way and the cheapness is not "
  "a collapsing denominator.",

  "<b>The chart has gone the other way and the register has shrunk.</b> " +
  SHAREALIGN + "<code>promoter_pct</code> 70.39% is 15th of 61, "
  "<code>fii_pct</code> 4.14% is 20th of 47, <code>dii_pct</code> 3.10% is "
  "18th of 51 and <code>shareholders</code> 223,624 is ninth of 61. "
  "<code>ret_12m_rel</code> -23.45% is 40th of 56, <code>ret_6m_rel</code> "
  "-15.55% is 50th of 59 and <code>ret_3m_rel</code> +2.09% is 29th of 59 — "
  "twelve months behind the index, six months further behind, three months "
  "flat. <code>pct_above_200ema_252d</code> 0.00% is tied 46th of 54 in a "
  "nine-way tie spanning positions 46 to 54: the close did not finish above "
  "its 200-day EMA on a single one of the last 252 sessions. "
  "<code>sales_yoy_q</code> +25.33% is 13th of 60 against "
  "<code>np_yoy_q</code> +11.15% at 32nd of 61, so the latest quarter grew "
  "sales faster than earnings. " + MOM95,

  "<i>BLS is a watch and not a buy, and the gap is between the record and the "
  "tape. What is real: <code>roce_3y</code> 29.76% at sixth of 60 agreeing "
  "with <code>roce_5y</code> 27.35% at fifth of 62, "
  "<code>rev_cagr_5y</code> 37.05% at ninth of 60, "
  "<code>cfo_ebitda_5y</code> 1.140 at sixth of 56, and no negative operating "
  "cash year in the ten annual rows. What that does not settle: a price the "
  "market has marked down 23.45% against the index over twelve months while "
  "those readings improved, which is either an opportunity or something the "
  "market knows that this pack does not hold; <code>opm_now</code> 27.28% "
  "against <code>opm_prev</code> 29.05%, so the latest margin is the lower of "
  "the two; and an own-history earnings band too wide to say whether 12.71x is "
  "cheap against this row's own past rather than against its peers. The "
  "business here is a government-contract renewal cycle, and the pack holds "
  "nothing about the contracts. Confidence is medium.</i>",
  ],
},

"GLOBAL": {
  "verdict": "WATCH — composite 92, sixth of 61, on return on capital of "
             "36.93%, third of 60, against an operating margin the pack flags "
             "for falling 44.71% to 38.16% in a single year while sales rose "
             "29.8%",
  "confidence": "low",
  "trigger": "the next two quarters holding the operating margin near 38% "
             "while sales keep compounding -> the step was the cost of growth "
             "and the capital returns are the real reading; the margin falling "
             "further or operating cash staying under half of operating profit "
             "-> the reported profit is not converting and the price has "
             "already paid for it",
  "evidence": ["roce_3y", "roce_5y", "opm_now", "opm_prev",
               "ebitda_margin_3y"],
  "points": [
  "<b>Not held — GLOBAL is on your watchlist.</b> Global Education Limited "
  "sells educational training, examination and consultancy services to "
  "institutions, corporates and banks out of Nagpur — it is not a leisure or "
  "hospitality business, and it sits in this platform's "
  "<code>leisure_hospitality</code> cluster because the classifier files it "
  "under Consumer Services. Market capitalisation ₹708.24cr, 31st of 62. " +
  VET + "On the scorecard, composite 92 is sixth of 61, quality 74 is tied "
  "fourth of 62 in a two-way tie spanning positions 4 to 5, momentum 67 is "
  "tied sixth of 62 in a two-way tie spanning positions 6 to 7 and valuation "
  "42 is tied 41st of 61 in a two-way tie spanning positions 41 to 42. " +
  BANDWIDE,

  "<b>The margin is what the pack stopped on.</b> " + STEPFLAG +
  "<code>opm_now</code> 38.16% is eighth of 59 and <code>opm_prev</code> "
  "44.71% is second of 59, so even after the step this row runs a wider "
  "operating margin than all but seven of the readings in the bucket — the "
  "fall is from an unusual level, not to a bad one. "
  "<code>ebitda_margin_3y</code> 53.66% is fourth of 61 and "
  "<code>ebitda_margin_5y</code> 55.71% is fifth of 61. "
  "<code>roce_3y</code> 36.93% is third of 60 and <code>roce_5y</code> 37.68% "
  "is second of 62 — the two windows agree and both are near the front of the "
  "bucket, which is the quality reading. <code>rev_cagr_5y</code> 24.23% is "
  "25th of 60 on an annual sales line of ₹26.15cr rising to ₹93.85cr, and "
  "<code>asset_turnover</code> 0.668 is 20th of 62. " + SUBFLOOR +
  "<code>np_cagr_5y</code> 25.04% is one of them and is quoted here as a "
  "figure only.",

  "<b>The record is good and the cash behind it is not.</b> "
  "<code>roe_avg_above_threshold_5y</code> 1.000 is tied first of 62 in a "
  "four-way tie spanning positions 1 to 4, "
  "<code>roe_avg_above_threshold_7y</code> 0.857 is tied second of 62 in a "
  "three-way tie spanning positions 2 to 4 and "
  "<code>roe_avg_above_threshold_10y</code> 0.900 is tied second of 62 in a "
  "two-way tie spanning positions 2 to 3 — the average return on equity "
  "cleared its bar in nine years of the ten. "
  "<code>np_growth_above_inflation_10y</code> 0.556 is tied 19th of 62 in a "
  "14-way tie spanning positions 19 to 32, and "
  "<code>np_consistency_10y</code> 1.584 is ninth of 62. Against that, "
  "<code>cfo_ebitda_3y</code> 0.507 is 45th of 56 and "
  "<code>cfo_ebitda_5y</code> 0.634 is 37th of 56: roughly half of reported "
  "EBITDA reaches operating cash, and the bucket does it better. Operating "
  "cash was negative in two years of the ten annual rows, at minus ₹2.67cr "
  "and minus ₹1.49cr, and came in at 0.493 of operating profit in FY2026 "
  "against a prior-years mean of 0.799 — lower than its own past and well "
  "under the reported margin. The pack also holds no operating profit at all "
  "for two years of the ten annual rows, so the margin history here is eight "
  "years "
  "long rather than ten. <code>net_debt_ebitda</code> -0.135 is 36th of 53: "
  "there is no borrowing to speak of in any year the pack holds.",

  "<b>The price has already taken the quality reading as settled.</b> " +
  THINREAD + "<code>pe_ttm</code> 29.53x is 25th of 41, <code>pb</code> 5.386 "
  "is 13th of 56, <code>ev_ebitda_ttm</code> 18.19x is 13th of 50 and "
  "<code>ev_sales_ttm</code> 9.212 is ninth of 59 — dear on the enterprise "
  "and asset readings, middling on earnings, which is the valuation 42. "
  "<code>fcf_yield</code> 2.79% is 26th of 62 and <code>div_yield</code> "
  "0.719% is quoted without a position. <code>ttm_sales_pct</code> +28.17% is "
  "seventh of 58 but <code>ttm_op_pct</code> +9.39% is 23rd of 52 and "
  "<code>ttm_np_pct</code> +3.17% is 21st of 49: the trailing twelve months "
  "grew sales three times faster than operating profit and nine times faster "
  "than earnings, which is the same step the pack flagged, arriving in the "
  "growth rates.",

  "<b>The chart is the strongest thing on the row and the register is "
  "tiny.</b> " + SHAREALIGN + "<code>promoter_pct</code> 72.73% is tenth of "
  "61, <code>fii_pct</code> 0.03% is tied 37th of 47 in a four-way tie "
  "spanning positions 37 to 40, <code>dii_pct</code> 0.08% is 40th of 51 and "
  "<code>shareholders</code> 16,909 is 43rd of 61 — essentially no "
  "institutional ownership and one of the smaller shareholder registers in "
  "the bucket, which is what a ₹708.24cr market capitalisation with a 72.73% "
  "promoter looks like. <code>pct_above_200ema_252d</code> 100.00% is first "
  "of 54: the close finished above its 200-day EMA on every one of the last "
  "252 sessions. <code>ret_12m_rel</code> +110.16% is second of 56, "
  "<code>ret_3m_rel</code> +43.56% is third of 59 and "
  "<code>ret_6m_rel</code> +45.54% is eighth of 59. Against all of that, "
  "<code>sales_yoy_q</code> -5.33% is 45th of 60 and <code>np_yoy_q</code> "
  "-10.69% is 45th of 61 — the latest quarter went backwards on both lines "
  "while the twelve-month chart was doubling. " + MOM95,

  "<i>GLOBAL is a watch and not a buy, and the confidence is low for reasons "
  "that are about the data rather than the business. What is real: "
  "<code>roce_3y</code> 36.93% at third of 60 agreeing with "
  "<code>roce_5y</code> 37.68% at second of 62, "
  "<code>ebitda_margin_5y</code> 55.71% at fifth of 61, and an average return "
  "on equity that cleared its bar in nine years of the ten. What that does "
  "not survive: <code>cfo_ebitda_3y</code> 0.507 at 45th of 56, so half the "
  "reported EBITDA does not reach cash; an operating margin the pack flags "
  "for falling 6.55 points in one year with no split of what caused it; two "
  "annual rows with no operating profit recorded at all; a latest quarter "
  "negative on both sales and earnings; and a price that has already run "
  "110.16% past the index over twelve months. This is a ₹708cr company with "
  "16,909 shareholders filed in a cluster it does not belong to, and the "
  "quality reading is the most reliable number on the row rather than a "
  "reason to act. Confidence is low.</i>",
  ],
},

"LEMONTREE": {
  "verdict": "WATCH — composite 67, 21st of 61, on return on capital of "
             "14.68%, 22nd of 60, where a wide operating margin sits on an "
             "asset base carrying ₹2,003.65cr of borrowings and net profit was "
             "negative in four years of the ten annual rows",
  "confidence": "medium",
  "trigger": "borrowings falling while the operating margin holds near 47% -> "
             "the leverage is being retired out of operating cash and the "
             "capital return starts to follow the margin; the margin slipping "
             "with borrowings flat -> the asset base is the business and the "
             "return on it is what the price should be paying for",
  "evidence": ["ebitda_margin_3y", "roce_3y", "net_debt_ebitda", "pb",
               "opm_now"],
  "points": [
  "<b>Not held — LEMONTREE is on your watchlist.</b> Lemon Tree Hotels owns, "
  "leases, franchises and manages hotels across India under Aurika, Lemon Tree "
  "Premier, Red Fox and the Keys brands, and sits in this platform's "
  "<code>leisure_hospitality</code> cluster at a market capitalisation of "
  "₹8,809.77cr, eighth of 62. " + VET + "On the scorecard, composite 67 is "
  "21st of 61, quality 67 is 13th of 62 — scored on 91 points rather than the "
  "declared 100, the missing 9 being the five-year profit CAGR, which is NULL "
  "for this row — valuation 46 is 37th of 61, scored on 90 points rather than "
  "the declared 100, the missing 10 being the dividend yield, which this row "
  "does not pay, and momentum 43 is tied 36th of 62 in a two-way tie spanning "
  "positions 36 to 37. This is the one row in the batch whose own earnings "
  "band can price it: the own five-year earnings band runs 35.01-120.38x with "
  "an average of 66.02x.",

  "<b>The margin is a hotel margin and the capital return is not.</b> "
  "<code>opm_now</code> 47.48% is third of 59 and <code>opm_prev</code> 49.37% "
  "is first of 59, so the trailing operating margin is the widest reading in "
  "the bucket in the prior window and the third widest now. "
  "<code>ebitda_margin_3y</code> 58.94% is third of 61 and "
  "<code>ebitda_margin_5y</code> 58.90% is fourth of 61 — the same picture "
  "over both windows. And yet <code>roce_3y</code> 14.68% is 22nd of 60 and "
  "<code>roce_5y</code> 11.43% is 24th of 62, both the middle of the bucket: "
  "the gap between a margin at the front and a capital return in the middle is "
  "the asset base. <code>asset_turnover</code> 0.339 is 36th of 62 and "
  "<code>net_debt_ebitda</code> 2.725 is 18th of 53, on borrowings that went "
  "₹798.67cr to ₹2,003.65cr across the ten annual rows and peaked at "
  "₹2,335.85cr two years ago. <code>rev_cagr_5y</code> 37.66% is eighth of 60, "
  "measured out of the pandemic trough: sales went ₹412.08cr to ₹1,444.50cr "
  "over the ten rows with ₹251.72cr in the middle of them, so the five-year "
  "compounding is a recovery as much as a growth rate.",

  "<b>Four years of the ten were loss-making and the cash never was.</b> Net "
  "profit was negative in four years of the ten annual rows — minus ₹6.17cr, "
  "minus ₹9.54cr, minus ₹127.07cr and minus ₹87.43cr — while operating profit "
  "was positive in every one of them, which is the shape of a leveraged asset "
  "base: the losses are made under the operating line, in interest and "
  "depreciation. There is no negative operating cash year in the ten annual "
  "rows, and operating cash came in at 0.785 of operating profit in FY2026 "
  "against a prior-years mean of 0.935. <code>cfo_ebitda_3y</code> 0.695 is "
  "17th of 56 and <code>cfo_ebitda_5y</code> 0.680 is 29th of 56. The "
  "track-record columns carry the losses: "
  "<code>roe_avg_above_threshold_5y</code> 0.600 is tied 12th of 62 in a "
  "seven-way tie spanning positions 12 to 18, "
  "<code>roe_avg_above_threshold_7y</code> 0.429 is tied 14th of 62 in a "
  "six-way tie spanning positions 14 to 19 and "
  "<code>roe_avg_above_threshold_10y</code> 0.300 is tied 19th of 62 in an "
  "eight-way tie spanning positions 19 to 26 — the average return on equity "
  "cleared its bar in three years of the ten. "
  "<code>np_growth_above_inflation_5y</code> 1.000 is tied first of 62 in a "
  "five-way tie spanning positions 1 to 5 and "
  "<code>np_growth_above_inflation_10y</code> 0.778 is tied second of 62 in a "
  "five-way tie spanning positions 2 to 6, which is the recovery rather than "
  "the record. <code>np_consistency_10y</code> 0.919 is 33rd of 62.",

  "<b>The price is paying for the margin and not for the return.</b> " +
  THINREAD + "<code>pe_ttm</code> 37.52x is 15th of 41, <code>pb</code> 6.329 "
  "is 11th of 56, <code>ev_ebitda_ttm</code> 12.78x is 26th of 50 and "
  "<code>ev_sales_ttm</code> 7.273 is 13th of 59 — dear on the asset and sales "
  "readings, middling on the enterprise one. Against its own history 37.52x "
  "sits in the lower part of a band that runs 35.01-120.38x, which is the one "
  "comparison on this row that is not a peer comparison. "
  "<code>fcf_yield</code> 4.98% is 18th of 62. <code>ttm_sales_pct</code> "
  "+10.46% is 24th of 58, <code>ttm_op_pct</code> +6.22% is 26th of 52 and "
  "<code>ttm_np_pct</code> +9.15% is 16th of 49: the trailing twelve months "
  "grew into the low teens on all three lines, which is a long way below the "
  "five-year compounding and is what the recovery arithmetic looks like once "
  "the trough has washed out.",

  "<b>The institutions own this row and the promoter mostly does not.</b> " +
  SHAREALIGN + "<code>promoter_pct</code> 22.32% is 56th of 61 — one of the "
  "lowest promoter holdings in the bucket — against <code>fii_pct</code> "
  "19.44% at second of 47, <code>dii_pct</code> 14.35% at ninth of 51 and "
  "<code>shareholders</code> 422,447 at fourth of 61. A third of the register "
  "is institutional and the promoter holds less than a quarter, which is the "
  "opposite of most of this cluster and means the price is set by people who "
  "will sell it. <code>ret_12m_rel</code> -27.22% is 45th of 56, "
  "<code>ret_6m_rel</code> -1.45% is 37th of 59 and <code>ret_3m_rel</code> "
  "+7.59% is 20th of 59, so the markdown is twelve months old and the last "
  "three months have stopped it. <code>pct_above_200ema_252d</code> 15.48% is "
  "28th of 54: the close held above its 200-day EMA on about one session in "
  "seven of the last 252. <code>sales_yoy_q</code> +9.13% is 33rd of 60 and "
  "<code>np_yoy_q</code> +20.09% is 29th of 61. " + MOM95,

  "<i>LEMONTREE is a watch and not a buy, and the reason is the asset base "
  "rather than the trading. What is real: <code>ebitda_margin_3y</code> 58.94% "
  "at third of 61 confirmed by <code>ebitda_margin_5y</code> 58.90% at fourth "
  "of 61, <code>opm_now</code> 47.48% at third of 59, no negative operating "
  "cash year in the ten annual rows, and institutional ownership that has "
  "already done the work on this one. What that does not settle: "
  "<code>roce_3y</code> 14.68% at 22nd of 60 with <code>roce_5y</code> 11.43% "
  "at 24th of 62, so a front-of-bucket margin produces a middle-of-bucket "
  "return on the capital that funds it; <code>net_debt_ebitda</code> 2.725 at "
  "18th of 53 on borrowings of ₹2,003.65cr; net profit negative in four years "
  "of the ten annual rows; and <code>pb</code> 6.329 at 11th of 56 for the "
  "privilege. The band says 37.52x is low against this row's own past, and the "
  "capital return says the past was not worth much. Confidence is medium.</i>",
  ],
},

"MPSLTD": {
  "verdict": "WATCH — return on capital of 37.33%, second of 60, with the "
             "average return on equity clearing its bar in every year of the "
             "ten, against five-year sales compounding at 14.38% and a book "
             "value multiple tenth of 56",
  "confidence": "medium",
  "trigger": "sales growth moving into the high teens while the operating "
             "margin holds above 32% -> the returns are attached to a growing "
             "business and the multiple is defensible; growth staying in the "
             "low teens -> this is a high-return business that cannot "
             "redeploy, and the price is already paying for a reinvestment "
             "rate it does not have",
  "evidence": ["roce_3y", "roe_avg_above_threshold_10y", "np_consistency_10y",
               "rev_cagr_5y", "pb"],
  "points": [
  "<b>Not held — MPSLTD is on your watchlist.</b> MPS Limited builds content "
  "production, publishing platforms and eLearning solutions for publishers and "
  "learning companies — founded in 1892, formerly Macmillan India, and not a "
  "leisure or hospitality business at all; it sits in this platform's "
  "<code>leisure_hospitality</code> cluster because the classifier files it "
  "under Consumer Services. Market capitalisation ₹4,095.12cr, 14th of 62. " +
  VET + "On the scorecard, composite 90 is seventh of 61, quality 71 is tied "
  "eighth of 62 in a two-way tie spanning positions 8 to 9, momentum 64 is "
  "tied tenth of 62 in a two-way tie spanning positions 10 to 11 and valuation "
  "44 is tied 38th of 61 in a three-way tie spanning positions 38 to 40, "
  "scored on 90 points rather than the declared 100, the missing 10 being the "
  "dividend yield, which this row does not pay. " + BANDWIDE,

  "<b>The capital return is the second best reading in the bucket and the "
  "growth is in the bottom third.</b> <code>roce_3y</code> 37.33% is second of "
  "60 and <code>roce_5y</code> 35.57% is third of 62 — the two windows agree "
  "and both sit at the front. <code>opm_now</code> 32.56% is 13th of 59 "
  "against <code>opm_prev</code> 30.06% at 14th of 59, so the trailing twelve "
  "months stepped the margin up by 2.50 points, and "
  "<code>ebitda_margin_3y</code> 33.97% at 19th of 61 against "
  "<code>ebitda_margin_5y</code> 33.97% at 15th of 61 says the level has held "
  "flat for five years. <code>asset_turnover</code> 0.842 is 12th of 62 and "
  "<code>net_debt_ebitda</code> -0.129 is 35th of 53: there was essentially no "
  "borrowing in nine years of the ten annual rows and ₹60.63cr in the latest "
  "one. "
  "Against all of that, <code>rev_cagr_5y</code> 14.38% is 42nd of 60, and the "
  "annual sales line reads ₹288.70cr, ₹267.03cr, ₹362.54cr, ₹331.65cr, "
  "₹422.55cr, ₹448.88cr, ₹501.05cr, ₹545.31cr, ₹726.89cr and ₹768.36cr: "
  "steady, unexciting, and never once a step change. " + SUBFLOOR +
  "<code>np_cagr_5y</code> 18.75% is one of them and is quoted here as a "
  "figure only.",

  "<b>This is the most consistent record in the batch and the consistency is "
  "the asset.</b> <code>roe_avg_above_threshold_10y</code> 1.000 is first of "
  "62 and untied and <code>roe_avg_above_threshold_7y</code> 1.000 is first of "
  "62 and untied — the average return on equity cleared its bar in every year "
  "of the ten, which no other row in this bucket managed — with "
  "<code>roe_avg_above_threshold_5y</code> 1.000 tied first of 62 in a "
  "four-way tie spanning positions 1 to 4. "
  "<code>np_consistency_10y</code> 1.723 is third of 62. "
  "<code>np_growth_above_inflation_5y</code> 1.000 is tied first of 62 in a "
  "five-way tie spanning positions 1 to 5, "
  "<code>np_growth_above_inflation_7y</code> 0.833 is tied first of 62 in a "
  "five-way tie spanning positions 1 to 5 and "
  "<code>np_growth_above_inflation_10y</code> 0.667 is tied seventh of 62 in a "
  "12-way tie spanning positions 7 to 18. Net profit was positive in all ten "
  "annual rows, rising ₹70.42cr to ₹173.22cr. There is no negative operating "
  "cash year in the ten, and operating cash came in at 0.834 of operating "
  "profit in FY2026 against a prior-years mean of 0.701 — the conversion "
  "improved rather than slipped. Even so, <code>cfo_ebitda_3y</code> 0.597 is "
  "37th of 56 and <code>cfo_ebitda_5y</code> 0.642 is 34th of 56: the "
  "conversion level itself is below the middle of the bucket.",

  "<b>The price is middling on every reading and the free cash flow is "
  "not.</b> " + THINREAD + "<code>pe_ttm</code> 21.74x is 32nd of 41, "
  "<code>ev_ebitda_ttm</code> 13.99x is 21st of 50 and "
  "<code>ev_sales_ttm</code> 5.037 is 22nd of 59 — cheap on earnings against "
  "the rows that have earnings, middling on the enterprise readings — while "
  "<code>pb</code> 6.867 is tenth of 56, which is where a 37% capital return "
  "with no borrowing ends up on an asset multiple. The reading that does not "
  "fit is <code>fcf_yield</code> 0.395% at 43rd of 62: this row converts well "
  "into operating cash and then spends it, so there is very little free cash "
  "yield behind the earnings multiple. <code>ttm_sales_pct</code> +10.09% is "
  "25th of 58, <code>ttm_op_pct</code> +19.25% is 17th of 52 and "
  "<code>ttm_np_pct</code> +19.03% is 12th of 49: the trailing twelve months "
  "grew earnings twice as fast as sales, which is the margin step rather than "
  "the business.",

  "<b>Nobody institutional owns this and the chart has already moved.</b> " +
  SHAREALIGN + "<code>promoter_pct</code> 68.34% is 18th of 61, "
  "<code>fii_pct</code> 1.38% is 26th of 47, <code>dii_pct</code> 2.14% is "
  "21st of 51 and <code>shareholders</code> 25,565 is 35th of 61 — under 4% of "
  "the register is institutional, on a company with the best ten-year return "
  "on equity record in the bucket, which is either an opportunity or a "
  "liquidity constraint. <code>ret_6m_rel</code> +51.61% is fifth of 59 and "
  "<code>ret_12m_rel</code> +18.18% is tenth of 56, but "
  "<code>ret_3m_rel</code> -1.07% is 38th of 59: the move is six months old "
  "and the last three have given some of it back. "
  "<code>pct_above_200ema_252d</code> 33.73% is 14th of 54. "
  "<code>sales_yoy_q</code> +20.38% is 14th of 60 and <code>np_yoy_q</code> "
  "+42.99% is 20th of 61, so the latest quarter is the best growth print on "
  "this row in years. " + MOM95,

  "<i>MPSLTD is the strongest row in this batch and it is still a watch, "
  "because what it does well is not growing fast. What is real: "
  "<code>roce_3y</code> 37.33% at second of 60 agreeing with "
  "<code>roce_5y</code> 35.57% at third of 62, "
  "<code>roe_avg_above_threshold_10y</code> 1.000 first of 62 and untied, "
  "<code>np_consistency_10y</code> 1.723 at third of 62, no negative operating "
  "cash year in the ten annual rows, and net profit positive in all ten of "
  "them. What that does not settle: <code>rev_cagr_5y</code> 14.38% at 42nd of "
  "60, so a business earning 37% on capital is compounding sales at half the "
  "rate of the bucket's better rows and cannot redeploy what it earns; "
  "<code>fcf_yield</code> 0.395% at 43rd of 62, so the cash that does arrive "
  "goes back out; <code>pb</code> 6.867 at tenth of 56; and an own-history "
  "earnings band too wide to price the row against its own past. The 1892 "
  "founding date is not a moat and the publishing-services end market is not "
  "in this pack at all. Confidence is medium.</i>",
  ],
},

"UFBL": {
  "verdict": "WATCH — no verdict — net profit was negative in eight years of "
             "the ten annual rows and over the trailing twelve months too, so "
             "there is no earnings multiple, no earnings band and no complete "
             "price pillar to read, on return on capital of 3.92%, 46th of 60",
  "confidence": "low",
  "trigger": "a full year of positive net profit with borrowings falling -> "
             "there is an earnings denominator to price for the first time in "
             "a decade and the pillar can be read; the operating margin "
             "staying under 15% while borrowings rise -> the restaurant "
             "estate is being funded by debt and the chart is the only thing "
             "working",
  "evidence": ["roce_3y", "net_debt_ebitda", "pb", "ret_12m_rel",
               "asset_turnover"],
  "points": [
  "<b>Not held — UFBL is on your watchlist. This row gets no verdict.</b> " +
  NOVERDICT + "United Foodbrands runs the Barbeque Nation and Toscano "
  "restaurant chains in India and the Gulf — it was Barbeque-Nation "
  "Hospitality until September 2025 — and sits in this platform's "
  "<code>leisure_hospitality</code> cluster at a market capitalisation of "
  "₹2,482.89cr, 19th of 62. " + VET + "On the scorecard, momentum 82 is second "
  "of 62, composite 85 is tenth of 61, valuation 65 is tied 13th of 61 in a "
  "three-way tie spanning positions 13 to 15 and quality 37 is tied 43rd of 62 "
  "in a two-way tie spanning positions 43 to 44 — scored on 91 points rather "
  "than the declared 100, the missing 9 being the five-year profit CAGR, which "
  "is NULL for this row. " + NOEARN + NOBAND,

  "<b>The operations work and the capital they sit on does not.</b> "
  "<code>opm_now</code> 14.77% is 35th of 59 against <code>opm_prev</code> "
  "16.86% at 34th of 59, and <code>ebitda_margin_3y</code> 30.12% is 28th of "
  "61 against <code>ebitda_margin_5y</code> 30.22% at 27th of 61 — a restaurant "
  "estate running a middle-of-the-bucket margin, flat over five years. "
  "<code>asset_turnover</code> 0.932 is ninth of 62: the asset base does turn. "
  "But <code>roce_3y</code> 3.92% is 46th of 60 and <code>roce_5y</code> 4.81% "
  "is 44th of 62, both near the back, and <code>net_debt_ebitda</code> 3.956 "
  "is 13th of 53 — the most levered reading on any row in this batch. "
  "Borrowings went ₹87.05cr to ₹885.27cr across the ten annual rows while "
  "sales went ₹503.48cr to ₹1,338.71cr and operating profit ₹63.61cr to "
  "₹192.95cr: the estate was built with debt, the debt is still there, and the "
  "operating profit it produces is 3.92% on the capital employed. "
  "<code>rev_cagr_5y</code> 11.68% is 47th of 60.",

  "<b>Eight years of the ten annual rows lost money below the operating line, "
  "and the "
  "operating cash never stopped.</b> Net profit was negative in eight years of "
  "the ten annual rows — minus ₹5.80cr, minus ₹38.39cr, minus ₹32.39cr, minus "
  "₹90.46cr, minus ₹25.60cr, minus ₹13.41cr, minus ₹27.79cr and minus "
  "₹59.13cr — with only ₹9.03cr ten years ago and ₹17.02cr four years ago on "
  "the other side. Operating profit was positive in every one of those years, "
  "so the losses are made under the operating line: interest on ₹885.27cr and "
  "depreciation on a leased estate. There is no negative operating cash year "
  "in the ten annual rows, and operating cash came in at 1.156 of operating "
  "profit in FY2026 against a prior-years mean of 0.847 — more cash arrives "
  "than operating profit is reported, which is what leases and depreciation do "
  "to this shape. Even so, <code>cfo_ebitda_3y</code> 0.554 is 41st of 56 and "
  "<code>cfo_ebitda_5y</code> 0.499 is 49th of 56. The track-record columns "
  "read as you would expect: <code>roe_avg_above_threshold_7y</code> 0.000 is "
  "tied 43rd of 62 in a 20-way tie spanning positions 43 to 62 and "
  "<code>roe_avg_above_threshold_10y</code> 0.000 is tied 48th of 62 in a "
  "15-way tie spanning positions 48 to 62 — the average return on equity has "
  "not cleared its bar in any year the pack holds. "
  "<code>np_growth_above_inflation_5y</code> 0.250 is tied 44th of 62 in a "
  "16-way tie spanning positions 44 to 59, "
  "<code>np_growth_above_inflation_7y</code> 0.333 is tied 47th of 62 in a "
  "14-way tie spanning positions 47 to 60 and "
  "<code>np_growth_above_inflation_10y</code> 0.333 is tied 53rd of 62 in a "
  "ten-way tie spanning positions 53 to 62. "
  "<code>np_consistency_10y</code> 0.670 is 45th of 62.",

  "<b>What is left of the price readings is the asset and enterprise side, and "
  "it is not cheap.</b> " + THINREAD + "<code>pb</code> 8.002 is ninth of 56 — "
  "the dearest book multiple in this batch, on the row with the weakest "
  "capital return in it. <code>ev_ebitda_ttm</code> 8.212x is 37th of 50 and "
  "<code>ev_sales_ttm</code> 2.276 is 47th of 59, both toward the back, which "
  "is the arithmetic of a wide EBITDA margin on a leased estate rather than a "
  "judgement about the price. <code>fcf_yield</code> 6.73% is 13th of 62, and "
  "that reading is the one worth holding onto: the cash is real even where the "
  "earnings are not. <code>ttm_sales_pct</code> +19.87% is 15th of 58 and "
  "<code>ttm_op_pct</code> +5.04% is 29th of 52, so sales grew four times "
  "faster than operating profit over the trailing twelve months. The trailing "
  "net change is not stated here because there is no positive base to compute "
  "it against, and the latest quarter's earnings change is excluded for the "
  "same reason: a percentage off a negative base is arithmetic, not "
  "information.",

  "<b>The chart is first in the bucket on two windows and it is the shortest "
  "chart in the bucket.</b> " + PRICEHIST + "<code>ret_12m_rel</code> "
  "+228.67% is first of 56 and <code>ret_6m_rel</code> +124.38% is first of "
  "59, with <code>ret_3m_rel</code> +7.68% at 19th of 59 — the move is six to "
  "twelve months old and the last three months have been ordinary. The share "
  "of sessions above the 200-day EMA cannot be computed on 274 bars and is "
  "NULL. <code>sales_yoy_q</code> +43.41% is seventh of 60, the strongest "
  "quarterly sales print on any row here. " + SHAREALIGN +
  "<code>promoter_pct</code> 34.62% is 49th of 61 against "
  "<code>fii_pct</code> 10.55% at sixth of 47, <code>dii_pct</code> 17.22% at "
  "seventh of 51 and <code>shareholders</code> 31,896 at 30th of 61: a low "
  "promoter holding with real institutional ownership on both sides. The pack "
  "holds no delivery row for this symbol at all, so there is nothing to say "
  "about who is actually taking stock. " + MOM85,

  "<i>UFBL gets no verdict, and the reason is that the number the page would "
  "lead with cannot be read. Its price pillar is scored on 68 of its declared "
  "100 points because "
  "the trailing earnings multiple and the dividend yield are both absent, and "
  "they are absent because net profit has been negative in eight years of the "
  "ten annual rows. What is real: <code>asset_turnover</code> 0.932 at ninth "
  "of 62, <code>fcf_yield</code> 6.73% at 13th of 62, no negative operating "
  "cash year in the ten annual rows, operating cash at 1.156 of operating "
  "profit against a prior-years mean of 0.847, and <code>ret_12m_rel</code> "
  "+228.67% first of 56. What refuses the verdict: <code>roce_3y</code> 3.92% "
  "at 46th of 60 with <code>roce_5y</code> 4.81% at 44th of 62; "
  "<code>net_debt_ebitda</code> 3.956 at 13th of 53 on borrowings of "
  "₹885.27cr; <code>pb</code> 8.002 at ninth of 56, the dearest book multiple "
  "here; an average return on equity that has cleared its bar in none of the "
  "years the pack holds; and a momentum reading computed on 274 bars of price "
  "where the rest of the bucket has 700. The operating business is fine and "
  "the capital structure sitting on top of it is the question, and this pack "
  "cannot answer it. Confidence is low.</i>",
  ],
},

}


# CHOICE 1. The pillar denominators are NOT the cohort size, and that is the
# trap a single-tier batch replaces the cross-tier one with. Asserted.
PILLAR_OF = {"quality_pct": 62, "valuation_pct": 61, "momentum_pct": 62,
             "composite_pct": 61, "market_cap": 62}

# Long constants that legitimately contain a banned phrase or a pillar word.
PHRASE_EXEMPT = (NOEARN, NOVERDICT, STEPFLAG, PRICEHIST, SUBFLOOR, THINREAD,
                 MOM95, MOM85, SHAREALIGN, BANDWIDE, NOBAND)


def _scrub(text: str) -> str:
    """Strip the shared cohort sentence out before searching for a claim.

    VET reads "weights quality 40, valuation 30 and momentum 30", so a naive
    search for a pillar figure finds the cohort weighting rather than this
    row's own percentile — guard 21 would then fire on every row that carries
    a renormalisation, and pass silently on the one that needed it.
    """
    for t in TIER_SENTENCE.values():
        text = text.replace(t, " ")
    return text


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
        sranks = pr.get("scores") or {}
        annual = p.get("annual") or []
        eq = p.get("earnings_quality") or {}
        cov = p.get("scorecard_coverage") or {}

        # 1. Shape.
        if len(pts) != 6:
            errs.append(f"{sym}: {len(pts)} points, expected 6")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. CHOICE 1. One tier here, which is why the cohort sentence is
        #    asserted against the pack rather than assumed: a row that changed
        #    tier between reruns would otherwise keep a sentence naming the
        #    wrong bucket and the wrong weights, and with only one sentence in
        #    the dict there would be no second one to contradict it.
        want = TIER_SENTENCE.get(tier)
        if want is None:
            errs.append(f"{sym}: tier={tier} has no cohort sentence")
        elif want not in p0:
            errs.append(f"{sym}: tier={tier} but point one does not carry the "
                        f"{tier} cohort sentence")
        if TIER_N.get(tier) != n:
            errs.append(f"{sym}: TIER_N says {tier} is {TIER_N.get(tier)}, "
                        f"peer_ranks says {n}")
        stated = re.search(r"[Pp]eered against (\d+) peers", p0)
        if not stated:
            errs.append(f"{sym}: point one states no cohort size")
        elif int(stated.group(1)) != n:
            errs.append(f"{sym}: point one says {stated.group(1)} peers, "
                        f"peer_ranks says {n}")
        gotw = cov.get("pillar_weights") or {}
        wantw = PILLAR_WEIGHTS.get(tier) or {}
        if gotw != wantw:
            errs.append(f"{sym}: PILLAR_WEIGHTS says {tier} is {wantw}, the "
                        f"pack says {gotw}")
        for k in ("q", "v", "m"):
            if str(wantw.get(k)) not in (want or ""):
                errs.append(f"{sym}: the {tier} cohort sentence does not state "
                            f"the {k} weight of {wantw.get(k)}")

        # 3. All five are `full`; asserted rather than assumed.
        st = p["scores"]["score_status"]
        if st != STATUS[sym]:
            errs.append(f"{sym}: score_status={st}, STATUS says {STATUS[sym]}")

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
            if "tech_net_score_scaled" in pt and not (MOM95 in pt
                                                      or MOM85 in pt):
                errs.append(f"{sym}: names tech_net_score_scaled outside the "
                            f"momentum-weight sentence")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. CHOICE 9. Thirteen sessions is a print, not a series, and one row
        #    has none at all. Naming the absence is allowed; a figure beside it
        #    is not.
        sessions = (p.get("delivery") or {}).get("sessions")
        for pt in allprose:
            if "delivery_pct" in pt:
                errs.append(f"{sym}: names delivery_pct off {sessions} "
                            f"session(s)")
            for m in re.finditer(r"deliver", pt, re.I):
                win = pt[max(0, m.start() - 60):m.end() + 90]
                if re.search(r"\d+(?:\.\d+)?\s*%", win):
                    errs.append(f"{sym}: quotes a figure beside delivery off "
                                f"{sessions} sessions")
        if sessions == 0 and "no delivery row" not in joined:
            errs.append(f"{sym}: the pack holds no delivery row and no point "
                        f"says so")
        if sessions and "no delivery row" in joined:
            errs.append(f"{sym}: says it has no delivery row, the pack holds "
                        f"{sessions} sessions")

        # 7. np_consistency is an index 0-2, never a pass rate.
        for pt in pts:
            if re.search(r"np_consistency\w*</code>\s*[\d.]+\s*(?:of|in)\s",
                         pt):
                errs.append(f"{sym}: np_consistency written as a pass rate")

        # 8. Every evidence key must resolve non-NULL in THIS row's own
        #    cluster_metrics or verdict-load.py rejects the whole row.
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")

        # 9. CHOICE 3, three-valued: absent / wide / usable, and all three
        #    occur in this batch, so neither refusal can quietly become
        #    "nobody quotes a band". MPSLTD sits at 5.026 and the threshold is
        #    not moved to keep its sentence.
        band = p.get("pe_band") or {}
        lo, hi, avg, bn = (band.get("lo"), band.get("hi"), band.get("avg"),
                           band.get("n"))
        if not band or not lo or (bn or 0) < BAND_MIN_N:
            state = "absent"
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
                errs.append(f"{sym}: band is {state} but the prose carries "
                            f"the other refusal")
            for pt in allprose:
                if re.search(r"own \w+-year (?:earnings )?band", pt):
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
                        r"own (\w+)-year earnings band runs ([\d.]+)-([\d.]+)x"
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

        # 11. The cash count, recomputed on every row — and the word
        #     "deterioration", which NO row in this batch earns. CASH_FLAGGED
        #     is empty here, so the guard is the inverse of the construction
        #     one: a pack that starts flagging a row fails the build rather
        #     than leaving the prose silently behind it.
        yrs = [r for r in annual if r.get("cash_from_operating") is not None]
        want_neg, want_rows, want_ratio = CASHYRS[sym]
        if len(yrs) != want_rows:
            errs.append(f"{sym}: CASHYRS counts out of {want_rows} annual cash "
                        f"rows, the pack holds {len(yrs)}")
        neg = sum(1 for r in yrs if r["cash_from_operating"] < 0)
        if neg != want_neg:
            errs.append(f"{sym}: CASHYRS says {want_neg} negative "
                        f"operating-cash years, the annual rows say {neg}")
        phrase = NOZERO if not neg else f"negative in {NEGWORD[neg]}"
        if phrase not in joined and phrase not in v["verdict"]:
            errs.append(f"{sym}: no point states the cash count ('{phrase}')")
        gotr = eq.get("cfo_op_latest")
        if gotr is None or abs(float(gotr) - want_ratio) > 0.0005:
            errs.append(f"{sym}: CASHYRS says cfo_op_latest={want_ratio}, "
                        f"pack says {gotr}")
        cashflags = [f for f in (eq.get("flags") or [])
                     if "cash conversion" in f]
        if sym in CASH_FLAGGED and not cashflags:
            errs.append(f"{sym}: in CASH_FLAGGED but the pack now carries no "
                        f"cash-conversion flag")
        if sym not in CASH_FLAGGED and cashflags:
            errs.append(f"{sym}: pack carries {len(cashflags)} "
                        f"cash-conversion flag(s), not in CASH_FLAGGED")
        said = [i + 1 for i, pt in enumerate(allprose)
                if re.search(DETERIORATION, pt, re.I)]
        if sym not in CASH_FLAGGED and said:
            errs.append(f"{sym}: block(s) {said} call a cash number a "
                        f"{DETERIORATION}; no row in this batch has a flag the "
                        f"pack can evidence a fall from")

        # 12. Every row's TTM window is the same quarter pair here, so a rerun
        #     that moves one off the batch has to fail rather than leave four
        #     rows silently incomparable.
        win = (p.get("ttm_vs_prior") or {}).get("window")
        if win != WINDOW_BATCH:
            errs.append(f"{sym}: TTM window {win} is not the batch window "
                        f"{WINDOW_BATCH} and no point says so")

        # 13. A rank whose own tie group covers more than 1/TIE_DIVISOR of the
        #     bucket is not a rank. A smaller tie is allowed and must say so
        #     IMMEDIATELY after the figure, naming the span.
        def tie_check(label: str, d: dict, where: str, seg: str) -> None:
            tied = d.get("tied") or 1
            says = bool(re.match(r"\s*\S+\s+(?:is\s+)?tied\b", seg))
            if tied > 1 and not says:
                errs.append(f"{sym}: {where} ranks {label}, which sits in a "
                            f"{tied}-way tie spanning "
                            f"{d['tie_span'][0]}-{d['tie_span'][1]}, without "
                            f"saying 'tied' immediately after the figure")
            if tied == 1 and says:
                errs.append(f"{sym}: {where} says {label} is tied; the pack "
                            f"gives it tied={tied}")
            if tied > 1:
                span = f"positions {d['tie_span'][0]} to {d['tie_span'][1]}"
                if span not in seg[:220]:
                    errs.append(f"{sym}: {where} states {label}'s tie without "
                                f"'{span}'")

        for i, pt in enumerate(pts):
            for k, d in mranks.items():
                if not d or not d.get("rankable"):
                    continue
                tag = f"<code>{k}</code>"
                tied = d.get("tied") or 1
                if tied * TIE_DIVISOR > n:
                    if any(tag in x for x in allprose):
                        errs.append(f"{sym}: names <code>{k}</code>, whose "
                                    f"{tied}-way tie covers more than a third "
                                    f"of the {n}-row bucket — not a rank")
                    continue
                at = 0
                while True:
                    at = pt.find(tag, at)
                    if at < 0:
                        break
                    at += len(tag)
                    tie_check(k, d, f"point {i + 1}", pt[at:at + 260])

        for key, word in PILLAR_WORD.items():
            d = sranks.get(key)
            if not d or not d.get("rankable"):
                continue
            rx = re.compile(
                rf"\b{word}\s+\d+(?:\.\d+)?\s*(?:,\s*|\s+is\s+|\s+at\s+)"
                rf"(?:tied\s+)?(?:{_ORDINAL})\s+of\s+\d+", re.I)
            for where, text in ([(f"point {i + 1}", pt)
                                 for i, pt in enumerate(pts)]
                                + [("verdict", v["verdict"]),
                                   ("trigger", v["trigger"])]):
                for m in rx.finditer(text):
                    head = re.match(rf"\b{word}\s+\d+(?:\.\d+)?", m.group(0),
                                    re.I)
                    tie_check(key, d, where,
                              m.group(0)[head.end():]
                              + text[m.end():m.end() + 220])

        # 14. CHOICE 2. A denominator under the floor is fabricated or carried
        #     in from another cluster.
        floor = DENOM_FLOOR[tier]
        for pt in allprose:
            for d2 in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                if int(d2) < floor:
                    errs.append(f"{sym}: states a denominator of {d2}; nothing "
                                f"ranked against this {tier} bucket is read by "
                                f"fewer than {floor} peers")

        # 14b. CHOICE 2, and the half a denominator floor cannot catch. A
        #      reading under the floor may still be QUOTED as a figure — the
        #      figure is real, only the position is not — so no ordinal may
        #      follow such a tag before the next tag begins. The set is
        #      recomputed PER ROW, because the five rows do not have the same
        #      sub-floor readings: LEMONTREE and UFBL carry neither column.
        subfloor = tuple(sorted(
            k for k, d in mranks.items()
            if d and d.get("rankable") and (d.get("of") or 0) < floor))
        if subfloor and SUBFLOOR not in joined:
            errs.append(f"{sym}: has sub-{floor} readings {list(subfloor)} and "
                        f"carries no SUBFLOOR sentence")
        if not subfloor and SUBFLOOR in joined:
            errs.append(f"{sym}: carries SUBFLOOR but every reading on it "
                        f"clears the floor of {floor}")
        ord_rx = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+\d+", re.I)
        for i, pt in enumerate(pts):
            for k in subfloor:
                tag = f"<code>{k}</code>"
                at = 0
                while True:
                    at = pt.find(tag, at)
                    if at < 0:
                        break
                    at += len(tag)
                    nxt = pt.find("<code>", at)
                    seg = pt[at:] if nxt < 0 else pt[at:nxt]
                    if ord_rx.search(seg):
                        errs.append(f"{sym}: point {i + 1} puts a position on "
                                    f"<code>{k}</code>, which only "
                                    f"{mranks[k]['of']} peers of the {n} "
                                    f"carry — quote the figure, not the rank")

        # 15. CHOICE 4. The label is the finding, so the headline carries it,
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
                errs.append(f"{sym}: is NOVERDICT_SYM but point one carries "
                            f"no explanation")
            if "no verdict" in v["verdict"]:
                errs.append(f"{sym}: headline says 'no verdict' but point one "
                            f"carries no explanation")

        # 16. CHOICE 5. The momentum weight is read off the pack PER ROW and
        #     it is NOT uniform here: four rows on 95, UFBL on 85. One shared
        #     sentence would have told four rows the truth and the fifth a lie.
        mw = ((cov.get("pillars") or {}).get("momentum") or {})
        if mw.get("covered_weight") != MOM_WEIGHT[sym]:
            errs.append(f"{sym}: MOM_WEIGHT says {MOM_WEIGHT[sym]}, the pack "
                        f"covers {mw.get('covered_weight')} of momentum's 100")
        need_mom = MOM85 if MOM_WEIGHT[sym] == 85 else MOM95
        other_mom = MOM95 if MOM_WEIGHT[sym] == 85 else MOM85
        got = sum(need_mom in pt for pt in pts)
        if got != 1:
            errs.append(f"{sym}: the momentum-weight sentence for "
                        f"{MOM_WEIGHT[sym]} appears {got}x, expected 1")
        if other_mom in joined:
            errs.append(f"{sym}: carries the momentum sentence for the other "
                        f"weight")

        # 17. CHOICE 10. ema_stack_bull is a binary with no order inside
        #     either group. Banned, not caveated.
        for pt in allprose:
            if EMAFLAT in pt:
                errs.append(f"{sym}: names {EMAFLAT}, a binary whose groups "
                            f"have no order inside them")

        # 18. The half guard 10 cannot see. These phrases resolve, in the
        #     ranks checker's own vocabulary, to columns this cluster does not
        #     carry. Asset turnover, the EBITDA margin, net debt to EBITDA,
        #     return on capital and book value ARE carried here, so the
        #     construction list would have been wrong in both directions.
        scrub = joined + " " + v["trigger"] + " " + v["verdict"]
        for ex in PHRASE_EXEMPT:
            scrub = scrub.replace(ex, " ")
        low = scrub.lower()
        for ph in BANNED_PHRASES:
            if ph.lower() in low:
                errs.append(f"{sym}: prose says '{ph}', which names a column "
                            f"leisure_hospitality does not carry")

        # 19. No figure for a metric that is NULL on this row.
        for key, word in (("promoter_pct", r"promoter"),
                          ("dii_pct", r"domestic institution|\bDII\b")):
            if live.get(key) is None and any(
                    re.search(word, pt) for pt in allprose):
                errs.append(f"{sym}: names {key} in the prose but it is NULL "
                            f"in the pack")

        # 20. CHOICE 7. Four readings sit on part of the bucket, so a rank on
        #     any of them places the row among those peers. Allowed, but only
        #     with THINREAD in the SAME point, and the counts are recomputed.
        for k, wantof in THIN_READS.items():
            gotof = (mranks.get(k) or {}).get("of")
            if gotof is not None and gotof != wantof:
                errs.append(f"{sym}: THIN_READS says {k} is read by {wantof} "
                            f"peers, the pack says {gotof} — rewrite THINREAD")
        for i, pt in enumerate(pts):
            if any(f"<code>{k}</code>" in pt for k in THIN_READS) \
                    and THINREAD not in pt:
                errs.append(f"{sym}: point {i + 1} ranks a reading carried by "
                            f"part of the bucket without THINREAD in the same "
                            f"point")
        if THINREAD in joined and not any(
                f"<code>{k}</code>" in joined for k in THIN_READS):
            errs.append(f"{sym}: carries THINREAD but ranks none of the thin "
                        f"readings")

        # 21. CHOICE 4 and CHOICE 5. A pillar percentile computed on part of
        #     its declared weight may be quoted only alongside what is missing
        #     underneath. Not uniform, so the renormalisation sits in the SAME
        #     point and the figure is banned from headline and trigger.
        for pillar, phr in PILLAR_WEIGHT.get(sym, []):
            rx = re.compile(rf"\b{pillar}\s+(?:of\s+)?\d+", re.I)
            hits = 0
            for i, pt in enumerate(pts):
                m = rx.search(_scrub(pt))
                if m:
                    hits += 1
                    if phr not in pt:
                        errs.append(f"{sym}: point {i + 1} quotes "
                                    f"'{m.group(0)}' without naming the "
                                    f"renormalisation ('{phr[:40]}...')")
            if not hits:
                errs.append(f"{sym}: PILLAR_WEIGHT caveats {pillar} but no "
                            f"point states the figure — the caveat is "
                            f"unreachable and the guard cannot fail")
            for where, text in (("verdict", v["verdict"]),
                                ("trigger", v["trigger"])):
                m = rx.search(text)
                if m:
                    errs.append(f"{sym}: {where} quotes '{m.group(0)}', a "
                                f"pillar scored on part of its weight, with "
                                f"no room for the caveat")
        for pillar, _phr in PILLAR_WEIGHT.get(sym, []):
            gw = ((cov.get("pillars") or {}).get(pillar) or {})
            if gw.get("covered_weight") is not None \
                    and gw["covered_weight"] >= 100:
                errs.append(f"{sym}: PILLAR_WEIGHT caveats {pillar} but the "
                            f"pack now covers {gw['covered_weight']} of 100 — "
                            f"drop the caveat")
        for pillar in ("valuation", "quality"):
            gw = ((cov.get("pillars") or {}).get(pillar) or {})
            cwt = gw.get("covered_weight")
            if cwt is not None and cwt < 100 and not any(
                    pl == pillar for pl, _ in PILLAR_WEIGHT.get(sym, [])):
                errs.append(f"{sym}: the pack scores {pillar} on {cwt} of 100 "
                            f"and PILLAR_WEIGHT carries no caveat for it")

        # 22. CHOICE 6. One row is flagged for the size of its margin step.
        #     Keyed off the pack's own flag rather than the sign of the step,
        #     because four of these five rows stepped the margin down and only
        #     one of them did it by enough for the pack to say so.
        flagged_step = any("operating margin stepped" in f
                           for f in (eq.get("flags") or []))
        if sym == STEPFLAG_SYM:
            if not flagged_step:
                errs.append(f"{sym}: STEPFLAG_SYM but the pack raises no "
                            f"margin-step flag")
            if STEPFLAG not in joined:
                errs.append(f"{sym}: flagged on the step and carries no "
                            f"STEPFLAG")
            for fig in (eq.get("opm_now"), eq.get("opm_prev")):
                if fig is not None and f"{float(fig) * 100:.2f}%" \
                        not in STEPFLAG:
                    errs.append(f"{sym}: STEPFLAG does not state "
                                f"{float(fig) * 100:.2f}%, a term of the step")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in STEPFLAG_FIELDS) \
                        and STEPFLAG not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks the margin pair "
                                f"without STEPFLAG in the same point")
        else:
            if flagged_step:
                errs.append(f"{sym}: the pack flags this row's margin step but "
                            f"the row is not STEPFLAG_SYM")
            if STEPFLAG in joined:
                errs.append(f"{sym}: carries STEPFLAG, which belongs to "
                            f"{STEPFLAG_SYM}")

        # 23. No row in this batch makes its earnings above the operating
        #     line, which is why nothing here carries construction's BELOWANN.
        #     Recomputed, so a restated history fails the build rather than
        #     leaving an uncaveated earnings multiple standing.
        pairs = [r for r in annual
                 if r.get("net_profit") is not None
                 and r.get("operating_profit") is not None]
        above = sum(1 for r in pairs
                    if r["net_profit"] > r["operating_profit"])
        if len(pairs) and above * 2 >= len(pairs):
            errs.append(f"{sym}: net profit outran operating profit in {above} "
                        f"of {len(pairs)} annual rows — this batch has no "
                        f"sentence for that and the earnings multiples below "
                        f"are uncaveated")

        # 24. CHOICE 8. The filings sit in two different months and one row of
        #     62 has none, so an ownership rank is read across the rows that
        #     filed. Asserted against the pack's own alignment block, which is
        #     the thing that would silently change.
        al = (pr["cohort"].get("shareholding_as_of") or {})
        ranked_share = [k for k in SHAREALIGN_KEYS
                        if (mranks.get(k) or {}).get("rankable")
                        and k not in subfloor]
        if al.get("aligned") is not False:
            errs.append(f"{sym}: SHAREALIGN claims the filings are not "
                        f"aligned; the pack says aligned={al.get('aligned')}")
        if str(al.get("rows_with_filing")) not in SHAREALIGN:
            errs.append(f"{sym}: SHAREALIGN does not state "
                        f"{al.get('rows_with_filing')} rows filed")
        for per in (al.get("periods") or []):
            if per not in SHAREALIGN:
                errs.append(f"{sym}: SHAREALIGN does not name the filing "
                            f"period {per}")
        for i, pt in enumerate(pts):
            if any(f"<code>{k}</code>" in pt for k in ranked_share) \
                    and SHAREALIGN not in pt:
                errs.append(f"{sym}: point {i + 1} ranks an ownership reading "
                            f"without SHAREALIGN in the same point")

        # 25. Loss-making years, recomputed. Two rows have them and three do
        #     not, and a row that has them must say how many — a negative
        #     earnings record is the thing a reader cannot see from a
        #     percentile.
        lossy = sum(1 for r in pairs if r["net_profit"] < 0)
        if lossy != LOSSYRS[sym]:
            errs.append(f"{sym}: LOSSYRS says {LOSSYRS[sym]} loss-making "
                        f"annual years, the pack's rows say {lossy}")
        if lossy:
            claim = (f"negative in {NEGWORD[lossy]} years of the "
                     f"{NEGWORD[len(pairs)]} annual rows")
            if claim not in joined and claim not in v["verdict"]:
                errs.append(f"{sym}: {lossy} loss-making years and no block "
                            f"states it as '{claim}'")

        # 26. Nothing in this batch carries the pack's below-EBIT flag. The
        #     guard exists so that a snapshot which starts raising one fails
        #     the build instead of leaving an uncaveated earnings multiple.
        if any("below EBIT" in f or "outran operating profit" in f
               for f in (eq.get("flags") or [])):
            errs.append(f"{sym}: the pack now flags earnings made below the "
                        f"operating line and no sentence here caveats it")

        # 27. CHOICE 1. The pillar denominators are not the cohort size, and
        #     the cohort sentence states which is which. Asserted, because a
        #     one-off error between 61 and 62 is invisible to a reader and to
        #     every other guard here.
        for key, wantof in PILLAR_OF.items():
            d = sranks.get(key) or {}
            if d.get("of") is not None and d["of"] != wantof:
                errs.append(f"{sym}: PILLAR_OF says {key} is read across "
                            f"{wantof}, the pack says {d['of']}")

        # 28. CHOICE 12. One row's price series is thirteen months old, and
        #     the momentum ranks on it are computed inside that. The bar count
        #     is read off the pack in both directions.
        bars = (p.get("technicals") or {}).get("bars")
        if sym == PRICEHIST_SYM:
            if bars != PRICEHIST_BARS:
                errs.append(f"{sym}: PRICEHIST states {PRICEHIST_BARS} bars, "
                            f"the pack holds {bars}")
            if PRICEHIST not in joined:
                errs.append(f"{sym}: has {bars} bars and carries no PRICEHIST")
        else:
            if bars is not None and bars < PRICEHIST_MIN:
                errs.append(f"{sym}: holds only {bars} bars, under the "
                            f"{PRICEHIST_MIN} a 252-day window above a "
                            f"200-day EMA needs, and carries no PRICEHIST")
            if PRICEHIST in joined:
                errs.append(f"{sym}: carries PRICEHIST, which belongs to "
                            f"{PRICEHIST_SYM}")

        # 29. CHOICE 13. Two of these rows are not hospitality businesses and
        #     the prose may not borrow the cluster's language for them. The
        #     disclaimer sentence and the cluster key itself are scrubbed
        #     first, or the guard would fire on the very sentence that says so.
        if sym in NOT_HOSPITALITY:
            hs = " ".join(allprose)
            for ex in HOSPITALITY_EXEMPT:
                hs = hs.replace(ex, " ")
            for w in HOSPITALITY_WORDS:
                if w in hs.lower():
                    errs.append(f"{sym}: prose uses '{w}' on a row that is "
                                f"not a hospitality business")

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
