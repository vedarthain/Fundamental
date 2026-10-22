"""it_services_midsmall — the 8 tracked names, written against the real peer set.

WHY THIS FILE IS SHAPED THIS WAY

Fifth batch written with `peer_ranks` in the pack and the generic pass-2
checker, so the established rules hold unchanged: every denominator is a
per-metric READING COUNT rather than the cohort size, the cohort sentence names
the bucket the scorer actually used, and the guards below cover the structural
claims neither pass can see.

What is specific to this batch:

CHOICE 1 — THREE MATURITY TIERS IN ONE CLUSTER, AND THEY ARE NOT COMPARABLE.

`scoring/scorer.py` peers on `(cluster_id, maturity_tier)`. Here that splits
eight tracked names three ways: veteran holds 86 (BSOFT, CALSOFT, COFORGE,
CYIENT, PERSISTENT, ZENSARTECH), mature holds 33 (RATEGAIN), mid holds 33
(BLSE). All three clear `MIN_PEERS = 10`, so all eight rows are
`score_status = 'full'` and none needs the mixed-tier caveat.

The part that matters is not the cohort size, it is the PILLAR WEIGHTS. Veteran
is q50/v30/m20, mature is q45/v30/m25, mid is q40/v30/m30. A composite of 83 in
the veteran bucket and a composite of 75 in the mature bucket are not the same
number computed on different peers — they are different numbers. Guard 19
requires the two non-veteran rows to say so, and no row in this batch compares
its composite to a row in another tier.

CHOICE 2 — THE FIRST BATCH WHERE DENOMINATORS ARE MOSTLY HEALTHY.

86 veteran peers is the largest cohort written so far, and the per-metric counts
under it are real: `pe_ttm` 69, `ev_ebitda_ttm` 69, `np_cagr_5y` 61, `peg` 46,
`div_yield` 37. Nothing in the veteran prose needs a floor. The exception is
BLSE (CHOICE 5).

CHOICE 3 — `cfo_pat_3y` DOES NOT EXIST IN THIS CLUSTER, AND THE CHECKER THINKS
IT DOES.

This cluster scores cash on `cfo_ebitda_3y` / `cfo_ebitda_5y`, not
`cfo_pat_3y`. But `WORD_DIMS` in `verdict-ranks-check.py` maps the English
phrase "cash conversion" to `cfo_pat_3y`, because four previous clusters used
that column. So the words "cash conversion" written anywhere near a rank in
THIS batch attribute the claim to a column the pack does not hold.

The same trap exists for "book value" -> `pb`, which this cluster also does not
carry. Neither phrase appears below. Guard 11 is the general form of the fix:
every `<code>` key in the prose must exist and be non-NULL in that symbol's own
`cluster_metrics`, which catches a borrowed key from any previous batch rather
than just these two.

CHOICE 4 — THE MOMENTUM PILLAR IS 95 OF 100 FOR ALL EIGHT, AND FOR EVERY
COMPANY ON THE PLATFORM.

`tech_net_score_scaled` is NULL for 3,178 of 3,178 rows in the latest snapshot,
and it carries 5 momentum points. So every momentum percentile in this batch —
and every one on the site — is computed on 95 of its 100 declared points.

This is the opposite of a per-row defect: it is UNIFORM, so it cannot move one
row relative to another and the ranks are unaffected. That is why it gets a
shared sentence and not a per-row caveat, and why the headline is allowed to
quote momentum. Guard 18 requires the sentence in any point that quotes a
momentum percentile. CYIENT's valuation pillar (CHOICE 7) is the other kind and
is handled the other way.

CHOICE 5 — BLSE HAS NO OWN PE HISTORY AT ALL AND TWO UNUSABLE DENOMINATORS.

The pack carries no `pe_band` for BLSE — insufficient usable annual history —
while `pe_ttm` reads 44.60x. A multiple with no own history behind it cannot be
called high or low against itself, only against the bucket, and the row says
that rather than quietly skipping it.

Its mid bucket is 33 names but `peg` is read by 3 of them and `div_yield` by 5.
A rank out of 3 is not a rank. Guard 12 rejects any stated denominator under 9
on this row, so neither appears.

CHOICE 6 — CALSOFT'S ENTIRE SCORECARD IS ONE EVENT.

Four blockers. TTM net profit +1800% (first of 66), TTM operating profit +1172%
(first of 69), operating margin stepped 26.86% -> 81.73% in a single year, and
`cfo_ebitda_3y` is 0.000 — tied 71st of 74, which is the floor. FY2026 collected
-0.175 of operating profit. `dso` is 312.27 days, fourth-longest of 85. There is
no delivery row.

Against that: momentum 94 is first of 85 and composite 93 is seventh of 84. Both
are arithmetic on the event. An 81.73% operating margin is not a software
testing margin, and a 17.25x PE computed on a profit base that grew eighteen-fold
is not a 17.25x PE. Guard 13 requires the artefact sentence in any point quoting
the composite, the momentum percentile, the earnings multiple or a TTM figure,
and forbids the headline from leading on the composite.

CHOICE 7 — CYIENT'S VALUATION PILLAR IS SCORED ON 70 OF 100 POINTS.

`peg` is NULL, and it carries 30 of valuation's 100 points. Unlike CHOICE 4 this
is NOT uniform — it is one row in 86 answering a narrower question than its
peers. Guard 14 requires the renormalisation in the SAME point as the figure and
bans the figure from the headline and the trigger outright.

CHOICE 8 — COFORGE HAS NO PROMOTER AT ALL.

`promoter_pct` is NULL, not zero: there is no promoter group. Guard 15 rejects
any promoter prose on this row and requires the row to say why the field is
absent, because a reader who sees no promoter line will otherwise assume the
pack failed to load one. The institutional register is what replaces it —
`fii_pct` 24.31% first of 74, `dii_pct` 42.62% second of 63.

CHOICE 9 — PERSISTENT'S TTM WINDOW IS A QUARTER AHEAD OF THE OTHER SEVEN.

Its `ttm_vs_prior` window is 2025-12-31 to 2026-09-30; every other row in this
batch is 2025-09-30 to 2026-06-30. PERSISTENT has reported its September quarter
and the rest have not. So its TTM ranks are computed against a mixed field, and
the figure is one quarter fresher than the names it is ranked against. Guard 16
requires the window sentence in any point of this row that quotes a TTM figure.

CHOICE 10 — ZENSARTECH'S TWO MOMENTUM READINGS DISAGREE BY CONSTRUCTION.

`ema_stack_bull` is 1.000, tied first of 81. `pct_above_200ema_252d` is 0.004 —
the close held above its 200-day EMA on four tenths of one per cent of the last
252 sessions, 56th of 71. Both are true: the stack turned bullish recently after
a year spent almost entirely below the average. Quoting either alone is a
one-sided claim, so guard 17 requires both whenever either appears.
"""

import json
import re

PACK = "/tmp/it8.json"
OUT = "build/verdicts/it-services-8-verdicts.json"
SOURCE_REPORT = "it_services_midsmall — 8 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

# Measured against app.portfolio_holding on 2026-10-22, not recalled. BLSE sits
# on BOTH tables; the portfolio is what decides the held/not-held line.
HELD = {"BLSE", "BSOFT", "CYIENT", "ZENSARTECH"}

EMIT = {"BLSE", "BSOFT", "CALSOFT", "COFORGE", "CYIENT", "PERSISTENT",
        "RATEGAIN", "ZENSARTECH"}

VET = ("Peered against 86 veteran-tier peers inside "
       "<code>it_services_midsmall</code> — the scorer's bucket is (cluster, "
       "maturity tier) and this one clears the 10-peer floor comfortably, so "
       "every rank below is against those veterans rather than the whole "
       "cluster, and the row is badged <code>full</code> with no mixed-tier "
       "caveat. Eighty-six peers is more than any cohort written here so far, "
       "but the "
       "per-metric reading counts still run from 37 to 86, so every "
       "denominator below is the metric's own. ")

MAT = ("Peered against 33 mature-tier peers inside "
       "<code>it_services_midsmall</code> — the scorer's bucket is (cluster, "
       "maturity tier), this one clears the 10-peer floor, and the row is "
       "badged <code>full</code> with no mixed-tier caveat. Every denominator "
       "below is the metric's own reading count, not 33. ")

MID = ("Peered against 33 mid-tier peers inside "
       "<code>it_services_midsmall</code> — the scorer's bucket is (cluster, "
       "maturity tier), this one clears the 10-peer floor, and the row is "
       "badged <code>full</code> with no mixed-tier caveat. Every denominator "
       "below is the metric's own reading count, not 33. ")

TIER_SENTENCE = {"veteran": VET, "mature": MAT, "mid": MID}

# CHOICE 1. The two non-veteran rows carry this because their composite is
# computed under a different weighting than the six veteran rows in the same
# batch, and a reader comparing the numbers down the page has no way to know.
TIERW = ("One thing about the number itself: the scorer weights the pillars by "
         "maturity tier, so this composite is 40% quality, 30% valuation and "
         "30% momentum, where the veteran rows in this same cluster are "
         "50/30/20. It is not the veteran composite computed on different "
         "peers; it is a differently weighted number, and the two should not "
         "be read down the page against each other. ")

# CHOICE 4. Uniform across the whole platform, so it moves no row relative to
# another — which is exactly why it reads as a shared sentence rather than a
# per-row defect, and why the headline may still quote the percentile.
MOM95 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 5 of momentum's 100 points, so every "
         "momentum percentile on this platform is scored on 95 points out of a declared 100. It is "
         "uniform, so it cannot move one row relative to another and the "
         "ranks are unaffected — but the pillar is narrower than the "
         "scorecard claims, here and everywhere.")

# CHOICE 5. BLSE only, and the reason no denominator under 9 appears on it.
THIN = ("Two denominators in this bucket are unusable: 3 rows out of the 33 report a "
        "PEG and 5 report a dividend. A rank out of 3 is not a rank, so no "
        "denominator below 9 appears below and neither of those two is quoted "
        "at all. ")

# CHOICE 5, second half. The pack carries no pe_band for this row.
NOBAND = ("And the multiple has no own history to be measured against: there "
          "is not enough usable annual data to build a PE band for this "
          "company, so 44.60x can be called high or low against the bucket "
          "and against nothing else. ")

# CHOICE 6. CALSOFT only.
ARTEFACT = ("Everything below is one event, and the scorecard does not know "
            "that. The operating margin went from 26.86% to 81.73% in a "
            "single year, TTM net profit grew eighteen-fold and TTM operating "
            "profit nearly thirteen-fold. An 81.73% operating margin is not a "
            "software testing margin, and a 17.25x earnings multiple computed "
            "on that base is not a 17.25x multiple on operations. Three-year "
            "operating cash against EBITDA is 0.000, and none of this is an "
            "operating trend. ")

# The short form of the above. Repeating the whole paragraph in every point
# that quotes a distorted figure is bloat a reader skips, and a caveat that is
# skipped is not a caveat — so guard 13 requires the long ARTEFACT in point one
# and this phrase in each later point that leans on the event.
ARTEFACT_TAG = "none of this is an operating trend"

# CHOICE 6, the exemption guard 6 grants to the word it otherwise rejects.
NODELIV = ("There is also no delivery row for this symbol, so accumulation "
           "cannot be separated from churn.")

# CHOICE 8. COFORGE only. An absent field, not a zero one.
NOPROM = ("One field is absent rather than low: there is no "
          "<code>promoter_pct</code> for this company because there is no "
          "promoter group — it is professionally managed and the register is "
          "institutional and public throughout. A missing promoter line here "
          "is the fact, not a failed load. ")

# CHOICE 9. PERSISTENT only.
WINDOW = ("One comparability note before any twelve-month figure: this row's "
          "TTM window is 2025-12-31 to 2026-09-30, because the September "
          "quarter is already reported. Every other name in this batch is "
          "still on 2025-09-30 to 2026-06-30. So the TTM ranks below are one "
          "quarter ahead of the field they are ranked against. ")

# The short form, for the later points. Same reasoning as ARTEFACT_TAG: a
# caveat repeated in full is a caveat the reader skips.
WINDOW_TAG = "one quarter ahead of the field"

# CHOICE 10. ZENSARTECH only. Neither reading may be quoted without the other.
PAIRED = ("<code>ema_stack_bull</code> 1.000 is tied first of 81, a 20-way "
          "tie spanning positions 1 to 20, while "
          "<code>pct_above_200ema_252d</code> 0.004 is tied 56th of 71, a "
          "three-way tie spanning positions 56 to 58 — the close held above "
          "its 200-day EMA on four tenths of one per cent of the last 252 "
          "sessions. Both are true and they are not in conflict: the "
          "short-term stack turned up recently after a year spent almost "
          "entirely below the average. ")

# Metrics NULL for >=99% of the universe in this snapshot. Naming one is a
# claim about a number the platform does not hold.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "book_value_cagr_5y",
        "cfo_pat_latest", "roce_latest", "op_margin_latest")

# <code> tags that are legitimately not metrics of this cluster.
CODE_ALLOW = {"it_services_midsmall", "full", "tech_net_score_scaled",
              "promoter_pct"}

# CHOICE 6 / CHOICE 5. Rows the pack flagged, and the phrase each row's prose
# must carry. Two rows, two unrelated defects: BLSE's collection HALVED from a
# healthy level, CALSOFT's never existed.
EQ_FLAGGED = {
    "BLSE": "the fall is the flag, not the level",
    "CALSOFT": "none of this is an operating trend",
}

# CHOICE 7. Not uniform, unlike MOM95 — one row answering a narrower question
# than its 85 peers. Same-point rule in the points, banned outright in the
# headline and the trigger.
PILLAR_WEIGHT = {
    "CYIENT": ("valuation", "70 of its 100 declared points"),
}

MOM95_SYMS = EMIT          # every row that quotes a momentum percentile
TIERW_SYMS = {"BLSE", "RATEGAIN"}
FLOOR_SYMS = {"BLSE"}
DENOM_FLOOR = 9

_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}
_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
_CODE_RX = re.compile(r"<code>([a-z0-9_]+)</code>")


SPEC = {

# ---------------------------------------------------------------- veterans

"BSOFT": {
 "confidence": "medium",
 "verdict": "HOLD — composite 70, 26th of 84 veteran peers, at 15.48x against an own ten-year band averaging 17.61x, with five-year profit growth of 2.83%, 46th of 61",
 "points": [
  "<b>Held — BSOFT is in your portfolio.</b> Birlasoft, ₹8,868cr and 12th of 86 by market cap in this bucket — global technology services and consulting under the CKA Birla Group, three segments (Digital and Data; ERP; Infrastructure and Cloud), with 86% of FY26 revenue from the Americas; <code>promoter_pct</code> is 40.38%, 55th of 83. " + VET + "Quality 60, valuation 50, momentum 50, composite 70.",
  "<b>The margin went up and the revenue did not.</b> <code>opm_now</code> 17.21% against <code>opm_prev</code> 12.40% at 46th of 83 is a 4.8-point step in one year, and <code>ttm_op_pct</code> +40.67% is 19th of 69 with <code>ttm_np_pct</code> +21.13% at 19th of 66 — while <code>ttm_sales_pct</code> +1.35% is 65th of 82. Twelve months of almost no revenue growth turned into forty per cent more operating profit, which is cost, not demand, and cost stories finish. <code>roce_3y</code> 22.04% is 23rd of 86 and <code>roce_5y</code> 21.50% is 22nd of 86 — the same answer over both windows, so the return is structural. <code>cfo_ebitda_3y</code> 0.679 is 26th of 74 and <code>cfo_ebitda_5y</code> 0.672 is 23rd of 73: about two thirds of EBITDA has reached operating cash over both windows. FY2026 collected 0.555 of operating profit against a prior-years mean of 0.804, which the pack does not flag but is the direction to watch.",
  "<b>Five years of growth is what you are actually buying, and it is not there.</b> <code>np_cagr_5y</code> 2.83% is 46th of 61 and <code>rev_cagr_5y</code> 6.48% is 66th of 83 — the bottom quartile of this cohort on the five-year revenue line. Five-year profit growth above inflation 0.250 is tied 63rd of 86, a 19-way tie spanning positions 63 to 81: one of the last four years beat inflation. Ten-year profit consistency 1.739 is tenth of 81, so the shape of the record is good while the slope is not — consistency measures how steady the line is, not which way it points. <code>op_margin_trend_7y</code> 0.003 is 32nd of 85 and <code>op_margin_3y</code> 15.04% is 36th of 84. <code>np_yoy_q</code> +51.27% is 23rd of 86 against <code>sales_yoy_q</code> +7.35% at 54th of 83 — the same split, one quarter at a time.",
  "<b>Cheap against itself and dear against its own growth.</b> <code>pe_ttm</code> 15.48x is 47th of 69 and the own ten-year band runs 6.44-32.82x with an average of 17.61x, so the stock trades a little under its own decade mean rather than at a discount to it. <code>ev_ebitda_ttm</code> 8.46x is 46th of 69 and <code>ev_sales_ttm</code> 1.58x is 53rd of 83. Then <code>peg</code> 5.473 is third of 46 — growth-adjusted this is one of the dearest rows in the cohort, because the denominator is that 2.83% five-year profit CAGR. <code>fcf_yield</code> 6.36% is 25th of 86 and the 2.05% dividend is 11th of 37. <code>dso</code> 83.35 days is 48th of 85. The chart: <code>ret_3m_rel</code> +18.17% is 15th of 81, <code>ret_6m_rel</code> -10.71% is 57th of 81, <code>ret_12m_rel</code> -10.03% is 28th of 76, <code>ema_stack_bull</code> 1.000 is tied first of 81 in a 20-way tie spanning positions 1 to 20, and the close held above its 200-day EMA on 16.67% of the last 252 sessions, 33rd of 71. <code>fii_pct</code> 12.78% is ninth of 74, <code>dii_pct</code> 21.98% is tied sixth of 63 in a two-way tie at that figure, and <code>shareholders</code> 400,850 is fifth of 86. " + MOM95,
  "<i>Holding BSOFT is a bet that the margin step was the first half of something. Return on capital 22.04% is 23rd of 86 and <code>roce_5y</code> 21.50% is 22nd of 86 — solid, not special. <code>pe_ttm</code> 15.48x against an own ten-year band averaging 17.61x is the cheapest this has looked against itself in a decade, and <code>peg</code> 5.473 at third of 46 is why: <code>rev_cagr_5y</code> 6.48% is 66th of 83 and <code>np_cagr_5y</code> 2.83% is 46th of 61. The TTM reads +40.67% operating profit on +1.35% revenue, which is margin and not demand. <code>cfo_ebitda_3y</code> 0.679 at 26th of 74 is adequate; FY2026's 0.555 against a 0.804 prior mean is not yet a problem and would become one next year. Confidence is medium: the record is clean, the growth is the question, and nothing in this pack tells you whether the next quarter brings revenue.</i>",
 ],
 "trigger": "rev_cagr_5y lifting toward double digits with ttm_sales_pct following it -> the 40.67% operating profit growth is demand rather than cost and peg 5.473 collapses on its own. opm_now slipping back under 14% while ttm_sales_pct stays near 1% -> the margin step reverses and 15.48x is not the floor it looks like.",
 "evidence": ["opm_now", "opm_prev", "ttm_op_pct", "ttm_np_pct", "ttm_sales_pct", "roce_3y", "roce_5y", "cfo_ebitda_3y", "cfo_ebitda_5y", "np_cagr_5y", "rev_cagr_5y", "np_growth_above_inflation_5y", "np_consistency_10y", "op_margin_trend_7y", "op_margin_3y", "np_yoy_q", "sales_yoy_q", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "fcf_yield", "div_yield", "dso", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"CALSOFT": {
 "confidence": "low",
 "verdict": "WATCH — quality 58, tied 33rd of 86 veteran peers, on an operating margin that stepped from 26.86% to 81.73% in one year with nothing in operating cash behind it",
 "points": [
  "<b>Not held — CALSOFT is on your watchlist.</b> California Software, ₹252cr and 56th of 86 by market cap in this bucket — software testing and validation of applications and products, which is the entirety of the disclosed business. " + ARTEFACT + VET + "Quality 58, valuation 51, momentum 94, composite 93.",
  "<b>The margin is the tell.</b> <code>opm_now</code> 81.73% is first of 83 against <code>opm_prev</code> 26.86% at tenth of 83 — a 54.9-point step in a single year. <code>op_margin_3y</code> 47.15% is first of 84, so the three-year average is already carrying the event rather than averaging it away. <code>ttm_np_pct</code> +1800.0% is first of 66 while <code>ttm_op_pct</code> +1171.7% is first of 69: net profit outran operating profit by 49 points and that difference sits below EBIT — other income, a one-off, tax or interest, not trading. <code>sales_yoy_q</code> +327.74% is second of 83 and <code>np_yoy_q</code> +2105.26% is third of 86, so the quarter says the same thing the year does. And " + ARTEFACT_TAG + " — the three-year averages will carry it for two more years.",
  "<b>There is no cash and the receivables are most of a year long.</b> <code>cfo_ebitda_3y</code> 0.000 is tied 71st of 74 in a four-way tie spanning positions 71 to 74, and <code>cfo_ebitda_5y</code> 0.000 is tied 71st of 73 in a three-way tie spanning positions 71 to 73 — over three years and over five, none of EBITDA reached operating cash. FY2026 collected -0.175 of operating profit against a prior-years mean of -1.051, so the negative is the norm here and not the exception. <code>dso</code> 312.27 days is fourth of 85: the revenue is invoiced and not collected. <code>fcf_yield</code> -0.68% is 63rd of 86. That is the floor of this cohort on the cash line, and it sits directly underneath the highest operating margin in it.",
  "<b>The chart is the best in this cohort and it is the same event again.</b> <code>ret_6m_rel</code> +170.71% is first of 81, <code>ret_12m_rel</code> +75.92% is first of 76 and <code>ret_3m_rel</code> +56.44% is third of 81 — momentum 94 is first of 85 on those three alone, and " + ARTEFACT_TAG + ". <code>pe_ttm</code> 17.25x is 40th of 69 and looks ordinary, which is the trap: the own nine-year band runs 3.51-92.83x with an average of 42.05x, and that is not a band. <code>ev_sales_ttm</code> 10.04x at fifth of 83 is the honest valuation reading, because revenue cannot be restated by one line below EBIT. <code>ema_stack_bull</code> 0.000 puts it in a 61-way tie spanning positions 21 to 81, and the close held above its 200-day EMA on 63.89% of the last 252 sessions, tied fourth of 71 in a two-way tie. <code>fii_pct</code> 0.03% is tied 58th of 74 in a three-way tie and <code>shareholders</code> 18,115 is 68th of 86 — nobody institutional is here. " + NODELIV + " " + MOM95,
  "<i>Composite 93 at seventh of 84 and momentum 94 at first of 85 are the two highest numbers this platform will ever show you about CALSOFT, and " + ARTEFACT_TAG + ". The operating margin went 26.86% to 81.73%, TTM net profit grew eighteen-fold, and <code>cfo_ebitda_3y</code> 0.000 is tied 71st of 74 — a company earning an 81.73% operating margin and collecting none of it is describing an accounting event rather than a business. <code>dso</code> 312.27 days at fourth of 85 and FY2026 operating cash at -0.175 of operating profit are that same sentence said twice. ₹252cr of market cap, 18,115 shareholders, no dividend column, no institutional holding worth naming, and nothing to separate accumulation from churn. Confidence is low and the answer is to leave it alone: there is nothing here to value until one full year is reported without the event inside it.</i>",
 ],
 "trigger": "four consecutive quarters reported with opm_now back in the twenties and cfo_ebitda_3y above 0.40 -> there is an operating business underneath the event and it can be valued for the first time. dso staying above 300 days with another year of 0.000 three-year operating cash against EBITDA -> the revenue is not collectable and the 81.73% margin was never real.",
 "evidence": ["opm_now", "opm_prev", "op_margin_3y", "ttm_np_pct", "ttm_op_pct", "sales_yoy_q", "np_yoy_q", "cfo_ebitda_3y", "cfo_ebitda_5y", "dso", "fcf_yield", "pe_ttm", "ev_sales_ttm", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "shareholders"],
},

"COFORGE": {
 "confidence": "medium",
 "verdict": "WATCH — valuation 26, tied 71st of 84 veteran peers, with foreign institutions at 24.31%, first of 74, and no promoter holding at all",
 "points": [
  "<b>Not held — COFORGE is on your watchlist.</b> Coforge, ₹86,906cr and third of 86 by market cap in this bucket — AI-led engineering, cloud and data services, quality engineering and managed services across banking, insurance, travel, public sector, hi-tech and healthcare, sold in North and South America, Europe, the Middle East, India and Asia-Pacific. " + NOPROM + VET + "Quality 64, valuation 26, momentum 81, composite 74.",
  "<b>The growth is real and it is accelerating.</b> <code>rev_cagr_5y</code> 26.37% is 17th of 83 and <code>np_cagr_5y</code> 23.83% is 20th of 61 — top quintile of the cohort on both five-year lines. The latest twelve months are faster than that: <code>ttm_sales_pct</code> +35.68% is 15th of 82, <code>ttm_op_pct</code> +72.84% is ninth of 69 and <code>ttm_np_pct</code> +76.36% is tenth of 66, with <code>opm_now</code> 18.63% against <code>opm_prev</code> 14.63% at 37th of 83. The quarter agrees — <code>sales_yoy_q</code> +49.22% is tenth of 83 and <code>np_yoy_q</code> +63.39% is 21st of 86. <code>roce_3y</code> 22.38% is 21st of 86 and <code>roce_5y</code> 24.84% is 15th of 86, so the capital is earning while the revenue compounds, which is the combination this cluster mostly lacks.",
  "<b>What it does not do is turn that into cash.</b> <code>cfo_ebitda_3y</code> 0.532 is 45th of 74 and <code>cfo_ebitda_5y</code> 0.558 is 46th of 73 — mid-pack, with about half of EBITDA reaching operating cash over both windows, and FY2026 collected 0.610 of operating profit against a prior-years mean of 0.698. <code>fcf_yield</code> -0.20% is 57th of 86: after capex there is nothing left, on a company growing revenue at 35.68% over twelve months. <code>dso</code> 88.34 days is 45th of 85. <code>op_margin_3y</code> 15.997% is 30th of 84 and <code>op_margin_trend_7y</code> -0.002 is 46th of 85, so seven years of margin went nowhere — the recent step is recent. Ten-year profit consistency 1.638 is 26th of 81 and ten-year profit growth above inflation 0.667 is tied 17th of 85 in a 19-way tie spanning positions 17 to 35 in a four-way tie spanning positions 11 to 14.",
  "<b>Everything good about it is in the price, and that is what valuation 26 is saying.</b> <code>pe_ttm</code> 49.47x is 12th of 69, <code>ev_ebitda_ttm</code> 21.25x is 12th of 69 and <code>ev_sales_ttm</code> 4.76x is 12th of 83 — the same position on three independent measures, which is harder to argue with than any one of them. <code>peg</code> 2.076 is 17th of 46 and the 0.61% dividend is 31st of 37. The own ten-year band runs 2.14-66.78x with an average of 13.52x, which spans a loss year at the low end and is too wide to anchor anything; the cohort comparison is the usable one. The chart is working: <code>ret_6m_rel</code> +68.45% is fifth of 81, <code>ret_3m_rel</code> +39.80% is seventh of 81, <code>ret_12m_rel</code> +13.37% is 14th of 76, <code>ema_stack_bull</code> 1.000 is tied first of 81 in a 20-way tie spanning positions 1 to 20, and the close held above its 200-day EMA on 50.40% of the last 252 sessions, 12th of 71. Ownership is the story: <code>fii_pct</code> 24.31% is first of 74, <code>dii_pct</code> 42.62% is second of 63, <code>shareholders</code> 340,980 is seventh of 86. " + MOM95,
  "<i>COFORGE is the best operating record in this batch and the hardest price to defend. Revenue compounding at 26.37%, TTM operating profit +72.84%, return on capital 22.38% and <code>roce_5y</code> 24.84% at 15th of 86 — against <code>pe_ttm</code> 49.47x at 12th of 69, <code>ev_sales_ttm</code> 4.76x at 12th of 83 and <code>fcf_yield</code> -0.20% at 57th of 86. Institutions own two thirds of it with no promoter anywhere, which cuts both ways: no family overhang, and no anchor if the growth slows. The number that would change my mind is free cash flow, not revenue: <code>cfo_ebitda_3y</code> 0.532 at 45th of 74 on a 49.47x multiple means you are paying a quality price for average collection. Confidence is medium — the record supports the business and nothing in this pack supports the multiple.</i>",
 ],
 "trigger": "fcf_yield turning positive with cfo_ebitda_3y above 0.65 while revenue stays near 25% -> growth that funds itself, and 49.47x is a quality premium rather than a bet. ttm_sales_pct decelerating under 15% with pe_ttm still above 45x -> the multiple is carrying the whole thesis and the growth that justified it has stopped.",
 "evidence": ["rev_cagr_5y", "np_cagr_5y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "sales_yoy_q", "np_yoy_q", "roce_3y", "roce_5y", "cfo_ebitda_3y", "cfo_ebitda_5y", "fcf_yield", "dso", "op_margin_3y", "op_margin_trend_7y", "np_consistency_10y", "np_growth_above_inflation_10y", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "div_yield", "ret_6m_rel", "ret_3m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders"],
},

"CYIENT": {
 "confidence": "medium",
 "verdict": "HOLD — ten-year profit consistency 1.810, first of 81 veteran peers, on a company whose five-year profit growth is -4.86%, 53rd of 61",
 "points": [
  "<b>Held — CYIENT is in your portfolio.</b> Cyient, ₹12,950cr and ninth of 86 by market cap in this bucket — lifecycle engineering services, engineering-led manufacturing and IP-led silicon innovation across three segments (Cyient DET, Cyient DLM, Cyient Semiconductors); <code>promoter_pct</code> is 24.70%, 73rd of 83, with the register held mostly by institutions. " + VET + "Quality 59, valuation 42 — scored on 70 of its 100 declared points, because this row reports no growth-adjusted multiple — momentum 61, composite 64.",
  "<b>The most consistent ten-year profit record in the cohort belongs to a company whose profit is shrinking.</b> Ten-year profit consistency 1.810 is first of 81 — no veteran peer here has a steadier decade. Then <code>np_cagr_5y</code> -4.86% is 53rd of 61 and <code>ttm_np_pct</code> -39.55% is 56th of 66, with <code>ttm_op_pct</code> -15.26% at 53rd of 69 and <code>ttm_sales_pct</code> +3.19% at 62nd of 82. <code>np_yoy_q</code> -32.31% is 72nd of 86. Both readings are correct and they measure different things: consistency scores how steady the line is, not which way it points, and a steadily declining profit scores well on it. Five-year profit growth above inflation 0.250 is tied 63rd of 86 in a 19-way tie spanning positions 63 to 81, which is the same fact told properly.",
  "<b>Margins down, collection up.</b> <code>opm_now</code> 12.23% against <code>opm_prev</code> 14.89% at 36th of 83 is 2.7 points of operating margin gone in a year, and <code>op_margin_3y</code> 15.35% is 33rd of 84 with <code>op_margin_trend_7y</code> 0.001 at 38th of 85 — seven years flat. <code>roce_3y</code> 16.22% is 36th of 86 and <code>roce_5y</code> 17.07% is 37th of 86, mid-pack on both. Against that, the cash is improving while the profit falls: <code>cfo_ebitda_3y</code> 0.564 is 41st of 74, FY2026 collected 0.876 of operating profit against a prior-years mean of 0.645, and <code>fcf_yield</code> 5.36% is 29th of 86. <code>dso</code> 65.56 days is 63rd of 85 — among the shortest collection cycles in the cohort, which is the one operational thing getting better.",
  "<b>The price went up 47% relative in three months while the earnings went down 39.55%.</b> <code>pe_ttm</code> 40.75x is 14th of 69 and the own ten-year band runs 7.36-32.47x with an average of 19.24x — the stock trades above everything in its own decade and at more than twice its own mean, on a falling profit line. <code>ev_ebitda_ttm</code> 9.80x is 38th of 69 and <code>ev_sales_ttm</code> 1.56x is 54th of 83, both of which look reasonable precisely because the denominator has not fallen the way net profit has. Valuation 42 is tied 51st of 84 and is scored on 70 of its 100 declared points, and this row reports no growth-adjusted multiple at all, because there is no growth to divide by. The chart: <code>ret_3m_rel</code> +47.25% is fifth of 81, <code>ret_6m_rel</code> +39.37% is seventh of 81, <code>ret_12m_rel</code> +6.10% is 15th of 76, <code>ema_stack_bull</code> 1.000 is tied first of 81 in a 20-way tie spanning positions 1 to 20, and the close held above its 200-day EMA on 16.27% of the last 252 sessions, tied 34th of 71 in a two-way tie. <code>fii_pct</code> 14.53% is seventh of 74, <code>dii_pct</code> 37.49% is third of 63 and <code>shareholders</code> 226,950 is 14th of 86. " + MOM95,
  "<i>The uncomfortable part of holding CYIENT is that its single best number measures the wrong thing. Ten-year profit consistency 1.810 is first of 81, and <code>np_cagr_5y</code> -4.86% is 53rd of 61 with the last twelve months of net profit down 39.55% and the latest quarter down 32.31%. The market has repriced it anyway — <code>ret_3m_rel</code> +47.25% at fifth of 81, <code>pe_ttm</code> 40.75x against an own ten-year band topping out at 32.47x. What is genuinely better is the cash: 0.876 of operating profit collected in FY2026 against a 0.645 prior mean, <code>dso</code> 65.56 days at 63rd of 85, <code>fcf_yield</code> 5.36% at 29th of 86. So: a cheap-looking business on sales, an expensive one on earnings, and the semiconductor and DLM segments are where the story has to come from. Confidence is medium — this pack has no segment-level numbers and that is where the whole question lives.</i>",
 ],
 "trigger": "ttm_op_pct back to positive with opm_now above 14% -> the margin reset is over and the 40.75x is paying for a recovery that arrived. ttm_np_pct still negative four quarters from now with pe_ttm above 40x -> the re-rating happened without the earnings and the own ten-year ceiling of 32.47x is the reference that matters.",
 "evidence": ["np_consistency_10y", "np_cagr_5y", "ttm_np_pct", "ttm_op_pct", "ttm_sales_pct", "np_yoy_q", "np_growth_above_inflation_5y", "opm_now", "opm_prev", "op_margin_3y", "op_margin_trend_7y", "roce_3y", "roce_5y", "cfo_ebitda_3y", "fcf_yield", "dso", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"PERSISTENT": {
 "confidence": "medium",
 "verdict": "WATCH — quality 73, tied fifth of 86 veteran peers, on the largest market cap in this bucket at ₹91,405cr, first of 86, against valuation 26, tied 71st of 84",
 "points": [
  "<b>Not held — PERSISTENT is on your watchlist.</b> Persistent Systems, ₹91,405cr and first of 86 by market cap in this bucket — software engineering, digital transformation and enterprise AI services and platforms, incorporated 1990, run out of Pune; <code>promoter_pct</code> is 30.29%, 68th of 83. " + WINDOW + VET + "Quality 73, valuation 26, momentum 63, composite 80.",
  "<b>The quality record is the best in this batch and it is not close.</b> Five-year profit growth above inflation 1.000 is tied first of 86 in a 12-way tie spanning positions 1 to 12, seven-year profit growth above inflation 1.000 is tied first of 85 in a three-way tie spanning positions 1 to 3, and ten-year profit growth above inflation 0.889 is tied second of 85 in a five-way tie spanning positions 2 to 6 — every year of the last seven beat inflation. <code>roe_avg_above_threshold_5y</code> 1.000 is tied first of 86 in a 14-way tie spanning positions 1 to 14. <code>roce_3y</code> 28.67% is tenth of 86 and <code>roce_5y</code> 27.52% is 12th of 86. <code>rev_cagr_5y</code> 26.77% is 15th of 83 and <code>np_cagr_5y</code> 28.20% is 18th of 61 — profit compounding slightly faster than revenue over five years, which is the right order.",
  "<b>The most recent quarter went backwards, and it is " + WINDOW_TAG + ".</b> <code>np_yoy_q</code> -25.44% is 67th of 86 — the September quarter this row has reported and the others have not. Across the twelve months: <code>ttm_sales_pct</code> +27.10% is 21st of 82 but <code>ttm_op_pct</code> +17.14% is 33rd of 69 and <code>ttm_np_pct</code> +8.29% is 34th of 66, so revenue grew three times faster than net profit. <code>opm_now</code> 16.85% against <code>opm_prev</code> 18.28% at 23rd of 83 is 1.4 points of margin given back, and <code>op_margin_3y</code> 17.75% is 22nd of 84 with <code>op_margin_trend_7y</code> 0.006 at 27th of 85. <code>cfo_ebitda_3y</code> 0.566 is 40th of 74 and <code>cfo_ebitda_5y</code> 0.597 is 38th of 73, with FY2026 collecting 0.632 of operating profit against a prior-years mean of 0.713. <code>fcf_yield</code> 1.35% is 48th of 86 and <code>dso</code> 82.52 days is 49th of 85.",
  "<b>You are paying 54.76x for it.</b> <code>pe_ttm</code> 54.76x is ninth of 69 and <code>ev_ebitda_ttm</code> 29.59x is sixth of 69, with <code>ev_sales_ttm</code> 5.40x at 11th of 83 — the dearest row in this batch on all three. The own ten-year band runs 6.19-61.37x with an average of 25.03x, so the multiple sits inside its own ceiling and at more than twice its own decade mean. <code>peg</code> 1.942 is 18th of 46 and the 0.69% dividend is 27th of 37. The chart is steady rather than strong: <code>ret_6m_rel</code> +24.60% is 19th of 81, <code>ret_3m_rel</code> +19.87% is 12th of 81, <code>ret_12m_rel</code> +2.18% is 18th of 76, <code>ema_stack_bull</code> 1.000 is tied first of 81 in a 20-way tie spanning positions 1 to 20, and the close held above its 200-day EMA on 51.98% of the last 252 sessions, 11th of 71. Momentum 63 is tied 15th of 85. Ownership: <code>fii_pct</code> 20.79% is third of 74, <code>dii_pct</code> 30.25% is fourth of 63, <code>shareholders</code> 284,983 is tenth of 86. " + MOM95,
  "<i>PERSISTENT is the one row here where the quality is unarguable and the question is entirely price. Seven straight years of profit growth above inflation, return on capital 28.67% at tenth of 86, <code>roce_5y</code> 27.52% at 12th of 86, revenue compounding 26.77% — against <code>pe_ttm</code> 54.76x at ninth of 69 and <code>ev_ebitda_ttm</code> 29.59x at sixth of 69. Two things sit under that multiple and neither is comfortable: <code>ttm_np_pct</code> +8.29% at 34th of 66 on +27.10% revenue, and <code>np_yoy_q</code> -25.44% at 67th of 86 — a quarter that is " + WINDOW_TAG + ", so the peers it is ranked against have not yet shown theirs. At 54.76x against an own ten-year band averaging 25.03x, a single soft quarter is expensive. Confidence is medium: the record is as clean as this cluster gets and the entry point is not.</i>",
 ],
 "trigger": "np_yoy_q back to growth with opm_now above 18% -> the September quarter was a timing effect and 54.76x is a quality premium on an intact compounder. two more quarters of ttm_np_pct under 10% on revenue above 20% -> the margin is structurally lower, and a multiple at twice its own decade mean has nothing holding it up.",
 "evidence": ["np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "roe_avg_above_threshold_5y", "roce_3y", "roce_5y", "rev_cagr_5y", "np_cagr_5y", "np_yoy_q", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "op_margin_3y", "op_margin_trend_7y", "cfo_ebitda_3y", "cfo_ebitda_5y", "fcf_yield", "dso", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "div_yield", "ret_6m_rel", "ret_3m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"ZENSARTECH": {
 "confidence": "medium",
 "verdict": "HOLD — composite 83, 15th of 84 veteran peers, at 14.99x against an own ten-year band averaging 15.07x, with a 2.92% dividend, sixth of 37",
 "points": [
  "<b>Held — ZENSARTECH is in your portfolio.</b> Zensar Technologies, ₹11,635cr and tenth of 86 by market cap in this bucket — an RPG Group company selling AI-native technology and digital transformation services across five segments (Products & Platforms, Data Engineering and Analytics, Application Services, Cloud Infrastructure and Security, Marketing and Engagement); <code>promoter_pct</code> is 49.00%, 42nd of 83. " + VET + "Quality 65, valuation 62, momentum 37, composite 83.",
  "<b>It collects its money better than anything else in this batch.</b> <code>cfo_ebitda_3y</code> 0.673 is 28th of 74 and <code>cfo_ebitda_5y</code> 0.678 is 22nd of 73, and FY2026 collected 0.841 of operating profit against a prior-years mean of 0.808 — the latest year here is better than its own record, and the record was already fine. <code>dso</code> 59.31 days is 68th of 85, the shortest collection cycle of the eight. <code>fcf_yield</code> 5.02% is 32nd of 86 and the 2.92% dividend is sixth of 37. <code>roce_3y</code> 22.11% is 22nd of 86 and <code>roce_5y</code> 20.20% is 26th of 86. Ten-year profit consistency 1.687 is 16th of 81 and <code>roe_avg_above_threshold_5y</code> 0.800 is tied 15th of 86 in an eight-way tie spanning positions 15 to 22.",
  "<b>The reason it is cheap is that it has stopped growing.</b> <code>rev_cagr_5y</code> 7.59% is 60th of 83 — bottom third of the cohort over five years — while <code>np_cagr_5y</code> 16.79% is 24th of 61, so profit grew on margin rather than on sales. And the margin has now stopped too: <code>opm_now</code> 15.94% against <code>opm_prev</code> 15.46% at 34th of 83 is half a point in a year, with <code>op_margin_3y</code> 16.45% at 26th of 84 and <code>op_margin_trend_7y</code> 0.003 at 33rd of 85. <code>ttm_sales_pct</code> +8.06% is 52nd of 82, <code>ttm_op_pct</code> +11.47% is 42nd of 69 and <code>ttm_np_pct</code> +15.21% is 25th of 66. <code>sales_yoy_q</code> +8.90% is 52nd of 83 and <code>np_yoy_q</code> +0.99% is 43rd of 86 — a flat quarter on a flat year.",
  "<b>Priced exactly at its own ten-year average, with the two momentum readings pointing opposite ways.</b> <code>pe_ttm</code> 14.99x is 48th of 69 and the own ten-year band runs 3.36-24.50x with an average of 15.07x — the stock is within a rounding error of its own decade mean, which is the most neutral starting price in this batch. <code>ev_ebitda_ttm</code> 10.74x is 32nd of 69, <code>ev_sales_ttm</code> 1.86x is 48th of 83 and <code>peg</code> 0.892 is 28th of 46. " + PAIRED + "<code>ret_12m_rel</code> -29.55% is 47th of 76, <code>ret_6m_rel</code> -0.97% is 39th of 81 and <code>ret_3m_rel</code> +11.47% is 24th of 81, which is the same shape the two EMA readings describe. <code>fii_pct</code> 10.73% is 11th of 74, <code>dii_pct</code> 21.98% is tied sixth of 63 in a two-way tie at that figure, <code>shareholders</code> 219,808 is 15th of 86. " + MOM95,
  "<i>Holding ZENSARTECH is the least exciting and most defensible position in this batch. <code>pe_ttm</code> 14.99x against an own ten-year band averaging 15.07x, a 2.92% dividend at sixth of 37, <code>cfo_ebitda_3y</code> 0.673 at 28th of 74 with FY2026 ahead of its own record, <code>dso</code> 59.31 days at 68th of 85 and return on capital 22.11% at 22nd of 86. Composite 83 at 15th of 84 is the fourth-highest in this batch on numbers that are all real. What you are not getting is growth: <code>rev_cagr_5y</code> 7.59% at 60th of 83, revenue up 8.06% over twelve months, a quarter up 0.99%. Momentum 37 is tied 46th of 85 and the twelve-month relative return is -29.55%. The honest version is that this is a cash-generative, fairly priced, slow company, and the only thing that re-rates it is a revenue line. Confidence is medium.</i>",
 ],
 "trigger": "ttm_sales_pct lifting into double digits with opm_now holding above 16% -> a 14.99x multiple on a 0.841 collection rate re-rates toward the top of its own 3.36-24.50x band. rev_cagr_5y staying under 8% with opm_now slipping under 15% -> cheap for the right reason, and the dividend is the only return on offer.",
 "evidence": ["cfo_ebitda_3y", "cfo_ebitda_5y", "dso", "fcf_yield", "div_yield", "roce_3y", "roce_5y", "np_consistency_10y", "roe_avg_above_threshold_5y", "rev_cagr_5y", "np_cagr_5y", "opm_now", "opm_prev", "op_margin_3y", "op_margin_trend_7y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "ema_stack_bull", "pct_above_200ema_252d", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"RATEGAIN": {
 "confidence": "medium",
 "verdict": "WATCH — quality 59, 13th of 33 mature peers, with return on capital of 13.04%, 18th of 33, on a company whose revenue more than doubled in twelve months",
 "points": [
  "<b>Not held — RATEGAIN is on your watchlist.</b> RateGain Travel Technologies, ₹9,275cr and seventh of 33 by market cap in this bucket — SaaS distribution, revenue-management and marketing-technology products sold to hotels, airlines, online travel agents and car-rental firms, incorporated 2012, run out of Noida; <code>promoter_pct</code> is 48.78%, 13th of 19. " + MAT + TIERW + "Quality 59, valuation 51, momentum 78, composite 75.",
  "<b>The top line is the loudest in this bucket and it is genuine.</b> <code>ttm_sales_pct</code> +114.36% is first of 20 and <code>ttm_op_pct</code> +98.02% is first of 19 — revenue and operating profit both roughly doubled over the twelve months. <code>sales_yoy_q</code> +187.63% is first of 21 and <code>np_yoy_q</code> +102.24% is fourth of 21. Over five years <code>rev_cagr_5y</code> 49.34% is fifth of 33 and <code>np_cagr_5y</code> 119.20% is fifth of 27. <code>op_margin_3y</code> 20.21% is 14th of 33 and <code>op_margin_trend</code> 0.027 is seventh of 33, so the margin has been drifting up across three years rather than being bought.",
  "<b>Net profit did not follow, and the leak sits below operating profit.</b> <code>ttm_np_pct</code> +15.14% is 11th of 19 — against +114.36% of revenue and +98.02% of operating profit, which is the single most important number on this row. <code>opm_now</code> 19.67% at tenth of 20 against <code>opm_prev</code> 21.29% at 11th of 20 is 1.6 points of margin given back in the latest window even as volumes doubled. <code>roce_3y</code> 13.04% is 18th of 33 and <code>roce_5y</code> 10.32% is 21st of 33 — low for a software business and the reason quality sits mid-pack rather than high. <code>cfo_ebitda_3y</code> 0.550 is 18th of 31 and <code>cfo_ebitda_5y</code> 0.469 is 21st of 32, with FY2026 collecting 0.677 of operating profit against a prior-years mean of 0.608. <code>fcf_yield</code> -5.39% is 23rd of 33 — free cash flow is negative. <code>dso</code> 94.36 days is 13th of 33. <code>np_consistency_5y</code> 1.621 is 20th of 33.",
  "<b>38.27x, with nothing of its own to measure it against.</b> <code>pe_ttm</code> 38.27x is seventh of 21, <code>ev_ebitda_ttm</code> 18.61x is eighth of 21 and <code>ev_sales_ttm</code> 4.30x is tenth of 22. This company has five usable annual earnings readings since listing, spanning 25.13x to 425.80x, which is a listing history rather than a band — 38.27x cannot be anchored to its own past. <code>peg</code> 0.321 is 13th of 15 and reads as very cheap only because the denominator is a 119.20% five-year profit CAGR measured off a near-zero base; it is an artefact of the base, not a signal. This row pays no dividend, so valuation 51 is scored on 95 of its 100 declared points. The chart is strong: <code>ret_12m_rel</code> +32.20% is third of 26, <code>ret_6m_rel</code> +38.68% is fourth of 29, the close held above its 200-day EMA on 76.59% of the last 252 sessions at second of 24, while <code>ret_3m_rel</code> -2.74% is 21st of 29 and <code>ema_stack_bull</code> 0.000 is tied eighth of 29 in a 22-way tie spanning positions 8 to 29. Momentum 78 is tied fifth of 30. Ownership: <code>fii_pct</code> 5.75% is eighth of 17, <code>dii_pct</code> 20.86% is third of 16, <code>shareholders</code> 90,004 is ninth of 20. " + MOM95,
  "<i>RATEGAIN is the one row in this batch where the growth is not in question and the economics are. <code>ttm_sales_pct</code> +114.36% at first of 20, <code>ttm_op_pct</code> +98.02% at first of 19, <code>sales_yoy_q</code> +187.63% at first of 21 — and <code>ttm_np_pct</code> +15.14% at 11th of 19 out the other end. Something between operating profit and net profit is consuming almost all of it, and until a reader can see what, <code>roce_3y</code> 13.04% at 18th of 33 and <code>fcf_yield</code> -5.39% at 23rd of 33 are the honest summary of what the doubling has returned. It is on a watchlist and not a holding for exactly that reason: the demand is proven, the conversion is not. Confidence is medium — the figures are clean, the interpretation of the gap is not available from this snapshot.</i>",
 ],
 "trigger": "ttm_np_pct moving above 50% with roce_3y lifting through 16% -> the gap below operating profit was a one-off and a doubling business is converting it. two more windows of ttm_np_pct under 20% on revenue above 50%, or fcf_yield staying negative -> the growth is being bought rather than earned, and 38.27x has no own history to fall back on.",
 "evidence": ["ttm_sales_pct", "ttm_op_pct", "sales_yoy_q", "np_yoy_q", "rev_cagr_5y", "np_cagr_5y", "op_margin_3y", "op_margin_trend", "ttm_np_pct", "opm_now", "opm_prev", "roce_3y", "roce_5y", "cfo_ebitda_3y", "cfo_ebitda_5y", "fcf_yield", "dso", "np_consistency_5y", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "ema_stack_bull", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"BLSE": {
 "confidence": "low",
 "verdict": "WATCH — composite 60, seventh of 15 mid-tier peers, on a stock down 56.77% in the last month with no usable earnings history of its own to price it against",
 "points": [
  "<b>Held — BLSE is in your portfolio and on your watchlist.</b> BLS E-Services, ₹2,592cr and sixth of 33 by market cap in this bucket — digital last-mile banking correspondent services, loan disbursement, e-governance and assisted e-services run through a village-level franchise network, a subsidiary of BLS International; <code>promoter_pct</code> is 71.87%, second of 15. " + MID + TIERW + "Quality 54, valuation 53, momentum 44, composite 60. " + THIN,
  "<b>The growth is real and the margin paying for it is not.</b> <code>rev_cagr_3y</code> 92.55% is third of 31 — revenue has close to doubled each year for three years, which is the strongest thing on this row. But <code>op_margin_3y</code> 10.73% is 22nd of 31 and <code>op_margin_trend_3y</code> -0.036 is 24th of 31, so the margin has been falling the whole way up, and <code>opm_now</code> 6.65% at eighth of 10 against <code>opm_prev</code> 9.66% at sixth of 10 is three more points gone in the latest window. <code>np_cagr_3y</code> 35.32% is 16th of 24 against that 92.55% of revenue. <code>ttm_sales_pct</code> +71.20% is third of 10 while <code>ttm_op_pct</code> +17.90% is seventh of 10 and <code>ttm_np_pct</code> +5.20% is eighth of 10 — the same wedge, one window wide. <code>sales_yoy_q</code> +24.63% is tenth of 14 and <code>np_yoy_q</code> +4.22% is ninth of 14, so the doubling has already slowed to a quarter in the low twenties. <code>np_consistency_3y</code> 1.806 is seventh of 31 and <code>roce_3y</code> 14.91% is 21st of 31.",
  "<b>Cash collection halved, and the fall is the flag, not the level.</b> FY2026 collected 0.675 of operating profit in cash against a prior-years mean of 1.324 — a 0.68 conversion rate on its own would be unremarkable for this cluster, and <code>cfo_ebitda_3y</code> 0.691 at 11th of 30 sits mid-pack precisely because the earlier years carried it. What matters is the direction: the business was over-collecting and is now under-collecting, in the same window the operating margin fell three points and revenue grew 71.20%. <code>dso</code> 38.94 days is 30th of 33 and <code>fcf_yield</code> 0.39% is sixth of 26, both of which read well and neither of which explains the drop.",
  "<b>44.60x on a company with no own band, after a 56.77% month.</b> " + NOBAND + "<code>ev_ebitda_ttm</code> 27.60x is fourth of 18 and <code>ev_sales_ttm</code> 1.98x is 14th of 20, so on enterprise value against operating profit this is one of the dearest rows in the bucket while on enterprise value against sales it is mid-pack — the difference is the 6.65% margin. The price has broken: the stock is -56.77% over one month, -49.76% over three and -23.88% over six, with <code>ret_3m_rel</code> -39.48% last of 25, <code>ret_6m_rel</code> -14.84% 13th of 23 and <code>ret_12m_rel</code> -13.39% sixth of 19. The close held above its 200-day EMA on 64.29% of the last 252 sessions, first of 17 — that reading is a count over a year that mostly predates the collapse, and <code>ema_stack_bull</code> 0.000 is tied ninth of 26 in an 18-way tie spanning positions 9 to 26, which is the current state. Ownership: <code>fii_pct</code> 0.64% is tenth of 13, <code>dii_pct</code> 0.02% is tenth of 14, <code>shareholders</code> 69,588 is ninth of 15. " + MOM95,
  "<i>This is the row in the batch that is least safe to hold and hardest to value. The case for it is <code>rev_cagr_3y</code> 92.55% at third of 31 and <code>promoter_pct</code> 71.87% at second of 15. Against it: a margin that has fallen every year of that growth, <code>opm_now</code> 6.65% at eighth of 10, cash collection down to 0.675 from a prior-years mean of 1.324, a quarter already back to +24.63% of sales, and 44.60x with nothing of its own behind it. The price has taken 56.77% off in a month, which means the market has formed a view this snapshot cannot confirm or deny. Confidence is low and it is low for a reason that will not improve with more reading: the thin cohort, the absent band and the single-year cash reversal mean every number here is either unanchored or too new to trust. A holding this size with this much unreadable in it is a position to size down rather than argue about.</i>",
 ],
 "trigger": "opm_now recovering above 9% with next-year cash collection back over 1.0 -> the margin and conversion drop were the cost of one year of growth, and 92.55% three-year revenue compounding is worth a premium. another window of opm_now under 7% or collection under 0.7 -> the growth was bought with working capital, and there is no own earnings history to tell you what the floor is.",
 "evidence": ["rev_cagr_3y", "op_margin_3y", "op_margin_trend_3y", "opm_now", "opm_prev", "np_cagr_3y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "np_consistency_3y", "roce_3y", "cfo_ebitda_3y", "dso", "fcf_yield", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "pct_above_200ema_252d", "ema_stack_bull", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},
}


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These guards
    cover the third category — structural claims neither pass can see. Guard 11
    is the one this batch forced into existence: `cash conversion` and
    `book value` are both live WORD_DIMS phrases that name columns
    `it_services_midsmall` does not carry, so a sentence copied from an earlier
    batch would read correctly and point at nothing.
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
        live = (p.get("metrics") or {}).get("cluster_metrics") or {}

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. The cohort sentence must match the bucket the scorer used, in BOTH
        #    the tier and the count. This cluster spans three buckets (86/33/33)
        #    and two of the three counts are identical, so the tier half of this
        #    check is the half that can actually fail.
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

        # 3. Every row here is `full`. If the scorer's bucketing changes this
        #    stops the build rather than shipping a stale claim.
        st = p["scores"]["score_status"]
        if st != "full":
            errs.append(f"{sym}: score_status={st}, but the cohort sentence "
                        f"asserts `full` with no mixed-tier caveat")

        # 4. Held vs watchlist, measured not recalled.
        held = sym in HELD
        says_held = p0.startswith("<b>Held —")
        if held != says_held:
            errs.append(f"{sym}: in HELD={held} but point one says "
                        f"{'held' if says_held else 'not held'}")

        # 5. Dead metrics may not be argued from. tech_net_score_scaled is
        #    exempted only inside MOM95, which exists to say it is missing.
        for pt in pts:
            for d in DEAD:
                if d in pt:
                    errs.append(f"{sym}: prose names dead metric '{d}'")
            if "tech_net_score_scaled" in pt and MOM95 not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside MOM95")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. delivery_data holds 12 distinct sessions, so a delivery percentage
        #    is one day's print. NODELIV is the only exemption and it exists to
        #    report an absence, not a figure.
        for pt in allprose:
            if re.search(r"deliver", pt, re.I) and NODELIV not in pt:
                errs.append(f"{sym}: quotes delivery off "
                            f"{(p.get('delivery') or {}).get('sessions')} "
                            f"sessions — a single-day print")

        # 7. np_consistency is an index 0-2, never a pass rate.
        for pt in pts:
            if re.search(r"np_consistency\w*</code>\s*[\d.]+\s*(?:of|in)\s",
                         pt):
                errs.append(f"{sym}: np_consistency written as a pass rate")

        # 8. Every evidence key must resolve non-NULL in this row's own
        #    cluster_metrics or verdict-load.py rejects the whole row. The key
        #    set differs BY TIER in this cluster — the mid rows carry no
        #    np_consistency_10y and no op_margin_trend_7y — so a key lifted
        #    from a veteran row resolves for six symbols and not for the other
        #    two.
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics "
                            f"(tier={tier})")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")

        # 9. Any own-history PE band quoted in prose must match the pack in
        #    every number it states — width, low, high, average.
        band = p.get("pe_band") or {}

        def _width(yr: str, where: str, _sym=sym, _band=band) -> None:
            if _YEAR_WORD.get(yr.lower()) != _band.get("n"):
                errs.append(f"{_sym}: says {yr}-year band in {where}, pack "
                            f"n={_band.get('n')}")

        for pt in allprose:
            for yr, lo, hi, avg in re.findall(
                    r"own (\w+)-year band (?:runs|of) ([\d.]+)-([\d.]+)x"
                    r"(?: with an average of | averaging )([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a PE band; pack has none")
                    continue
                _width(yr, "the full form")
                if (abs(float(lo) - band["lo"]) > 0.005
                        or abs(float(hi) - band["hi"]) > 0.005):
                    errs.append(f"{sym}: band {lo}-{hi} vs pack "
                                f"{band['lo']}-{band['hi']}")
                if abs(float(avg) - band["avg"]) > 0.005:
                    errs.append(f"{sym}: band average {avg} vs pack "
                                f"{band['avg']}")
            for yr, avg in re.findall(
                    r"own (\w+)-year band averaging ([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a band average; pack has none")
                    continue
                _width(yr, "the averaging form")
                if abs(float(avg) - band["avg"]) > 0.005:
                    errs.append(f"{sym}: band average {avg} vs pack "
                                f"{band['avg']}")

        # 10. A row the pack flagged for an earnings-quality gap must name the
        #     defect the pack actually flagged. Two rows, two unrelated
        #     defects, so a shared phrase would pass a row naming the wrong
        #     problem. The elif is what keeps it from going stale: if a rerun
        #     clears a flag, the build fails rather than shipping a caveat
        #     about a problem that no longer exists.
        flags = ((p.get("earnings_quality") or {}).get("flags") or [])
        if sym in EQ_FLAGGED:
            if not flags:
                errs.append(f"{sym}: in EQ_FLAGGED but the pack now carries "
                            f"no earnings-quality flag")
            phrase = EQ_FLAGGED[sym]
            if not any(phrase in pt for pt in pts):
                errs.append(f"{sym}: flagged by the pack but no point says "
                            f"'{phrase}'")
        elif flags:
            errs.append(f"{sym}: pack carries {len(flags)} earnings-quality "
                        f"flag(s) but the symbol is not in EQ_FLAGGED")

        # 11. THE NEW ONE. Every <code> key in prose must exist and be non-NULL
        #     in THIS row's cluster_metrics. The specific bug that forced it:
        #     `cash conversion` resolves to cfo_pat_3y and `book value` to pb
        #     in the checker's WORD_DIMS, and this cluster carries neither — it
        #     scores cash on cfo_ebitda_3y/5y and has no pb at all. A sentence
        #     carried over from an earlier batch therefore reads perfectly and
        #     attributes its rank to a column that does not exist. Guarding the
        #     general form rather than those two names catches the next one
        #     too, including the per-tier gaps guard 8 only sees in evidence.
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

        # 12. BLSE's bucket reports a PEG on 3 of 33 and a dividend on 5. A
        #     rank out of 3 is noise wearing a rank's clothes, so this row
        #     carries THIN and NOBAND and states no denominator under 9.
        if sym in FLOOR_SYMS:
            if THIN not in p0:
                errs.append(f"{sym}: point one does not carry THIN")
            if not any(NOBAND in pt for pt in pts):
                errs.append(f"{sym}: no point carries NOBAND")
            if p.get("pe_band"):
                errs.append(f"{sym}: carries NOBAND but the pack now HAS a "
                            f"pe_band — the caveat is stale")
            for pt in allprose:
                for d in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                    if int(d) < DENOM_FLOOR:
                        errs.append(f"{sym}: states a denominator of {d}, "
                                    f"under the {DENOM_FLOOR}-reading floor "
                                    f"this row is held to")

        # 13. CALSOFT's entire scorecard is one event: a margin that stepped
        #     26.86% -> 81.73% in a year with 0.000 of it in operating cash.
        #     The composite, the momentum percentile, the earnings multiple and
        #     every ttm_* figure are all computed on that base, so the long
        #     caveat goes in point one and the short tag in every later point
        #     that leans on a distorted figure. The headline may not lead on
        #     the composite at all — it is the part read alone.
        if sym == "CALSOFT":
            if ARTEFACT not in p0:
                errs.append(f"{sym}: point one does not carry ARTEFACT")
            tainted = re.compile(r"\b(?:composite|momentum)\s+\d+|"
                                 r"<code>(?:pe_ttm|ttm_\w+)</code>")
            for i, pt in enumerate(pts[1:], start=2):
                m = tainted.search(pt)
                if m and ARTEFACT_TAG not in pt:
                    errs.append(f"{sym}: point {i} quotes '{m.group(0)}' off "
                                f"the artefact base without the tag "
                                f"('{ARTEFACT_TAG}')")
            if re.search(r"composite\s+\d+", v["verdict"], re.I):
                errs.append(f"{sym}: headline leads on a composite computed "
                            f"on a one-year margin artefact")

        # 14. A pillar percentile computed on part of its declared weight may
        #     be quoted only alongside what is missing underneath it. Unlike
        #     MOM95 this is NOT uniform — one row in 86 answering a narrower
        #     question — so the renormalisation must sit in the SAME point, and
        #     the figure is banned from the headline and the trigger, neither
        #     of which has room for the caveat.
        if sym in PILLAR_WEIGHT:
            pillar, phrase = PILLAR_WEIGHT[sym]
            rx = re.compile(rf"\b{pillar}\s+(?:of\s+)?\d+", re.I)
            for i, pt in enumerate(pts):
                m = rx.search(pt)
                if m and phrase not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes "
                                f"'{m.group(0)}' without naming the "
                                f"renormalisation ('{phrase}')")
            for where, text in (("verdict", v["verdict"]),
                                ("trigger", v["trigger"])):
                m = rx.search(text)
                if m:
                    errs.append(f"{sym}: {where} quotes '{m.group(0)}', a "
                                f"pillar scored on part of its weight, with "
                                f"no room for the caveat")

        # 15. COFORGE has no promoter group at all. A reader who sees no
        #     promoter line assumes a failed load, so the absence has to be
        #     stated as the fact — and no promoter figure may be invented.
        if sym == "COFORGE":
            if NOPROM not in p0:
                errs.append(f"{sym}: point one does not carry NOPROM")
            if live.get("promoter_pct") is not None:
                errs.append(f"{sym}: carries NOPROM but the pack now has "
                            f"promoter_pct={live['promoter_pct']}")
            for pt in allprose:
                if (re.search(r"promoter[^.]{0,80}?\d", pt, re.I)
                        and NOPROM not in pt):
                    errs.append(f"{sym}: states a promoter figure")
        elif live.get("promoter_pct") is None and any(
                "promoter" in pt for pt in allprose):
            errs.append(f"{sym}: names promoter but promoter_pct is NULL")

        # 16. PERSISTENT has already reported the September quarter; the other
        #     seven have not. Its TTM window is therefore 2025-12-31 to
        #     2026-09-30 against everyone else's 2025-09-30 to 2026-06-30, so
        #     every TTM rank on this row is measured against a staler field.
        #     Long caveat in point one, short tag wherever a ttm_* figure is
        #     quoted.
        if sym == "PERSISTENT":
            if WINDOW not in p0:
                errs.append(f"{sym}: point one does not carry WINDOW")
            for i, pt in enumerate(pts[1:], start=2):
                m = re.search(r"<code>ttm_\w+</code>", pt)
                if m and WINDOW_TAG not in pt:
                    errs.append(f"{sym}: point {i} quotes {m.group(0)} "
                                f"without the window tag ('{WINDOW_TAG}')")

        # 17. ZENSARTECH's two trend readings disagree: the EMA stack is tied
        #     first of 81 while the close spent 0.4% of 252 sessions above its
        #     200-day average. Either one alone is a different company, so
        #     neither may appear without the other.
        if sym == "ZENSARTECH":
            for i, pt in enumerate(pts):
                if (re.search(r"ema_stack_bull|pct_above_200ema_252d|"
                              r"200-day EMA", pt) and PAIRED not in pt):
                    errs.append(f"{sym}: point {i + 1} quotes one of the two "
                                f"EMA readings without PAIRED")

        # 18. MOM95 exactly once per row. Zero means a momentum percentile is
        #     quoted as if it were scored on 100 points; twice is the bloat
        #     that makes a reader skip the caveat on the row that needs it.
        if sym in MOM95_SYMS:
            got = sum(MOM95 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM95 appears {got}x in the points, "
                            f"expected exactly 1")

        # 19. The two non-veteran rows have their composite computed under a
        #     different pillar weighting (40/30/30 and 45/30/25) than the six
        #     veteran rows in the same batch. A reader comparing composites
        #     down the page has no way to know, so the row says so.
        if sym in TIERW_SYMS:
            if TIERW not in p0:
                errs.append(f"{sym}: non-veteran tier={tier} but point one "
                            f"does not carry TIERW")
        elif TIERW in p0:
            errs.append(f"{sym}: tier={tier} carries the TIERW caveat")

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
