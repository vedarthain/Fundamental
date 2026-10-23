#!/usr/bin/env python3
"""construction — the five tracked names, 2026-10-21 snapshot.

Thirteen choices this batch forced, each one a guard below rather than a note.

CHOICE 1 — two tiers, two cohorts, and two different pillar weightings. Four
rows are veteran and peer against 69; SRM is mid and peers against 36. The
weightings are not the same shape: the veteran tier is quality 40 / valuation
30 / momentum 30, the mid tier is quality 30 / valuation 30 / momentum 40. So
SRM's composite is not a worse or better reading of the same scorecard, it is a
different scorecard, and no sentence in this batch compares a figure on SRM to
a figure on the other four. Guard 2.

CHOICE 2 — the reading thin enough to lose its ordinal, which is what this
batch turns on. SRM's tier is 36 rows but the readings underneath are not:
<code>opm_now</code>, <code>opm_prev</code> and all three trailing-twelve-month
fields are carried by 9 peers, <code>peg</code> by 10, the shareholding fields
by 12 to 14, the quarterly year-on-year fields by 14 and
<code>pct_above_200ema_252d</code> by 15. A "third of 9" inside a 36-row tier
reads as a rank against construction and is not one. So the floor is per tier —
28 on the veteran side, 17 on the mid side — and a reading under its own tier's
floor may be QUOTED as a figure but carries no ordinal at all, with the row
saying which ones it dropped. Guards 14 and 14b.

CHOICE 3 — the band is three-valued here and all three values occur. Usable on
ENGINERSIN (8.95-29.40x) and KPIL (7.25-34.10x); more than five times wide on
UNIVASTU (1.50-9.23x) and WELENT (2.61-247.96x); absent on SRM, which has too
few annual multiples to build one. Guard 9.

CHOICE 4 — UNIVASTU gets no verdict, and the reason is that the composite of
100, first of 68, is measuring a record that cannot be read. Sales fell from
₹110.63cr to ₹51.24cr in FY2022 while operating profit nearly doubled to
₹21.46cr; the operating margin then stepped 20.36% to 14.80% in the latest
year; net profit outran operating profit by 75% over the trailing twelve
months; ₹0.30 of each rupee of operating profit reached operating cash; there
is no delivery row for the symbol at all; and the shareholding filing is one
month off the cohort's with the promoter down 67.46% to 64.24% inside it. Each
of those is a reason to keep watching and none is a reason to act. Guards 11,
15, 22, 24 and 26.

CHOICE 5 — WELENT is the one row that earns the word "deterioration", which
cement refused outright. Its collection ratio is 0.150 against a prior-years
mean of 0.526, so something did fall from a level, and the level was not good
either: operating cash is negative in six years of the ten annual rows and
<code>cfo_sales_3y</code> is -0.0543, 50th of 69. The word is permitted on that
row and banned on the other four. Guard 11.

CHOICE 6 — two rows carry the pack's below-EBIT flag on the trailing twelve
months: net profit outran operating profit by 40% on KPIL and 75% on UNIVASTU.
BELOWEBIT sits in the same point as any earnings multiple or trailing net
figure on those rows, checked against the live flag in both directions.
Guard 26.

CHOICE 7 — ENGINERSIN is the case the trailing flag cannot see. Its trailing
gap is 0.007 and the pack raises nothing, but net profit exceeded operating
profit in four of the ten ANNUAL rows — not once but four times — which is what a
consultancy holding a large cash balance looks like from the income statement
down. BELOWANN is required there, recomputed from the annual rows, and banned
elsewhere. Guard 23.

CHOICE 8 — momentum here is scored on 94 of its declared 100: this cluster
gives <code>tech_net_score_scaled</code> 6 of momentum's 100 points and the
column is NULL for all 3,178 rows in the snapshot. Uniform across the five, so
it changes no ranking. MOM94 states it once per row and cannot be copied from
any previous batch, where the weight was 7. Guard 16.

CHOICE 9 — SRM and UNIVASTU have no dividend yield, so their valuation pillar
is scored on 95 of 100. Not uniform, so it sits in the SAME point as the figure
and is banned from headline and trigger. Guard 21.

CHOICE 10 — the thin readings on the veteran side. A dividend yield exists on
28 of the 69 rows, <code>peg</code> on 33, an EV/EBITDA on 53, a trailing
earnings multiple and a trailing net change on 54 each and a trailing operating
change on 57. None is banned — each is load-bearing somewhere here — but any
point ranking one carries THINREAD in the same point. Guard 20.

CHOICE 11 — <code>ema_stack_bull</code> is 0.0 on all five rows and tied 57
ways across positions 10 to 66 on the veteran side and 23 ways of 29 on the mid
side. Banned outright rather than caveated, because the sort order among 57
identical zeroes is not a rank. Guard 17.

CHOICE 12 — delivery_data holds 13 sessions for four rows and ZERO rows for
UNIVASTU. Any percentage off 13 sessions is a single-day print; UNIVASTU has
not even that. Naming the absence is allowed; quoting a figure beside it is
not. Guard 6.

CHOICE 13 — the shareholding filings are not aligned across this cohort: the
veteran bucket holds periods 2026-06-30 and 2026-07-31 with 65 of 69 rows
filed, and the mid bucket 14 of 36. A shareholding rank is therefore read
across the rows that filed, in two different months, and any point quoting one
says so. Guard 24.
"""
import json
import re

PACK = "/tmp/constr5.json"
OUT = "build/verdicts/constr-5-verdicts.json"
SOURCE_REPORT = "construction — 5 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = PRICE_ASOF = "2026-10-21"

HELD: set[str] = set()
EMIT = {"ENGINERSIN", "KPIL", "SRM", "UNIVASTU", "WELENT"}

STATUS = {s: "full" for s in EMIT}

# CHOICE 1. Two tiers, and the weightings differ in shape as well as in bucket.
VET = ("Peered against 69 peers in the veteran tier of this cluster, where the "
       "scorecard weights quality 40, valuation 30 and momentum 30 — every "
       "rank below is read against that bucket and no other. ")
MID = ("Peered against 36 peers in the mid tier of this cluster, where the "
       "scorecard weights momentum 40 against quality 30 and valuation 30 — "
       "the inverse of the veteran weighting, so a figure here and a figure on "
       "a veteran row are not two readings of one scorecard. Every rank below "
       "is read against the 36 and no other. ")
TIER_SENTENCE = {"veteran": VET, "mid": MID}
TIER_N = {"veteran": 69, "mid": 36}
PILLAR_WEIGHTS = {"veteran": {"q": 40, "v": 30, "m": 30},
                  "mid": {"q": 30, "v": 30, "m": 40}}

# CHOICE 10. Required in the same point as any rank on the thin veteran
# readings. The counts are recomputed, so a filled-in snapshot fails the build.
THINREAD = ("Thin reading: a dividend yield exists on 28 of these 69 rows, a "
            "PEG on 33, an EV/EBITDA on 53, a trailing earnings multiple and a "
            "trailing net change on 54 each and a trailing operating change on "
            "57, so a rank on any of them places the row among those peers "
            "rather than across the bucket. ")
# Per TIER, because the two buckets are not thin in the same places and a
# single dict would assert the veteran counts against the mid row.
THIN_READS = {"veteran": {"div_yield": 28, "peg": 33, "ev_ebitda_ttm": 53,
                          "pe_ttm": 54, "ttm_np_pct": 54, "ttm_op_pct": 57},
              "mid": {}}

# CHOICE 2. The mid tier's own thin readings are thin enough that the ordinal
# goes away entirely. The figure may be stated; the rank may not.
SUBFLOOR = ("Ranks withheld: on this row the operating margin, both its terms, "
            "and all three trailing-twelve-month changes are carried by 9 "
            "peers of the 36, the PEG by 10, the shareholding fields by 12 to "
            "14, the quarterly changes by 14 and the share of sessions above "
            "the 200-day average by 15. Those figures are quoted below as "
            "figures and given no position, because a placing among nine "
            "peers of the 36 is not a placing in construction. The earnings "
            "and enterprise multiples clear the floor at 17 and are ranked, "
            "against those 17 rows rather than the 36. ")
SUBFLOOR_SYM = "SRM"
# measured: every reading on SRM whose `of` falls under the mid-tier floor of
# 17. Recomputed in guard 14b, so a filled-in snapshot fails the build.
SUBFLOOR_KEYS = ("opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct",
                 "ttm_np_pct", "peg", "dii_pct", "fii_pct", "promoter_pct",
                 "shareholders", "np_yoy_q", "sales_yoy_q",
                 "pct_above_200ema_252d")
# and the readings on that row that DO clear the mid floor but sit far under
# the tier: a rank on them needs SUBFLOOR in the same point too.
SUBFLOOR_THIN = ("pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm")

# CHOICE 8. 94, not 93 — this cluster's weight for the dead column.
MOM94 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 6 of momentum's 100 points in this "
         "cluster, so every momentum percentile here is scored on 94 points "
         "out of a declared 100. It is uniform across these five, so it "
         "changes no ranking — but the pillar is narrower than the scorecard "
         "claims.")

# CHOICE 5. The one row where something fell from a level, and the level was
# not good either.
CASHFLAG = ("The pack flags this row's cash twice, for the level and for the "
            "fall, and both readings hold. Operating cash came in at ₹112.19cr "
            "against ₹746.41cr of operating profit in FY2026 — 0.150 of it, "
            "against a prior-years mean of 0.526, which is a deterioration "
            "rather than a level — and the level it fell from was itself "
            "under 0.53. Operating cash is negative in six years of the ten "
            "annual rows, including three of the last four. ")
CASHFLAG_SYM = "WELENT"
DETERIORATION = "deterioration"

# CHOICE 4. The other flagged row: a level, not a fall, and three more flags
# on top of it.
CASHLEVEL = ("The pack flags this row's cash for the level it reached: "
             "₹11.99cr of operating cash against ₹39.93cr of operating profit "
             "in FY2026, 0.300 of it, where under 0.40 is the flag's own line. "
             "The prior-years mean is 0.474, so the direction is down, but the "
             "pack raises no fall here and no sentence below calls it one. ")
CASHLEVEL_SYM = "UNIVASTU"

# CHOICE 4. The year the whole record turns on, and what it is not.
ARTEFACT = ("And FY2022 is not a year this row can be read through. Sales fell "
            "from ₹110.63cr to ₹51.24cr while operating profit nearly doubled "
            "from ₹10.84cr to ₹21.46cr — a 41.9% operating margin on a sales "
            "line that halved, which is a contract-accounting or a one-off "
            "shape and not an operating one. Every multi-year reading below "
            "crosses it. The pack carries no restatement and no split of what "
            "makes it, so nothing here is adjusted for it either. ")
ARTEFACT_SYM = "UNIVASTU"

# CHOICE 6. The flag two rows carry, and what it disqualifies.
BELOWEBIT = ("The pack flags this row for earnings made below the operating "
             "line: net profit outran operating profit over the trailing "
             "twelve months, so an earnings multiple on that base is not a "
             "multiple on operations and the trailing net change is not an "
             "operating one. ")
BELOWEBIT_SYMS = {"KPIL": 0.3993, "UNIVASTU": 0.7526}
BELOWEBIT_FIELDS = ("pe_ttm", "ttm_np_pct")

# CHOICE 7. The annual-row version, which the trailing flag does not catch.
BELOWANN = ("Net profit exceeded operating profit in four years of the ten "
            "annual rows on this row — not a single year — so this is the shape "
            "of the business rather than a trailing artefact: a consultancy "
            "carrying a large cash balance earns below the operating line and "
            "reports it above the net one. The pack carries no split of what "
            "makes it, so how much of the earnings multiple divides into "
            "operations cannot be stated here. ")
BELOWANN_SYM = "ENGINERSIN"
BELOWANN_FIELDS = ("pe_ttm",)

# CHOICE 4. One row's margin went the other way, and the pack flags the size.
STEPDOWN = ("This is the one row in this batch whose operating margin stepped "
            "down rather than up, and the pack flags the size of it: 20.36% in "
            "the prior twelve months to 14.80% in the trailing ones. ")
STEPDOWN_SYMS = {"UNIVASTU"}
STEPDOWN_FIELDS = ("opm_now", "opm_prev")

NOVERDICT = ("A composite of 100, first of 68, standing on a record that "
             "cannot be read through: a FY2022 where sales halved and "
             "operating profit doubled, an operating margin that stepped down "
             "5.6 points in the latest year, net profit outrunning operating "
             "profit by 75% over the trailing twelve months, ₹0.30 of each "
             "rupee of operating profit reaching cash, and no delivery row at "
             "all. What follows is what can be said; a recommendation is not "
             "among it. ")
NOVERDICT_SYM = "UNIVASTU"

# CHOICE 13. The filings are in two different months and 4 of 69 are absent.
SHAREALIGN = ("The shareholding filings in this bucket are not aligned: the "
              "pack holds periods 2026-06-30 and 2026-07-31 across it with 65 "
              "rows of the 69 filed, so an ownership rank here is read across "
              "those rows in two different months. ")
SHAREALIGN_KEYS = ("promoter_pct", "fii_pct", "dii_pct", "shareholders")

# Metrics NULL for >=95% of the universe in this snapshot, measured from the
# pack's own sanity block rather than carried from the last batch.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "cfo_pat_latest",
        "roce_latest", "op_margin_latest", "book_value_cagr_5y", "np_cagr_7y",
        "roe_excess_13_10y", "roe_excess_13_7y", "roe_excess_13_5y",
        "book_value_cagr_10y", "p_aum")

# Plain-English phrases naming columns THIS cluster does not carry. Guard 10
# cannot see them because they are not tags. Note that working capital days,
# receivable days and debt-to-equity ARE carried here and are not banned —
# the cement list would have been wrong in both directions.
BANNED_PHRASES = ("inventory day", "net debt to EBITDA", "asset turnover",
                  "EBITDA margin", "capex intensity", "interest coverage",
                  "loan book", "price-to-aum", "dividend payout",
                  "return on assets", "equity to assets", "profit CAGR",
                  "earnings yield trend", "margin trend")
PHRASE_EXEMPT = (CASHFLAG, CASHLEVEL, BELOWEBIT, BELOWANN, ARTEFACT, STEPDOWN)

EMAFLAT = "ema_stack_bull"
CODE_ALLOW = {"construction", "full", "tech_net_score_scaled"}

# CHOICE 3: None = usable, else the reason it cannot price a row.
BAND_RATIO_MAX = 5.0
BAND_MIN_N = 5
BAND_REASON = {"ENGINERSIN": None, "KPIL": None, "SRM": "absent",
               "UNIVASTU": "wide", "WELENT": "wide"}
BANDWIDE = ("Its own earnings band is too wide to price it — the high is more "
            "than five times the low, which records an earnings denominator "
            "passing near zero in some year of the window rather than a range "
            "a price can sit inside. ")
NOBAND = ("The pack cannot build an own-history earnings band for this row: it "
          "has fewer than five annual multiples to build one from. ")

MOM94_SYMS = EMIT

# Per row: negative-operating-cash years, the row count they are out of, and
# the latest ratio as a level. Every figure recomputed from the annual rows.
CASHYRS = {
    "ENGINERSIN": (1, 10, 0.456),
    "KPIL": (0, 10, 0.631),
    "SRM": (1, 6, 0.553),
    "UNIVASTU": (3, 10, 0.300),
    "WELENT": (6, 10, 0.150),
}
CASH_FLAGGED = {"UNIVASTU", "WELENT"}
NEGWORD = {0: "no", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
           6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
NOZERO = "no negative operating cash year"

TTM_FIELDS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct")
WINDOW_BATCH = ["2025-09-30", "2026-06-30"]

# CHOICE 9. Two rows have no dividend yield, so valuation is scored on 95.
PILLAR_WEIGHT = {
    "SRM": [("valuation",
             "scored on 95 points rather than the declared 100")],
    "UNIVASTU": [("valuation",
                  "scored on 95 points rather than the declared 100")]}

# CHOICE 2. Per tier, because the two buckets are not thin in the same places.
DENOM_FLOOR = {"veteran": 28, "mid": 17}

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

"ENGINERSIN": {
  "verdict": "WATCH — quality 79, first of 69, on near-zero borrowings and "
             "capital returns above 25% in both windows, against five-year "
             "sales compounding at only 7.76% and four years of the ten "
             "annual rows earned below the operating line",
  "confidence": "medium",
  "trigger": "five-year sales compounding into the mid teens with the "
             "operating margin held above 19% -> the quality reading is "
             "attached to a growing business and the price is defensible; the "
             "trailing net change falling back toward the operating one -> the "
             "earnings base was other income and the multiple is on the wrong "
             "denominator",
  "evidence": ["roce_3y", "roce_5y", "opm_now", "debt_equity", "rev_cagr_5y"],
  "points": [
  "<b>Not held — ENGINERSIN is on your watchlist.</b> Engineers India sits in "
  "this platform's <code>construction</code> cluster at a market "
  "capitalisation of ₹14,703.06cr, seventh of 69. " + VET +
  "On the scorecard, quality 79 is first of 69, composite 96 is fourth of 68, "
  "momentum 64 is ninth of 68 and valuation 34 is tied 52nd of 69 in a two-way "
  "tie spanning positions 52 to 53 — the strongest quality reading in the "
  "bucket, and nearly the weakest price reading. Its own ten-year earnings "
  "band runs 8.95-29.40x with an average of 19.57x.",

  "<b>The returns are the best thing here and the growth is not.</b> "
  "<code>roce_3y</code> 25.75% is seventh of 65 and <code>roce_5y</code> "
  "25.08% is seventh of 66 — the two windows agree, which is what the quality "
  "pillar is reading. <code>debt_equity</code> 0.0053 is 61st of 63: there is "
  "essentially no borrowing, and the annual rows bear it out, with borrowings "
  "of ₹16.80cr against ₹3,928.18cr of sales. <code>op_margin_3y</code> 14.53% "
  "is 22nd of 69 while <code>opm_now</code> 19.35% is 14th of 64 against "
  "<code>opm_prev</code> 16.00% at 18th of 63, so the trailing twelve months "
  "stepped the margin up. Against all of that, <code>rev_cagr_5y</code> 7.76% "
  "is 34th of 68 — the middle of the bucket — and the annual sales line reads "
  "₹3,236.54cr, ₹3,144.17cr, ₹2,912.78cr, ₹3,330.14cr, ₹3,280.86cr, "
  "₹3,087.59cr and ₹3,928.18cr across the last seven years: six years of no "
  "progress and then one good one. <code>np_consistency_10y</code> 1.728 is "
  "tenth of 69.",

  "<b>The track-record columns read well and most of them are ties.</b> "
  "<code>roe_avg_above_threshold_5y</code> 0.800 is tied first of 69 in a "
  "two-way tie spanning positions 1 to 2, "
  "<code>roe_avg_above_threshold_7y</code> 0.714 is tied second of 69 in a "
  "five-way tie spanning positions 2 to 6 and "
  "<code>roe_avg_above_threshold_10y</code> 0.700 is tied third of 69 in a "
  "three-way tie spanning positions 3 to 5 — the average return on equity "
  "cleared the bar in seven years of the ten. "
  "<code>np_growth_above_inflation_5y</code> 1.000 is tied first of 69 in a "
  "17-way tie spanning positions 1 to 17, "
  "<code>np_growth_above_inflation_7y</code> 0.667 is tied 18th of 69 in a "
  "19-way tie spanning positions 18 to 36 and "
  "<code>np_growth_above_inflation_10y</code> 0.667 is tied 13th of 69 in a "
  "23-way tie spanning positions 13 to 35. On the cash side, "
  "<code>cfo_sales_3y</code> 6.23% is 26th of 69, <code>dso</code> 44.53 days "
  "is 59th of 69 and <code>wc_days</code> -206.94 is 52nd of 69 — the negative "
  "figure is the cluster's shape, client advances funding the work, and it is "
  "not a strength on its own. Operating cash was negative in one year of the "
  "ten annual rows, at minus ₹112.73cr, and came in at 0.456 of operating "
  "profit in FY2026 against a prior-years mean of 0.186.",

  "<b>Four years of the ten annual rows were earned below the operating line, "
  "and the price does not reflect it.</b> " + BELOWANN + THINREAD +
  "<code>pe_ttm</code> 20.80x is 26th of 54, <code>pb</code> 4.674 is fifth of "
  "63, <code>ev_ebitda_ttm</code> 22.33x is sixth of 53 and "
  "<code>ev_sales_ttm</code> 3.824 is 13th of 65, with <code>peg</code> 0.4226 "
  "at 20th of 33 and <code>div_yield</code> 1.911% at third of 28 — expensive "
  "on the asset and cash-flow readings, unremarkable on earnings, and one of "
  "the better yields in the bucket. <code>fcf_yield</code> 1.346% is 37th of "
  "69. <code>ttm_sales_pct</code> +16.30% is 18th of 63, "
  "<code>ttm_op_pct</code> +40.67% is 15th of 57 and <code>ttm_np_pct</code> "
  "+41.65% is 15th of 54, so the trailing net and operating changes agree on "
  "this row even though the ten-year record does not.",

  "<b>The chart has run and the ownership has not moved.</b> " + SHAREALIGN +
  "<code>promoter_pct</code> 51.32% is 36th of 64 and has not changed in any "
  "of the nine periods the pack holds — a government holding, repriced by "
  "nobody. <code>fii_pct</code> 9.17% is 13th of 59 and has risen from 6.75%, "
  "<code>dii_pct</code> 14.22% is twelfth of 58, and "
  "<code>shareholders</code> 390,132 is ninth of 65, down from 485,225: the "
  "institutions came in while the retail register shrank by a fifth. The close "
  "held above its 200-day EMA on 71.43% of the last 252 sessions, third of "
  "61, with <code>ret_12m_rel</code> +39.66% at sixth of 64, "
  "<code>ret_3m_rel</code> +26.44% at fifth of 66 and <code>ret_6m_rel</code> "
  "+8.68% at 14th of 66 — the twelve-month and three-month windows are strong "
  "and the six-month one in between is not, so the move is front-loaded and "
  "recent rather than steady. <code>sales_yoy_q</code> -5.80% is 47th of 65 "
  "against <code>np_yoy_q</code> +141.50% at ninth of 65, which is the same "
  "below-the-line shape arriving one quarter at a time. " + MOM94,

  "<i>ENGINERSIN is a watch and not a buy, and the reason is the denominator "
  "rather than the business. What is real: <code>roce_3y</code> 25.75% at "
  "seventh of 65 agreeing with <code>roce_5y</code> 25.08% at seventh of 66, "
  "<code>debt_equity</code> 0.0053 at 61st of 63, and a quality reading of 79 "
  "that is first of 69. What that does not survive: five-year sales "
  "compounding, <code>rev_cagr_5y</code> 7.76%, at 34th of 68, on a sales line that went nowhere for six "
  "years; net profit exceeding operating profit in four years of the ten "
  "annual rows, so part of the record is other income rather than consultancy "
  "fees; and <code>pb</code> 4.674 at fifth of 63, with EV/EBITDA "
  "at 22.33x. Quality first of 69 earns the price only if the growth arrives, "
  "and five years of this record say it has not. Confidence is medium.</i>",
  ],
},

"KPIL": {
  "verdict": "WATCH — composite 81, 14th of 68, on sales compounded to "
             "₹27,143.06cr and operating cash positive in every year of the ten "
             "annual rows, against an operating margin of 8.32% and a trailing "
             "net change the pack flags as earned below the operating line",
  "confidence": "medium",
  "trigger": "the operating margin clearing 10% with the trailing operating "
             "change catching the net one -> the earnings base is the EPC "
             "business and the multiple is readable; the margin holding near "
             "8% while borrowings rise -> scale without a return and the "
             "domestic institutions are the only bid",
  "evidence": ["roce_3y", "op_margin_3y", "dso", "rev_cagr_5y",
               "cfo_sales_3y"],
  "points": [
  "<b>Not held — KPIL is on your watchlist.</b> Kalpataru Projects "
  "International sits in this platform's <code>construction</code> cluster at "
  "a market capitalisation of ₹22,183.34cr, third of 69. " + VET +
  "On the scorecard, composite 81 is 14th of 68, momentum 59 is tied 11th of "
  "68 in a two-way tie spanning positions 11 to 12, quality 57 is tied 22nd of "
  "69 in a four-way tie spanning positions 22 to 25 and valuation 47 is tied "
  "37th of 69 in a two-way tie spanning positions 37 to 38 — the middle of the "
  "bucket on every pillar, from the third largest row in it. Its own ten-year "
  "earnings band runs 7.25-34.10x with an average of 19.38x.",

  "<b>The sales line is the strongest fact and the margin on it is the "
  "weakest.</b> Sales across the ten annual rows ran ₹7,445.81cr, "
  "₹8,708.98cr, ₹10,840.48cr, ₹12,675.84cr, ₹12,949.44cr, ₹14,777.38cr, "
  "₹16,361.44cr, ₹19,626.43cr, ₹22,315.78cr and ₹27,143.06cr — a 3.6-fold "
  "rise with no down year in it — and <code>rev_cagr_5y</code> 16.42% is 23rd "
  "of 68. Operating profit rose with it, ₹920.66cr to ₹2,432.38cr, but "
  "<code>op_margin_3y</code> 9.10% is 41st of 69 and <code>opm_now</code> "
  "8.32% is 38th of 64 against <code>opm_prev</code> 8.29% at 40th of 63: the "
  "margin did not move at all year on year, and it sits below the middle of "
  "the bucket in both windows. <code>roce_3y</code> 16.11% is 18th of 65 and "
  "<code>roce_5y</code> 15.64% is 20th of 66 — again the two windows agree, at "
  "a level the quality pillar reads as ordinary rather than good. "
  "<code>np_consistency_10y</code> 1.697 is twelfth of 69.",

  "<b>The cash record is the cleanest in this batch.</b> There is " + NOZERO +
  " in the ten annual rows: operating cash ran ₹766.36cr, ₹649.59cr, "
  "₹1,035.29cr, ₹937.24cr, ₹931.00cr, ₹713.66cr, ₹656.39cr, ₹842.96cr, "
  "₹913.95cr and ₹1,534.38cr, and FY2026 collected 0.631 of operating profit "
  "against a prior-years mean of 0.477, so the latest year is above its own "
  "history rather than below it. <code>cfo_sales_3y</code> 4.68% is 33rd of "
  "69 and <code>fcf_yield</code> 4.89% is 25th of 69. "
  "<code>debt_equity</code> 0.4556 is 31st of 63 with borrowings of "
  "₹3,542.62cr against ₹27,143.06cr of sales — down from ₹4,313.51cr the year "
  "before, on a sales line that grew 21.6%. <code>dso</code> 113.02 days is "
  "28th of 69 and <code>wc_days</code> -83.39 is 37th of 69: receivables run "
  "long, as they do for an EPC contractor billing against milestones, and "
  "client advances still fund more than they absorb. On the track-record "
  "columns <code>roe_avg_above_threshold_10y</code> 0.100 is tied 30th of 69 "
  "in a 19-way tie spanning positions 30 to 48 and "
  "<code>roe_avg_above_threshold_7y</code> 0.143 is tied 24th of 69 in a "
  "20-way tie spanning positions 24 to 43 — the average return on equity "
  "cleared the bar in one year of the ten.",

  "<b>The trailing net change is the figure drawing attention, and the pack "
  "says it was not earned in the EPC business.</b> " + BELOWEBIT + THINREAD +
  "<code>ttm_np_pct</code> +60.86% is ninth of 54 against "
  "<code>ttm_op_pct</code> +14.96% at 24th of 57 and "
  "<code>ttm_sales_pct</code> +14.56% at 20th of 63 — the net change is four "
  "times the operating one, which is the gap the flag is naming. "
  "<code>pe_ttm</code> 19.52x is 29th of 54 and sits almost exactly on its own "
  "ten-year average, <code>pb</code> 2.853 is 14th of 63, "
  "<code>ev_ebitda_ttm</code> 8.570x is 32nd of 53 and "
  "<code>ev_sales_ttm</code> 0.872 is 52nd of 65, with <code>peg</code> 1.097 "
  "at eleventh of 33 and <code>div_yield</code> 0.847% at 13th of 28. The "
  "<code>ev_sales_ttm</code> at 52nd of 65 against <code>pb</code> at 14th of 63 is "
  "the thin margin restated as a price: the market is paying for the equity, "
  "not the revenue.",

  "<b>Domestic institutions own more of this row than the promoter does.</b> " +
  SHAREALIGN + "<code>dii_pct</code> 44.84% is first of 58 while "
  "<code>promoter_pct</code> 33.58% is 50th of 64, down from 35.24% a year "
  "ago, and <code>fii_pct</code> 10.77% is eleventh of 59. "
  "<code>shareholders</code> 119,404 is 18th of 65. A row where the domestic "
  "funds hold the largest block in the bucket and the promoter holds a third "
  "is priced by the funds' flows, which is a different risk from a thin "
  "register and not a smaller one. The close held above its 200-day EMA "
  "on 69.44% of the last 252 sessions, fourth of 61, with "
  "<code>ret_12m_rel</code> +13.07% at ninth of 64, <code>ret_6m_rel</code> "
  "+12.50% at eighth of 66 and <code>ret_3m_rel</code> +9.87% at 16th of 66 — "
  "a steady relative gain rather than a move, which is the opposite shape to "
  "the rest of this batch. <code>sales_yoy_q</code> +3.84% is 34th of 65 and "
  "<code>np_yoy_q</code> +45.15% is 22nd of 65. " + MOM94,

  "<i>KPIL is a watch and the question is the margin, not the order book. What "
  "is real: sales from ₹7,445.81cr to ₹27,143.06cr with no down year, " +
  NOZERO + " in the ten annual rows, FY2026 collecting 0.631 of operating "
  "profit against a prior-years mean of 0.477, and borrowings down to "
  "₹3,542.62cr on a sales line that grew 21.6%. What holds it back: "
  "<code>op_margin_3y</code> 9.10% at 41st of 69 and <code>opm_now</code> "
  "8.32% at 38th of 64 with <code>opm_prev</code> 8.29% at 40th of 63, so "
  "three and a half times the sales have bought no margin at all; and a "
  "trailing net change of +60.86% that the pack flags as earned below the "
  "operating line while the operating change was +14.96%. At a trailing "
  "earnings multiple of 19.52x the price is not asking much, but it is being "
  "asked of the wrong earnings. Confidence is medium.</i>",
  ],
},

"SRM": {
  "verdict": "WATCH — composite 90, fourth of 29, on three-year sales "
             "compounding at 73.06%, against six annual rows, a "
             "cohort whose own readings are too thin to place most of them, "
             "and a share price down against the market across every window",
  "confidence": "low",
  "trigger": "a fourth and fifth full year holding the operating margin near "
             "17% with operating cash positive -> the record becomes long "
             "enough to rank and the price is the opportunity; the margin "
             "falling back toward 12% -> the trailing year was project mix and "
             "there is nothing underneath it",
  "evidence": ["roce_3y", "op_margin_3y", "rev_cagr_3y", "debt_equity",
               "cfo_sales_3y"],
  "points": [
  "<b>Not held — SRM is on your watchlist.</b> SRM Contractors sits in this "
  "platform's <code>construction</code> cluster at a market capitalisation of "
  "₹851.25cr, seventh of 36. " + MID + NOBAND +
  "On the scorecard, composite 90 is fourth of 29, quality 76 is second of 36 "
  "and momentum 44 is tied twelfth of 29 in a two-way tie spanning positions "
  "12 to 13.",

  "<b>Six annual rows, and the growth in them is the whole case.</b> Sales "
  "across the six rows the pack holds ran ₹160.06cr, ₹263.61cr, ₹300.29cr, "
  "₹342.42cr, ₹528.13cr and ₹1,025.57cr, with operating profit ₹16.55cr, "
  "₹30.16cr, ₹38.31cr, ₹41.63cr, ₹81.55cr and ₹166.87cr and net profit "
  "₹8.27cr, ₹17.57cr, ₹18.75cr, ₹26.97cr, ₹55.00cr and ₹111.02cr — every line "
  "rising in every year, and the last year nearly doubling. "
  "<code>rev_cagr_3y</code> 73.06% is fourth of 33 and <code>roce_3y</code> "
  "26.79% is eleventh of 33, with <code>op_margin_3y</code> 14.62% at 19th of "
  "36. Against that, <code>np_consistency_3y</code> 1.648 is 28th of 33: the "
  "growth is fast and it is not smooth. Six rows is six rows, and the company "
  "listed in April 2024, so there is no part of this record that was reported "
  "to a public market before the growth started.",

  "<b>Most of this row's readings are carried by too few peers to place "
  "it.</b> " + SUBFLOOR + "So, as figures: <code>opm_now</code> 17.24% "
  "against <code>opm_prev</code> 14.95%, which is a step up of 2.3 points; "
  "<code>ttm_sales_pct</code> +75.33%, <code>ttm_op_pct</code> +102.18% and "
  "<code>ttm_np_pct</code> +86.75%, where the operating change exceeds both "
  "the sales and the net ones — the rare shape in this batch, and the right "
  "way round; <code>peg</code> 0.1232; <code>promoter_pct</code> 72.59%, "
  "<code>fii_pct</code> 0.10%, <code>dii_pct</code> 0.25% and "
  "<code>shareholders</code> 22,179; <code>sales_yoy_q</code> +37.82% and "
  "<code>np_yoy_q</code> +54.59%; and <code>pct_above_200ema_252d</code> "
  "0.5675. None of those carries a position on this row and none is given "
  "one.",

  "<b>What can be placed: the price is near the bottom of what reads it, and "
  "the cash is not there.</b> " + SUBFLOOR + "<code>pe_ttm</code> 7.215x is 16th of 17, "
  "<code>ev_ebitda_ttm</code> 3.958x is 16th of 17 and "
  "<code>ev_sales_ttm</code> 0.743 is 15th of 17 — on the rows that carry "
  "those readings at all, this is among the lowest-priced — while "
  "<code>pb</code> 2.294 is 14th of 36, which the whole tier reads. Valuation "
  "73 is fourth of 36 and is scored on 95 points rather than the declared 100, "
  "the missing 5 being the dividend yield, which is NULL on this row. Against "
  "the price: <code>fcf_yield</code> -5.92% is 16th of 32, "
  "<code>cfo_sales_3y</code> 1.44% is seventh of 36 and operating cash was "
  "negative in one year of the six annual rows, at minus ₹46.66cr in FY2025, "
  "recovering to ₹92.27cr in FY2026 — 0.553 of operating profit, against a "
  "prior-years mean of 0.163. <code>debt_equity</code> 0.3631 is 26th of 36 "
  "with borrowings up from ₹40.89cr to ₹134.75cr in the latest year, which is "
  "how the working capital behind a doubled sales line was funded. "
  "<code>dso</code> 32.75 days is 35th of 36 and <code>wc_days</code> -121.81 "
  "is 36th of 36.",

  "<b>The share price has gone the other way from the business.</b> "
  "<code>ret_12m_rel</code> -26.75% is eleventh of 22, "
  "<code>ret_6m_rel</code> -21.82% is 23rd of 28 and <code>ret_3m_rel</code> "
  "-17.38% is 25th of 29 — behind the market across all three windows, and "
  "behind most of the peers that carry the reading on the two shorter ones. A "
  "sales line that doubled and a share price that fell a quarter is either the "
  "opportunity or the market's verdict on whether the doubling repeats, and "
  "six annual rows cannot tell those apart. " + MOM94,

  "<i>SRM is a watch and the confidence is low for reasons of measurement "
  "rather than of judgement. What is real: six annual rows every one of which "
  "grew, sales from ₹160.06cr to ₹1,025.57cr, <code>rev_cagr_3y</code> 73.06% "
  "at fourth of 33, <code>roce_3y</code> 26.79% at eleventh of 33, and "
  "operating cash back to ₹92.27cr after one negative year. What cannot be "
  "read: this row's tier weights momentum 40 against quality 30, the inverse "
  "of the weighting on the other four rows in this batch, so its composite is "
  "not the same measurement; the operating margin, the trailing changes, the "
  "PEG and the whole shareholding block are carried by nine to fifteen peers "
  "and carry no position; and a trailing earnings multiple of 7.215x with an "
  "EV/EBITDA of 3.958x is read by 17 rows of the 36, so the cheapness is "
  "measured against those and not against construction. The business is the "
  "best-looking thing in this batch "
  "and the evidence behind the ranks is the thinnest. Confidence is low.</i>",
  ],
},

"UNIVASTU": {
  "verdict": "WATCH — no verdict. A composite of 100, first of 68, standing on "
             "a FY2022 where sales halved while operating profit doubled, an "
             "operating margin down 5.6 points in the latest year, and ₹0.30 "
             "of each rupee of operating profit reaching cash",
  "confidence": "low",
  "trigger": "a full year holding the operating margin near 20% with "
             "operating cash above 0.60 of operating profit -> the record "
             "becomes readable and a verdict can be written; the margin "
             "falling further while receivables lengthen -> the trailing year "
             "was the mix and the composite was measuring it",
  "evidence": ["roce_3y", "roce_5y", "rev_cagr_5y", "dso", "cfo_sales_3y"],
  "points": [
  "<b>Not held — UNIVASTU is on your watchlist.</b> Univastu India sits in "
  "this platform's <code>construction</code> cluster at a market "
  "capitalisation of ₹473.23cr, 45th of 69. " + VET + NOVERDICT +
  "On the scorecard, composite 100 is first of 68, momentum 86 is second of "
  "68 and quality 69 is fifth of 69; the valuation pillar is stated in point "
  "four, where the caveat it needs can sit beside it. " + BANDWIDE,

  "<b>The year the record turns on is not a year.</b> " + ARTEFACT +
  "Sales across the ten annual rows ran ₹41.63cr, ₹81.54cr, ₹100.90cr, "
  "₹110.63cr, ₹51.24cr, ₹58.74cr, ₹86.95cr, ₹120.61cr, ₹171.18cr and "
  "₹243.35cr, with operating profit ₹3.76cr, ₹6.49cr, ₹11.09cr, ₹10.84cr, "
  "₹21.46cr, ₹13.10cr, ₹14.78cr, ₹19.54cr, ₹28.29cr and ₹39.93cr. "
  "<code>rev_cagr_5y</code> 42.67% is fifth of 68 and reads across the "
  "trough, which is most of what makes it fifth. "
  "<code>np_consistency_10y</code> 1.564 is 26th of 69.",

  "<b>The margin stepped down and the cash behind it did not arrive.</b> " +
  STEPDOWN + CASHLEVEL + "<code>opm_now</code> 14.80% is 18th of 64 against "
  "<code>opm_prev</code> 20.36% at 13th of 63, and <code>op_margin_3y</code> "
  "16.38% is 19th of 69. <code>roce_3y</code> 25.28% is eighth of 65 and "
  "<code>roce_5y</code> 22.15% is eleventh of 66 — the three-year reading "
  "above the five-year one, which is the trough rolling out of the window "
  "rather than a return improving. Operating cash was negative in three years "
  "of the ten annual rows, at minus ₹7.97cr, minus ₹4.80cr and minus "
  "₹5.66cr. <code>cfo_sales_3y</code> 3.51% is 36th of 69, "
  "<code>fcf_yield</code> 0.72% is 40th of 69, <code>dso</code> 120.94 days is "
  "25th of 69 and <code>wc_days</code> -165.30 is 49th of 69, with "
  "<code>debt_equity</code> 0.3247 at 38th of 63 and borrowings of ₹33.57cr, "
  "flat across the last four years.",

  "<b>The trailing twelve months are the best readings in the bucket and the "
  "pack says the net one was not earned in the operations.</b> " +
  BELOWEBIT + THINREAD + "<code>ttm_sales_pct</code> +106.68% is second of 63, "
  "<code>ttm_np_pct</code> +163.23% is fourth of 54 and "
  "<code>ttm_op_pct</code> +50.19% is eleventh of 57 — the net change is more "
  "than three times the operating one, which is the gap the flag names. "
  "<code>pe_ttm</code> 15.59x is 36th of 54, <code>pb</code> 4.577 is seventh "
  "of 63, <code>ev_ebitda_ttm</code> 9.980x is 28th of 53 and "
  "<code>ev_sales_ttm</code> 1.530 is 31st of 65, with <code>peg</code> 0.3447 "
  "at 23rd of 33; valuation 46 is scored on 95 points rather than the declared "
  "100, the missing 5 being the dividend yield, which is NULL on this row. "
  "<code>sales_yoy_q</code> +252.67% is first of 65 and <code>np_yoy_q</code> "
  "+281.61% is sixth of 65. The track-record columns read high and mostly as "
  "ties: <code>np_growth_above_inflation_5y</code> 1.000 is tied first of 69 "
  "in a 17-way tie spanning positions 1 to 17, "
  "<code>np_growth_above_inflation_7y</code> 0.833 is tied second of 69 in a "
  "16-way tie spanning positions 2 to 17 and "
  "<code>roe_avg_above_threshold_10y</code> 0.600 is tied sixth of 69 in a "
  "three-way tie spanning positions 6 to 8.",

  "<b>The promoter sold into the move and there is no delivery row to read it "
  "against.</b> " + SHAREALIGN + "This row's own latest filing is the "
  "2026-07-31 one, a month ahead of the rest of the bucket, and inside that "
  "month <code>promoter_pct</code> went from 67.46% to 64.24%, now 20th of "
  "64, while <code>shareholders</code> 8,627 is 60th of 65, up from 4,766 "
  "eighteen months ago. <code>fii_pct</code> 0.01% is tied 49th of 59 in a "
  "three-way tie spanning positions 49 to 51 and <code>dii_pct</code> 0.00% "
  "is tied 50th of 58 in a nine-way tie spanning positions 50 to 58: there is "
  "no institution here at all. The pack holds no delivery row whatsoever for "
  "this symbol, so whether the register grew by accumulation or by churn "
  "cannot be established. The price has run: <code>ret_6m_rel</code> +101.57% "
  "is second of 66, <code>ret_12m_rel</code> +100.57% is third of 64 and "
  "<code>ret_3m_rel</code> +20.23% is seventh of 66, with the close above its "
  "200-day EMA on 47.62% of the last 252 sessions, eighth of 61 — the "
  "whole gain is inside the last six months. " + MOM94,

  "<i>No verdict. The composite of 100 is first of 68 and it is the least "
  "informative figure on this page, because every multi-year reading "
  "underneath it crosses a FY2022 in which sales fell from ₹110.63cr to "
  "₹51.24cr while operating profit rose from ₹10.84cr to ₹21.46cr. What is "
  "real: sales of ₹243.35cr in FY2026 against ₹171.18cr, "
  "<code>roce_3y</code> 25.28% at eighth of 65, and a share price up more "
  "than the market in every window. What refuses a recommendation: the "
  "operating margin stepping 20.36% to 14.80%, which the pack itself flags as "
  "a mix change rather than a trend; a trailing net change of +163.23% flagged "
  "as earned below the operating line against a trailing operating change of "
  "+50.19%; ₹11.99cr of operating cash against ₹39.93cr of operating profit; "
  "the promoter down 3.2 points in the month the price was at its highest; and "
  "no delivery row at all. Each of those is answerable in two quarters and "
  "none is answerable now. Confidence is low.</i>",
  ],
},

"WELENT": {
  "verdict": "WATCH — operating cash negative in six years of the ten annual "
             "rows and ₹0.150 of each rupee of operating profit collected in "
             "FY2026 against a prior-years mean of 0.526, while borrowings "
             "went from ₹150.30cr to ₹1,986.52cr and the price outran the "
             "market by 30.99%",
  "confidence": "low",
  "trigger": "two consecutive years collecting above 0.50 of operating profit "
             "with borrowings flat -> the cash record was the build-out and "
             "the operating margin is real; a seventh negative year, or "
             "borrowings past ₹2,500cr -> the margin is being funded rather "
             "than earned",
  "evidence": ["roce_3y", "op_margin_3y", "rev_cagr_5y", "debt_equity",
               "dso"],
  "points": [
  "<b>Not held — WELENT is on your watchlist.</b> Welspun Enterprises sits in "
  "this platform's <code>construction</code> cluster at a market "
  "capitalisation of ₹9,551.24cr, eleventh of 69. " + VET +
  "On the scorecard, quality 61 is tied 16th of 69 in a five-way tie spanning "
  "positions 16 to 20, momentum 54 is 17th of 68, composite 60 is 28th of 68 "
  "and valuation 30 is tied 57th of 69 in a three-way tie spanning positions "
  "57 to 59 — middling on quality and momentum, near the back of the bucket "
  "on price. " + BANDWIDE,

  "<b>The cash line is the finding, and this is the one row in this batch "
  "where something fell from a level.</b> " + CASHFLAG +
  "Operating cash across the ten annual rows ran minus ₹23.65cr, minus "
  "₹287.30cr, minus ₹116.22cr, minus ₹57.94cr, ₹8.74cr, ₹287.07cr, "
  "₹344.67cr, minus ₹344.48cr, minus ₹273.49cr and ₹112.19cr, and "
  "<code>cfo_sales_3y</code> -5.43% is 50th of 69 — the three-year average is "
  "itself negative, so this is not one bad year inside a good record. "
  "Borrowings went ₹150.30cr, ₹459.83cr, ₹592.08cr, ₹812.07cr, ₹2,236.98cr, "
  "₹2,526.28cr, ₹763.55cr, ₹762.10cr, ₹1,499.13cr and ₹1,986.52cr: the cash "
  "the operations did not produce was borrowed. <code>debt_equity</code> "
  "0.6526 is 21st of 63 and <code>fcf_yield</code> -2.53% is 48th of 69.",

  "<b>The operating line looks better than the business behind it.</b> "
  "<code>opm_now</code> 20.19% is 13th of 64 against <code>opm_prev</code> "
  "17.98% at 17th of 63 and <code>op_margin_3y</code> 17.53% at 16th of 69 — "
  "the margin stepped up and sits in the better quarter of the bucket. "
  "<code>roce_3y</code> 16.23% is 17th of 65 and <code>roce_5y</code> 16.60% "
  "is 18th of 66, so the two windows agree at an ordinary level. "
  "<code>rev_cagr_5y</code> 28.11% is twelfth of 68 on sales that went "
  "₹305.44cr to ₹3,615.38cr across the record — but the latest year fell, "
  "₹3,695.34cr to ₹3,615.38cr, the first decline in nine years. Net profit "
  "reads ₹722.76cr in FY2022 against ₹246.85cr of operating profit in the "
  "same year, which is a gain made outside the operations and not repeated: "
  "profit then ran ₹295.09cr, ₹322.56cr and ₹349.87cr, below that FY2022 "
  "figure in every year since. <code>np_consistency_10y</code> 1.539 is 27th "
  "of 69, and <code>dso</code> 51.45 days is 56th of 69 with "
  "<code>wc_days</code> -160.27 at 47th of 69.",

  "<b>The trailing twelve months went backwards and the price did not.</b> "
  "The pack raises no below-the-operating-line flag on this row: net profit "
  "ran 0.121 below operating profit over the trailing twelve months, so the "
  "earnings multiple here is a multiple on operations. " + THINREAD +
  "<code>ttm_sales_pct</code> -1.84% is 41st of "
  "63, <code>ttm_np_pct</code> -3.06% is 30th of 54 and "
  "<code>ttm_op_pct</code> +10.26% is 27th of 57, with "
  "<code>sales_yoy_q</code> -8.44% at 50th of 65 and <code>np_yoy_q</code> "
  "-48.74% at 52nd of 65 — the quarter is worse than the year, so the "
  "direction is still down. Against that, <code>pe_ttm</code> 31.25x is 16th "
  "of 54, <code>pb</code> 3.138 is twelfth of 63, <code>ev_ebitda_ttm</code> "
  "14.62x is 21st of 53 and <code>ev_sales_ttm</code> 3.160 is 18th of 65, "
  "with <code>peg</code> 1.062 at twelfth of 33 and <code>div_yield</code> "
  "0.426% at 19th of 28. A row in the dearer quarter of the bucket on four "
  "separate price readings, with a trailing sales line that shrank. On the "
  "track-record columns <code>roe_avg_above_threshold_5y</code> 0.200 is tied "
  "18th of 69 in a 20-way tie spanning positions 18 to 37 and "
  "<code>np_growth_above_inflation_7y</code> 0.500 is tied 37th of 69 in a "
  "21-way tie spanning positions 37 to 57 — the average return on equity "
  "cleared the bar in one year of the ten.",

  "<b>The promoter has been buying and the register has been shrinking.</b> " +
  SHAREALIGN + "<code>promoter_pct</code> 56.13% is 30th of 64 and has risen "
  "from 54.51% across the nine periods the pack holds, while "
  "<code>shareholders</code> 51,191 is 30th of 65, down from 65,441 — the "
  "promoter adding into a register that lost a fifth of its holders. "
  "<code>dii_pct</code> 9.25% is 19th of 58, up from 5.02%, and "
  "<code>fii_pct</code> 3.92% is 22nd of 59, down from 4.71%. The price has "
  "run while the trailing figures fell: <code>ret_6m_rel</code> +41.00% is "
  "fifth of 66, <code>ret_12m_rel</code> +30.99% is seventh of 64 and "
  "<code>ret_3m_rel</code> +20.94% is sixth of 66, with the close above its "
  "200-day EMA on 66.27% of the last 252 sessions, fifth of 61. " + MOM94,

  "<i>WELENT is a watch and the cash record is the reason it is not more than "
  "one. What is real: <code>opm_now</code> 20.19% at 13th of 64 with "
  "<code>op_margin_3y</code> 17.53% at 16th of 69, sales from ₹305.44cr to "
  "₹3,615.38cr, and a promoter who has bought rather than sold. What the cash "
  "record says against it: operating cash negative in six years of the ten "
  "annual rows, <code>cfo_sales_3y</code> -5.43% at 50th of 69, a FY2026 "
  "collection ratio of 0.150 against a prior-years mean of 0.526 — the one "
  "deterioration in this batch that the pack's own prior mean supports — and "
  "borrowings at ₹1,986.52cr against ₹150.30cr at the start of the record. A "
  "20.19% operating margin that reaches cash at 0.150 is an accounting margin "
  "until two years say otherwise, and a trailing earnings multiple of 31.25x "
  "with <code>pb</code> 3.138 at twelfth of 63 is not waiting for them. "
  "Confidence is low.</i>",
  ],
},
}


def _scrub(text: str) -> str:
    """Strip the shared cohort sentence out before searching for a claim.

    VET and MID both read "weights quality 40, valuation 30 and momentum 30",
    so a naive search for a pillar figure finds the cohort weighting rather
    than this row's own percentile. Guard 21 would fire on every row in the
    mid tier and on every veteran row that carries a renormalisation.
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

        # 2. CHOICE 1. Two tiers, two buckets AND two pillar weightings. The
        #    sentence is asserted against the pack in all three respects,
        #    because a row that silently changes tier between reruns would
        #    otherwise keep a cohort sentence naming the wrong bucket and the
        #    wrong weights.
        want = TIER_SENTENCE.get(tier)
        if want is None:
            errs.append(f"{sym}: tier={tier} has no cohort sentence")
        elif want not in p0:
            errs.append(f"{sym}: tier={tier} but point one does not carry the "
                        f"{tier} cohort sentence")
        for other, text in TIER_SENTENCE.items():
            if other != tier and text in joined:
                errs.append(f"{sym}: is {tier} but carries the {other} "
                            f"cohort sentence")
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
            if "tech_net_score_scaled" in pt and MOM94 not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside MOM94")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. CHOICE 12. Thirteen sessions is a print, not a series, and one row
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
        #    "nobody quotes a band".
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

        # 11. CHOICE 5 and CHOICE 4. Two rows are flagged on cash and the
        #     flags are not the same flag: one is a fall from a level the pack
        #     can evidence, the other is a level alone. So the word
        #     "deterioration" belongs to exactly one row here — the inverse of
        #     the cement batch, where it belonged to none — and the count of
        #     negative years is recomputed on every row.
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
        fell = [f for f in cashflags if "fell to" in f]
        if sym in CASH_FLAGGED and not cashflags:
            errs.append(f"{sym}: in CASH_FLAGGED but the pack now carries no "
                        f"cash-conversion flag")
        if sym not in CASH_FLAGGED and cashflags:
            errs.append(f"{sym}: pack carries {len(cashflags)} "
                        f"cash-conversion flag(s), not in CASH_FLAGGED")
        # the fall, and the one row entitled to the word for it
        if sym == CASHFLAG_SYM:
            if not fell:
                errs.append(f"{sym}: CASHFLAG_SYM but the pack raises no "
                            f"'fell to' cash flag")
            if CASHFLAG not in joined:
                errs.append(f"{sym}: flagged on the fall but carries no "
                            f"CASHFLAG")
            pm = eq.get("cfo_op_prior_mean")
            if pm is None or pm <= 0:
                errs.append(f"{sym}: CASHFLAG reads the ratio against a "
                            f"positive prior mean, the pack says {pm}")
            elif f"{pm}" not in CASHFLAG:
                errs.append(f"{sym}: CASHFLAG states a prior mean the pack "
                            f"does not carry ({pm})")
        else:
            if fell:
                errs.append(f"{sym}: the pack raises a 'fell to' cash flag but "
                            f"the row is not CASHFLAG_SYM")
            if CASHFLAG in joined:
                errs.append(f"{sym}: carries CASHFLAG, which belongs to "
                            f"{CASHFLAG_SYM}")
        # the level alone, which is a different claim
        if sym == CASHLEVEL_SYM:
            if not cashflags or fell:
                errs.append(f"{sym}: CASHLEVEL_SYM wants a level flag and no "
                            f"fall; the pack gives {len(cashflags)} flag(s), "
                            f"{len(fell)} of them a fall")
            if CASHLEVEL not in joined:
                errs.append(f"{sym}: flagged on the level but carries no "
                            f"CASHLEVEL")
        elif CASHLEVEL in joined:
            errs.append(f"{sym}: carries CASHLEVEL, which belongs to "
                        f"{CASHLEVEL_SYM}")
        # and the word itself: one row earns it, four may not use it
        said = [i + 1 for i, pt in enumerate(allprose)
                if re.search(DETERIORATION, pt, re.I)]
        if sym != CASHFLAG_SYM and said:
            errs.append(f"{sym}: block(s) {said} call a cash number a "
                        f"{DETERIORATION}; only {CASHFLAG_SYM} has a prior "
                        f"mean the pack can evidence a fall from")
        if sym == CASHFLAG_SYM and not said:
            errs.append(f"{sym}: earns the word {DETERIORATION} and no block "
                        f"uses it")
        # CHOICE 4: the year the no-verdict row cannot be read through
        if sym == ARTEFACT_SYM:
            if ARTEFACT not in joined:
                errs.append(f"{sym}: carries no ARTEFACT refusal")
            sales = [r.get("sales") for r in annual]
            ops = [r.get("operating_profit") for r in annual]
            if len(sales) < 6 or not (sales[4] < sales[3]
                                      and ops[4] > ops[3]):
                errs.append(f"{sym}: ARTEFACT claims sales fell and operating "
                            f"profit rose in the fifth annual row; the pack "
                            f"says sales {sales[3]}->{sales[4]}, operating "
                            f"profit {ops[3]}->{ops[4]}")
            for fig in (sales[3], sales[4], ops[3], ops[4]):
                if fig is not None and f"{fig:,.2f}cr" not in ARTEFACT:
                    errs.append(f"{sym}: ARTEFACT does not state "
                                f"₹{fig:,.2f}cr, a term of the year it "
                                f"refuses")
        elif ARTEFACT in joined:
            errs.append(f"{sym}: carries ARTEFACT, which belongs to "
                        f"{ARTEFACT_SYM}")

        # 12. Every row's TTM window is the same quarter pair here, so a rerun
        #     that moves one off the batch has to fail rather than leave four
        #     rows silently incomparable.
        win = (p.get("ttm_vs_prior") or {}).get("window")
        if win != WINDOW_BATCH:
            errs.append(f"{sym}: TTM window {win} is not the batch window "
                        f"{WINDOW_BATCH} and no point says so")

        # 13. A rank whose own tie group covers more than 1/TIE_DIVISOR of the
        #     bucket is not a rank. A smaller tie is allowed and must say so
        #     IMMEDIATELY after the figure, naming the span: a character window
        #     false-fires the moment a non-tied figure and a tied one share a
        #     sentence.
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

        # 14. CHOICE 2. The floor is PER TIER, because the mid bucket is thin
        #     in places the veteran one is not. A denominator under this row's
        #     own floor is fabricated or carried in from another cluster.
        floor = DENOM_FLOOR[tier]
        for pt in allprose:
            for d2 in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                if int(d2) < floor:
                    errs.append(f"{sym}: states a denominator of {d2}; nothing "
                                f"ranked against this row's {tier} bucket is "
                                f"read by fewer than {floor} peers")

        # 14b. CHOICE 2, and the half a denominator floor cannot catch. A
        #      reading under the floor may still be QUOTED as a figure — the
        #      figure is real, only the position is not — so the rule is that
        #      no ordinal may follow such a tag before the next tag begins.
        #      The set is recomputed from the pack, so a snapshot that fills
        #      these in fails the build rather than leaving a stale refusal.
        subfloor = tuple(sorted(
            k for k, d in mranks.items()
            if d and d.get("rankable") and (d.get("of") or 0) < floor))
        if sym == SUBFLOOR_SYM:
            if subfloor != tuple(sorted(SUBFLOOR_KEYS)):
                errs.append(f"{sym}: SUBFLOOR_KEYS is {sorted(SUBFLOOR_KEYS)}, "
                            f"the pack's sub-{floor} readings are "
                            f"{list(subfloor)}")
            if SUBFLOOR not in joined:
                errs.append(f"{sym}: has {len(subfloor)} sub-floor readings "
                            f"and carries no SUBFLOOR sentence")
        else:
            if subfloor:
                errs.append(f"{sym}: has sub-{floor} readings {list(subfloor)} "
                            f"but is not SUBFLOOR_SYM")
            if SUBFLOOR in joined:
                errs.append(f"{sym}: carries SUBFLOOR, which belongs to "
                            f"{SUBFLOOR_SYM}")
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
        # and the readings that clear the floor but still sit far under the
        # tier: a rank on those needs the same sentence in the same point
        if sym == SUBFLOOR_SYM:
            for i, pt in enumerate(pts):
                if any(f"<code>{k}</code>" in pt for k in SUBFLOOR_THIN) \
                        and SUBFLOOR not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks one of "
                                f"{list(SUBFLOOR_THIN)} without SUBFLOOR in "
                                f"the same point")

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

        # 16. CHOICE 8. MOM94 exactly once per row — 94, not 93: this cluster
        #     gives tech_net_score_scaled 6 of momentum's 100 points, and the
        #     weight is read off the pack rather than carried forward.
        mw = ((cov.get("pillars") or {}).get("momentum") or {})
        if mw.get("covered_weight") != 94:
            errs.append(f"{sym}: MOM94 says 94, the pack covers "
                        f"{mw.get('covered_weight')} of momentum's 100")
        if sym in MOM94_SYMS:
            got = sum(MOM94 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM94 appears {got}x in the points, "
                            f"expected exactly 1")

        # 17. CHOICE 11. ema_stack_bull is 0.0 on every row and tied across
        #     most of both buckets. Banned, not caveated.
        for pt in allprose:
            if EMAFLAT in pt:
                errs.append(f"{sym}: names {EMAFLAT}, tied across most of the "
                            f"cohort on either reading")

        # 18. The half guard 10 cannot see. These phrases resolve, in the
        #     ranks checker's own vocabulary, to columns this cluster does not
        #     carry. Note that working capital days, receivable days and
        #     debt-to-equity ARE carried here, so the cement list would have
        #     been wrong in both directions.
        scrub = joined + " " + v["trigger"] + " " + v["verdict"]
        for ex in PHRASE_EXEMPT:
            scrub = scrub.replace(ex, " ")
        low = scrub.lower()
        for ph in BANNED_PHRASES:
            if ph.lower() in low:
                errs.append(f"{sym}: prose says '{ph}', which names a column "
                            f"construction does not carry")

        # 19. No figure for a metric that is NULL on this row.
        for key, word in (("promoter_pct", r"promoter"),
                          ("dii_pct", r"domestic institution|\bDII\b")):
            if live.get(key) is None and any(
                    re.search(word, pt) for pt in allprose):
                errs.append(f"{sym}: names {key} in the prose but it is NULL "
                            f"in the pack")

        # 20. CHOICE 10. Six readings sit on part of the veteran bucket, so a
        #     rank on any of them places the row among those peers. Allowed,
        #     but only with THINREAD in the SAME point — and the counts are
        #     recomputed PER TIER, so the mid row is never asserted against
        #     the veteran bucket's reading counts.
        for k, wantof in THIN_READS[tier].items():
            gotof = (mranks.get(k) or {}).get("of")
            if gotof is not None and gotof != wantof:
                errs.append(f"{sym}: THIN_READS[{tier}] says {k} is read by "
                            f"{wantof} peers, the pack says {gotof} — rewrite "
                            f"THINREAD")
        for i, pt in enumerate(pts):
            if any(f"<code>{k}</code>" in pt for k in THIN_READS[tier]) \
                    and THINREAD not in pt:
                errs.append(f"{sym}: point {i + 1} ranks a reading carried by "
                            f"part of the bucket without THINREAD in the same "
                            f"point")
        if THINREAD in joined and not any(
                f"<code>{k}</code>" in joined for k in THIN_READS[tier]):
            errs.append(f"{sym}: carries THINREAD but ranks none of the thin "
                        f"readings of its own tier")

        # 21. CHOICE 9. A pillar percentile computed on part of its declared
        #     weight may be quoted only alongside what is missing underneath.
        #     Unlike MOM94 this is NOT uniform, so the renormalisation sits in
        #     the SAME point and the figure is banned from headline and trigger.
        for pillar, phr in PILLAR_WEIGHT.get(sym, []):
            rx = re.compile(rf"\b{pillar}\s+(?:of\s+)?\d+", re.I)
            for i, pt in enumerate(pts):
                # VET and MID literally contain "valuation 30" — the shared
                # cohort sentence is not a claim about THIS row's pillar.
                m = rx.search(_scrub(pt))
                if m and phr not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes '{m.group(0)}' "
                                f"without naming the renormalisation "
                                f"('{phr}')")
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
        for pillar, _phr in ((k, 0) for k in ("valuation", "quality")):
            gw = ((cov.get("pillars") or {}).get(pillar) or {})
            cwt = gw.get("covered_weight")
            if cwt is not None and cwt < 100 and not any(
                    pl == pillar for pl, _ in PILLAR_WEIGHT.get(sym, [])):
                errs.append(f"{sym}: the pack scores {pillar} on {cwt} of 100 "
                            f"and PILLAR_WEIGHT carries no caveat for it")

        # 22. CHOICE 4. Four rows stepped the operating margin up and one
        #     stepped it down, and the pack flags the size of that one. The
        #     sign is recomputed, so a constant that drifts onto the wrong row
        #     fails the build.
        step = eq.get("opm_step")
        if sym in STEPDOWN_SYMS:
            if step is None or float(step) >= 0:
                errs.append(f"{sym}: in STEPDOWN_SYMS but opm_step is {step}")
            if not any("operating margin stepped" in f
                       for f in (eq.get("flags") or [])):
                errs.append(f"{sym}: STEPDOWN claims the pack flags the size "
                            f"of the step; it raises no margin-step flag")
            for fig in (eq.get("opm_now"), eq.get("opm_prev")):
                if fig is not None and f"{float(fig) * 100:.2f}%" \
                        not in STEPDOWN:
                    errs.append(f"{sym}: STEPDOWN does not state "
                                f"{float(fig) * 100:.2f}%, a term of the step")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in STEPDOWN_FIELDS) \
                        and STEPDOWN not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks the margin pair "
                                f"without STEPDOWN in the same point")
        else:
            if step is not None and float(step) < 0:
                errs.append(f"{sym}: opm_step is {step}, a step down, but the "
                            f"row is not in STEPDOWN_SYMS")
            if STEPDOWN in joined:
                errs.append(f"{sym}: carries STEPDOWN, whose rows are "
                            f"{sorted(STEPDOWN_SYMS)}")

        # 23. CHOICE 7. The trailing below-EBIT flag does not catch a row half
        #     of whose RECORD is made below the operating line. The count is
        #     recomputed from the annual rows, so a restated history moves the
        #     claim rather than leaving it stale.
        pairs = [r for r in annual
                 if r.get("net_profit") is not None
                 and r.get("operating_profit") is not None]
        above = sum(1 for r in pairs
                    if r["net_profit"] > r["operating_profit"])
        if sym == BELOWANN_SYM:
            if above != 4:
                errs.append(f"{sym}: BELOWANN says net profit outran operating "
                            f"profit in five years, the annual rows say "
                            f"{above} of {len(pairs)}")
            if f"in {NEGWORD[above]} years of the ten" not in BELOWANN:
                errs.append(f"{sym}: BELOWANN does not state the count "
                            f"'{NEGWORD[above]}'")
            if BELOWANN not in joined:
                errs.append(f"{sym}: BELOWANN_SYM but no point carries it")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in BELOWANN_FIELDS) \
                        and BELOWANN not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks an earnings "
                                f"multiple without BELOWANN in the same point")
        else:
            if len(pairs) and above * 2 >= len(pairs):
                errs.append(f"{sym}: net profit outran operating profit in "
                            f"{above} of {len(pairs)} annual rows but the row "
                            f"is not BELOWANN_SYM")
            if BELOWANN in joined:
                errs.append(f"{sym}: carries BELOWANN, which belongs to "
                            f"{BELOWANN_SYM}")

        # 24. CHOICE 13. The filings in this bucket sit in two different
        #     months and four rows have none, so an ownership rank is read
        #     across the rows that filed. Asserted against the pack's own
        #     alignment block, which is the thing that would silently change.
        al = (pr["cohort"].get("shareholding_as_of") or {})
        ranked_share = [k for k in SHAREALIGN_KEYS
                        if (mranks.get(k) or {}).get("rankable")
                        and k not in subfloor]
        if tier == "veteran":
            if al.get("aligned") is not False:
                errs.append(f"{sym}: SHAREALIGN claims the filings are not "
                            f"aligned; the pack says aligned="
                            f"{al.get('aligned')}")
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
                    errs.append(f"{sym}: point {i + 1} ranks an ownership "
                                f"reading without SHAREALIGN in the same point")
        elif SHAREALIGN in joined:
            errs.append(f"{sym}: carries SHAREALIGN, which states the veteran "
                        f"bucket's filing counts")

        # 26. CHOICE 6. Two rows carry the pack's below-EBIT flag. A PE or a
        #     trailing net figure on that base is not a figure on operations,
        #     so BELOWEBIT sits in the SAME point as either — and the gap is
        #     recomputed against the pack in both directions.
        livegap = eq.get("np_over_op_gap")
        # The pack's own wording is "the difference sits below EBIT" — it
        # never says "operating line", which is MY phrasing. A substring test
        # on the latter reads every row as unflagged and passes silently.
        flagged_below = any("below EBIT" in f or "outran operating profit" in f
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
