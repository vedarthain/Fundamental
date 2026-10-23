#!/usr/bin/env python3
"""realty — 7 tracked names. Generator + the guards that back it.

Run:
    etl/.venv/bin/python build/verdicts/mk_realty_7.py
Then, and do not skip either:
    scripts/verdict-check.py       /tmp/realty7.json <OUT>
    scripts/verdict-ranks-check.py --verdicts <OUT> --pack /tmp/realty7.json

CHOICE 1 — the instrument, before the finding. Five of these seven rows carry
an earnings-quality blocker phrased as a RATIO: "cash conversion fell to 0.20
from a prior-years mean of 0.90". In a residential developer that ratio is
close to useless, because its denominator is a single year of operating profit
and a developer's operating profit is lumpy by construction. ASHIANA proves
it: its "prior-years mean" of 38.789 is the average of four annual ratios, one
of which is FY2021 — ₹121.13cr of operating cash against ₹0.87cr of operating
profit, a ratio of 139. Reading the blocker literally says ASHIANA's cash
collapsed from 38x to 2.6x. Reading the cash flow statement says ASHIANA
collected ₹342.19cr in FY2026 against ₹129.51cr of operating profit, the
largest operating cash figure in its ten-year record. The blocker is arithmetic
about a near-zero denominator.

So every cash claim in this batch is made on the COUNT OF YEARS with negative
operating cash out of the ten in the pack, which has no denominator problem,
and the FY2026 ratio is quoted only as a level beside it. CASHYRS holds the
counts and guard 11 checks them against the pack's own annual rows, so a rerun
that changes a year fails the build rather than leaving the prose stale.

The counts are the batch: PHOENIXLTD has no negative year in ten, LODHA one,
OBEROIRLTY three, ASHIANA four, MARATHON four, ARVSMART six, and SIL's problem
is not cash at all — its OPERATING PROFIT is negative in nine years out of the
ten.

CHOICE 2 — therefore only three rows may use the word "deterioration", and the
two that may not are forbidden for two DIFFERENT reasons, which is why guard 11
stores a reason rather than a boolean. ASHIANA is forbidden because its prior
mean is an artefact (CHOICE 1). SIL is forbidden because its only cash-
conversion reading in the pack is FY2022 — four years stale — and it has no
prior mean at all. ARVSMART, LODHA and MARATHON are permitted, and each is
permitted on the record rather than on the ratio: ARVSMART has run negative in
six years of ten, MARATHON in the last two consecutively while net profit set a
record, and LODHA's operating cash fell from ₹2,750.0cr to ₹959.3cr across
three years in which operating profit rose from ₹2,063.9cr to ₹4,923.0cr.

CHOICE 3 — the PE band is banned as an anchor wherever its own high is more
than five times its own low. A band of 23.85-783.11x does not locate a price;
it records that the earnings denominator went near zero in some year. That
bans ARVSMART (76.12/6.11 = 12.5x), ASHIANA (32.8x), PHOENIXLTD (13.4x) and
SIL (97x), leaving LODHA (3.7x, n=5), MARATHON (4.3x) and OBEROIRLTY (2.3x) as
the only three rows whose own history is allowed to price them. Guard 9 enforces
both halves: the three usable rows must state the band correctly, and the four
banned rows must carry BANDWIDE and may not quote a band figure at all. This is
new — every earlier batch treated the band as free evidence.

CHOICE 4 — this is the first cluster whose METRIC FAMILY differs, not just its
key set per tier. realty carries `cfo_sales_3y`, `roe_3y`, `debt_equity` and
`inv_days`, and carries NONE of `cfo_pat_3y`, `roce_3y`, `roce_5y`, `wc_days`,
`dso`, `asset_turnover`, `capex_intensity_3y`, `peg`, `ev_sales_ttm` or any
`op_margin_trend` variant. Guard 10's <code> check cannot see this, because the
danger is plain English: "cash conversion" resolves to cfo_pat_3y and "return
on capital" to roce_3y in the ranks checker's own vocabulary, and both columns
are absent here. A sentence lifted from chemicals_agro would read perfectly and
attribute its rank to a column this cluster does not have. Guard 18 bans the
phrases outright.

CHOICE 5 — SIL is `WATCH — no verdict`, and it is the clearest case the format
has had. Its composite is 91 at seventh of 65 and its valuation 86 at fourth of
67, both built on an operating margin that went from -37.3% to +34.8% in one
year, `ttm_op_pct` and `ttm_np_pct` both NULL, `np_cagr_5y` NULL, `rev_cagr_5y`
-47.07% at 68th of 70, `roe_3y` -9.45% at 61st of 66, operating profit negative
in nine years out of ten, a ₹106cr market capitalisation at 57th of 72, and an
overview that calls it an investment-holding company. The valuation percentile
is measuring a price against earnings that do not exist.

CHOICE 6 — PHOENIXLTD is the structural outlier and the batch's most useful
comparison. `op_margin_3y` 57.15% is first of 70 and `inv_days` 64.14 is 66th
of 70, which in a cohort of residential developers means it is barely one: a
retail-led landlord collecting lease rentals, scored against companies that
hold four years of work-in-progress. Its quality 75 at fourth of 71 is earned
by not being in the same business. Stated once, on its own row and on the two
rows it is used against, rather than left for the reader to infer.

CHOICE 7 — margin steps, and what they contaminate. Three rows carry a one-year
operating-margin step the pack itself flags: ARVSMART 24.4% -> 36.8%, ASHIANA
5.0% -> 13.1%, SIL -37.3% -> 34.8%. Every TTM growth figure on those rows is
computed on the stepped base, so ASHIANA's `ttm_np_pct` +224.97% at third of 48
is the step, not a business tripling. Guard 13 requires the STEP sentence in
any point that quotes a TTM growth figure on those three rows.

CHOICE 8 — one cohort this time. All seven are realty/veteran, n=72, basis
cluster_tier, every row `full`. The thinnest metric in the cluster is
`div_yield` at 27 readings, so there is no 9-reading floor to apply here and
guard 14 asserts the opposite: no denominator under 27 appears anywhere, which
catches a fabricated or copied rank rather than a thin one.

CHOICE 9 — `tech_net_score_scaled` is NULL for all 3,178 rows again, so every
momentum percentile is scored on 95 of a declared 100. Uniform, so one shared
sentence and the headline may still quote the percentile. ASHIANA and SIL
additionally lose 7.2 of quality's 100 points to a missing `np_cagr_5y`, which
is NOT uniform and gets the same-point treatment and a headline ban.

CHOICE 10 — `ema_stack_bull` is 0.000 for all seven, tied ninth of 64 in a
56-way tie spanning positions 9 to 64. A rank shared by 56 names is not a rank.
Banned from the prose outright (guard 17) rather than quoted with a caveat,
because a caveat printed beside a number loses to the number.

CHOICE 11 — OBEROIRLTY is the only held row and the only one whose TTM window
is ['2025-12-31', '2026-09-30']; the other six end at 2026-06-30. Its TTM
figures are one quarter ahead of the rest of the batch and are not comparable
across rows. WINDOW says so on the row that needs it, and guard 12 checks the
window against the pack.

CHOICE 12 — two ownership events worth more than their ranks. MARATHON's
promoter holding fell 73.63% -> 55.93% in the September 2025 quarter while FII
went 0.94% -> 6.89% and DII 2.31% -> 15.59%, with public barely moving: the
promoter sold into institutions. ARVSMART went the other way, 49.83% -> 53.83%
in March 2026 while DII fell 15.82% -> 8.60%. Neither is visible in the
single-period `promoter_pct` rank the scorer uses, so both are stated from the
shareholding series.
"""
import json
import re

PACK = "/tmp/realty7.json"
OUT = "build/verdicts/realty-7-verdicts.json"
SOURCE_REPORT = "realty — 7 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

HELD = {"OBEROIRLTY"}
EMIT = {"ARVSMART", "ASHIANA", "LODHA", "MARATHON", "OBEROIRLTY",
        "PHOENIXLTD", "SIL"}

# CHOICE 8. One bucket, 72 names, every row `full`.
VET = ("Peered against 72 veteran-tier peers inside <code>realty</code> — the "
       "scorer's bucket is (cluster, maturity tier), this one clears the "
       "10-peer floor with room to spare, and the row is badged "
       "<code>full</code>. Every denominator below is the metric's own reading "
       "count, not 72; the thinnest metric in this cluster is read by 27 of "
       "them. ")

TIER_SENTENCE = {"veteran": VET}

# CHOICE 1. The instrument, stated once on every row that makes a cash claim.
CASH = ("A word on how the cash claim below is measured, because the pack's own "
        "flag is unreliable here. The blocker divides one year of operating "
        "cash by one year of operating profit, and a residential developer's "
        "operating profit is lumpy by construction, so the ratio swings on its "
        "denominator rather than on the business. The claim below is therefore "
        "made on the count of years with negative operating cash across the "
        "ten in the pack, and the latest ratio is quoted beside it as a level "
        "rather than as a trend. ")

# CHOICE 2. Permitted only where the ten-year record supports the word.
DETERIORATION = ("This row is among the rows in this batch where the word "
                 "deterioration is earned on the record and not just on the "
                 "ratio. ")

# CHOICE 2, first forbidden reason. ASHIANA only.
ARTEFACT = ("The flag on this row should be ignored, and that is a claim worth "
            "making precisely. Its stated prior-years mean of 38.789 averages "
            "four annual ratios, one of which is FY2021: ₹121.13cr of "
            "operating cash against ₹0.87cr of operating profit, a ratio of "
            "139 produced by a denominator near zero. Measured on the cash "
            "flow statement instead, FY2026 collected ₹342.19cr against "
            "₹129.51cr of operating profit — a bigger operating cash figure "
            "than any other year in its ten-year record, not a collapse. ")

# CHOICE 2, second forbidden reason. SIL only.
STALE = ("And its only cash-conversion reading in the pack is FY2022, four "
         "years old, with no prior-years mean at all — so there is nothing "
         "here to call either a level or a fall. ")

# CHOICE 3. The four rows whose own band is too wide to locate a price.
BANDWIDE = ("Its own earnings band is not used to price it here, and that is "
            "deliberate: the high is more than five times the low, which "
            "records an earnings denominator going near zero in some year "
            "rather than a range the stock trades in. No band figure is quoted "
            "on this row. ")

# CHOICE 6. Said on PHOENIXLTD and on the rows it is measured against.
ANNUITY = ("One comparison runs through this batch and is worth stating rather "
           "than leaving to be inferred: PHOENIXLTD sits in this same cohort "
           "as a retail-led landlord collecting lease rentals, not a developer "
           "holding years of work-in-progress, so its margin and its inventory "
           "both sit at the opposite end of the cohort from the developers in "
           "it. Margin and inventory ranks in this cluster are partly a "
           "question of which business the row is in, and that is not "
           "something a percentile can show. ")

# CHOICE 7. Any TTM growth figure on a stepped row is a figure about the step.
STEP = ("Read against a base the pack itself flags: the operating margin moved "
        "in one step in a single year, and every twelve-month growth figure on "
        "this row is computed against the year before that step. A move that "
        "size is a mix change, a completion or a one-off, not an operating "
        "trend. ")

# CHOICE 11. OBEROIRLTY only.
WINDOW = ("Its twelve-month window ends 2026-09-30 where the other six rows "
          "here end 2026-06-30, so the TTM figures on this row are one quarter "
          "ahead of the rest of the batch and are not comparable across rows. ")

# CHOICE 9. Uniform across the platform.
MOM95 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 5 of momentum's 100 points, so every "
         "momentum percentile on this platform is scored on 95 points out of "
         "a declared 100. It is uniform, so it cannot move one row relative "
         "to another and the ranks are unaffected — but the pillar is "
         "narrower than the scorecard claims, here and everywhere.")

# CHOICE 5. SIL only.
NOVERDICT = ("There is no verdict on this row, and that is the finding. Its "
             "composite and valuation percentiles lead this batch and they are "
             "measuring a price against earnings that are not there: operating "
             "profit is negative in nine years and positive in one across the "
             "ten-year record, the single positive year being FY2022, the pack "
             "carries no trailing-year operating or net profit growth for the "
             "row at all, and the overview calls the company an investment-holding "
             "company rather than a developer. What follows is what can be "
             "said; a recommendation is not among it. ")

# Metrics NULL for >=95% of every row in this snapshot.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "book_value_cagr_5y",
        "book_value_cagr_10y", "cfo_pat_latest", "roce_latest",
        "op_margin_latest", "np_cagr_7y", "p_aum", "roe_excess_13_10y",
        "roe_excess_13_7y")

# CHOICE 4. Live WORD_DIMS phrases naming columns realty does not carry. The
# <code> check in guard 10 cannot see these, because they are plain English.
BANNED_PHRASES = ("cash conversion", "return on capital", "roce",
                  "working capital day", "receivable day", "collection cycle",
                  "asset turnover", "capex intensity", "margin trend",
                  "ev/sales", "ev to sales", "interest coverage")
# ARTEFACT and STALE exist to disown the pack's own ratio, so they are the
# only places the phrase "cash conversion" may appear.
PHRASE_EXEMPT = (ARTEFACT, STALE)

# CHOICE 10. A rank shared by 56 of 64 names is not a rank.
EMAFLAT = "ema_stack_bull"

# <code> tags that are legitimately not metrics of this cluster.
CODE_ALLOW = {"realty", "full", "tech_net_score_scaled"}

# CHOICE 1 and 2. Per row: negative-operating-cash years out of ten, the
# FY2026 ratio as a level, and whether the word "deterioration" is earned —
# None if it is, otherwise the reason it is refused.
CASHYRS = {
    "ARVSMART":   (6, -1.120, None),
    "ASHIANA":    (4, 2.642, "artefact"),
    "LODHA":      (1, 0.195, None),
    "MARATHON":   (4, -0.447, None),
    "OBEROIRLTY": (3, 0.411, None),
    "PHOENIXLTD": (0, 0.919, None),
    "SIL":        (2, 0.297, "stale"),
}

# Rows that make a cash argument off the pack's flag. OBEROIRLTY and
# PHOENIXLTD carry no flag, so they state the count without the CASH preamble.
CASH_FLAGGED = {"ARVSMART", "ASHIANA", "LODHA", "MARATHON", "SIL"}

# CHOICE 3. hi/lo above this and the band may not price the row.
BAND_RATIO_MAX = 5.0

# CHOICE 7. Rows whose TTM base is a stepped margin: (prev, now, step points).
MARGINSTEP = {
    "ARVSMART": (24.4, 36.8, 12.42),
    "ASHIANA": (5.0, 13.1, 8.04),
    "SIL": (-37.3, 34.8, 72.15),
}
TTM_FIELDS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct")

# CHOICE 9, second half. Not uniform: a narrower quality question than peers.
PILLAR_WEIGHT = {
    "ASHIANA": ("quality", "92.8 of its 100 declared points"),
    "SIL": ("quality", "92.8 of its 100 declared points"),
}

STATUS = {s: "full" for s in EMIT}

MOM95_SYMS = EMIT
ANNUITY_SYMS = {"PHOENIXLTD", "OBEROIRLTY", "ARVSMART"}
WINDOW_SYM = "OBEROIRLTY"
NOVERDICT_SYM = "SIL"

# CHOICE 8. The thinnest metric in this cluster has 27 readings, so nothing
# below 27 can be a real denominator here.
DENOM_FLOOR = 27

_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
_CODE_RX = re.compile(r"<code>([a-z0-9_-]+)</code>")
_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}

SPEC: dict[str, dict] = {
"OBEROIRLTY": {
 "confidence": "high",
 "verdict": "HOLD — quality 78, third of 71 rankable veteran peers, at 23.02x against an own ten-year band averaging 26.40x, with operating cash negative in three years and positive in seven across the ten-year record",
 "points": [
  "<b>Held — OBEROIRLTY is in your portfolio.</b> Oberoi Realty, ₹60,089cr and fifth of 72 by market cap in this bucket — residential, commercial, retail, hospitality and social-infrastructure projects, effectively all of it inside the Mumbai Metropolitan Region; <code>promoter_pct</code> is 67.71%, tied 25th of 70 in a two-way tie. " + VET + "Quality 78 is third of 71 and composite 77 is 16th of 65; valuation is 40 and momentum 44. " + WINDOW,
  "<b>A fifty-seven per cent operating margin that did not move, and a cash record that supports it.</b> <code>op_margin_3y</code> 56.21% is second of 70, with <code>opm_now</code> 57.28% at third of 66 against <code>opm_prev</code> 56.59% at fourth of 66 — the margin is not a step, it is a level held across both halves of the comparison. <code>cfo_sales_3y</code> 42.17% is 15th of 70. Operating cash was negative in three years and positive in seven across the ten-year record in the pack, and FY2026 collected 0.411 of operating profit against a prior-years mean of 0.408, so the level is flat rather than falling; the pack raises no earnings-quality flag on this row, and PHOENIXLTD is the other row in this batch without one. <code>roe_3y</code> 14.03% is seventh of 66 and <code>np_consistency_10y</code> 1.629 is ninth of 72. <code>debt_equity</code> 0.158 is 44th of 57 — the balance sheet is not carrying the projects. Ten-year profit growth above inflation 0.778 is tied third of 72 in a three-way tie spanning positions 3 to 5, and <code>np_growth_above_inflation_7y</code> 0.833 is tied third of 72 in a seven-way tie spanning positions 3 to 9.",
  "<b>What it does not have is a return-on-equity record, and the float is too thin to argue with.</b> <code>roe_avg_above_threshold_10y</code> 0.100 is tied 22nd of 72 in a 16-way tie spanning positions 22 to 37 — the average return on equity cleared the bar in just one year across the ten-year window, which on a quality percentile of 78 is the gap worth knowing about. <code>inv_days</code> 618.55 is 46th of 70 and <code>fcf_yield</code> 2.71% is 30th of 72: the margin is high but the capital turns slowly and very little of it emerges as free cash. Ownership is the other half of the same fact — <code>promoter_pct</code> 67.71%, <code>fii_pct</code> 15.11% at ninth of 55 and <code>dii_pct</code> 14.83% at eighth of 54 together hold 97.65%, leaving a public float of 2.36%. A price discovered on 2.36% of the shares is thinner evidence than its rank suggests. " + ANNUITY,
  "<b>And it trades at a discount to its own ten-year average, which few rows here can say.</b> <code>pe_ttm</code> 23.02x is 25th of 49 and the own ten-year band runs 16.09-37.77x with an average of 26.40x — thirteen per cent below its own mean, and its band is narrow enough to be used for pricing at all, which is true of three rows in this batch. <code>pb</code> 3.353 is 11th of 65, <code>ev_ebitda_ttm</code> 16.83x is 23rd of 44 and <code>div_yield</code> 0.484% is 16th of 27. The chart is unremarkable and consistent: <code>ret_12m_rel</code> +2.30% is 11th of 57, <code>ret_6m_rel</code> +2.76% is 24th of 61, <code>ret_3m_rel</code> -1.68% is 31st of 63, and the close held above its 200-day EMA on 54.76% of the last 252 sessions at seventh of 54. The twelve months behind it grew without drama — <code>ttm_sales_pct</code> +16.64% is 26th of 66, <code>ttm_op_pct</code> +18.08% is 19th of 49 and <code>ttm_np_pct</code> +17.82% is 22nd of 48 — while the latest quarter did not: <code>sales_yoy_q</code> -6.08% is 45th of 66 and <code>np_yoy_q</code> +0.18% is 45th of 70. <code>rev_cagr_5y</code> 22.21% is 25th of 70, <code>np_cagr_5y</code> 24.40% is 16th of 37 and <code>shareholders</code> 94,765 is 16th of 70. " + MOM95,
  "<i>OBEROIRLTY is the row in this batch where the quality percentile and the evidence underneath it agree. <code>op_margin_3y</code> 56.21% at second of 70, <code>roe_3y</code> 14.03% at seventh of 66, <code>np_consistency_10y</code> 1.629 at ninth of 72, operating cash negative in three years and positive in seven across the ten-year record, and no earnings-quality flag at all — against <code>pe_ttm</code> 23.02x at 25th of 49 and an own ten-year band averaging 26.40x. The two things to hold against it are structural rather than operating. <code>roe_avg_above_threshold_10y</code> 0.100 at tied 22nd of 72 says a fifty-seven per cent margin has still not translated into an adequate return on the equity it keeps, and a public float of 2.36% means the price is discovered on very few shares. Neither is a reason to sell a held position trading below its own decade; both are reasons the percentile is doing less work than it appears to. Confidence is high.</i>",
 ],
 "trigger": "roe_3y lifting through 16% with opm_now holding above 57% -> the margin is finally earning a return on the equity behind it, and 23.02x against an own ten-year average of 26.40x was the discount for waiting. Operating cash turning negative again while ttm_op_pct stays positive -> three negative years was the pattern rather than the exception, and a developer that cannot collect is being priced on reported profit alone.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "cfo_sales_3y", "roe_3y", "np_consistency_10y", "debt_equity", "np_growth_above_inflation_10y", "np_growth_above_inflation_7y", "roe_avg_above_threshold_10y", "inv_days", "fcf_yield", "promoter_pct", "fii_pct", "dii_pct", "pe_ttm", "pb", "ev_ebitda_ttm", "div_yield", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "rev_cagr_5y", "np_cagr_5y", "shareholders"],
},

"PHOENIXLTD": {
 "confidence": "medium",
 "verdict": "WATCH — a 57.15% three-year operating margin with no negative operating cash year across the ten-year record, at 52.21x on a three-year return on equity of 10.73%",
 "points": [
  "<b>Not held — PHOENIXLTD is on your watchlist.</b> The Phoenix Mills, ₹66,827cr and third of 72 by market cap in this bucket — retail-led mixed-use destinations, with lease rentals, hotel income and residential sales run through capital-partner platforms with CPP Investments and GIC across fourteen cities; <code>promoter_pct</code> is 47.25%, 56th of 70. " + VET + "Quality 75 is tied fourth of 71 and composite 60 is 27th of 65; valuation is 20 at 63rd of 67 and momentum 59 at 18th of 70. " + BANDWIDE,
  "<b>It is not really a developer, and that is most of what its quality percentile measures.</b> <code>op_margin_3y</code> 57.15% is first of 70, with <code>opm_now</code> 59.73% at second of 66 against <code>opm_prev</code> 56.82% at third of 66, and <code>inv_days</code> 64.14 is 66th of 70 — two months of inventory in a cohort where the developers carry two to four years of it. <code>cfo_sales_3y</code> 54.68% is ninth of 70, and operating cash was positive in every year of the ten-year window in the pack, with FY2026 collecting 0.919 of operating profit: no negative year, no flag, and the strongest collection record in this batch on both the count and the level. " + ANNUITY + "Growth is real rather than incidental — <code>rev_cagr_5y</code> 31.90% is 16th of 70 and <code>np_cagr_5y</code> 50.69% is seventh of 37 — and <code>np_consistency_10y</code> 1.567 is 17th of 72, with ten-year profit growth above inflation 0.556 tied 11th of 72 in a 31-way tie spanning positions 11 to 41, a tie wide enough that the rank says little.",
  "<b>What a fifty-seven per cent margin has not produced is a return on the capital behind it.</b> <code>roe_3y</code> 10.73% is 20th of 66, mid-pack, and <code>roe_avg_above_threshold_10y</code> 0.100 is tied 22nd of 72 in a 16-way tie spanning positions 22 to 37 — the average return on equity cleared the bar in just one year across the ten-year window. The arithmetic is in the statements: FY2026 turned ₹2,638.45cr of operating profit into ₹1,223.82cr of net profit, so less than half of it survived depreciation, interest and the capital partners' share. <code>debt_equity</code> 0.484 is 24th of 57 and <code>fcf_yield</code> 0.638% is 38th of 72. A mall is a high-margin, slow-returning asset, and the margin rank and the return rank are both telling the truth about different things.",
  "<b>The price already pays for the annuity, and the holder that set it is reducing.</b> <code>pe_ttm</code> 52.21x is tenth of 49, <code>pb</code> 6.081 is third of 65, <code>ev_ebitda_ttm</code> 23.20x is 14th of 44 and <code>div_yield</code> 0.134% is 26th of 27 — valuation 20 at 63rd of 67 is not an artefact of one metric. The chart is the strongest in the cohort: the close held above its 200-day EMA on 86.90% of the last 252 sessions at first of 54, <code>ret_12m_rel</code> +16.99% is sixth of 57 and <code>ret_6m_rel</code> +10.57% is 14th of 61, with <code>ret_3m_rel</code> -1.34% at 30th of 63 the only soft reading. The twelve months behind it support it — <code>ttm_sales_pct</code> +17.67% is 24th of 66, <code>ttm_op_pct</code> +23.69% is 17th of 49 and <code>ttm_np_pct</code> +28.98% is 17th of 48 — as does the quarter, with <code>sales_yoy_q</code> +12.80% at 31st of 66 and <code>np_yoy_q</code> +23.34% at 34th of 70. Ownership is the one thing moving the wrong way: <code>fii_pct</code> 31.73% is first of 55 but the series in the pack falls from 35.41% two years ago to 33.85% three quarters ago to 31.73% now, while <code>dii_pct</code> 17.38% at fifth of 54 rose over the same stretch. <code>shareholders</code> 73,390 is 23rd of 70. " + MOM95,
  "<i>PHOENIXLTD is the cleanest set of operating facts in this batch and the price that already knows it. <code>op_margin_3y</code> 57.15% at first of 70, <code>cfo_sales_3y</code> 54.68% at ninth of 70, <code>inv_days</code> 64.14 at 66th of 70, no negative operating cash year across the ten-year record, and <code>np_cagr_5y</code> 50.69% at seventh of 37 — none of it an artefact, and most of it a consequence of being a landlord in a cohort of builders. The two things that keep it on a watchlist rather than in a portfolio are the return and the multiple. <code>roe_3y</code> 10.73% at 20th of 66 and <code>roe_avg_above_threshold_10y</code> 0.100 at tied 22nd of 72 say the capital inside those malls earns an ordinary return, and <code>pb</code> 6.081 at third of 65 with <code>pe_ttm</code> 52.21x at tenth of 49 says it is priced as if it earned an extraordinary one. Its own earnings band cannot adjudicate that, which is why no band figure appears above. Confidence is medium.</i>",
 ],
 "trigger": "roe_3y lifting through 14% with op_margin_3y holding above 55% -> the annuity base is finally earning on the capital inside it, and 52.21x was the market paying for that early. pct_above_200ema_252d breaking down with fii_pct falling further from 31.73% -> the foreign holding that set this price becomes the marginal seller, on a row where valuation is 20 at 63rd of 67.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "inv_days", "cfo_sales_3y", "roe_3y", "roe_avg_above_threshold_10y", "np_consistency_10y", "np_growth_above_inflation_10y", "debt_equity", "rev_cagr_5y", "np_cagr_5y", "pe_ttm", "pb", "ev_ebitda_ttm", "fcf_yield", "div_yield", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "fii_pct", "dii_pct", "promoter_pct", "shareholders"],
},

"LODHA": {
 "confidence": "medium",
 "verdict": "WATCH — operating profit rose from ₹2,063.9cr to ₹4,923.0cr across three years while operating cash fell from ₹2,750.0cr to ₹959.3cr, at 25.07x against an own five-year band averaging 40.88x",
 "points": [
  "<b>Not held — LODHA is on your watchlist.</b> Lodha Developers, formerly Macrotech, ₹103,439cr and second of 72 by market cap in this bucket — residential development, township creation and an annuity book run as DevCo, RentCo and LandCo, including industrial parks, high-street retail and a powered-shell data-centre platform across MMR, Pune, Bengaluru and the NCR; <code>promoter_pct</code> is 70.31%, 20th of 70, down from 72.13% two years ago. " + VET + "Quality 64 is tied 17th of 71 and composite 69 is 21st of 65; valuation is 33 and momentum 64.",
  "<b>Three years of rising profit and falling cash, on a ₹103,439cr balance sheet.</b> " + CASH + DETERIORATION + "The record is unambiguous because it is a trend and not a ratio: operating profit went ₹2,063.9cr, ₹2,664.7cr, ₹3,988.8cr, ₹4,923.0cr across FY2023 to FY2026 while operating cash went ₹2,750.0cr, ₹2,512.3cr, ₹1,565.6cr, ₹959.3cr — profit up 139% and cash down 65% over the same four years. Operating cash was negative in one year and positive in nine across the ten-year record, so this is not a company that cannot collect; it is a company whose collection has moved in the opposite direction to its reported earnings for three consecutive years. FY2026 collected 0.195 of operating profit against a prior-years mean of 0.895. <code>inv_days</code> 881.05 is 38th of 70 and <code>cfo_sales_3y</code> 13.82% is 33rd of 70 — mid-pack on both, which is the point: the level is normal for a developer and the direction is not. <code>debt_equity</code> 0.425 is 28th of 57.",
  "<b>And the five-year return record is worse than the ten-year one, on the row that grew profit fastest.</b> <code>roe_avg_above_threshold_10y</code> 0.300 is tied seventh of 72 in a seven-way tie spanning positions 7 to 13 — the average return on equity cleared the bar in three years across the ten-year window. But <code>roe_avg_above_threshold_5y</code> 0.000 is tied 29th of 72 in a 44-way tie spanning positions 29 to 72: across the most recent five years it cleared the bar in no year at all, and <code>roe_avg_above_threshold_7y</code> 0.143 is tied 13th of 72 in a 19-way tie spanning positions 13 to 31. <code>roe_3y</code> 12.43% is 13th of 66 and <code>np_cagr_5y</code> 29.94% is 13th of 37, so the profit growth is real; it is the return on the equity funding it that has not kept up. <code>op_margin_3y</code> 28.10% is 16th of 70, with <code>opm_now</code> 32.22% at 14th of 66 against <code>opm_prev</code> 29.21% at 16th of 66 — three points of margin gained, and no step the pack considers worth flagging. <code>rev_cagr_5y</code> 15.93% is 36th of 70 and <code>np_consistency_10y</code> 1.567 is 18th of 72, with ten-year profit growth above inflation 0.667 tied sixth of 72 in a five-way tie spanning positions 6 to 10.",
  "<b>Priced well below its own short history, with retail arriving and almost no float to arrive into.</b> <code>pe_ttm</code> 25.07x is 23rd of 49 and the own five-year band runs 19.73-72.92x with an average of 40.88x — but that band holds five readings rather than ten, because the company listed in 2021, so it is a usable range and a short one. <code>pb</code> 4.442 is fifth of 65, <code>ev_ebitda_ttm</code> 17.69x is 21st of 44, <code>fcf_yield</code> 1.36% is 34th of 72 and <code>div_yield</code> 0.410% is 19th of 27. The twelve months behind it grew on every line — <code>ttm_sales_pct</code> +26.04% is 21st of 66, <code>ttm_op_pct</code> +39.02% is 12th of 49 and <code>ttm_np_pct</code> +39.20% is 14th of 48 — and so did the quarter, with <code>sales_yoy_q</code> +43.10% at 18th of 66 and <code>np_yoy_q</code> +103.36% at 18th of 70. The chart has not followed: <code>ret_12m_rel</code> -5.68% is 16th of 57 and <code>ret_3m_rel</code> -4.04% is 36th of 63, though <code>ret_6m_rel</code> +26.24% is seventh of 61 and the close held above its 200-day EMA on 28.17% of the last 252 sessions at 22nd of 54. Ownership is the unusual part: <code>fii_pct</code> 23.65% is third of 55, <code>dii_pct</code> 3.56% is 19th of 54 and <code>shareholders</code> 158,746 is tenth of 70, up from 67,699 in June 2024 — the register has more than doubled in two years into a public float of 2.46%. " + MOM95,
  "<i>LODHA is the row where every reported line improved and the cash statement went the other way for three straight years. <code>ttm_op_pct</code> +39.02% at 12th of 49 and <code>np_cagr_5y</code> 29.94% at 13th of 37 against operating cash of ₹959.3cr in FY2026, down from ₹2,750.0cr in FY2023 while operating profit more than doubled — and <code>roe_avg_above_threshold_5y</code> 0.000 at tied 29th of 72, meaning the equity funding that growth has not earned an adequate return in any of the last five years. <code>inv_days</code> 881.05 at 38th of 70 says the inventory build is ordinary for the cluster, which makes the cash gap a question about timing and recognition rather than about the business model. At <code>pe_ttm</code> 25.07x at 23rd of 49, against an own band averaging 40.88x on five readings, the market is not paying for the growth either. This is a watch rather than a buy because the one number that would settle it — operating cash — has moved the wrong way three years running, and a developer's profit is an estimate until it is collected. Confidence is medium.</i>",
 ],
 "trigger": "cash_from_operating recovering above ₹2,500cr with opm_now holding above 32% -> the three-year gap was project phasing, and 25.07x against an own five-year average of 40.88x was the discount for it. roe_avg_above_threshold_5y still at 0.000 with operating cash under ₹1,000cr again -> profit is being reported faster than it is being collected, on a ₹103,439cr balance sheet where the float is 2.46%.",
 "evidence": ["cfo_sales_3y", "inv_days", "debt_equity", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_3y", "np_cagr_5y", "op_margin_3y", "opm_now", "opm_prev", "rev_cagr_5y", "np_consistency_10y", "np_growth_above_inflation_10y", "pe_ttm", "pb", "ev_ebitda_ttm", "fcf_yield", "div_yield", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "ret_12m_rel", "ret_3m_rel", "ret_6m_rel", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"MARATHON": {
 "confidence": "low",
 "verdict": "WATCH — composite 80, 14th of 65, where net profit set a record at ₹202.96cr on operating profit that fell to ₹121.10cr and operating cash was negative two years running, at 14.05x against an own ten-year band averaging 12.87x",
 "points": [
  "<b>Not held — MARATHON is on your watchlist.</b> Marathon Nextgen Realty, ₹2,667cr and 23rd of 72 by market cap in this bucket — a Mumbai developer across luxury residential at Monte South, Grade A commercial at Futurex and Millennium, integrated townships at Nexzone, affordable NeoHomes and a Permanent Transit Camp book, concentrated in Byculla, Lower Parel, Panvel, Bhandup, Mulund and Dombivli; <code>promoter_pct</code> is 56.42%, 42nd of 70. " + VET + "Quality 73 is tied seventh of 71 and composite 80 is 14th of 65; valuation is 56 and momentum 38.",
  "<b>The long profit record leads this batch, and the current year is the reason to distrust it.</b> Five-year profit growth above inflation 1.000 is tied first of 72 in an eight-way tie spanning positions 1 to 8, <code>np_growth_above_inflation_7y</code> 0.833 is tied third of 72 in a seven-way tie spanning positions 3 to 9, and <code>np_cagr_5y</code> 51.51% is fifth of 37. <code>roe_avg_above_threshold_5y</code> 0.600 is tied fourth of 72 in a two-way tie spanning positions 4 to 5 and <code>roe_avg_above_threshold_7y</code> 0.429 is tied fourth of 72 in a four-way tie spanning positions 4 to 7, which in this cohort is a genuine return record rather than a tie artefact. <code>roe_3y</code> 13.74% is tenth of 66, <code>np_consistency_10y</code> 1.569 is 16th of 72 and <code>debt_equity</code> 0.044 is 51st of 57 — close to no borrowing at all, and the lowest gearing on any row in this batch. Against all of that: <code>op_margin_3y</code> 29.10% is 15th of 70 but <code>opm_now</code> 25.05% at 22nd of 66 is below <code>opm_prev</code> 27.03% at 21st of 66, and <code>ttm_sales_pct</code> -1.06% is 41st of 66, <code>ttm_op_pct</code> -8.32% is 28th of 49 and <code>ttm_np_pct</code> -7.72% is 31st of 48. Every twelve-month line is negative.",
  "<b>Net profit set a record while operating profit halved, and the cash went out of the door.</b> " + CASH + DETERIORATION + "The two series in the pack run in opposite directions: net profit went ₹120.99cr, ₹166.47cr, ₹186.55cr, ₹202.96cr across FY2023 to FY2026 while operating profit went ₹245.63cr, ₹232.86cr, ₹173.08cr, ₹121.10cr. In FY2026 the net profit of ₹202.96cr was larger than the operating profit of ₹121.10cr, so the earnings line is being made below the operating line rather than by the operations. Operating cash was negative in four years and positive in six across the ten-year record, and the negative years include the last two consecutively — minus ₹25.31cr in FY2025 and minus ₹54.16cr in FY2026, the second being 0.447 of operating profit going out rather than coming in, against a prior-years mean of 0.564 coming in. <code>cfo_sales_3y</code> -4.05% is 49th of 70 and <code>inv_days</code> 615.86 is 47th of 70. Three years of record profit and no cash behind any of it is the single fact this row turns on.",
  "<b>The promoter sold seventeen points into institutions, and the chart has not recovered since.</b> The shareholding series shows <code>promoter_pct</code> at 73.63% through June 2025 and 55.93% by September 2025, while <code>fii_pct</code> went 0.94% to 6.89% and <code>dii_pct</code> 2.31% to 15.59% in the same quarter and the public holding barely moved — a placement into institutional hands rather than a sale into the market. The current readings are <code>fii_pct</code> 4.68% at tied 22nd of 55 in a two-way tie, which is lower than the quarter of the placement, and <code>dii_pct</code> 14.71% at ninth of 54; <code>shareholders</code> 14,230 is 46th of 70. Since then: <code>ret_12m_rel</code> -30.71% is 39th of 57, <code>ret_6m_rel</code> -14.32% is 43rd of 61, and the close held above its 200-day EMA on 2.78% of the last 252 sessions at tied 40th of 54 in a two-way tie — effectively the whole year below the average, with only <code>ret_3m_rel</code> +5.76% at 19th of 63 positive. On price it is the least demanding row here: <code>pe_ttm</code> 14.05x is 38th of 49 and the own ten-year band runs 4.44-18.90x with an average of 12.87x, so it sits nine per cent above its own mean and inside its own range; <code>pb</code> 1.172 is 39th of 65, <code>ev_ebitda_ttm</code> 18.79x is 20th of 44, <code>fcf_yield</code> 0.656% is 37th of 72 and <code>div_yield</code> 0.253% is 22nd of 27. <code>rev_cagr_5y</code> 12.83% is 39th of 70, <code>sales_yoy_q</code> +40.26% is 20th of 66 and <code>np_yoy_q</code> -16.12% is 50th of 70. " + MOM95,
  "<i>MARATHON has the strongest multi-year profit record in this batch and the weakest connection between that record and cash. Five-year profit growth above inflation 1.000 at tied first of 72, <code>roe_avg_above_threshold_5y</code> 0.600 at tied fourth of 72, <code>np_cagr_5y</code> 51.51% at fifth of 37 and <code>debt_equity</code> 0.044 at 51st of 57 describe a company that earns well and owes nothing. Then: operating profit fell from ₹245.63cr in FY2023 to ₹121.10cr in FY2026 while net profit rose to a record ₹202.96cr above it, and operating cash was negative in both FY2025 and FY2026. <code>cfo_sales_3y</code> -4.05% at 49th of 70 confirms it is a three-year pattern and not one bad year. Confidence is low precisely because the quality percentile of 73 and the composite of 80 are reading the profit line, which is the one line here that operations are no longer producing. At <code>pe_ttm</code> 14.05x at 38th of 49 and <code>pb</code> 1.172 at 39th of 65 the price is not the risk; the earnings base is.</i>",
 ],
 "trigger": "ttm_op_pct returning to growth with cash_from_operating positive again -> the operating profit falling was project phasing, and 14.05x on a price-to-book of 1.17 was the discount for sitting through it. np_yoy_q staying negative while operating profit keeps falling -> the record net profit was made below the operating line and does not repeat, and a composite of 80 was reading the wrong line.",
 "evidence": ["np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_cagr_5y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_3y", "np_consistency_10y", "debt_equity", "op_margin_3y", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "cfo_sales_3y", "inv_days", "promoter_pct", "fii_pct", "dii_pct", "shareholders", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "pe_ttm", "pb", "ev_ebitda_ttm", "fcf_yield", "div_yield", "rev_cagr_5y", "sales_yoy_q", "np_yoy_q"],
},

"ARVSMART": {
 "confidence": "low",
 "verdict": "WATCH — composite 78, 15th of 65, on an operating margin that stepped from 24.4% to 36.8% in one year and operating cash negative in six years across the ten-year record, on gearing of 0.898",
 "points": [
  "<b>Not held — ARVSMART is on your watchlist.</b> Arvind SmartSpaces, ₹2,750cr and 22nd of 72 by market cap in this bucket — the Lalbhai Group's real estate arm, 93% residential and 7% commercial or industrial in FY25-26, with apartments, villas, plotted communities and industrial parks across Ahmedabad, Gandhinagar, Vadodara, Bengaluru, Pune and the MMR; <code>promoter_pct</code> is 53.83%, 48th of 70, and the shareholding series shows it rising from 49.83% to 53.83% in the March 2026 quarter while <code>dii_pct</code> fell from 15.82% to 8.60% — the promoter bought while domestic institutions sold. " + VET + "Quality 57 is tied 24th of 71 and composite 78 is 15th of 65; valuation is 41 and momentum 74. " + BANDWIDE,
  "<b>Operating cash has been negative in six separate years across the last ten, and FY2026 is the deepest.</b> " + CASH + DETERIORATION + "The count is the argument: operating cash was negative in six years and positive in four across the ten-year record in the pack — FY2017, FY2018, FY2020, FY2023, FY2025 and FY2026. FY2026 is the deepest of those, minus ₹170.44cr against operating profit of ₹152.20cr, a ratio of -1.120. The pack's prior-years mean of 0.256 should not be read as a steady base either: it averages +3.307, -2.057, +0.273 and -0.499 across FY2022 to FY2025, which is a sawtooth and not a level. <code>cfo_sales_3y</code> -11.02% is 53rd of 70 and <code>fcf_yield</code> -3.42% is 51st of 72, so the three-year picture agrees with the single year. The reason is on the balance sheet: <code>inv_days</code> 1,437.97 is 25th of 70 — nearly four years of inventory — funded with <code>debt_equity</code> 0.898 at 13th of 57, the most levered row in this batch.",
  "<b>And the margin that the composite is reading moved in one step.</b> " + STEP + "<code>opm_now</code> 36.78% is eighth of 66 against <code>opm_prev</code> 24.36% at 25th of 66 — twelve and a half points of operating margin in a single year, which the pack flags as a mix change, a completion or a one-off rather than a trend. Everything downstream of it is therefore a figure about the step: <code>ttm_op_pct</code> +58.97% is ninth of 49 and <code>ttm_np_pct</code> +55.16% is tenth of 48 while <code>ttm_sales_pct</code> is only +5.31% at 34th of 66, so the profit growth is margin and not volume. The quarter is the same effect amplified by a small base — <code>sales_yoy_q</code> +212.14% is seventh of 66 and <code>np_yoy_q</code> +785.60% is sixth of 70. <code>op_margin_3y</code> 27.78% at 17th of 70 is the figure to trust over <code>opm_now</code>, because it averages three years rather than reading the year of the step. " + ANNUITY,
  "<b>The return record and the price are both ordinary, which leaves nothing holding the composite up.</b> <code>roe_3y</code> 13.91% is eighth of 66 and <code>np_cagr_5y</code> 40.06% is ninth of 37, both genuinely good, but <code>roe_avg_above_threshold_10y</code> 0.100 is tied 22nd of 72 in a 16-way tie spanning positions 22 to 37, <code>roe_avg_above_threshold_7y</code> 0.143 is tied 13th of 72 in a 19-way tie spanning positions 13 to 31 and <code>roe_avg_above_threshold_5y</code> 0.200 is tied 12th of 72 in a 17-way tie spanning positions 12 to 28 — the average return on equity cleared the bar in one year across ten, one across seven and one across five. <code>rev_cagr_5y</code> 21.73% is 26th of 70, <code>np_consistency_10y</code> 1.575 is 15th of 72 and ten-year profit growth above inflation 0.556 is tied 11th of 72 in a 31-way tie spanning positions 11 to 41. On price: <code>pe_ttm</code> 14.92x is 37th of 49 and <code>pb</code> 4.236 is eighth of 65, which is the pair that matters — a modest earnings multiple on stepped earnings and a high multiple of book, with <code>ev_ebitda_ttm</code> 10.77x at 31st of 44 and <code>div_yield</code> 0.375% at 20th of 27. The chart is flat rather than strong: <code>ret_12m_rel</code> +0.23% is 13th of 57, <code>ret_3m_rel</code> +7.44% is 17th of 63, <code>ret_6m_rel</code> +4.35% is 22nd of 61 and the close held above its 200-day EMA on 35.71% of the last 252 sessions at 17th of 54. <code>fii_pct</code> 0.69% is 32nd of 55 and <code>shareholders</code> 92,477 is 18th of 70. " + MOM95,
  "<i>ARVSMART has a composite of 78 at 15th of 65 and almost none of it survives being looked at. The margin it is scored on moved twelve and a half points in one year — <code>opm_now</code> 36.78% at eighth of 66 against <code>opm_prev</code> 24.36% at 25th of 66 — and every twelve-month growth figure sits on that base. Underneath it, operating cash was negative in six years and positive in four across the ten-year record, FY2026 at minus ₹170.44cr against ₹152.20cr of operating profit, with <code>inv_days</code> 1,437.97 at 25th of 70 funded by <code>debt_equity</code> 0.898 at 13th of 57. The genuinely good facts are <code>roe_3y</code> 13.91% at eighth of 66 and <code>np_cagr_5y</code> 40.06% at ninth of 37, and the promoter buying four points in March 2026 is worth noting on a row where <code>dii_pct</code> 8.99% at 11th of 54 is little more than half its December 2025 level. But <code>pb</code> 4.236 at eighth of 65 is a full developer price for four years of inventory and six negative cash years, and its own earnings band is too wide to adjudicate the multiple. Confidence is low.</i>",
 ],
 "trigger": "opm_now holding near 36.8% for a second full year with operating cash turning positive -> the step was a permanent mix change and 14.92x on it was genuinely cheap. opm_now reverting toward 24.4% with operating cash negative again -> the composite of 78 was built on one year of margin and four years of inventory funded with borrowing.",
 "evidence": ["cfo_sales_3y", "fcf_yield", "inv_days", "debt_equity", "opm_now", "opm_prev", "op_margin_3y", "ttm_op_pct", "ttm_np_pct", "ttm_sales_pct", "sales_yoy_q", "np_yoy_q", "roe_3y", "np_cagr_5y", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_5y", "rev_cagr_5y", "np_consistency_10y", "np_growth_above_inflation_10y", "pe_ttm", "pb", "ev_ebitda_ttm", "div_yield", "ret_12m_rel", "ret_3m_rel", "ret_6m_rel", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"ASHIANA": {
 "confidence": "low",
 "verdict": "WATCH — the pack's cash flag on this row is an artefact of a ₹0.87cr denominator, and the real gap is a ten-year return-on-equity threshold reading of 0.000, at 53.53x on a margin that stepped from 5.0% to 13.1%",
 "points": [
  "<b>Not held — ASHIANA is on your watchlist.</b> Ashiana Housing, ₹3,650cr and 19th of 72 by market cap in this bucket. The pack carries no segment detail for this row at all — its overview says only that this is a listed realty company, incorporated in 1986, with a Saket office and a Kolkata registered office — so nothing below is argued from what the business does. <code>promoter_pct</code> is 61.11%, 36th of 70, and it is unchanged across all nine periods in the shareholding series. " + VET + "Quality 62 is 19th of 71 but is scored on 92.8 of its 100 declared points, the missing 7.2 being five-year profit CAGR, which is NULL for this row; composite 46 is 36th of 65, valuation 25 is tied 59th of 67 and momentum is 53. " + BANDWIDE,
  "<b>The pack's cash flag on this row is wrong, and it is worth saying why rather than quietly dropping it.</b> " + CASH + ARTEFACT + "On the count instead: operating cash was negative in four years and positive in six across the ten-year record, the negative years being FY2017, FY2018, FY2019 and FY2022, and the last four years run ₹11.59cr, ₹212.31cr, ₹233.51cr and ₹342.19cr — rising every year. <code>cfo_sales_3y</code> 32.20% is 21st of 70 and <code>fcf_yield</code> 6.69% is 20th of 72, both comfortably above the cluster middle. <code>inv_days</code> 862.64 is 39th of 70 and <code>debt_equity</code> 0.376 is 32nd of 57 — an ordinary developer balance sheet. Cash is not this row's problem.",
  "<b>Its problem is that it has never earned an adequate return on equity — not in five years, seven or ten.</b> <code>roe_avg_above_threshold_10y</code> 0.000 is tied 38th of 72 in a 35-way tie spanning positions 38 to 72, <code>roe_avg_above_threshold_7y</code> 0.000 is tied 32nd of 72 in a 41-way tie spanning positions 32 to 72 and <code>roe_avg_above_threshold_5y</code> 0.000 is tied 29th of 72 in a 44-way tie spanning positions 29 to 72 — the average return on equity cleared the bar in no year of any of those three windows. The ties are wide, so the ranks say little; the readings of 0.000 say everything. <code>roe_3y</code> 8.98% is 22nd of 66 and <code>op_margin_3y</code> 8.29% is 39th of 70, both below the cluster middle, and ten-year profit growth above inflation 0.444 is tied 42nd of 72 in a 15-way tie spanning positions 42 to 56. <code>np_consistency_10y</code> 1.237 is 33rd of 72. The growth that does exist is recent: <code>rev_cagr_5y</code> 50.68% is 11th of 70, with five-year profit growth above inflation 0.750 tied ninth of 72 in a 14-way tie spanning positions 9 to 22.",
  "<b>And the twelve-month figures that look spectacular are one year of margin on a near-zero base.</b> " + STEP + "<code>opm_prev</code> 5.03% is 45th of 66 and <code>opm_now</code> 13.07% is 36th of 66 — eight points of operating margin added in one year, off a base so low that the growth rates computed against it are arithmetic. That is the whole of <code>ttm_op_pct</code> +256.52% at third of 49 and <code>ttm_np_pct</code> +224.97% at third of 48, against <code>ttm_sales_pct</code> of only +37.13% at 18th of 66. And the most recent quarter has gone the other way: <code>sales_yoy_q</code> -63.30% is 60th of 66, with <code>np_yoy_q</code> +3.07% at 43rd of 70. The price has paid for the growth rates rather than the quarter: <code>pe_ttm</code> 53.53x is ninth of 49, <code>ev_ebitda_ttm</code> 48.64x is fifth of 44 and <code>pb</code> 4.246 is seventh of 65, with <code>div_yield</code> 0.413% at 18th of 27. The chart agrees with the price and not the business — <code>ret_12m_rel</code> +35.34% is fourth of 57, <code>ret_6m_rel</code> +12.77% is 11th of 61, <code>ret_3m_rel</code> +1.84% is 26th of 63 and the close held above its 200-day EMA on 66.27% of the last 252 sessions at fifth of 54. <code>fii_pct</code> 8.19% is 16th of 55, <code>dii_pct</code> 8.08% is 13th of 54 and <code>shareholders</code> 24,051 is 43rd of 70. " + MOM95,
  "<i>ASHIANA is the row where the pack's own flag points at the wrong thing. The stated collapse in cash is a ₹0.87cr operating-profit denominator in FY2021, and the actual record is ₹342.19cr of operating cash in FY2026 against ₹129.51cr of operating profit, with <code>cfo_sales_3y</code> 32.20% at 21st of 70. What should be flagged instead is sitting in plain sight: <code>roe_avg_above_threshold_10y</code> 0.000 at tied 38th of 72, <code>roe_avg_above_threshold_7y</code> 0.000 at tied 32nd of 72 and <code>roe_avg_above_threshold_5y</code> 0.000 at tied 29th of 72 — three windows, no year in any of them where the average return on equity was adequate — alongside <code>roe_3y</code> 8.98% at 22nd of 66 and <code>op_margin_3y</code> 8.29% at 39th of 70. The twelve-month growth is a margin step from 5.03% to 13.07%, the latest quarter is <code>sales_yoy_q</code> -63.30% at 60th of 66, and the price is <code>pe_ttm</code> 53.53x at ninth of 49 with <code>ev_ebitda_ttm</code> 48.64x at fifth of 44. Collecting cash well is not the same as earning a return, and this row has spent a decade demonstrating the difference. Confidence is low.</i>",
 ],
 "trigger": "opm_now holding near 13% with sales_yoy_q returning to growth -> the margin step was a mix change that holds, and ₹342.19cr of operating cash in FY2026 was the first evidence for it. roe_avg_above_threshold_10y still 0.000 with sales_yoy_q negative again -> a decade without an adequate return on equity, and 53.53x was paying for a single year of margin.",
 "evidence": ["cfo_sales_3y", "fcf_yield", "inv_days", "debt_equity", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_5y", "roe_3y", "op_margin_3y", "np_growth_above_inflation_10y", "np_growth_above_inflation_5y", "np_consistency_10y", "rev_cagr_5y", "opm_prev", "opm_now", "ttm_op_pct", "ttm_np_pct", "ttm_sales_pct", "sales_yoy_q", "np_yoy_q", "pe_ttm", "ev_ebitda_ttm", "pb", "div_yield", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"SIL": {
 "confidence": "low",
 "verdict": "WATCH — no verdict. Composite 91 at seventh of 65 and valuation 86 at tied fourth of 67, on operating profit negative in nine years across the ten-year record, with ttm_op_pct and ttm_np_pct both NULL",
 "points": [
  "<b>Not held — SIL is on your watchlist.</b> Standard Industries, ₹106cr and 57th of 72 by market cap in this bucket. " + NOVERDICT + "The overview describes an investment-holding company with fixed assets and subsidiaries, a corporate office in Mumbai and a registered office in Vashi, which is worth reading alongside the fact that the scorer has filed it in <code>realty</code> and ranks it against developers. <code>promoter_pct</code> is 20.31%, 67th of 70, unchanged across all nine periods in the shareholding series. " + VET + "Quality 45 is 43rd of 71 and is scored on 92.8 of its 100 declared points, the missing 7.2 being five-year profit CAGR, which is NULL for this row; momentum is tied 13th of 70 at 65. " + BANDWIDE,
  "<b>There is no earnings base here, and that is a statement about the accounts rather than about the price.</b> Operating profit was negative in nine years and positive in one across the ten-year record in the pack. The single positive year is FY2022, at ₹203.39cr on ₹437.32cr of sales; FY2026 ran ₹34.33cr of sales and minus ₹13.55cr of operating profit, and the four years in between were minus ₹12.42cr, minus ₹11.49cr, minus ₹11.51cr and minus ₹13.55cr — an operating loss of roughly ₹12cr a year on sales of ₹21cr to ₹34cr. <code>op_margin_3y</code> -41.14% is 55th of 70, <code>rev_cagr_5y</code> -47.07% is 68th of 70 and <code>roe_3y</code> -9.45% is 61st of 66. <code>np_consistency_10y</code> 0.543 is 63rd of 72, five-year profit growth above inflation 0.000 is tied 68th of 72 in a five-way tie spanning positions 68 to 72, and <code>np_growth_above_inflation_7y</code> 0.333 is tied 55th of 72 in a 15-way tie spanning positions 55 to 69. One rank here contradicts all of that and should be read as an artefact of its own definition: <code>roe_avg_above_threshold_10y</code> 0.200 is tied 14th of 72 in an eight-way tie spanning positions 14 to 21, a respectable rank on a company whose three-year return on equity is negative.",
  "<b>The cash lines cannot settle it either, in one case because the reading is four years old.</b> " + CASH + STALE + "On the count: operating cash was negative in two years and positive in eight across the ten-year record, and FY2026 brought in ₹42.64cr — but it did so while operating profit was minus ₹13.55cr, so the cash is not coming from operations in any sense a ratio can express. <code>cfo_sales_3y</code> 35.18% is 19th of 70 and <code>fcf_yield</code> 12.05% is 15th of 72, and both are measured against a sales line that has fallen by nearly half a year on year for five years. <code>debt_equity</code> 0.031 is 52nd of 57 and <code>inv_days</code> 604.12 is 48th of 70. <code>div_yield</code> 3.335% is first of 27 — the company is returning capital to shareholders while losing money at the operating line, which is consistent with an investment-holding company and inconsistent with the developer it is being ranked as.",
  "<b>And the margin step that lifted every recent figure is a sign change, not a recovery.</b> " + STEP + "<code>opm_prev</code> -37.30% is 54th of 66 and <code>opm_now</code> 34.85% is 11th of 66 — seventy-two points of operating margin in one year, from a loss to a profit, which is why <code>ttm_sales_pct</code> +585.24% is third of 66 and why <code>sales_yoy_q</code> +1,735.75% is second of 66 and <code>np_yoy_q</code> +7,981.37% is third of 70. Growth rates computed off a base that small are not information about the business. The valuation percentile is built on the same base: <code>pe_ttm</code> 1.715x is 48th of 49, <code>pb</code> 0.923 is 45th of 65 and <code>ev_ebitda_ttm</code> 1.357x is 44th of 44 — the cheapest set of multiples in the cohort on all three readings, which is what a valuation percentile of 86 is reading, and all three divide by an earnings figure the pack itself cannot compute for the trailing year. Ownership carries the last discontinuity: <code>fii_pct</code> is 0.00%, tied 47th of 55 in a nine-way tie spanning positions 47 to 55, where the shareholding series shows 38.86% in every period from June 2024 to March 2026 and the public holding at 36.79%, then 0.00% and 75.72% respectively in June 2026. A 38.86-point foreign holding does not become a public holding in one quarter by being sold; it is either a reclassification or a transfer, and the pack does not say which. <code>dii_pct</code> 3.96% is 18th of 54 and <code>shareholders</code> 45,134 is 30th of 70. The chart is flat: <code>ret_12m_rel</code> -11.57% is 21st of 57, <code>ret_6m_rel</code> -0.10% is 27th of 61, <code>ret_3m_rel</code> +0.28% is 28th of 63 and the close held above its 200-day EMA on 21.83% of the last 252 sessions at tied 26th of 54 in a two-way tie. " + MOM95,
  "<i>SIL is the clearest case this format has had for refusing to produce a verdict. Composite 91 at seventh of 65 and valuation 86 at tied fourth of 67 are the strongest percentiles in this batch, and underneath them sit <code>op_margin_3y</code> -41.14% at 55th of 70, <code>rev_cagr_5y</code> -47.07% at 68th of 70, <code>roe_3y</code> -9.45% at 61st of 66, operating profit negative in nine years across the ten-year record, and a trailing year for which the pack cannot compute either an operating or a net growth figure. The percentiles are not wrong arithmetic; they are correct arithmetic on a price divided by earnings that are not there, and <code>ev_ebitda_ttm</code> 1.357x at 44th of 44 is what that looks like from the other side. Two further facts belong in the file rather than in a recommendation: the company describes itself as an investment-holding company while being ranked against developers, and its <code>fii_pct</code> went from 38.86% to 0.00% in a single quarter with the public holding moving the other way by the same amount. A ₹106cr market capitalisation at 57th of 72 is small enough that none of this needs resolving urgently — but a verdict on this row would be a verdict on the scorer, not on the company. Confidence is low.</i>",
 ],
 "trigger": "ttm_op_pct and ttm_np_pct becoming non-NULL with operating profit positive for two consecutive years -> there would be an earnings base to value, and a verdict could be written. rev_cagr_5y staying below -40% with operating profit negative again -> the valuation percentile of 86 is measuring a price against nothing, and the no-verdict label stays.",
 "evidence": ["op_margin_3y", "rev_cagr_5y", "roe_3y", "np_consistency_10y", "np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "roe_avg_above_threshold_10y", "cfo_sales_3y", "fcf_yield", "debt_equity", "inv_days", "div_yield", "opm_prev", "opm_now", "ttm_sales_pct", "sales_yoy_q", "np_yoy_q", "pe_ttm", "pb", "ev_ebitda_ttm", "fii_pct", "dii_pct", "shareholders", "promoter_pct", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d"],
},

}

# Guard 11 reads the count out of the pack's own annual rows and the prose has
# to state it in words, so a rerun that changes a year fails the build.
NEGWORD = {0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
           6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
NOZERO_PHRASE = "no negative operating cash year"

# SIL's problem is the operating line, not the cash line, so its count is
# checked separately and against operating_profit.
OPNEG = {"SIL": 9}

# CHOICE 11. The six comparable rows end 2026-06-30; OBEROIRLTY does not.
WINDOW_BATCH = ["2025-09-30", "2026-06-30"]
WINDOW_HELD = ["2025-12-31", "2026-09-30"]


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These cover
    the third category — structural claims neither pass can see. The three this
    batch forced into existence are 11 (the cash count is read out of the annual
    rows, not out of the pack's own unreliable ratio), 9 (a band wider than 5x
    may not price a row) and 18 (a plain-English phrase naming a column this
    cluster does not carry).
    """
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

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. One cohort this time, but the count still has to match the bucket
        #    the scorer actually used rather than the cluster size.
        want = TIER_SENTENCE.get(tier)
        if want is None:
            errs.append(f"{sym}: tier={tier} has no cohort sentence")
        elif want not in p0:
            errs.append(f"{sym}: tier={tier} but point one does not carry the "
                        f"{tier} cohort sentence")
        stated = re.search(r"against (\d+) (?:veteran|mid|mature)-tier peers",
                           p0)
        if not stated:
            errs.append(f"{sym}: point one states no cohort size")
        elif int(stated.group(1)) != n:
            errs.append(f"{sym}: point one says {stated.group(1)} peers, "
                        f"peer_ranks says {n}")

        # 3. Per-symbol, kept from chemicals_agro: every row here is `full`,
        #    which is exactly why the guard stays — the next cluster will not be.
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
            if "tech_net_score_scaled" in pt and MOM95 not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside MOM95")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. Every row here holds 13 distinct sessions, which is a single-day
        #    print repeated. The word is banned outright.
        for pt in allprose:
            if re.search(r"deliver", pt, re.I):
                errs.append(f"{sym}: quotes delivery off "
                            f"{(p.get('delivery') or {}).get('sessions')} "
                            f"sessions — a single-day print")

        # 7. np_consistency is an index 0-2, never a pass rate.
        for pt in pts:
            if re.search(r"np_consistency\w*</code>\s*[\d.]+\s*(?:of|in)\s",
                         pt):
                errs.append(f"{sym}: np_consistency written as a pass rate")

        # 8. Every evidence key must resolve non-NULL in THIS row's own
        #    cluster_metrics or verdict-load.py rejects the whole row. Here
        #    np_cagr_5y, ttm_op_pct and ttm_np_pct are NULL on some rows and
        #    not others.
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics "
                            f"(tier={tier})")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")

        # 9. CHOICE 3, and new in this batch. A band whose high is more than
        #    BAND_RATIO_MAX times its low does not locate a price — it records
        #    an earnings denominator going near zero in some year. Four rows
        #    here are in that state and may quote no band figure at all; the
        #    other three must state the band and state it correctly.
        band = p.get("pe_band") or {}
        lo, hi, avg = band.get("lo"), band.get("hi"), band.get("avg")
        wide = (not band) or not lo or (hi / lo) > BAND_RATIO_MAX
        if wide:
            if BANDWIDE not in p0:
                errs.append(f"{sym}: band is {hi}/{lo} wide and point one does "
                            f"not carry BANDWIDE")
            for pt in allprose:
                if re.search(r"own \w+-year band", pt):
                    errs.append(f"{sym}: quotes its own band, which is "
                                f"{hi}/{lo} = too wide to price the row")
                for fig in (lo, hi, avg):
                    if fig is not None and f"{fig:.2f}x" in pt:
                        errs.append(f"{sym}: states band figure {fig:.2f}x on "
                                    f"a row whose band is banned")
        else:
            if BANDWIDE in joined:
                errs.append(f"{sym}: carries BANDWIDE but its band is "
                            f"{hi}/{lo}, inside the {BAND_RATIO_MAX}x limit")
            got = 0
            for pt in allprose:
                for yr, blo, bhi, bavg in re.findall(
                        r"own (\w+)-year band runs ([\d.]+)-([\d.]+)x"
                        r" with an average of ([\d.]+)x", pt):
                    got += 1
                    if _YEAR_WORD.get(yr.lower()) != band.get("n"):
                        errs.append(f"{sym}: says {yr}-year band, pack "
                                    f"n={band.get('n')}")
                    if (abs(float(blo) - lo) > 0.005
                            or abs(float(bhi) - hi) > 0.005):
                        errs.append(f"{sym}: band {blo}-{bhi} vs pack "
                                    f"{lo}-{hi}")
                    if abs(float(bavg) - avg) > 0.005:
                        errs.append(f"{sym}: band average {bavg} vs pack {avg}")
            for pt in allprose:
                for bavg in re.findall(
                        r"own \w+-year (?:band |)average(?: of|) ([\d.]+)x",
                        pt):
                    if abs(float(bavg) - avg) > 0.005:
                        errs.append(f"{sym}: restates the band average as "
                                    f"{bavg}x, pack says {avg}")
            if not got:
                errs.append(f"{sym}: band is usable ({lo}-{hi}x, n="
                            f"{band.get('n')}) but no point states it")

        # 10. Every <code> key in prose must exist and be non-NULL in THIS
        #     row's cluster_metrics. This is the general form; guard 18 is the
        #     half it cannot see.
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

        # 11. THE NEW ONE, and the spine of the batch. The pack's cash flag is
        #     a one-year ratio with a lumpy denominator, so the claim is made on
        #     the count of negative operating-cash years in the annual rows.
        #     The count is recomputed here, so a rerun that changes a year fails
        #     the build rather than leaving the prose stale. Two rows may not use
        #     the word "deterioration" and they are forbidden for two different
        #     reasons, which is why CASHYRS stores a reason and not a boolean.
        annual = p.get("annual") or []
        yrs = [r for r in annual if r.get("cash_from_operating") is not None]
        if len(yrs) != 10:
            errs.append(f"{sym}: pack has {len(yrs)} annual cash rows, not 10 "
                        f"— every count in the prose is stated out of ten")
        neg = sum(1 for r in yrs if r["cash_from_operating"] < 0)
        want_neg, want_ratio, refused = CASHYRS[sym]
        if neg != want_neg:
            errs.append(f"{sym}: CASHYRS says {want_neg} negative "
                        f"operating-cash years, the annual rows say {neg}")
        phrase = (NOZERO_PHRASE if not neg
                  else f"negative in {NEGWORD[neg]} year")
        if phrase not in joined:
            errs.append(f"{sym}: no point states the cash count "
                        f"('{phrase}')")
        eq = p.get("earnings_quality") or {}
        gotr = eq.get("cfo_op_latest")
        if gotr is None or abs(float(gotr) - want_ratio) > 0.0005:
            errs.append(f"{sym}: CASHYRS says cfo_op_latest={want_ratio}, pack "
                        f"says {gotr}")
        if sym in OPNEG:
            opneg = sum(1 for r in annual
                        if (r.get("operating_profit") or 0) < 0)
            if opneg != OPNEG[sym]:
                errs.append(f"{sym}: OPNEG says {OPNEG[sym]} negative "
                            f"operating-profit years, annual rows say {opneg}")
            if f"negative in {NEGWORD[opneg]} year" not in joined:
                errs.append(f"{sym}: no point states the operating-loss count")
        flags = eq.get("flags") or []
        if sym in CASH_FLAGGED:
            if not flags:
                errs.append(f"{sym}: in CASH_FLAGGED but the pack now carries "
                            f"no earnings-quality flag")
            if CASH not in joined:
                errs.append(f"{sym}: flagged on cash but carries no CASH "
                            f"sentence")
        else:
            if flags:
                errs.append(f"{sym}: pack carries {len(flags)} "
                            f"earnings-quality flag(s) but is not in "
                            f"CASH_FLAGGED")
            if CASH in joined:
                errs.append(f"{sym}: carries the CASH sentence with no flag")
        said = [i + 1 for i, pt in enumerate(pts)
                if re.search(r"deteriorat", pt, re.I)]
        if refused:
            if said:
                errs.append(f"{sym}: point(s) {said} call the cash number a "
                            f"deterioration, refused here as '{refused}'")
            if DETERIORATION in joined:
                errs.append(f"{sym}: carries DETERIORATION, refused here as "
                            f"'{refused}'")
            needed = ARTEFACT if refused == "artefact" else STALE
            if needed not in joined:
                errs.append(f"{sym}: refused as '{refused}' but carries no "
                            f"sentence saying why")
        else:
            if DETERIORATION not in joined and sym in CASH_FLAGGED:
                errs.append(f"{sym}: flagged, not refused, but carries no "
                            f"DETERIORATION sentence")
            for other, text in (("artefact", ARTEFACT), ("stale", STALE)):
                if text in joined:
                    errs.append(f"{sym}: carries the '{other}' refusal but is "
                                f"not refused")

        # 12. CHOICE 11. One row's TTM window is a quarter ahead of the rest of
        #     the batch, so its TTM figures are not comparable across rows.
        win = (p.get("ttm_vs_prior") or {}).get("window")
        if sym == WINDOW_SYM:
            if WINDOW not in p0:
                errs.append(f"{sym}: point one does not carry WINDOW")
            if win != WINDOW_HELD:
                errs.append(f"{sym}: WINDOW says {WINDOW_HELD}, pack says "
                            f"{win}")
        else:
            if WINDOW in joined:
                errs.append(f"{sym}: carries WINDOW but its window is {win}")
            if win is not None and win != WINDOW_BATCH:
                errs.append(f"{sym}: window {win} differs from the batch "
                            f"{WINDOW_BATCH} and no point says so")

        # 13. CHOICE 7. Three rows' TTM growth is computed against the year
        #     before a one-year margin step, so a point quoting a TTM figure on
        #     those rows must carry STEP in the SAME point — a caveat in a
        #     different point is a caveat the reader does not reach.
        if sym in MARGINSTEP:
            prev, now, step = MARGINSTEP[sym]
            tv = p.get("ttm_vs_prior") or {}
            for field, wanted in (("opm_prev", prev), ("opm_now", now)):
                if tv.get(field) != wanted:
                    errs.append(f"{sym}: MARGINSTEP says {field}={wanted}, "
                                f"pack says {tv.get(field)}")
            gotstep = round((eq.get("opm_step") or 0) * 100, 2)
            if abs(gotstep - step) > 0.005:
                errs.append(f"{sym}: MARGINSTEP says a {step} point step, pack "
                            f"says {gotstep}")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in TTM_FIELDS) \
                        and STEP not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes a TTM growth "
                                f"figure computed on a stepped base without "
                                f"STEP in the same point")
        elif STEP in joined:
            errs.append(f"{sym}: carries STEP but the pack flags no margin "
                        f"step on this row")

        # 14. CHOICE 8. The inverse of chemicals_agro's floor. The thinnest
        #     metric in this cluster is read by 27 peers, so a denominator under
        #     27 cannot be a real rank here — it is a fabricated or a copied
        #     one, and that is exactly the failure a batch is most likely to
        #     carry in from the previous cluster.
        for pt in allprose:
            for d in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                if int(d) < DENOM_FLOOR:
                    errs.append(f"{sym}: states a denominator of {d}; nothing "
                                f"in this cluster is read by fewer than "
                                f"{DENOM_FLOOR} peers")

        # 15. CHOICE 5. The label is the finding, so the headline must carry it,
        #     point one must carry the explanation, and no other row may use it.
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

        # 16. MOM95 exactly once per row.
        if sym in MOM95_SYMS:
            got = sum(MOM95 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM95 appears {got}x in the points, "
                            f"expected exactly 1")

        # 17. CHOICE 10. ema_stack_bull is 0.000 on all seven rows and tied
        #     ninth of 64 in a 56-way tie. Banned rather than caveated.
        for pt in allprose:
            if EMAFLAT in pt:
                errs.append(f"{sym}: names {EMAFLAT}, which is 0.000 for every "
                            f"row here and tied across 56 of 64 names")

        # 18. CHOICE 4. The half guard 10 cannot see. These phrases resolve, in
        #     the ranks checker's own vocabulary, to columns this cluster does
        #     not carry — so a sentence lifted from chemicals_agro or
        #     it_services reads perfectly and attributes its rank to nothing.
        scrub = joined + " " + v["trigger"] + " " + v["verdict"]
        for ex in PHRASE_EXEMPT:
            scrub = scrub.replace(ex, " ")
        low = scrub.lower()
        for ph in BANNED_PHRASES:
            if ph in low:
                errs.append(f"{sym}: prose says '{ph}', which names a column "
                            f"realty does not carry")

        # 19. No promoter figure for a row whose promoter_pct is NULL.
        if live.get("promoter_pct") is None and any(
                re.search(r"promoter", pt, re.I) for pt in allprose):
            errs.append(f"{sym}: names promoter but promoter_pct is NULL")

        # 20. CHOICE 6. The annuity comparison is stated on the row it is about
        #     and on the rows it is used against, and nowhere else — repeated on
        #     all seven it becomes boilerplate the reader skips.
        has = ANNUITY in joined
        if has != (sym in ANNUITY_SYMS):
            errs.append(f"{sym}: ANNUITY present={has}, expected "
                        f"{sym in ANNUITY_SYMS}")

        # 21. A pillar percentile computed on part of its declared weight may
        #     be quoted only alongside what is missing underneath it. Unlike
        #     MOM95 this is NOT uniform, so the renormalisation sits in the SAME
        #     point and the figure is banned from headline and trigger.
        if sym in PILLAR_WEIGHT:
            pillar, phr = PILLAR_WEIGHT[sym]
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
