#!/usr/bin/env python3
"""cement — the five tracked names, 2026-10-21 snapshot.

Twelve choices this batch forced, each one a guard below rather than a note.

CHOICE 1 — the giant ties are the defining problem here, not the thin readings.
ema_stack_bull is 0.0 on four of the five rows and tied 31 ways across
positions 3 to 33 of the 33 that carry it; roe_avg_above_threshold_5y is 0.0 on
three rows and tied 24 ways spanning 11 to 34. A rank whose own tie covers more
than a third of the bucket is not a rank. Guard 13 bans any reading whose tied
count exceeds n/3 on the row that carries it — which bans the three
roe_avg_above_threshold windows on GRASIM, NUVOCO and RAMCOIND while leaving
them legal on JKCEMENT and SAHYADRI, where the values are real.

CHOICE 2 — GRASIM gets no verdict, and the reason is the shape of the entity.
Operating cash is negative in six years of the ten annual rows including each of the
last four, the latest at minus ₹17,809.61cr against ₹36,295.92cr of operating
profit, with borrowings up from ₹9,213.03cr to ₹227,853.06cr across the record.
The flag's ratio of -0.491 is read against a prior-years mean of -0.311, so
"fell to" is meaningless and "deterioration" is refused on every row in this
batch. And the pack's own segment list puts Financial Services — one of the
four declared segments — inside the same
consolidated statement as the cement, with no segment-level cash split, so the
one question that matters cannot be answered from this pack at all. Guards 11
and 15.

CHOICE 3 — the band is three-valued here. Usable on JKCEMENT (14.56-53.33x) and
RAMCOIND (5.84-16.51x); more than five times wide on GRASIM (7.07-47.96x),
NUVOCO (27.94-776.69x on five readings) and SAHYADRI (2.46-36.01x). No row is
short, but NUVOCO's n=5 is one rerun from it, so the machinery stays. Guard 9.

CHOICE 4 — two rows carry the pack's below-EBIT flag on the trailing twelve
months: net profit outran operating profit by 106% on NUVOCO and 59% on
SAHYADRI. BELOWEBIT sits in the same point as any earnings multiple or trailing
net figure, both directions checked against the live flag. Guard 26.

CHOICE 5 — RAMCOIND is the case the TTM flag cannot see. Its trailing gap is
only +0.117 and the pack raises nothing, but net profit exceeded operating
profit in eight of the ten ANNUAL rows. A 7.98x multiple at 26th of 27 divides
into earnings its operations mostly did not make. BELOWANN is required there,
recomputed from the annual rows, and banned elsewhere. Guard 23.

CHOICE 6 — SAHYADRI is the inverse artefact. It collected ₹121.34cr of
operating cash against ₹61.11cr of operating profit, 1.986 times it, against a
prior-years mean of 0.543, while borrowings fell from ₹78.39cr to ₹16.59cr.
That is one year's working-capital release, not a level — and it is underneath
a composite of 100, first of 33, on an operating line that peaked at ₹100.15cr
in FY2022. CASHUP says so. Guard 11.

CHOICE 7 — JKCEMENT is the only row whose operating margin stepped down,
17.94% to 16.21%, and the only one with a negative trailing net change. STEPDOWN
is required in the same point as either margin figure and banned on the four
rows that stepped up, with the sign recomputed from opm_step. Guard 22.

CHOICE 8 — momentum here is scored on 93 of its declared 100, not 95 or 96:
this cluster gives tech_net_score_scaled 7 of momentum's 100 points. Uniform
across the five, so it changes no ranking. MOM93 states it once per row, and it
cannot be copied from any previous batch. Guard 16.

CHOICE 9 — NUVOCO's valuation pillar is scored on 90 of 100, dividend yield
being NULL on that row alone. Not uniform, so it sits in the SAME point as the
figure and is banned from headline and trigger. Guard 21.

CHOICE 10 — the thin readings. A dividend yield exists on 23 of these rows, a
trailing earnings multiple and a trailing net change on 27 each and a trailing
operating change on 28, out of a bucket of 34. None is banned — each is
load-bearing somewhere here — but any point ranking one carries THINREAD in the
same point, and the bucket's thinnest reading of 23 is the denominator floor.
Guards 14 and 20.

CHOICE 11 — ema_stack_bull is banned outright on top of the tie rule, because
the one row that reads 1.0 would otherwise get a first-of-33 out of a binary.
Guard 17.

CHOICE 12 — delivery_data holds 13 sessions for every row. Any percentage off
it is a single-day print. Naming the absence is allowed; quoting a figure beside
it is not. Guard 6.
"""
import json
import re

PACK = "/tmp/cement5.json"
OUT = "build/verdicts/cement-5-verdicts.json"
SOURCE_REPORT = "cement — 5 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = PRICE_ASOF = "2026-10-21"

HELD = {"JKCEMENT", "NUVOCO"}
EMIT = {"GRASIM", "JKCEMENT", "NUVOCO", "RAMCOIND", "SAHYADRI"}

STATUS = {s: "full" for s in EMIT}

# Every row is veteran and every cohort is the same 34, so there is one cohort
# sentence — but it is still asserted against the pack rather than assumed.
VET = ("Peered against 34 peers in the veteran tier of this cluster — every "
       "rank below is read against that bucket and no other. ")
TIER_SENTENCE = {"veteran": VET}

# CHOICE 10. Required in the same point as any rank on the four thin readings.
THINREAD = ("Thin reading: a dividend yield exists on 23 of these rows, a "
            "trailing earnings multiple and a trailing net change on 27 each "
            "and a trailing operating change on 28, out of a bucket of 34, so "
            "a rank on any of them places the row among those peers rather "
            "than across the bucket. ")
THIN_READS = {"div_yield": 23, "pe_ttm": 27, "ttm_np_pct": 27,
              "ttm_op_pct": 28}

# CHOICE 8. 93, not 95 and not 96 — this cluster's weight for the dead metric.
MOM93 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 7 of momentum's 100 points in this "
         "cluster, so every momentum percentile here is scored on 93 points "
         "out of a declared 100. It is uniform across these five, so it "
         "changes no ranking — but the pillar is narrower than the scorecard "
         "claims.")

# CHOICE 2. The flag is real and the word the flag invites is still refused.
CASHFLAG = ("The pack flags this row's cash, and the flag is milder than the "
            "record behind it. Operating cash was minus ₹17,809.61cr in FY2026 "
            "against ₹36,295.92cr of operating profit, while borrowings rose "
            "from ₹186,325.56cr to ₹227,853.06cr in the same year. The ratio "
            "the flag reports, -0.491, is read against a prior-years mean of "
            "-0.311, so nothing here fell from a level: the operating cash "
            "line is negative in six years of the ten annual rows, including each of "
            "the last four. ")
CASHFLAG_SYM = "GRASIM"

SEGMENT = ("And the consolidated cash line is not a cement collection line. "
           "The pack's own segment list for this row reads Cellulosic Fibres, "
           "Chemicals, Building Materials and Financial Services, and its "
           "core-business line names cement, paints, chemicals and cellulosic "
           "fibres — one consolidated statement across all of it. The pack "
           "carries no segment-level cash split, so which "
           "part of it consumed the cash cannot be established here, and no "
           "sentence below asserts one. ")
SEGMENT_SYM = "GRASIM"
SEGMENT_WORDS = ("Cellulosic Fibres", "Chemicals", "Building Materials",
                 "Financial Services", "paints")

# CHOICE 6. The opposite artefact: a collection ratio far above its own mean.
CASHUP = ("Operating cash on this row came in at ₹121.34cr against ₹61.11cr of "
          "operating profit in FY2026 — 1.986 times it, against a prior-years "
          "mean of 0.543 — while borrowings fell from ₹78.39cr to ₹16.59cr. "
          "That is a working-capital release inside one year, not a level to "
          "read a multiple or a percentile off. ")
CASHUP_SYM = "SAHYADRI"

# CHOICE 4. The flag two rows carry, and what it disqualifies.
BELOWEBIT = ("The pack flags this row for earnings made below the operating "
             "line: net profit outran operating profit over the trailing "
             "twelve months, so an earnings multiple on that base is not a "
             "multiple on operations and the trailing net change is not an "
             "operating one. ")
BELOWEBIT_SYMS = {"NUVOCO": 1.0585, "SAHYADRI": 0.5913}
BELOWEBIT_FIELDS = ("pe_ttm", "ttm_np_pct")

# CHOICE 5. The annual-row version, which the trailing flag does not catch.
BELOWANN = ("Net profit exceeded operating profit in eight years of the ten annual "
            "rows on this row, so this is the shape of the record rather than "
            "a trailing artefact: most of what an earnings multiple divides "
            "into here was not made by the operations. The pack carries no "
            "split of what makes it. ")
BELOWANN_SYM = "RAMCOIND"
BELOWANN_FIELDS = ("pe_ttm",)

# CHOICE 7. One row's margin went the other way.
STEPDOWN = ("This is the one row in this batch whose operating margin stepped "
            "down rather than up: 17.94% in the prior twelve months to 16.21% "
            "in the trailing ones. ")
STEPDOWN_SYMS = {"JKCEMENT"}
STEPDOWN_FIELDS = ("opm_now", "opm_prev")

NOVERDICT = ("Operating cash negative in six years of the ten annual rows and in "
             "each of the last four, a flag ratio read against a prior-years "
             "mean that is itself negative, and a consolidated statement that "
             "contains a financial-services arm the pack gives no cash split "
             "for. What follows is what can be said; a recommendation is not "
             "among it. ")
NOVERDICT_SYM = "GRASIM"

# Metrics NULL for >=95% of the universe in this snapshot.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "cfo_pat_latest",
        "roce_latest", "op_margin_latest", "book_value_cagr_5y", "np_cagr_7y",
        "roe_excess_13_10y", "roe_excess_13_7y", "roe_excess_13_5y",
        "book_value_cagr_10y", "p_aum")

# Plain-English phrases naming columns THIS cluster does not carry. Guard 10
# cannot see them because they are not tags.
BANNED_PHRASES = ("working capital day", "debt-to-equity", "debt to equity",
                  "inventory day", "receivable day", "interest coverage",
                  "loan book", "price-to-aum", "dividend payout",
                  "cash conversion", "collection cycle", "profit CAGR",
                  "cash-to-profit")
PHRASE_EXEMPT = (CASHFLAG, CASHUP, BELOWEBIT, BELOWANN)

EMAFLAT = "ema_stack_bull"
CODE_ALLOW = {"cement", "full", "tech_net_score_scaled"}

# CHOICE 3: None = usable, else the reason it cannot price a row.
BAND_RATIO_MAX = 5.0
BAND_MIN_N = 5
BAND_REASON = {"GRASIM": "wide", "JKCEMENT": None, "NUVOCO": "wide",
               "RAMCOIND": None, "SAHYADRI": "wide"}
BANDWIDE = ("Its own earnings band is too wide to price it — the high is more "
            "than five times the low, which records an earnings denominator "
            "passing near zero in some year of the window rather than a range "
            "a price can sit inside. ")
NOBAND = ("The pack cannot build an own-history earnings band for this row: it "
          "has fewer than five annual multiples to build one from. ")

MOM93_SYMS = EMIT

# Per row: negative-operating-cash years, the row count they are out of, the
# latest ratio as a level, and whether the pack flags the cash.
CASHYRS = {
    "GRASIM": (6, 10, -0.491),
    "JKCEMENT": (0, 10, 0.787),
    "NUVOCO": (0, 10, 0.800),
    "RAMCOIND": (1, 10, 0.864),
    "SAHYADRI": (0, 10, 1.986),
}
CASH_FLAGGED = {"GRASIM"}
NEGWORD = {0: "no", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
           6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
NOZERO = "no negative operating cash year"

TTM_FIELDS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct")
WINDOW_BATCH = ["2025-09-30", "2026-06-30"]

# CHOICE 9. Only NUVOCO is renormalised, and only on valuation.
PILLAR_WEIGHT = {
    "NUVOCO": [("valuation",
                "scored on 90 points rather than the declared 100")]}

# CHOICE 10. The bucket's thinnest reading is 23, so a denominator under it is
# fabricated or carried in from another cluster.
DENOM_FLOOR = 23

# CHOICE 1. A tie covering more than a third of the bucket is not a rank.
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

"GRASIM": {
  "verdict": "WATCH — no verdict. Operating cash negative in six years of the "
             "ten annual rows, most recently minus ₹17,809.61cr against a "
             "record ₹36,295.92cr of operating profit, inside a four-segment "
             "entity the pack gives no cash split for",
  "confidence": "low",
  "trigger": "one full year of positive operating cash with borrowings flat, "
             "or a segment-level cash disclosure the pack can carry -> the row "
             "becomes readable and a verdict can be written; a seventh negative "
             "year -> the cement rank is decoration on a financing entity",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "net_debt_ebitda",
               "rev_cagr_5y"],
  "points": [
  "<b>Not held — GRASIM is on your watchlist.</b> Grasim Industries sits in "
  "this platform's <code>cement</code> cluster at a market capitalisation of "
  "₹196,753.08cr, second of 34. " + VET + NOVERDICT +
  "On the scorecard, quality 56 is 14th of 34, valuation 35 is tied 23rd of 33 "
  "in a two-way tie spanning positions 23 to 24, momentum 63 is fourth of 34 "
  "and composite 64 is 13th of 33. " + BANDWIDE,

  "<b>The operating line is near the front of the bucket and the return on the "
  "capital behind it is in the middle.</b> <code>opm_now</code> 20.96% is "
  "second of 33 against <code>opm_prev</code> 19.74% at third of 33, with "
  "<code>ebitda_margin_3y</code> 24.35% at fourth of 33 and "
  "<code>ebitda_margin_5y</code> 24.20% at fifth of 34, and "
  "<code>op_margin_trend_7y</code> 0.00185 is fourth of 33. Against that, "
  "<code>roce_3y</code> 9.11% is 15th of 33 and <code>roce_5y</code> 10.13% is "
  "15th of 33, and <code>asset_turnover</code> 0.308 is 32nd of 33 — the "
  "capital base is very large relative to what it turns. "
  "<code>rev_cagr_5y</code> 16.36% is second of 32 and "
  "<code>np_consistency_10y</code> 1.722 is sixth of 34. "
  "<code>np_growth_above_inflation_10y</code> 0.333 is tied 30th of 34 in a "
  "five-way tie spanning positions 30 to 34: profit cleared inflation three "
  "times in nine comparisons.",

  "<b>The cash line is negative across most of the record, and the entity is "
  "not only a cement maker.</b> " + CASHFLAG + SEGMENT +
  "<code>fcf_yield</code> -18.46% is 32nd of 34 and "
  "<code>capex_intensity_3y</code> 0.143 is eighth of 33, with "
  "<code>net_debt_ebitda</code> 5.748 at eighth of 31. Net profit across the "
  "ten annual rows ran ₹3,167.30cr, ₹2,678.58cr, ₹1,692.99cr, ₹4,411.74cr, "
  "₹4,304.82cr, ₹7,549.78cr, ₹6,827.26cr, ₹5,624.49cr, ₹3,705.68cr and "
  "₹4,966.48cr, while operating profit rose from ₹7,386.60cr to ₹36,295.92cr "
  "across the same window — the operating line more than quadrupled and the "
  "reported profit did not move.",

  "<b>The chart leads the cohort on the one reading that spans a year.</b> " +
  THINREAD + "<code>pe_ttm</code> 34.94x is 11th of 27, <code>pb</code> 1.902 "
  "is 12th of 32, <code>ev_ebitda_ttm</code> 9.038x is 14th of 31 and "
  "<code>ev_sales_ttm</code> 2.274 is tenth of 33, and "
  "<code>div_yield</code> 0.3459% is 17th of 23. <code>ttm_sales_pct</code> "
  "+19.51% is seventh of 33, <code>ttm_op_pct</code> +26.86% is ninth of 28 "
  "and <code>ttm_np_pct</code> +39.02% is 12th of 27, with "
  "<code>sales_yoy_q</code> +21.43% at sixth of 33 and <code>np_yoy_q</code> "
  "+51.06% at seventh of 34. The close held above its 200-day EMA on 80.16% of "
  "the last 252 sessions, first of 32, while <code>ret_12m_rel</code> +3.97% "
  "is fifth of 33, <code>ret_6m_rel</code> +9.23% is eighth of 33 and "
  "<code>ret_3m_rel</code> -1.41% is tenth of 33. Ownership: "
  "<code>promoter_pct</code> 43.73% is 30th of 34 and has risen from 43.05%, "
  "<code>fii_pct</code> 14.63% is third of 31 and has risen from 13.69%, "
  "<code>dii_pct</code> 16.13% is 12th of 31 against a peak of 18.24%, and "
  "<code>shareholders</code> 241,017 is third of 34, down from 265,202, on a "
  "public float of 25.15%. " + MOM93,

  "<i>No verdict. The operating record is one of the strongest readings in this "
  "bucket — <code>opm_now</code> 20.96% at second of 33, with "
  "<code>rev_cagr_5y</code> 16.36% at second of 32 on five-year sales — and "
  "the cash line behind it is "
  "negative in six years of the ten annual rows and in each of the last four. "
  "Those two facts cannot be reconciled from what the pack carries, because the "
  "statement is consolidated across fibres, chemicals, building materials and "
  "financial services and there is no segment cash split in it. "
  "<code>net_debt_ebitda</code> 5.748 at eighth of 31 is the balance sheet "
  "arriving at the same question. A recommendation here would be a guess about "
  "which segment consumed ₹17,809.61cr, and that guess is not available. "
  "Confidence is low.</i>",
  ],
},

"JKCEMENT": {
  "verdict": "HOLD — quality 69, fifth of 34, on capital returns that hold "
             "across both windows, against an operating margin that stepped "
             "down year on year, a trailing net change of -5.47% and book "
             "value first of 32",
  "confidence": "medium",
  "trigger": "the operating margin recovering above 17.94% with the trailing "
             "net change back positive -> the step was a cost year and the hold "
             "stands; a second year of margin step-down -> "
             "book value first of 32 is being paid for a record that "
             "has stopped",
  "evidence": ["roce_3y", "roce_5y", "ebitda_margin_3y", "opm_now", "pb"],
  "points": [
  "<b>Held — JKCEMENT is in your portfolio.</b> JK Cement sits in this "
  "platform's <code>cement</code> cluster at a market capitalisation of "
  "₹38,510.52cr, fifth of 34. " + VET + "Its own ten-year earnings band runs "
  "14.56-53.33x with an average of 33.65x, inside the five-times limit and "
  "usable to price the row. On the scorecard, quality 69 is fifth of 34, "
  "valuation 24 is 29th of 33, momentum 38 is 15th of 34 and composite 42 is "
  "20th of 33 — the quality reading is the one that stands out, and the price "
  "is what argues with it.",

  "<b>The capital returns and the ten-year record are both near the front of "
  "the bucket.</b> <code>roce_3y</code> 14.36% is fourth of 33 and "
  "<code>roce_5y</code> 13.54% is eighth of 33, with "
  "<code>ebitda_margin_3y</code> 22.38% at ninth of 33 and "
  "<code>ebitda_margin_5y</code> 21.75% at tenth of 34. "
  "<code>rev_cagr_5y</code> 14.47% is third of 32 and "
  "<code>np_consistency_10y</code> 1.684 is tenth of 34. "
  "<code>roe_avg_above_threshold_10y</code> 0.300 is tied fifth of 34 in a "
  "three-way tie spanning positions 5 to 7, "
  "<code>roe_avg_above_threshold_7y</code> 0.429 is tied second of 34 in a "
  "four-way tie spanning positions 2 to 5 and "
  "<code>roe_avg_above_threshold_5y</code> 0.200 is tied fourth of 34 in a "
  "seven-way tie spanning positions 4 to 10 — the average return on equity "
  "cleared the bar in three years out of ten. "
  "<code>np_growth_above_inflation_10y</code> 0.667 is tied third of 34 in a "
  "two-way tie spanning positions 3 to 4, "
  "<code>np_growth_above_inflation_7y</code> 0.667 is tied second of 34 in a "
  "six-way tie spanning positions 2 to 7 and "
  "<code>np_growth_above_inflation_5y</code> 0.750 is tied first of 34 in a "
  "two-way tie spanning positions 1 to 2: profit cleared inflation six times "
  "in nine comparisons, and three times in the most recent four. "
  "<code>asset_turnover</code> 0.742 is 13th of 33.",

  "<b>The margin stepped down and the trailing net line went negative.</b> " +
  STEPDOWN + "<code>opm_now</code> 16.21% is eighth of 33 against "
  "<code>opm_prev</code> 17.94% at sixth of 33, and "
  "<code>op_margin_trend_7y</code> -0.0097 is 18th of 33. " + THINREAD +
  "<code>ttm_np_pct</code> -5.47% is 20th of 27 and <code>ttm_op_pct</code> "
  "+4.74% is 19th of 28 against <code>ttm_sales_pct</code> +15.92% at ninth of "
  "33 — sales grew and neither profit line followed it. The pack raises no cash "
  "flag on this row and there is " + NOZERO + " in the ten annual rows: "
  "operating cash was ₹1,872.99cr in FY2026 against ₹2,378.71cr of operating "
  "profit, 0.787 of it, read against a prior-years mean of 0.880. "
  "<code>net_debt_ebitda</code> 2.448 is 12th of 31, and borrowings rose from "
  "₹3,317.12cr to ₹6,182.99cr across the ten annual rows while sales rose from "
  "₹4,010.50cr to ₹13,722.30cr.",

  "<b>Priced at the front of the bucket on book value, with the chart behind "
  "the year.</b> <code>pb</code> 5.472 is first of 32 and "
  "<code>ev_sales_ttm</code> 3.071 is fourth of 33, with "
  "<code>ev_ebitda_ttm</code> 14.804x at fifth of 31. " + THINREAD +
  "<code>pe_ttm</code> 40.73x is ninth of 27 and <code>div_yield</code> "
  "0.4013% is 16th of 23. <code>sales_yoy_q</code> +20.26% is eighth of 33 and "
  "<code>np_yoy_q</code> -14.47% is 16th of 34. The close held above its "
  "200-day EMA on 13.89% of the last 252 sessions, 14th of 32, while "
  "<code>ret_12m_rel</code> -15.50% is 13th of 33, <code>ret_6m_rel</code> "
  "-7.36% is 13th of 33 and <code>ret_3m_rel</code> -7.82% is 21st of 33. "
  "<code>fcf_yield</code> 1.90% is 21st of 34 and "
  "<code>capex_intensity_3y</code> 0.094 is 12th of 33. Ownership is "
  "institutional: <code>fii_pct</code> 16.85% is first of 31, down from "
  "17.71%, <code>dii_pct</code> 23.72% is third of 31, "
  "<code>promoter_pct</code> 45.66% is 27th of 34 and has barely moved from "
  "45.70%, and <code>shareholders</code> 80,353 is 12th of 34 on a public "
  "float of 13.76%. " + MOM93,

  "<i>JKCEMENT is a hold on quality that is measured rather than claimed: "
  "<code>roce_3y</code> 14.36% at fourth of 33, <code>roce_5y</code> 13.54% at "
  "eighth of 33, and a ten-year record that cleared inflation six times in "
  "nine comparisons. The price asks the full amount for it — <code>pb</code> "
  "5.472 is first of 32 — and the twelve months argued the other way: the "
  "operating margin stepped down from 17.94% to 16.21% and the trailing net "
  "change came in at -5.47%, the one negative trailing net reading in this "
  "batch. The band is usable and the row sits above the middle of it at "
  "40.73x. Nothing here needs a decision today; a second year of margin "
  "step-down would make one. Confidence is medium.</i>",
  ],
},

"NUVOCO": {
  "verdict": "HOLD — composite 70, 11th of 33, on a trailing net change of "
             "+153.65% against a trailing operating change of +23.22%, and a "
             "net-profit record that was negative in two years of the ten "
             "annual rows",
  "confidence": "low",
  "trigger": "a year where net profit is made at or below the operating line "
             "with the margin holding above 16% -> the trailing step is "
             "operating and the hold is an add; the reported profit falling "
             "back under ₹50cr -> the trailing year was the exception",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "net_debt_ebitda",
               "pe_ttm"],
  "points": [
  "<b>Held — NUVOCO is in your portfolio.</b> Nuvoco Vistas sits in this "
  "platform's <code>cement</code> cluster at a market capitalisation of "
  "₹11,921.86cr, ninth of 34. " + VET + "On the scorecard, quality 48 is tied "
  "22nd of 34 in a two-way tie spanning positions 22 to 23, valuation 61 is "
  "tied 14th of 33 in a two-way tie spanning positions 14 to 15, momentum 50 "
  "is 11th of 34 and composite 70 is 11th of 33. Valuation here is scored on "
  "90 points rather than the declared 100, the missing 10 being a yield this "
  "row does not pay. " + BANDWIDE,

  "<b>The margin went up and the return on the capital stayed near the back of "
  "the bucket.</b> <code>opm_now</code> 16.44% is seventh of 33 against "
  "<code>opm_prev</code> 14.61% at 11th of 33, with "
  "<code>ebitda_margin_3y</code> 23.17% at seventh of 33 and "
  "<code>ebitda_margin_5y</code> 23.18% at eighth of 34. Against that, "
  "<code>roce_3y</code> 5.39% is 23rd of 33 and <code>roce_5y</code> 3.90% is "
  "25th of 33, and <code>op_margin_trend_7y</code> -0.0078 is 12th of 33. The "
  "reported profit is why: net profit across the ten annual rows ran "
  "₹165.67cr, ₹158.07cr, minus ₹26.49cr, ₹249.26cr, minus ₹25.95cr, ₹32.08cr, "
  "₹15.86cr, ₹147.37cr, ₹21.84cr and ₹359.35cr — negative in two years of the "
  "ten and under ₹50cr in three more — while sales rose from ₹5,156.98cr to "
  "₹11,338.29cr and operating profit from ₹728.37cr to ₹1,857.37cr. "
  "<code>np_consistency_10y</code> 1.274 is 23rd of 34 and "
  "<code>rev_cagr_5y</code> 5.03% is 18th of 32.",

  "<b>The trailing net change is not an operating change.</b> " + BELOWEBIT +
  THINREAD + "<code>ttm_np_pct</code> +153.65% is third of 27 against "
  "<code>ttm_op_pct</code> +23.22% at 11th of 28 and "
  "<code>ttm_sales_pct</code> +9.45% at 16th of 33, and <code>pe_ttm</code> "
  "30.89x is 13th of 27 divided into that base. There is " + NOZERO + " in the "
  "ten annual rows: operating cash was ₹1,485.17cr in FY2026 against "
  "₹1,857.37cr of operating profit, 0.800 of it, read against a prior-years "
  "mean of 1.043 — below its own history and still positive. "
  "<code>net_debt_ebitda</code> 2.528 is 11th of 31; borrowings ran "
  "₹4,314.38cr at the start of the window, peaked at ₹7,791.66cr and stand at "
  "₹4,916.10cr. <code>fcf_yield</code> 7.84% is 13th of 34 and "
  "<code>capex_intensity_3y</code> 0.046 is 17th of 33.",

  "<b>The chart is mid-pack on the year and the promoter has not moved in nine "
  "periods.</b> <code>pb</code> 1.276 is 17th of 32, "
  "<code>ev_ebitda_ttm</code> 5.9996x is 22nd of 31 and "
  "<code>ev_sales_ttm</code> 1.444 is 16th of 33. <code>sales_yoy_q</code> "
  "+8.91% is 16th of 33 and <code>np_yoy_q</code> +19.98% is 11th of 34. The "
  "close held above its 200-day EMA on 16.27% of the last 252 sessions, 12th "
  "of 32, while <code>ret_12m_rel</code> -12.76% is tenth of 33, "
  "<code>ret_6m_rel</code> +21.89% is fifth of 33 and <code>ret_3m_rel</code> "
  "+0.47% is seventh of 33 — the six-month reading is ahead of the cohort and "
  "the twelve-month one is behind it. <code>promoter_pct</code> 72.02% is "
  "seventh of 34 and has not changed across any of the nine periods the pack "
  "holds, <code>fii_pct</code> 4.71% is 14th of 31 and has risen from 3.50%, "
  "<code>dii_pct</code> 18.00% is ninth of 31, and <code>shareholders</code> "
  "179,030 is fifth of 34, down from 219,934, on a public float of 5.27%. " +
  MOM93,

  "<i>NUVOCO is a hold on a composite of 70, 11th of 33, that is built mostly "
  "on the trailing year: the net change of +153.65% is six times the operating "
  "change of +23.22%, and the pack flags the row for earnings made below the "
  "operating line. Valuation 61 is scored on 90 points rather than the "
  "declared 100, the missing 10 being a yield this row does not pay. What is "
  "solid underneath: <code>opm_now</code> 16.44% at seventh of 33, "
  "<code>ebitda_margin_3y</code> 23.17% at seventh of 33, " + NOZERO + " in "
  "the record, and a promoter holding of 72.02% that has not moved across any "
  "of the nine periods the pack holds. What is not: <code>roce_3y</code> 5.39% "
  "at 23rd of 33 on a profit record that was negative in two years of the ten "
  "annual rows. The hold is on the operating line, not on the reported "
  "earnings. Confidence is low.</i>",
  ],
},

"RAMCOIND": {
  "verdict": "WATCH — valuation 64, tenth of 33, on 7.98x trailing earnings "
             "made mostly below the operating line: net profit exceeded "
             "operating profit in eight years of the ten annual rows",
  "confidence": "low",
  "trigger": "a year where operating profit exceeds net profit with the "
             "operating margin holding above 14% -> the cheapness is real and "
             "the row becomes a buy candidate; the gap widening again -> the "
             "multiple is pricing someone else's earnings",
  "evidence": ["roce_3y", "ebitda_margin_3y", "opm_now", "asset_turnover",
               "np_consistency_10y"],
  "points": [
  "<b>Not held — RAMCOIND is on your watchlist.</b> Ramco Industries sits in "
  "this platform's <code>cement</code> cluster at a market capitalisation of "
  "₹2,610.02cr, 17th of 34, and is filed under Other Construction Materials "
  "rather than cement itself. " + VET + "Its own ten-year earnings band runs "
  "5.84-16.51x with an average of 9.47x, inside the five-times limit and "
  "usable to price the row. On the scorecard, composite 79 is eighth of 33, "
  "valuation 64 is tenth of 33, momentum 55 is seventh of 34 and quality 50 is "
  "19th of 34.",

  "<b>The earnings the multiple divides into were not made by the "
  "operations.</b> " + BELOWANN + THINREAD + "<code>pe_ttm</code> 7.976x is "
  "26th of 27, and the annual rows are why that is not a bargain: net profit "
  "ran ₹204.76cr, ₹176.02cr, ₹172.35cr, ₹169.53cr, ₹278.75cr, ₹302.85cr, "
  "₹124.00cr, ₹105.71cr, ₹180.91cr and ₹306.26cr against operating profit that "
  "went from ₹117.19cr to ₹232.61cr, so in eight years of the ten the reported "
  "profit was larger than what the operations made. <code>div_yield</code> "
  "0.0042% is 23rd of 23 and <code>fcf_yield</code> 6.01% is 15th of 34.",

  "<b>Capital returns near the back of the bucket on a profit record that is "
  "consistent.</b> <code>roce_3y</code> 3.76% is 25th of 33 and "
  "<code>roce_5y</code> 3.95% is 24th of 33, with "
  "<code>ebitda_margin_3y</code> 13.61% at 23rd of 33 and "
  "<code>ebitda_margin_5y</code> 14.26% at 23rd of 34. "
  "<code>opm_now</code> 14.38% is 12th of 33 against <code>opm_prev</code> "
  "11.53% at 16th of 33, and <code>op_margin_trend_7y</code> -0.0031 is "
  "seventh of 33 — the margin stepped up in the trailing twelve months against "
  "a seven-year drift that is close to flat. <code>np_consistency_10y</code> "
  "1.750 is third of 34 and <code>np_growth_above_inflation_7y</code> 0.667 is "
  "tied second of 34 in a six-way tie spanning positions 2 to 7: profit "
  "cleared inflation four times in six comparisons. "
  "<code>asset_turnover</code> 0.360 is 28th of 33 and "
  "<code>rev_cagr_5y</code> 5.26% is 16th of 32, with sales rising from "
  "₹880.76cr to ₹1,792.22cr across the ten annual rows.",

  "<b>The cash collected ahead of its own history and the chart is ahead of "
  "the cohort.</b> Operating cash was negative in one year of the ten "
  "annual rows, FY2023 at minus ₹43.30cr; FY2026 collected ₹200.97cr against "
  "₹232.61cr of operating profit, 0.864 of it, read against a prior-years mean "
  "of 0.427. <code>net_debt_ebitda</code> 0.075 is 26th of 31 — effectively no "
  "net debt — with borrowings down from ₹336.13cr to ₹171.47cr across the "
  "window, and <code>capex_intensity_3y</code> -0.00065 is 27th of 33. " +
  THINREAD + "<code>ttm_op_pct</code> +41.46% is fourth of 28, "
  "<code>ttm_np_pct</code> +57.99% is ninth of 27 and "
  "<code>ttm_sales_pct</code> +13.43% is 11th of 33, with "
  "<code>sales_yoy_q</code> +15.48% at 12th of 33 and <code>np_yoy_q</code> "
  "+31.94% at eighth of 34. The close held above its 200-day EMA on 64.29% of "
  "the last 252 sessions, third of 32, while <code>ret_12m_rel</code> -8.48% "
  "is seventh of 33, <code>ret_6m_rel</code> +18.57% is sixth of 33 and "
  "<code>ret_3m_rel</code> -2.18% is 12th of 33. <code>pb</code> 0.577 is 30th "
  "of 32 and <code>ev_sales_ttm</code> 1.404 is 17th of 33, with "
  "<code>ev_ebitda_ttm</code> 8.582x at 16th of 31. Ownership: "
  "<code>promoter_pct</code> 54.84% is 21st of 34, <code>fii_pct</code> 1.00% "
  "is 23rd of 31, <code>dii_pct</code> 3.35% is 17th of 31 and down from "
  "4.19%, and <code>shareholders</code> 31,622 is 26th of 34 on a public float "
  "of 40.81%. " + MOM93,

  "<i>RAMCOIND is a watch rather than a buy because the cheapness and the "
  "quality point in opposite directions. The price is low on every reading — a "
  "trailing multiple of 7.98x, <code>pb</code> 0.577 at 30th of 32, and a "
  "balance sheet with <code>net_debt_ebitda</code> 0.075 at 26th of 31 — and "
  "the earnings it divides into were larger than operating profit in eight "
  "years of the ten annual rows, so most of what makes the multiple cheap was "
  "not made by the operations. <code>roce_3y</code> 3.76% at 25th of 33 is the "
  "same fact arriving from the capital side. The chart has noticed something: "
  "the close held above its 200-day EMA on 64.29% of the last 252 sessions, "
  "third of 32. What would change this is a year in which the operating line "
  "makes the profit. Confidence is low.</i>",
  ],
},

"SAHYADRI": {
  "verdict": "WATCH — composite 100, first of 33, on an operating profit of "
             "₹61.11cr against ₹100.15cr four years ago, a cash year that "
             "collected twice it, and a register of 10,467 holders",
  "confidence": "low",
  "trigger": "operating profit back above ₹90cr with the cash ratio settling "
             "near 1.0 -> the composite is measuring a real recovery; "
             "operating cash falling back under ₹60cr -> FY2026 was a "
             "working-capital year and the whole scorecard was priced off it",
  "evidence": ["asset_turnover", "roce_5y", "opm_now", "fcf_yield",
               "np_consistency_10y"],
  "points": [
  "<b>Not held — SAHYADRI is on your watchlist.</b> Sahyadri Industries sits "
  "in this platform's <code>cement</code> cluster at a market capitalisation "
  "of ₹356.30cr, 29th of 34, with <code>shareholders</code> 10,467 at 34th of "
  "34 and <code>promoter_pct</code> 71.12% at eighth of 34, unchanged across "
  "all nine periods the pack holds. " + VET + "On the scorecard, composite 100 "
  "is first of 33, valuation 89 is first of 33, momentum 76 is first of 34 and "
  "quality 59 is tied 11th of 34 in a two-way tie spanning positions 11 to 12 "
  "— first on three pillars of the four, from the smallest register in the "
  "bucket. " + BANDWIDE,

  "<b>The operating profit is lower than it was four years ago.</b> Operating "
  "profit across the ten annual rows ran ₹42.69cr, ₹64.42cr, ₹69.03cr, "
  "₹46.40cr, ₹91.90cr, ₹100.15cr, ₹81.03cr, ₹66.44cr, ₹54.46cr and ₹61.11cr — "
  "FY2022 is the peak and the trailing year is ₹39.04cr below it — while sales "
  "rose from ₹252.80cr to ₹678.73cr. <code>op_margin_trend_7y</code> -0.0182 "
  "is 26th of 33, which is that drift as a rank. Against it, "
  "<code>opm_now</code> 11.05% is 18th of 33 and <code>opm_prev</code> 8.36% "
  "is 22nd of 33, so the trailing twelve months stepped the margin back up. "
  "<code>roce_5y</code> 12.68% is 12th of 33 and <code>roce_3y</code> 9.00% is "
  "16th of 33 — the five-year reading sits above the three-year one, the same "
  "fact again. <code>asset_turnover</code> 1.276 is first of 33 and "
  "<code>ebitda_margin_3y</code> 13.33% is 24th of 33 with "
  "<code>ebitda_margin_5y</code> 15.76% at 21st of 34: it turns its assets "
  "faster than any peer here and earns a thin margin doing it. "
  "<code>roe_avg_above_threshold_10y</code> 0.400 is tied second of 34 in a "
  "three-way tie spanning positions 2 to 4, "
  "<code>roe_avg_above_threshold_7y</code> 0.286 is tied sixth of 34 in a "
  "four-way tie spanning positions 6 to 9 and "
  "<code>roe_avg_above_threshold_5y</code> 0.200 is tied fourth of 34 in a "
  "seven-way tie spanning positions 4 to 10 — the average return on equity "
  "cleared the bar in four years out of ten. "
  "<code>np_growth_above_inflation_7y</code> 0.333 is tied 23rd of 34 in a "
  "ten-way tie spanning positions 23 to 32 and "
  "<code>np_growth_above_inflation_5y</code> 0.250 is tied 23rd of 34 in an "
  "eleven-way tie spanning positions 23 to 33.",

  "<b>The cash year the scorecard is priced off is a working-capital "
  "release.</b> " + CASHUP + "There is " + NOZERO + " in the ten annual rows, "
  "and the two years before this one collected ₹57.81cr and ₹53.89cr — "
  "₹121.34cr is more than twice either of them. <code>fcf_yield</code> 21.61% "
  "is third of 34 and <code>net_debt_ebitda</code> 0.114 is 24th of 31, with "
  "<code>capex_intensity_3y</code> 0.0013 at 26th of 33: the row is not "
  "spending, which is the other half of why the free cash reads the way it "
  "does. Net profit across the window went from ₹3.00cr to ₹29.00cr, with "
  "₹61.82cr in FY2022, and <code>np_consistency_10y</code> 1.653 is 14th of "
  "34.",

  "<b>The cheapest trailing multiple in the bucket, on earnings made partly "
  "below the operating line.</b> " + BELOWEBIT + THINREAD +
  "<code>pe_ttm</code> 7.962x is 27th of 27, <code>ttm_np_pct</code> +152.40% "
  "is fourth of 27 against <code>ttm_op_pct</code> +58.61% at second of 28 and "
  "<code>ttm_sales_pct</code> +19.93% at fifth of 33, and "
  "<code>div_yield</code> 0.4603% is 14th of 23. <code>ev_sales_ttm</code> "
  "0.506 is 32nd of 33, <code>ev_ebitda_ttm</code> 3.4998x is 30th of 31 and "
  "<code>pb</code> 0.877 is 25th of 32 — cheap on every price reading the pack "
  "carries. <code>sales_yoy_q</code> +20.51% is seventh of 33 and "
  "<code>np_yoy_q</code> +146.24% is fourth of 34. The chart has run: "
  "<code>ret_12m_rel</code> +41.55% is second of 33, <code>ret_6m_rel</code> "
  "+43.23% is second of 33 and <code>ret_3m_rel</code> +28.80% is second of "
  "33, with the close above its 200-day EMA on 49.60% of the last 252 "
  "sessions, fifth of 32 — second on all three return windows and only half "
  "the year spent above the average, so the move is recent. There are no "
  "institutions here: <code>fii_pct</code> 0.01% is 29th of 31 and "
  "<code>dii_pct</code> 0.01% is 30th of 31, on a public float of 28.86%. " +
  MOM93,

  "<i>SAHYADRI is a watch and not a buy, because the composite of 100, first "
  "of 33, is measuring one year. The operating profit of ₹61.11cr is below the "
  "₹100.15cr of FY2022, <code>op_margin_trend_7y</code> -0.0182 is 26th of 33, "
  "and the cash that makes <code>fcf_yield</code> 21.61% read third of 34 came "
  "in at 1.986 times operating profit against a prior-years mean of 0.543 — a "
  "working-capital release inside one year. What is real: "
  "<code>asset_turnover</code> 1.276 at first of 33, " + NOZERO + " in the "
  "record, borrowings down from ₹78.39cr to ₹16.59cr, and a promoter holding "
  "that has not moved. What makes it unownable at size: "
  "<code>shareholders</code> 10,467 at 34th "
  "of 34 and effectively no institutional presence, so the price is set by a "
  "register too small to exit into. Confidence is low.</i>",
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
        sranks = pr.get("scores") or {}
        annual = p.get("annual") or []
        eq = p.get("earnings_quality") or {}

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. One tier in this batch, so the sentence is uniform — and the
        #    stated count has to be the bucket the scorer used.
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
        stated = re.search(r"[Pp]eered against (\d+) peers", p0)
        if not stated:
            errs.append(f"{sym}: point one states no cohort size")
        elif int(stated.group(1)) != n:
            errs.append(f"{sym}: point one says {stated.group(1)} peers, "
                        f"peer_ranks says {n}")

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
            if "tech_net_score_scaled" in pt and MOM93 not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside MOM93")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. CHOICE 12. Thirteen sessions of delivery data is a print, not a
        #    series. Naming the absence is allowed; a figure beside it is not.
        for pt in allprose:
            if "delivery_pct" in pt:
                errs.append(f"{sym}: names delivery_pct, a 13-session print")
            for m in re.finditer(r"deliver", pt, re.I):
                win = pt[max(0, m.start() - 60):m.end() + 90]
                if re.search(r"\d+(?:\.\d+)?\s*%", win):
                    errs.append(f"{sym}: quotes a figure beside delivery off "
                                f"{(p.get('delivery') or {}).get('sessions')} "
                                f"sessions")

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

        # 9. CHOICE 3, three-valued: absent / wide / usable. Three of these
        #    five bands are more than BAND_RATIO_MAX wide, so the rows with a
        #    usable band must state it correctly — otherwise the ban quietly
        #    becomes "nobody quotes a band".
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
                                f"not a metric of this row")
                elif live[k] is None:
                    errs.append(f"{sym}: point {i + 1} names <code>{k}</code>, "
                                f"NULL in the pack")

        # 11. CHOICE 7 and CHOICE 8. The cash claim is made on the count of
        #     negative operating-cash years and the count is recomputed. One
        #     row is flagged and its prior-years mean is itself negative, so
        #     nothing on it fell from a level: the word "deterioration" is
        #     banned on EVERY row this batch rather than reserved for one.
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
        if phrase not in joined:
            errs.append(f"{sym}: no point states the cash count ('{phrase}')")
        gotr = eq.get("cfo_op_latest")
        if gotr is None or abs(float(gotr) - want_ratio) > 0.0005:
            errs.append(f"{sym}: CASHYRS says cfo_op_latest={want_ratio}, "
                        f"pack says {gotr}")
        cashflags = [f for f in (eq.get("flags") or [])
                     if "cash conversion" in f]
        if sym in CASH_FLAGGED:
            if not cashflags:
                errs.append(f"{sym}: in CASH_FLAGGED but the pack now carries "
                            f"no cash-conversion flag")
            if CASHFLAG not in joined:
                errs.append(f"{sym}: flagged on cash but carries no CASHFLAG")
            pm = eq.get("cfo_op_prior_mean")
            if pm is None or pm >= 0:
                errs.append(f"{sym}: CASHFLAG reads the ratio against a "
                            f"negative prior mean, the pack says {pm}")
            elif f"{pm}" not in CASHFLAG:
                errs.append(f"{sym}: CASHFLAG states a prior mean the pack "
                            f"does not carry ({pm})")
        else:
            if cashflags:
                errs.append(f"{sym}: pack carries {len(cashflags)} "
                            f"cash-conversion flag(s), not in CASH_FLAGGED")
            if CASHFLAG in joined:
                errs.append(f"{sym}: carries CASHFLAG with no flag")
        # the segment refusal travels with the flagged row and nowhere else
        if sym == SEGMENT_SYM:
            if SEGMENT not in joined:
                errs.append(f"{sym}: carries no SEGMENT refusal")
            bs = " ".join(str(x) for x in (p.get("overview") or {}).values())
            for w in SEGMENT_WORDS:
                if w.lower() not in bs.lower():
                    errs.append(f"{sym}: SEGMENT names '{w}', absent from the "
                                f"pack's business_summary")
                if w.lower() not in SEGMENT.lower():
                    errs.append(f"{sym}: SEGMENT_WORDS has '{w}' but SEGMENT "
                                f"does not say it")
        elif SEGMENT in joined:
            errs.append(f"{sym}: carries SEGMENT, which belongs to "
                        f"{SEGMENT_SYM}")
        # and the other direction: a collection ratio above 1.0 is a release
        if sym == CASHUP_SYM:
            if gotr is None or float(gotr) <= 1.0:
                errs.append(f"{sym}: CASHUP_SYM but cfo_op_latest is {gotr}, "
                            f"not above 1.0")
            if CASHUP not in joined:
                errs.append(f"{sym}: collects {gotr} of operating profit and "
                            f"carries no CASHUP sentence")
        else:
            if gotr is not None and float(gotr) > 1.0:
                errs.append(f"{sym}: collects {gotr} of operating profit but "
                            f"is not CASHUP_SYM")
            if CASHUP in joined:
                errs.append(f"{sym}: carries CASHUP, which belongs to "
                            f"{CASHUP_SYM}")
        said = [i + 1 for i, pt in enumerate(allprose)
                if re.search(r"deteriorat", pt, re.I)]
        if said:
            errs.append(f"{sym}: block(s) {said} call a cash number a "
                        f"deterioration; the flagged row's prior-years mean "
                        f"is itself negative, so the word is refused batch-wide")

        # 12. Every row's TTM window is the same quarter pair here, so a rerun
        #     that moves one off the batch has to fail rather than leave four
        #     rows silently incomparable.
        win = (p.get("ttm_vs_prior") or {}).get("window")
        if win != WINDOW_BATCH:
            errs.append(f"{sym}: TTM window {win} is not the batch window "
                        f"{WINDOW_BATCH} and no point says so")

        # 13. CHOICE 1, and the one this batch turns on. A rank whose own tie
        #     group covers more than 1/TIE_DIVISOR of the bucket is not a
        #     rank — it is a sort order over identical values, and this cluster
        #     has three-valued track-record metrics where 16 to 24 rows share
        #     one number. Those are banned outright. A smaller tie is allowed
        #     and must say so IMMEDIATELY after the figure, naming the span:
        #     a character window false-fires the moment a non-tied figure and
        #     a tied one share a sentence, which point one does on three rows.
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
                span = (f"positions {d['tie_span'][0]} to "
                        f"{d['tie_span'][1]}")
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

        # the pillar half: the figure is a bare number beside an English word,
        # and the headline writes it with a comma where a point writes "is".
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

        # 14. CHOICE 10. The bucket's thinnest reading is 23, so a denominator
        #     under it is fabricated or carried in from another cluster.
        for pt in allprose:
            for d2 in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                if int(d2) < DENOM_FLOOR:
                    errs.append(f"{sym}: states a denominator of {d2}; "
                                f"nothing ranked against this bucket is read "
                                f"by fewer than {DENOM_FLOOR} peers")

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
                errs.append(f"{sym}: is NOVERDICT_SYM but point one carries "
                            f"no explanation")
            if "no verdict" in v["verdict"]:
                errs.append(f"{sym}: headline says 'no verdict' but point one "
                            f"carries no explanation")

        # 16. CHOICE 9. MOM93 exactly once per row — 93, not 96: this cluster
        #     gives tech_net_score_scaled 7 of momentum's 100 points.
        if sym in MOM93_SYMS:
            got = sum(MOM93 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM93 appears {got}x in the points, "
                            f"expected exactly 1")

        # 17. CHOICE 11. ema_stack_bull is tied 31 ways on the zero reading.
        #     Banned, not caveated.
        for pt in allprose:
            if EMAFLAT in pt:
                errs.append(f"{sym}: names {EMAFLAT}, tied across most of the "
                            f"cohort on either reading")

        # 18. The half guard 10 cannot see. These phrases resolve, in the
        #     ranks checker's own vocabulary, to columns this cluster does not
        #     carry — so a sentence lifted from realty or bfsi reads perfectly
        #     and attributes its rank to nothing.
        scrub = joined + " " + v["trigger"] + " " + v["verdict"]
        for ex in PHRASE_EXEMPT:
            scrub = scrub.replace(ex, " ")
        low = scrub.lower()
        for ph in BANNED_PHRASES:
            if ph.lower() in low:
                errs.append(f"{sym}: prose says '{ph}', which names a column "
                            f"cement does not carry")

        # 19. No figure for a metric that is NULL on this row.
        for key, word in (("promoter_pct", r"promoter"),
                          ("dii_pct", r"domestic institution|\bDII\b")):
            if live.get(key) is None and any(
                    re.search(word, pt) for pt in allprose):
                errs.append(f"{sym}: names {key} in the prose but it is NULL "
                            f"in the pack")

        # 20. CHOICE 10. Four readings sit on part of the bucket, so a rank on
        #     any of them places the row among those peers. Allowed, but only
        #     with THINREAD in the SAME point — and the counts are recomputed,
        #     so a snapshot that fills them in fails the build and tells me to
        #     rewrite the caveat rather than leaving a stale one.
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

        # 21. CHOICE 9. A pillar percentile computed on part of its declared
        #     weight may be quoted only alongside what is missing underneath.
        #     Unlike MOM93 this is NOT uniform, so the renormalisation sits in
        #     the SAME point and the figure is banned from headline and trigger.
        for pillar, phr in PILLAR_WEIGHT.get(sym, []):
            rx = re.compile(rf"\b{pillar}\s+(?:of\s+)?\d+", re.I)
            for i, pt in enumerate(pts):
                m = rx.search(pt)
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
        cw = ((p.get("scores") or {}).get("pillar_coverage")
              or (p.get("scores") or {}).get("coverage") or {})
        for pillar, _phr in PILLAR_WEIGHT.get(sym, []):
            got = (cw.get(pillar) or {}).get("covered_weight") \
                if isinstance(cw.get(pillar), dict) else None
            if got is not None and got >= 100:
                errs.append(f"{sym}: PILLAR_WEIGHT caveats {pillar} but the "
                            f"pack now covers {got} of 100 — drop the caveat")

        # 22. CHOICE 6. Four rows stepped the operating margin up and one
        #     stepped it down, so the step is stated with its direction and
        #     its sign is recomputed. A constant that drifts onto the wrong
        #     row is the failure this catches.
        step = eq.get("opm_step")
        if sym in STEPDOWN_SYMS:
            if step is None or float(step) >= 0:
                errs.append(f"{sym}: in STEPDOWN_SYMS but opm_step is {step}")
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

        # 23. CHOICE 5. The trailing below-EBIT flag does not catch a row
        #     whose WHOLE RECORD is made below the operating line. The count
        #     is recomputed from the annual rows, so a restated history moves
        #     the claim rather than leaving it stale.
        pairs = [r for r in annual
                 if r.get("net_profit") is not None
                 and r.get("operating_profit") is not None]
        above = sum(1 for r in pairs
                    if r["net_profit"] > r["operating_profit"])
        if sym == BELOWANN_SYM:
            if above != 8:
                errs.append(f"{sym}: BELOWANN says net profit outran "
                            f"operating profit in eight years, the annual "
                            f"rows say {above} of {len(pairs)}")
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
            if above >= 8:
                errs.append(f"{sym}: net profit outran operating profit in "
                            f"{above} of {len(pairs)} annual rows but the row "
                            f"is not BELOWANN_SYM")
            if BELOWANN in joined:
                errs.append(f"{sym}: carries BELOWANN, which belongs to "
                            f"{BELOWANN_SYM}")

        # 26. CHOICE 4. Two rows carry the pack's below-EBIT flag. A PE or a
        #     trailing net figure on that base is not a figure on operations,
        #     so BELOWEBIT sits in the SAME point as either — and the gap is
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
