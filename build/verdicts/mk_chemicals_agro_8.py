#!/usr/bin/env python3
"""chemicals_agro — 8 tracked names. Generator + the guards that back it.

Run:
    etl/.venv/bin/python build/verdicts/mk_chemicals_agro_8.py
Then, and do not skip either:
    scripts/verdict-check.py       /tmp/chem8.json <OUT>
    scripts/verdict-ranks-check.py --verdicts <OUT> --pack /tmp/chem8.json

CHOICE 1 — the finding that shapes the whole batch: FIVE of these eight rows
report negative or near-zero cash conversion in FY2026. SHIVALIK -0.72,
KRISHANA -0.64, MBAPL -0.56, PARADEEP -0.46, DHARMAJ 0.27. Written as five
per-row defects that would read as five companies independently failing to
collect their profit, which is not what the pack says: agri-input makers build
inventory and receivables into the sowing cycle and FY2026 is one fiscal year
end. So it is ONE shared sentence (CASH) stating the cluster pattern, plus the
per-row number, plus the only distinction that actually separates them — three
of the five had a negative or near-zero PRIOR-years mean too (KRISHANA -0.135,
SHIVALIK -0.156, PARADEEP 0.05), so for those the latest year is not a
deterioration from anything. MBAPL is the single row that fell from a genuinely
positive base (0.297 -> -0.562), and that is a different and worse claim. Guard
11 enforces the split: a row may not call its own number a deterioration unless
its prior mean was actually positive.

CHOICE 2 — three cohorts again, with different pillar weights and, this time,
different BASES. veteran n=32 (ARIES, DHANUKA, KRISHANA, MBAPL, SHIVALIK),
mature n=11 (PARADEEP, SUMICHEM), and DHARMAJ, whose mid tier did not clear the
10-peer floor and is therefore peered against all 49 rows of the cluster across
every tier.

CHOICE 3 — and so DHARMAJ is `partial-cluster-mixed-tiers`, not `full`. Every
batch before this one asserted score_status == "full" for every row. That guard
would now fire on a correct row, so guard 3 is per-symbol here (STATUS), and
DHARMAJ's cohort sentence says what the mixing means rather than hiding it: a
company incorporated in 2015 ranked against companies with thirty years of
history.

CHOICE 4 — the 9-reading floor, applied to PARADEEP, SUMICHEM and DHARMAJ.
The mature bucket is 11 names and its valuation and recent-period metrics are
read by 3 to 8 of them: PARADEEP's `pe_ttm` is 7th of 7, its `peg` 3rd of 3,
its `div_yield` 1st of 5; SUMICHEM's `peg` is 1st of 3 and its `opm_now` 1st
of 7. DHARMAJ's mid-tier growth metrics have 5 readings — `rev_cagr_3y` 1st of
5, `np_cagr_3y` 5th of 5. A rank out of 3 is noise wearing a rank's clothes,
and a caveat printed next to a number loses to the number: the reader keeps
"first of 3" and discards the sentence disowning it. So those three rows state
no denominator under 9 at all, and argue from absolute figures and their own
history instead.

CHOICE 5 — PARADEEP is `WATCH — no verdict`, and it is the only held position
in this batch to get that label. Once CHOICE 4 applies it has nothing rankable
left: no valuation metric with 9 readings, a PE band built on 4 usable years,
and FY2026 cash conversion of -0.46. A composite of 100 which is first of 10 is
not the same claim as a composite of 100 which is first of 86, and dressing
that up as a full verdict on a position Deb actually holds is the single worst
thing this batch could do.

CHOICE 6 — KRISHANA and MBAPL are the dangerous pair and the real story. Both
carry a net-profit-outran-operating-profit flag (25% and 50% gaps over the TTM),
both have negative FY2026 cash, both are near the top of the cohort on momentum
(85 first of 32, 71 third of 32) and on price-to-book (11.59 third of 31, 13.72
second of 31) — and both trade at a multiple of their own decade. KRISHANA's
own ten-year band averages 3.05x against `pe_ttm` 33.05x; MBAPL's averages
3.67x against 48.67x. That is a ten-to-thirteen-fold re-rating of the multiple,
not a premium, and it is the one thing on either row that no cohort rank shows.
Guard 12 requires both rows to state the band average wherever they state the
multiple.

CHOICE 7 — two partial valuation pillars, of different severity. SHIVALIK's is
scored on 78 of 100 (peg absent); DHARMAJ's on 63 of 100 (peg, fcf_yield and
div_yield all absent). Both get the same-point treatment and both are banned
from the headline and the trigger — a pillar missing 37% of its weight is not a
percentile a headline can carry.

CHOICE 8 — ARIES has no delivery row at all (0 sessions) while the other seven
have 13. Neither number is usable: 13 sessions is a single-day print, 0 is an
absence. Guard 6 bans the word outright and exempts only NODELIV, which exists
to report the absence.

CHOICE 9 — `tech_net_score_scaled` is NULL for all 3,178 rows again, so every
momentum percentile on the platform is scored on 95 points of a declared 100.
Uniform, so it moves no row relative to another: one shared sentence, and the
headline may still quote the percentile. Same treatment as it_services.

CHOICE 10 — the WORD_DIMS trap for THIS cluster. `cash conversion` resolves to
cfo_pat_3y, and this cluster DOES carry cfo_pat_3y — so unlike it_services the
phrase is safe here, and five rows need it. But `dso` is NULL for 89% of the
universe and absent from every row in this pack, so "collection cycle" and
"receivable days" have nothing behind them; the cash argument is made on
cfo_pat_3y and wc_days, which are present. Guard 10 is the general form kept
from it_services: every <code> key must exist and be non-NULL in that row's own
cluster_metrics.
"""
import json
import re

PACK = "/tmp/chem8.json"
OUT = "build/verdicts/chemicals-agro-8-verdicts.json"
SOURCE_REPORT = "chemicals_agro — 8 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

HELD = {"DHANUKA", "DHARMAJ", "PARADEEP"}
EMIT = {"ARIES", "DHANUKA", "DHARMAJ", "KRISHANA", "MBAPL", "PARADEEP",
        "SHIVALIK", "SUMICHEM"}

# CHOICE 2. Three cohorts, and the third is not a tier at all.
VET = ("Peered against 32 veteran-tier peers inside "
       "<code>chemicals_agro</code> — the scorer's bucket is (cluster, "
       "maturity tier), this one clears the 10-peer floor, and the row is "
       "badged <code>full</code> with no mixed-tier caveat. Every denominator "
       "below is the metric's own reading count, not 32. ")

MAT = ("Peered against 11 mature-tier peers inside "
       "<code>chemicals_agro</code> — the scorer's bucket is (cluster, "
       "maturity tier), and this one clears the 10-peer floor by one name. "
       "Eleven is the thinnest cohort written here, and the per-metric "
       "reading counts fall well below it. ")

# CHOICE 3. Not `full`, and the sentence says what the mixing costs.
MIXED = ("Peered against 49 peers inside <code>chemicals_agro</code> — and "
         "this row is the exception in this batch. Its own mid tier did not "
         "clear the 10-peer floor, so the scorer fell back to the whole "
         "cluster across every maturity tier and badged the row "
         "<code>partial-cluster-mixed-tiers</code>. That means a company "
         "incorporated in 2015 is ranked against companies with thirty years "
         "of reported history, which flatters it on anything cumulative and "
         "penalises it on anything requiring a long record. Every denominator "
         "below is the metric's own reading count, not 49. ")

TIER_SENTENCE = {"veteran": VET, "mature": MAT, "mid": MIXED}

# CHOICE 1. The cluster pattern, stated once per row that has it.
CASH = ("One thing is true of most of this cluster and not of this company "
        "alone: five names in this eight-row batch collected negative or near-zero "
        "operating cash against operating profit in FY2026. Agri-input makers "
        "fund the sowing cycle with inventory and receivables, and FY2026 is "
        "one fiscal year end rather than a trend. So the level below is read "
        "against the cluster and against this company's own prior years, not "
        "treated as a company failing alone. ")

# CHOICE 1, second half. Only MBAPL may call its own number a deterioration.
DETERIORATION = ("And this is the one row in the batch where the fall is from "
                 "a genuinely positive base rather than from an already "
                 "negative one, which makes it a deterioration and not a "
                 "level. ")

# CHOICE 9. Uniform across the platform, so it moves no row relative to any
# other — which is why it is a shared sentence and not a per-row defect.
MOM95 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 5 of momentum's 100 points, so every "
         "momentum percentile on this platform is scored on 95 points out of "
         "a declared 100. It is uniform, so it cannot move one row relative "
         "to another and the ranks are unaffected — but the pillar is "
         "narrower than the scorecard claims, here and everywhere.")

# CHOICE 4. The three rows held to the 9-reading floor, and why.
THIN = ("A note on what is not quoted below: this row's valuation and "
        "recent-period metrics are read by 3 to 8 of its peers, so the ranks "
        "the scorer computed on them are arithmetic rather than information. "
        "No denominator under 9 appears anywhere on this row. The argument is "
        "made on absolute figures and on this company's own history instead. ")

# CHOICE 5. PARADEEP only.
NOVERDICT = ("There is no verdict on this row, and that is the finding. Once "
             "the thin denominators are set aside there is no valuation "
             "metric here with 9 readings behind it, the PE band is built on "
             "4 usable years, and FY2026 cash conversion is -0.46. The "
             "composite of 100 is first of 10 — it is the top of a ten-name "
             "bucket, not the top of the market, and on a position actually "
             "held that distinction is the whole point. What follows is what "
             "can be said; a recommendation is not among it. ")

# CHOICE 8. ARIES only. An absence, not a figure.
NODELIV = ("There is also no delivery row for this symbol at all, where the "
           "other seven have 13 sessions — and neither is usable, because 13 "
           "sessions is a single-day print and 0 is nothing.")

# Metrics NULL for >=95% of every tier in this snapshot.
DEAD = ("roe_latest", "p_premium", "book_value_cagr_3y", "book_value_cagr_5y",
        "cfo_pat_latest", "roce_latest", "op_margin_latest", "dso")

# <code> tags that are legitimately not metrics of this cluster.
CODE_ALLOW = {"chemicals_agro", "full", "partial-cluster-mixed-tiers",
              "tech_net_score_scaled"}

# CHOICE 1. Rows the pack flagged, the phrase each must carry, and whether the
# row is allowed to call its own cash number a deterioration.
CASH_ROWS = {
    "DHARMAJ": (0.270, 0.317, False),
    "KRISHANA": (-0.642, -0.135, False),
    "MBAPL": (-0.562, 0.297, True),
    "PARADEEP": (-0.458, 0.052, False),
    "SHIVALIK": (-0.721, -0.156, False),
}

# CHOICE 6. Both rows trade at a multiple of their own decade; neither cohort
# rank shows it, so the band average travels with the multiple.
RERATED = {"KRISHANA": 3.05, "MBAPL": 3.67}

# CHOICE 7. Not uniform, unlike MOM95 — two rows answering a narrower question
# than their peers. Same-point rule in the points, banned in headline/trigger.
PILLAR_WEIGHT = {
    "SHIVALIK": ("valuation", "78 of its 100 declared points"),
    "DHARMAJ": ("valuation", "63 of its 100 declared points"),
}

# CHOICE 3. Per-symbol now, because one row is legitimately not `full`.
STATUS = {
    "ARIES": "full", "DHANUKA": "full", "KRISHANA": "full", "MBAPL": "full",
    "SHIVALIK": "full", "PARADEEP": "full", "SUMICHEM": "full",
    "DHARMAJ": "partial-cluster-mixed-tiers",
}

MOM95_SYMS = EMIT
FLOOR_SYMS = {"PARADEEP", "SUMICHEM", "DHARMAJ"}
DENOM_FLOOR = 9

_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}
_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
_CODE_RX = re.compile(r"<code>([a-z0-9_-]+)</code>")

SPEC: dict[str, dict] = {

"ARIES": {
 "confidence": "medium",
 "verdict": "WATCH — momentum 72, second of 32 veteran peers, at 29.35x against an own ten-year band topping out at 28.45x, on a company whose return on capital is 13.39%, 15th of 31",
 "points": [
  "<b>Not held — ARIES is on your watchlist.</b> Aries Agro, ₹616cr and 24th of 32 by market cap in this bucket — micronutrient and specialty fertilisers, sulphur and water-soluble products and agro-equipment, sold under Agromin, Aries Trillion and Aries Powersul; <code>promoter_pct</code> is 52.66%, 24th of 31. " + VET + "Quality 63, valuation 40, momentum 72, composite 77. " + NODELIV,
  "<b>It collects its profit better than anything else in this cluster.</b> <code>cfo_pat_3y</code> 3.000 is tied first of 27 in a three-way tie spanning positions 1 to 3 — three times the reported profit arrived as operating cash over three years, and FY2026 collected 1.129 of operating profit against a prior-years mean of 1.383, so both the level and the record are positive. In a batch where most rows went negative on this line, that is the single most useful fact about the row. <code>wc_days</code> -6.19 is 24th of 31: the working capital cycle is funded by the trade rather than by the balance sheet. <code>fcf_yield</code> 10.05% is seventh of 32 and <code>asset_turnover</code> 1.158 is 12th of 31.",
  "<b>And it has never earned an adequate return on its equity — not once in ten years.</b> <code>roe_avg_above_threshold_10y</code> 0.000 is tied 27th of 32 in a six-way tie spanning positions 27 to 32, <code>roe_avg_above_threshold_7y</code> 0.000 is tied 23rd of 32 in a ten-way tie spanning positions 23 to 32, and <code>roe_avg_above_threshold_5y</code> 0.000 is tied 22nd of 32 in an 11-way tie spanning positions 22 to 32 — the average return on equity cleared the bar in none of those windows. <code>roce_3y</code> 13.39% is 15th of 31 and <code>roce_5y</code> 13.54% is 16th of 31, mid-pack. <code>op_margin_3y</code> 8.99% is 16th of 31 and <code>op_margin_trend_7y</code> -0.012 is 23rd of 31 — a nine per cent margin going nowhere over seven years. The growth is real but modest: <code>rev_cagr_5y</code> 14.38% is fifth of 31 and <code>np_cagr_5y</code> 12.09% is sixth of 25, with five-year profit growth above inflation 0.750 tied first of 32 in a ten-way tie spanning positions 1 to 10.",
  "<b>The chart is the best in the cohort and the multiple has gone past its own ceiling.</b> <code>ret_3m_rel</code> +45.53% is first of 31, <code>ret_6m_rel</code> +31.64% is third of 31 and <code>ret_12m_rel</code> +25.79% is third of 31, with the close above its 200-day EMA on 54.37% of the last 252 sessions at third of 31. <code>ema_stack_bull</code> 0.000 is tied fourth of 31 in a 28-way tie spanning positions 4 to 31, which is most of the cohort and says nothing. Against that: <code>pe_ttm</code> 29.35x is eighth of 25 and the own ten-year band runs 5.34-28.45x with an average of 13.28x — the stock is above the highest annual multiple it has traded on in a decade, and at more than twice its own mean. <code>pb</code> 1.84 is 14th of 31, <code>ev_ebitda_ttm</code> 9.77x is ninth of 29 and <code>peg</code> 2.428 is fifth of 13. The twelve months behind it support the move: <code>ttm_sales_pct</code> +19.34% is ninth of 29, <code>ttm_op_pct</code> +19.72% is 11th of 27 and <code>ttm_np_pct</code> +29.76% is 12th of 26, with <code>opm_now</code> 12.08% against <code>opm_prev</code> 12.05% at 11th of 29. Ownership: <code>fii_pct</code> 3.13% is 11th of 28, <code>dii_pct</code> 0.02% is 25th of 27 and <code>shareholders</code> 18,136 is 26th of 31. " + MOM95,
  "<i>ARIES is the cleanest cash story in this batch attached to the weakest return on equity in it. <code>cfo_pat_3y</code> 3.000 at tied first of 27 and FY2026 at 1.129 of operating profit are not artefacts — they are what the other seven rows here wish they had. But <code>roe_avg_above_threshold_10y</code> 0.000, <code>roce_3y</code> 13.39% at 15th of 31 and a nine per cent operating margin flat across seven years describe a business that converts cash well and earns very little on the capital it keeps. At 29.35x it is priced above everything in its own decade, having risen 45.53% relative in three months. The cash makes it worth watching; the price and the return on equity are why it is a watchlist name and not a holding. Confidence is medium.</i>",
 ],
 "trigger": "roce_3y lifting through 18% with opm_now above 13% -> the collection advantage is finally earning a return and 29.35x is the market seeing it first. ret_3m_rel giving back the gain with roce_3y under 14% -> a re-rating on momentum alone, above the top of its own ten-year band, with nothing in the returns to hold it there.",
 "evidence": ["cfo_pat_3y", "wc_days", "fcf_yield", "asset_turnover", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_5y", "roce_3y", "roce_5y", "op_margin_3y", "op_margin_trend_7y", "rev_cagr_5y", "np_cagr_5y", "np_growth_above_inflation_5y", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "pct_above_200ema_252d", "ema_stack_bull", "pe_ttm", "pb", "ev_ebitda_ttm", "peg", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"DHANUKA": {
 "confidence": "medium",
 "verdict": "HOLD — quality 67, fifth of 32 veteran peers, at 14.14x against an own ten-year band averaging 17.74x, with return on capital of 24.77%, third of 31",
 "points": [
  "<b>Held — DHANUKA is in your portfolio.</b> Dhanuka Agritech, ₹3,790cr and 13th of 32 by market cap in this bucket — crop protection chemicals across insecticides (35% of FY26), herbicides (31%), fungicides (19%) and others, run out of Gurugram with pan-India distribution and an export book; <code>promoter_pct</code> is 69.81%, 15th of 31. " + VET + "Quality 67, valuation 52, momentum 20, composite 65.",
  "<b>It has the best return-on-equity record in the cohort, and it is not a tie.</b> <code>roe_avg_above_threshold_10y</code> 1.000 is first of 32 outright — the only row here whose average return on equity cleared the bar in every year of the ten-year window — with <code>roe_avg_above_threshold_7y</code> 1.000 tied first of 32 in a two-way tie and <code>roe_avg_above_threshold_5y</code> 1.000 tied first of 32 in a two-way tie. <code>roce_5y</code> 26.12% is second of 31 and <code>roce_3y</code> 24.77% is third of 31. <code>op_margin_3y</code> 19.69% is second of 31 and <code>op_margin_trend_7y</code> 0.006 is fourth of 31 — a nineteen per cent margin that has been drifting up across seven years, which almost nothing in this cluster can claim. <code>np_consistency_10y</code> 1.752 is eighth of 32.",
  "<b>The top line is going backwards and the quarter is worse than the year.</b> <code>ttm_sales_pct</code> -5.62% is 26th of 29, <code>ttm_op_pct</code> -12.33% is 22nd of 27 and <code>ttm_np_pct</code> -11.70% is 21st of 26 — revenue, operating profit and net profit all down over twelve months. <code>sales_yoy_q</code> -12.56% is 26th of 29 and <code>np_yoy_q</code> -34.59% is 26th of 31, so the most recent quarter is a steeper decline than the year that contains it. <code>opm_now</code> 19.21% at third of 29 against <code>opm_prev</code> 20.68% at second of 29 gives back 1.5 points of a nineteen per cent margin. <code>cfo_pat_3y</code> 0.710 is 23rd of 27 — only 71% of three years of reported profit reached operating cash, which is weak in absolute terms and consistent rather than deteriorating: FY2026 collected 0.486 of operating profit against a prior-years mean of 0.481. <code>wc_days</code> 102.63 is fifth of 31 and <code>fcf_yield</code> 3.80% is 17th of 32.",
  "<b>Cheap against its own decade, and the market has stopped looking.</b> <code>pe_ttm</code> 14.14x is 15th of 25 and the own ten-year band runs 10.95-32.03x with an average of 17.74x — the stock trades a fifth below its own ten-year mean and nearer the floor of the band than the ceiling. <code>pb</code> 2.25 is 11th of 31, <code>ev_ebitda_ttm</code> 8.96x is 12th of 29, <code>ev_sales_ttm</code> 2.01x is eighth of 29 and <code>peg</code> 1.706 is ninth of 13. Momentum is the weakest thing on the row: <code>ret_12m_rel</code> -34.41% is 25th of 31, <code>ret_3m_rel</code> -8.57% is 23rd of 31, <code>ret_6m_rel</code> -12.97% is 14th of 31, and the close held above its 200-day EMA on 0.40% of the last 252 sessions at 26th of 31 — effectively the whole year below the average. Momentum 20 is tied 28th of 32. Institutions have not left: <code>dii_pct</code> 18.71% is third of 27, <code>fii_pct</code> 1.64% is 15th of 28 and <code>shareholders</code> 42,508 is 19th of 31. " + MOM95,
  "<i>DHANUKA is the row in this batch whose quality is unambiguous and whose problem is entirely the current year. <code>roe_avg_above_threshold_10y</code> 1.000 at first of 32, <code>roce_5y</code> 26.12% at second of 31, <code>op_margin_3y</code> 19.69% at second of 31 and a margin trend that is still positive over seven years — against revenue down 5.62%, a quarter down 12.56% and net profit down 34.59% in that quarter. The two sit together because agrochemical demand is a monsoon and a channel-inventory story, not a franchise story. At 14.14x against an own ten-year average of 17.74x, with <code>dii_pct</code> 18.71% at third of 27 and nothing in the cash record deteriorating, the price already reflects a bad year. What would make this wrong is the margin: <code>opm_now</code> 19.21% is still third of 29, and a business of this quality losing margin is a different problem from a business of this quality losing a season. Confidence is medium.</i>",
 ],
 "trigger": "sales_yoy_q back to growth with opm_now holding above 19% -> a monsoon year, and 14.14x against an own average of 17.74x was the discount for it. opm_now slipping under 17% with ttm_sales_pct still negative -> the margin was the quality, and the cheapness is the market pricing its loss rather than a season.",
 "evidence": ["roe_avg_above_threshold_10y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_5y", "roce_5y", "roce_3y", "op_margin_3y", "op_margin_trend_7y", "np_consistency_10y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "opm_now", "opm_prev", "cfo_pat_3y", "wc_days", "fcf_yield", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "ret_12m_rel", "ret_3m_rel", "ret_6m_rel", "pct_above_200ema_252d", "dii_pct", "fii_pct", "shareholders", "promoter_pct"],
},

"KRISHANA": {
 "confidence": "low",
 "verdict": "WATCH — momentum 85, first of 32 veteran peers, at 33.05x against an own ten-year band averaging 3.05x, on five-year profit growth of 57.25%, second of 25",
 "points": [
  "<b>Not held — KRISHANA is on your watchlist.</b> Krishana Phoschem, ₹6,499cr and eighth of 32 by market cap in this bucket — an integrated phosphatic fertiliser maker with in-house sulphuric and phosphoric acid, beneficiating low-grade rock phosphate into SSP and NPK/DAP from Meghnagar in Madhya Pradesh across twelve states; part of the Ostwal Group, which also controls MBAPL elsewhere in this batch; <code>promoter_pct</code> is 72.93%, ninth of 31. " + VET + "Quality 65, valuation 35, momentum 85, composite 84.",
  "<b>It is the fastest-growing company in this cluster, and that part is not in doubt.</b> <code>rev_cagr_5y</code> 66.00% is first of 31 and <code>np_cagr_5y</code> 57.25% is second of 25. Five-year profit growth above inflation 0.750 is tied first of 32 in a ten-way tie spanning positions 1 to 10, seven-year profit growth above inflation 0.833 is tied first of 32 in a seven-way tie spanning positions 1 to 7, and ten-year profit growth above inflation 0.778 is tied first of 32 in a five-way tie spanning positions 1 to 5. <code>ttm_sales_pct</code> +73.44% is first of 29, <code>sales_yoy_q</code> +34.58% is second of 29, <code>asset_turnover</code> 1.473 is fourth of 31 and <code>roce_3y</code> 18.68% is fifth of 31. On growth and on asset efficiency this is a top-five row in a 32-name cohort.",
  "<b>Net profit grew far faster than operating profit, and no cash arrived at all.</b> <code>ttm_np_pct</code> +95.27% is fourth of 26 against <code>ttm_op_pct</code> +55.88% at fourth of 27 — close to forty points of difference, and that difference sits below EBIT: other income, a one-off, tax or interest, not trading. A multiple quoted on that base is not a multiple on operations. <code>opm_now</code> 12.59% against <code>opm_prev</code> 14.01% at seventh of 29 means the operating margin actually fell while net profit nearly doubled, and <code>op_margin_trend_7y</code> -0.016 is 26th of 31. " + CASH + "On this row FY2026 collected -0.642 of operating profit as cash against a prior-years mean of -0.135, so the level is bad and the record behind it was already negative — there is nothing here that was working and has stopped. <code>cfo_pat_3y</code> 0.594 is 25th of 27, <code>fcf_yield</code> -1.08% is 24th of 32 and <code>wc_days</code> 102.60 is sixth of 31. <code>roe_avg_above_threshold_5y</code> 0.400 is tied ninth of 32 in a five-way tie spanning positions 9 to 13 and <code>np_consistency_10y</code> 1.447 is 19th of 32 — the decade is neither steady nor adequately profitable on equity.",
  "<b>The price has gone up tenfold against its own history.</b> <code>pe_ttm</code> 33.05x is seventh of 25, and the own ten-year band runs 0.89-7.46x with an average of 3.05x — this has never traded above 7.46x on an annual basis in a decade and now trades at more than ten times its own mean. <code>pb</code> 11.59 is third of 31, <code>ev_ebitda_ttm</code> 20.19x is fifth of 29 and <code>ev_sales_ttm</code> 2.81x is fifth of 29. <code>peg</code> 0.577 is 11th of 13 and reads cheap only because the denominator is a 57.25% profit CAGR off a small base. The chart is near the top of everything: <code>ret_12m_rel</code> +94.37% is second of 31, <code>ret_6m_rel</code> +55.53% is second of 31, <code>ret_3m_rel</code> +42.80% is second of 31, <code>ema_stack_bull</code> 1.000 is tied first of 31 in a three-way tie spanning positions 1 to 3, and the close held above its 200-day EMA on 96.83% of the last 252 sessions at second of 31. Ownership has not followed: <code>fii_pct</code> 0.37% is 20th of 28, <code>dii_pct</code> 0.03% is tied 23rd of 27 in a two-way tie and <code>shareholders</code> 19,162 is 24th of 31. " + MOM95,
  "<i>KRISHANA is the row in this batch most likely to be right and most dangerous to be wrong about. <code>rev_cagr_5y</code> 66.00% at first of 31 and <code>roce_3y</code> 18.68% at fifth of 31 are real, and a fertiliser business with its own acid is genuinely integrated. But three things sit on top of each other: net profit up 95.27% while operating profit rose 55.88% and the operating margin fell, FY2026 operating cash at -0.642 of operating profit against an already negative prior mean, and a multiple at 33.05x on a ten-year band averaging 3.05x. None of those is fatal alone; together they describe a company whose reported earnings, cash and valuation are all telling different stories, and the price has backed the most flattering of the three. Confidence is low — not because the figures are uncertain but because the gap between profit and cash has no explanation available in this snapshot.</i>",
 ],
 "trigger": "FY2027 operating cash turning positive with opm_now back above 14% -> the working capital was the growth funding it and 33.05x is early rather than wrong. another year of negative cash with ttm_np_pct still outrunning ttm_op_pct -> the earnings are not the cash and a multiple ten times its own decade average has nothing underneath it.",
 "evidence": ["rev_cagr_5y", "np_cagr_5y", "np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "ttm_sales_pct", "sales_yoy_q", "asset_turnover", "roce_3y", "ttm_np_pct", "ttm_op_pct", "opm_now", "opm_prev", "op_margin_trend_7y", "cfo_pat_3y", "fcf_yield", "wc_days", "roe_avg_above_threshold_5y", "np_consistency_10y", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"MBAPL": {
 "confidence": "low",
 "verdict": "WATCH — valuation 23, 27th of 31 veteran peers, at 48.67x against an own ten-year band averaging 3.67x, on a company whose operating cash fell to -0.56 of operating profit from a prior-years mean of 0.30",
 "points": [
  "<b>Not held — MBAPL is on your watchlist.</b> Madhya Bharat Agro Products, ₹7,540cr and seventh of 32 by market cap in this bucket — SSP, boronated and zincated SSP, NPK and DAP plus its own phosphoric and sulphuric acid, from Sagar in Madhya Pradesh and Dhule in Maharashtra, incorporated 1997 and listed via the SME board; part of the Ostwal Group alongside KRISHANA in this same batch; <code>promoter_pct</code> is 71.38%, 14th of 31. " + VET + "Quality 60, valuation 23, momentum 71, composite 68.",
  "<b>Nothing in this cluster has returned more over twelve months.</b> <code>ret_12m_rel</code> +107.88% is first of 31 and <code>ret_6m_rel</code> +68.40% is first of 31, with <code>ret_3m_rel</code> +18.07% at fourth of 31, <code>ema_stack_bull</code> 1.000 tied first of 31 in a three-way tie spanning positions 1 to 3, and the close above its 200-day EMA on 100.00% of the last 252 sessions — first of 31, every single session of the year. Behind it: <code>rev_cagr_5y</code> 39.67% is second of 31, <code>np_cagr_5y</code> 27.39% is fourth of 25, <code>ttm_sales_pct</code> +47.70% is second of 29, and <code>capex_intensity_3y</code> 11.89% is second of 31 — it is spending heavily on capacity, which is the honest reason free cash flow is negative at <code>fcf_yield</code> -1.74%, 25th of 32. <code>roce_5y</code> 19.51% is seventh of 31.",
  "<b>Net profit more than doubled while operating profit grew 40%, and the cash went the other way.</b> <code>ttm_np_pct</code> +108.81% is third of 26 against <code>ttm_op_pct</code> +39.51% at seventh of 27 — roughly seventy points of difference sitting below EBIT, in other income, a one-off, tax or interest rather than in trading. <code>opm_now</code> 12.57% against <code>opm_prev</code> 13.30% at eighth of 29 shows the operating margin falling while reported profit doubled, and <code>op_margin_trend_7y</code> -0.026 is 29th of 31 — the second-worst seven-year margin trend in the cohort. " + CASH + "On this row FY2026 collected -0.562 of operating profit as cash against a prior-years mean of 0.297. " + DETERIORATION + "<code>cfo_pat_3y</code> 1.558 is 14th of 27, which is the point: measured over three years this company collected more than its reported profit, and the three-year figure is now carrying a year that did the opposite. <code>wc_days</code> 99.70 is seventh of 31.",
  "<b>48.67x, against a decade that averaged 3.67x.</b> <code>pe_ttm</code> 48.67x is third of 25 and the own ten-year band runs 0.48-17.02x with an average of 3.67x — more than thirteen times its own ten-year mean and nearly three times the highest annual multiple in that band. <code>pb</code> 13.72 is second of 31, <code>ev_ebitda_ttm</code> 33.33x is third of 29 and <code>ev_sales_ttm</code> 5.16x is second of 29: on every valuation line available this is among the two or three dearest rows in a 32-name cohort, which is what valuation 23 at 27th of 31 is measuring. <code>peg</code> 1.777 is eighth of 13. The quality underneath is middling rather than bad: <code>roe_avg_above_threshold_5y</code> 0.600 is tied fifth of 32 in a four-way tie spanning positions 5 to 8, <code>roe_avg_above_threshold_10y</code> 0.300 is tied 13th of 32 in a two-way tie, <code>np_consistency_10y</code> 1.497 is 16th of 32 and <code>roce_3y</code> 14.64% is 12th of 31. <code>sales_yoy_q</code> +1.61% is 18th of 29 and <code>np_yoy_q</code> +16.84% is 13th of 31 — the latest quarter is nothing like the twelve months behind it. Ownership: <code>fii_pct</code> 1.03% is 16th of 28, <code>dii_pct</code> 0.07% is tied 20th of 27 in a two-way tie and <code>shareholders</code> 15,993 is 28th of 31. " + MOM95,
  "<i>MBAPL is the one row in this batch whose cash deterioration is unambiguous, and it is also the row the market likes most. Operating cash went from collecting 0.297 of operating profit to -0.562 in a single year, net profit doubled while the operating margin fell, <code>op_margin_trend_7y</code> -0.026 is 29th of 31, and the latest quarter grew 1.61% on sales. Against that <code>ret_12m_rel</code> +107.88% is first of 31 and spent every session of the year above its 200-day average. At 48.67x on a ten-year band averaging 3.67x, and <code>pb</code> 13.72 at second of 31, the price is not discounting any of it. The capex at 11.89% of sales is the one charitable reading — a company genuinely building capacity consumes cash — but capex does not explain net profit outrunning operating profit by seventy points. Confidence is low, and the risk here is asymmetric in a way the chart is actively hiding.</i>",
 ],
 "trigger": "FY2027 operating cash back above 0.3 of operating profit with ttm_op_pct catching ttm_np_pct -> the capex cycle explains the cash and a doubling business earns a premium. a second year of negative operating cash, or opm_now under 12% -> a thirteen-times re-rating of the multiple on earnings that are not arriving as cash, with nothing in the record to fall back on.",
 "evidence": ["ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "ema_stack_bull", "pct_above_200ema_252d", "rev_cagr_5y", "np_cagr_5y", "ttm_sales_pct", "capex_intensity_3y", "fcf_yield", "roce_5y", "ttm_np_pct", "ttm_op_pct", "opm_now", "opm_prev", "op_margin_trend_7y", "cfo_pat_3y", "wc_days", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_10y", "np_consistency_10y", "roce_3y", "sales_yoy_q", "np_yoy_q", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"SHIVALIK": {
 "confidence": "low",
 "verdict": "WATCH — quality 38, 26th of 32 veteran peers, with return on capital of 5.08%, 25th of 31, and cash conversion of 0.000 over three years, 27th of 27",
 "points": [
  "<b>Not held — SHIVALIK is on your watchlist.</b> Shivalik Rasayan, ₹510cr and 25th of 32 by market cap in this bucket — agrochemical technicals (dimethoate, malathion, trifloxystrobin, kresoxim methyl) alongside an active-pharmaceutical-ingredient and oncology-dosage business with CDMO work; <code>promoter_pct</code> is 46.54%, 26th of 31, the second-lowest promoter stake in the cohort. " + VET + "Quality 38, momentum 55, composite 29.",
  "<b>Not a rupee of three years of reported profit reached operating cash.</b> <code>cfo_pat_3y</code> 0.000 is 27th of 27 — the bottom of the cohort, and not nearly the bottom but the floor itself. " + CASH + "On this row FY2026 collected -0.721 of operating profit as cash against a prior-years mean of -0.156, so the level is the worst in the batch and the years behind it were already negative; there is nothing here that was working. <code>fcf_yield</code> -7.21% is 30th of 32 and <code>wc_days</code> 163.70 is third of 31 — the longest working-capital cycle in the cohort bar two, which is where the cash is sitting. <code>asset_turnover</code> 0.449 is 30th of 31: it earns less revenue per rupee of assets than almost anything here.",
  "<b>Steady for a decade, and steadily downhill.</b> <code>np_consistency_10y</code> 1.775 is fourth of 32 — one of the steadiest ten-year profit lines in the cohort. Then <code>np_cagr_5y</code> -16.58% is 24th of 25: the line is steady because it has been declining smoothly. Consistency scores how even a series is, not which way it points, and this row is the cleanest illustration of that in the batch. Said properly: five-year profit growth above inflation 0.250 is tied 23rd of 32 in a seven-way tie spanning positions 23 to 29, <code>roe_avg_above_threshold_5y</code> 0.000 is tied 22nd of 32 in an 11-way tie spanning positions 22 to 32 and <code>roe_avg_above_threshold_7y</code> 0.000 is tied 23rd of 32 in a ten-way tie spanning positions 23 to 32. <code>roce_3y</code> 5.08% is 25th of 31 and <code>roce_5y</code> 7.04% is 27th of 31 — a return on capital below what a deposit pays. The one bright line: <code>op_margin_3y</code> 13.60% is seventh of 31 and <code>rev_cagr_5y</code> 14.41% is fourth of 31, so revenue has grown and the gross economics are not the problem.",
  "<b>Below book value, at its own ten-year average multiple, on a chart that has just moved.</b> <code>pb</code> 0.851 is 24th of 31 — the market values the equity below its carrying amount, which in this cohort is rare. <code>pe_ttm</code> 37.28x is fifth of 25 and the own ten-year band runs 4.07-70.69x with an average of 37.28x: the multiple is at its own decade mean to the decimal, but a band that wide is a record of loss years and recoveries rather than a range, so it anchors very little. <code>ev_ebitda_ttm</code> 9.24x is 11th of 29 and <code>ev_sales_ttm</code> 1.596x is tenth of 29, both mid-pack — the enterprise-value lines are the ordinary ones here. Valuation 32 is 25th of 31 and is scored on 78 of its 100 declared points, because this row reports no growth-adjusted multiple at all. Recent: <code>ttm_sales_pct</code> +14.88% is 14th of 29, <code>ttm_op_pct</code> +9.92% is 17th of 27 and <code>ttm_np_pct</code> -8.86% is 20th of 26, with <code>np_yoy_q</code> +112.50% second of 31 off a very low base. <code>ret_3m_rel</code> +41.12% is third of 31 and <code>ret_6m_rel</code> +25.23% is fourth of 31, but <code>ret_12m_rel</code> -19.62% is 13th of 31 and the close held above its 200-day EMA on only 15.08% of the last 252 sessions at 15th of 31. " + MOM95,
  "<i>SHIVALIK is the weakest row in this batch and the cheapest, and those are the same fact. Composite 29 at 23rd of 31, <code>roce_3y</code> 5.08% at 25th of 31, <code>cfo_pat_3y</code> 0.000 at 27th of 27, <code>np_cagr_5y</code> -16.58% at 24th of 25 and FY2026 operating cash at -0.721 — against <code>pb</code> 0.851 at 24th of 31, which is the market saying the assets are worth more than the business that runs them. The API and CDMO half is the reason to look: <code>rev_cagr_5y</code> 14.41% at fourth of 31 and <code>op_margin_3y</code> 13.60% at seventh of 31 say the revenue and the gross margin work. Everything between gross margin and cash does not. A three-month relative gain of 41.12% on a row with a five per cent return on capital and no cash conversion is a re-rating in hope, and it is worth watching rather than owning until one year of positive operating cash exists. Confidence is low.</i>",
 ],
 "trigger": "one full year of positive operating cash with roce_3y above 9% -> the CDMO investment phase ended and a sub-book valuation was the opportunity. wc_days past 180 with cash conversion still negative -> the working capital is the business model, and below book value is where it belongs.",
 "evidence": ["cfo_pat_3y", "fcf_yield", "wc_days", "asset_turnover", "np_consistency_10y", "np_cagr_5y", "np_growth_above_inflation_5y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roce_3y", "roce_5y", "op_margin_3y", "rev_cagr_5y", "pb", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "np_yoy_q", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "pct_above_200ema_252d", "promoter_pct"],
},

"SUMICHEM": {
 "confidence": "medium",
 "verdict": "HOLD — quality 76, first of 11 mature peers, at 32.99x against an own seven-year band of 33.50-55.23x averaging 45.42x",
 "points": [
  "<b>Not held — SUMICHEM is on your watchlist.</b> Sumitomo Chemical India, ₹19,117cr and first of 11 by market cap in this bucket — herbicides, insecticides, fungicides and plant growth regulators, plus an environmental health division and animal nutrition, majority-owned by Sumitomo Chemical Company of Japan at a 75.00% promoter stake. " + MAT + THIN,
  "<b>It is the best business in its bucket on every quality line that has enough readings to rank.</b> Quality 76 is first of 11. <code>roce_5y</code> 24.44% is first of 11 and <code>roce_3y</code> 21.72% is second of 11. <code>op_margin_3y</code> 19.18% is first of 11 and <code>np_consistency_5y</code> 1.882 is second of 11. <code>wc_days</code> 54.21 is 11th of 11 — the shortest working-capital cycle in the bucket, and in a cluster where most rows went cash-negative this year, that matters more than usual. On cash this row is clean: <code>cfo_pat_3y</code> 1.254 is fourth of nine and FY2026 collected 0.663 of operating profit against a prior-years mean of 0.815 — lower than its own record but comfortably positive, and it carries no earnings-quality flag. <code>fcf_yield</code> 2.72% is fourth of 11.",
  "<b>What it does not have is growth.</b> <code>rev_cagr_5y</code> 1.42% is ninth of 11 — revenue has compounded at barely above zero for five years — and <code>np_cagr_5y</code> 6.41% is sixth of 10, so what profit growth there is came from margin rather than volume. The latest twelve months continue it: revenue -3.61%, operating profit -0.75% and net profit +4.02%, with the margin improving from 20.50% to 21.11%. The quarter is flat: sales +0.62% and net profit +20.46%. <code>capex_intensity_3y</code> 1.10% is 11th of 11 — the lowest reinvestment rate in the bucket, which is consistent with a business holding margin rather than chasing share, and is also the reason there is no obvious path to revenue growth from here. <code>asset_turnover</code> 0.724 is seventh of 11 and <code>op_margin_trend</code> 0.003 is sixth of 11.",
  "<b>Below the bottom of its own seven-year range for the first time.</b> <code>pe_ttm</code> is 32.99x, and the own seven-year band runs 33.50-55.23x with an average of 45.42x — the multiple is now beneath the lowest annual earnings multiple this company has traded on since the band begins, and at roughly three-quarters of its own seven-year mean. <code>pb</code> 5.64 is second of 11, which is the counterweight: cheap against its own history, still expensive against its bucket on book value. Valuation 39 is seventh of 11. Enterprise value sits at 25.38x EBITDA and 5.87x sales, and the dividend yield is 0.34% — ranks on all three rest on 7 or 8 readings and are not quoted. The chart is the weak part: <code>ret_3m_rel</code> -20.01% is tenth of 10, the worst three-month relative return in the bucket, <code>ret_6m_rel</code> -6.23% is sixth of 10, and <code>ema_stack_bull</code> 0.000 is tied third of 10 in an eight-way tie spanning positions 3 to 10. Momentum 34 is eighth of 10. The register is tight: promoter 75.00%, domestic institutions 9.33% and foreign institutions 3.02%, leaving a public float under 13%. " + MOM95,
  "<i>SUMICHEM is the highest-quality row in this batch and the one whose price has moved furthest in the right direction for a buyer. <code>roce_5y</code> 24.44% at first of 11, <code>op_margin_3y</code> 19.18% at first of 11, the shortest working-capital cycle in the bucket, positive cash in a year when most of its batch peers went negative, and a Japanese parent at 75.00%. Against that: <code>rev_cagr_5y</code> 1.42% at ninth of 11, revenue down 3.61% over twelve months, <code>capex_intensity_3y</code> 1.10% at 11th of 11, and <code>ret_3m_rel</code> -20.01% at tenth of 10. At 32.99x against a seven-year band whose floor is 33.50x, the market has repriced a business whose economics have not changed and whose revenue has not grown. Which of those two facts matters depends entirely on whether the flat top line is a cycle or the steady state, and five years of 1.42% compounding is starting to look like the latter. Confidence is medium — the quality is measured, the growth case is not available.</i>",
 ],
 "trigger": "rev_cagr_5y lifting through 6% with op_margin_3y holding above 19% -> a quality compounder bought below its own seven-year floor. another two years of revenue under 3% growth -> the margin is the whole business, 32.99x is the right price for no growth, and the band floor was not support.",
 "evidence": ["roce_5y", "roce_3y", "op_margin_3y", "np_consistency_5y", "wc_days", "cfo_pat_3y", "fcf_yield", "rev_cagr_5y", "np_cagr_5y", "capex_intensity_3y", "asset_turnover", "op_margin_trend", "pe_ttm", "pb", "ret_3m_rel", "ret_6m_rel", "ema_stack_bull", "promoter_pct", "dii_pct", "fii_pct"],
},

"DHARMAJ": {
 "confidence": "medium",
 "verdict": "HOLD — composite 63, 18th of 46 peers drawn from every maturity tier of the cluster, at 14.60x on a nine per cent operating margin, with FY2026 cash conversion of 0.27",
 "points": [
  "<b>Held — DHARMAJ is in your portfolio.</b> Dharmaj Crop Guard, ₹879cr and 30th of 49 by market cap in this cluster — an integrated agrochemicals maker running branded formulations, domestic institutional formulations, exports and its own domestic active ingredients (alpha cypermethrin, bifenthrin, lambda cyhalothrin, chlorantraniliprole, thiamethoxam, tebuconazole), incorporated 2015 out of Ahmedabad, selling into 24 Indian states and 41 countries; <code>promoter_pct</code> is 70.40%, 17th of 44. " + MIXED + THIN + "Quality 51, momentum 50, composite 63 — the valuation percentile is left to the fourth point, which is where what is missing from underneath it can be stated.",
  "<b>Profit is being reported and only a quarter of it is being collected.</b> " + CASH + "On this row FY2026 collected 0.270 of operating profit as cash against a prior-years mean of 0.317, so the latest year is poor and the years behind it were not much better — this is the level the company runs at, which is a different and less alarming claim than a fall. <code>cfo_pat_3y</code> 0.594 is 33rd of 41: measured over three years, under sixty paise of every reported rupee reached operating cash. <code>wc_days</code> 73.03 is 26th of 48 and the business reports no capital-expenditure intensity, no free-cash-flow yield and no dividend at all, so there is no reinvestment or payout line to read the cash against.",
  "<b>It turns its assets faster than almost anything in the cluster and earns an ordinary margin doing it.</b> <code>asset_turnover</code> 1.352 is seventh of 48 — a formulation and distribution model rather than a capital-heavy one. But <code>op_margin_3y</code> 8.83% is 27th of 47 and <code>roce_3y</code> 13.29% is 21st of 47, both mid-pack, and <code>opm_now</code> 9.29% at 29th of 41 against <code>opm_prev</code> 9.27% at 24th of 41 says the margin has been flat for twelve months. The twelve-month growth is steady and unremarkable: <code>ttm_sales_pct</code> +8.45% is 23rd of 41, <code>ttm_op_pct</code> +8.71% is 23rd of 38 and <code>ttm_np_pct</code> +14.94% is 20th of 37, with <code>sales_yoy_q</code> +4.08% at 23rd of 42 and <code>np_yoy_q</code> +16.94% at 20th of 44. Quality 51 is tied 27th of 48 in a two-way tie, which is what a flat margin on fast asset turns and weak cash collection scores.",
  "<b>Cheap on the cluster, and with no history of its own to be cheap against.</b> <code>pe_ttm</code> 14.60x is 22nd of 38, <code>ev_ebitda_ttm</code> 7.95x is 24th of 42, <code>ev_sales_ttm</code> 0.871x is 29th of 43 and <code>pb</code> 1.956 is 22nd of 48 — four valuation lines, all of them mid-pack to inexpensive. Valuation 56 is tied 24th of 48 in a two-way tie and is scored on 63 of its 100 declared points, because this row reports no growth-adjusted multiple, no free-cash-flow yield and no dividend yield; more than a third of the pillar's weight is absent and the percentile is answering a narrower question than the scorecard asks. There is also no own-history earnings band for this symbol — ten years of annual multiples is what the band needs and a 2015 incorporation listed in 2022 cannot supply it, so there is nothing to say whether 14.60x is cheap or dear for this company. The chart is mid-pack: <code>ret_12m_rel</code> -5.13% is seventh of 45, <code>ret_6m_rel</code> +6.98% is 11th of 47 and <code>ret_3m_rel</code> +6.23% is 15th of 47, with the close above its 200-day EMA on 41.27% of the last 252 sessions at tied eighth of 41 in a two-way tie spanning positions 8 to 9, and <code>ema_stack_bull</code> 0.000 tied seventh of 47 in a 41-way tie spanning positions 7 to 47. Ownership: <code>fii_pct</code> 3.13% is tied 16th of 41 in a two-way tie, <code>dii_pct</code> 0.50% is 24th of 39 and <code>shareholders</code> 26,567 is 28th of 44, down from 40,676 two years ago. " + MOM95,
  "<i>DHARMAJ is a holding whose numbers are almost all mid-pack, and whose one real defect is cash. <code>asset_turnover</code> 1.352 at seventh of 48 and <code>pe_ttm</code> 14.60x at 22nd of 38 are the case for it: an asset-light formulator on an undemanding multiple, growing sales 8.45% and profit 14.94% over twelve months. Against that, <code>cfo_pat_3y</code> 0.594 at 33rd of 41 and FY2026 collecting 0.270 of operating profit say the growth is being financed by working capital rather than funding itself, and <code>op_margin_3y</code> 8.83% at 27th of 47 leaves no room to absorb that. Two structural caveats sit on this row and both matter: the cohort is all 49 names across every tier because its own mid tier was too thin, so a company eleven years old is being ranked against companies thirty years old; and the valuation pillar is missing 37% of its weight. The thing to watch is the cash, not the multiple. Confidence is medium.</i>",
 ],
 "trigger": "cfo_pat_3y above 0.80 with op_margin_3y holding past 9% -> the working-capital drag was the growth phase and 14.60x was the whole opportunity. a third year collecting under 0.40 of operating profit, or opm_now under 8.5% -> reported profit that does not convert, on a balance sheet with no payout and no reinvestment line to show where it went.",
 "evidence": ["cfo_pat_3y", "wc_days", "asset_turnover", "op_margin_3y", "roce_3y", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "pb", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "ema_stack_bull", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"PARADEEP": {
 "confidence": "low",
 "verdict": "WATCH — no verdict: composite 100, first of 10 mature peers, is the top of a ten-name bucket and not of the market, and once the thin denominators are set aside this row has no rankable valuation line and FY2026 cash conversion of -0.46",
 "points": [
  "<b>Held — PARADEEP is in your portfolio and on your watchlist.</b> Paradeep Phosphates, ₹14,731cr and second of 11 by market cap in this bucket — DAP, TSP, MOP, NPK complexes, urea and Nano DAP, with phospho-gypsum, sulphuric acid, HFSA and ammonia as intermediates, run from Paradeep in Odisha under Zuari Maroc Phosphates; incorporated 1981. Promoter holding is 57.86%, domestic institutions hold 18.07% and foreign institutions 5.10%, with 329,116 registered shareholders. " + MAT + THIN + NOVERDICT + "Quality 59, valuation 85, momentum 60, composite 100.",
  "<b>What is measured here is growth, and it is genuine.</b> <code>rev_cagr_5y</code> 29.09% is second of 11 and <code>np_cagr_5y</code> 25.75% is third of 10 — five years of compounding at roughly thirty per cent on the top line and twenty-five on the bottom. <code>asset_turnover</code> 1.217 is first of 11: it generates more revenue per rupee of assets than any other mature name in this bucket, which for a fertiliser manufacturer with its own acid and ammonia plants is unusual. <code>capex_intensity_3y</code> 5.58% is third of 11, so the capacity is being added rather than coasted on. The twelve months continue it: revenue +28.1%, operating profit +20.1% and net profit +12.4%, with the latest quarter at +35.99% on sales and +23.93% on net profit. The margin is the soft part — 9.77% now against 10.43% a year ago, and <code>op_margin_3y</code> 8.40% is eighth of 11 with <code>op_margin_trend</code> 0.006 at fifth of 11.",
  "<b>And none of that growth arrived as cash this year.</b> " + CASH + "On this row FY2026 collected -0.458 of operating profit as cash against a prior-years mean of 0.052, which was already barely positive — so the latest year is bad and the base it fell from was close to nothing. The three-year figure disagrees: <code>cfo_pat_3y</code> 1.830 is second of nine, meaning that across three years this company collected nearly twice its reported profit. One of those two statements is about to stop being true, and which one depends on FY2027. <code>wc_days</code> 86.46 is eighth of 11 — a long cycle for this bucket, and a 28% revenue year funded through it is exactly where the cash went. <code>fcf_yield</code> -1.83% is fifth of 11: with capital expenditure running at 5.58% of sales and operating cash negative, free cash flow is negative too, and the gap is being carried on the balance sheet.",
  "<b>On valuation there is nothing here that can be ranked honestly.</b> The absolute figures: <code>pe_ttm</code> is 13.74x, <code>ev_ebitda_ttm</code> 7.88x, <code>ev_sales_ttm</code> 0.981x, <code>peg</code> 0.534 and <code>div_yield</code> 1.06%. Not one of those figures is read by more than eight names in this eleven-row bucket, so the scorer's ranks on them are arithmetic and are not quoted — valuation 85 at second of 11 rests substantially on them. <code>pb</code> 2.172 is sixth of 11 and is the one valuation line with a full set of readings. The own four-year band runs 11.17-54.15x with an average of 22.89x, which looks supportive until you notice it spans four annual readings of a fertiliser cycle with a subsidy regime inside it; a range from 11x to 54x anchors nothing. The chart: <code>ret_3m_rel</code> +11.94% is third of 10 and <code>ret_6m_rel</code> +11.45% is third of 10, while twelve-month relative return is -9.57% and the close held above its 200-day EMA on 41.67% of the last 252 sessions — read by eight and six peers respectively, and so unranked here. <code>ema_stack_bull</code> 0.000 is tied third of 10 in an eight-way tie spanning positions 3 to 10. <code>np_consistency_5y</code> 1.613 is ninth of 11, which is the honest counterweight to the growth: the compounding has been lumpy. " + MOM95,
  "<i>PARADEEP gets no verdict because the evidence will not carry one, and it is the position in this batch where that matters most. The growth is real and rankable — <code>rev_cagr_5y</code> 29.09% at second of 11, <code>asset_turnover</code> 1.217 at first of 11, revenue up 28.1% over twelve months. The cash is real and bad — FY2026 at -0.458 of operating profit from a prior mean of 0.052, <code>wc_days</code> 86.46 at eighth of 11, <code>fcf_yield</code> -1.83%. And the valuation, which is where a decision would have to be made, has no usable cohort reading at all: <code>pe_ttm</code> 13.74x is read by seven peers, <code>peg</code> 0.534 by three, and the own-history band is four years wide, from 11x to 54x. A composite of 100 sitting first of 10 is the arithmetic top of a ten-name bucket, not a verdict, and publishing it as one on a held position would be the dishonest move. What to do with it depends on one number that is not in this snapshot: FY2027 operating cash. Confidence is low, and the label is deliberate.</i>",
 ],
 "trigger": "FY2027 operating cash back above 0.5 of operating profit with wc_days under 80 -> a thirty per cent grower on 13.74x and the working capital was the subsidy cycle. a second year of negative operating cash, or op_margin_3y under 8% -> growth financed by receivables in a subsidy-dependent business, and a composite of 100 that was measuring a ten-name bucket.",
 "evidence": ["rev_cagr_5y", "np_cagr_5y", "asset_turnover", "capex_intensity_3y", "op_margin_3y", "op_margin_trend", "cfo_pat_3y", "wc_days", "fcf_yield", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "div_yield", "pb", "ret_3m_rel", "ret_6m_rel", "ema_stack_bull", "np_consistency_5y"],
},

}

# CHOICE 9/guard 9. DHARMAJ has no own-history band at all and the absence has
# to be stated, because a reader who sees no band assumes it was omitted.
NOBAND_PHRASE = "no own-history earnings band"


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These cover
    the third category — structural claims neither pass can see. Guard 11 is
    the one this batch forced into existence: five rows share one cash pattern
    and only one of them may call its own number a deterioration.
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
        #    the tier and the count. This cluster spans three buckets and the
        #    third is not a tier at all (49 rows, all tiers), so the stated
        #    count has two legal forms and the tier half is what can fail.
        want = TIER_SENTENCE.get(tier)
        if want is None:
            errs.append(f"{sym}: tier={tier} has no cohort sentence")
        elif want not in p0:
            errs.append(f"{sym}: tier={tier} but point one does not carry the "
                        f"{tier} cohort sentence")
        stated = re.search(r"against (\d+) (?:veteran|mid|mature)-tier peers"
                           r"|against (\d+) peers inside", p0)
        if not stated:
            errs.append(f"{sym}: point one states no cohort size")
        else:
            got = int(stated.group(1) or stated.group(2))
            if got != n:
                errs.append(f"{sym}: point one says {got} peers, "
                            f"peer_ranks says {n}")

        # 3. Per-symbol now, because DHARMAJ is legitimately not `full` — its
        #    mid tier missed the 10-peer floor. Every earlier batch asserted
        #    `full` for every row; that guard would fire on a correct row here.
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

        # 6. Seven rows hold 13 distinct sessions and ARIES holds none. 13 is a
        #    single-day print and 0 is an absence, so the word is banned and
        #    NODELIV is the only exemption — it reports the absence.
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

        # 8. Every evidence key must resolve non-NULL in THIS row's own
        #    cluster_metrics or verdict-load.py rejects the whole row. The key
        #    set differs by tier in this cluster — the mature rows carry
        #    op_margin_trend where the veterans carry op_margin_trend_7y — so a
        #    key lifted from another row resolves for some symbols and not all.
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics "
                            f"(tier={tier})")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")

        # 9. Any own-history PE band quoted in prose must match the pack in
        #    every number it states — width, low, high, average. Three forms
        #    are in use in this batch and all three are checked: the full
        #    range, the average alone, and ARIES's topping-out form. And a row
        #    with NO band in the pack must say so.
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
            for yr, hi in re.findall(
                    r"own (\w+)-year band topping out at ([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a band ceiling; pack has none")
                    continue
                _width(yr, "the topping-out form")
                if abs(float(hi) - band["hi"]) > 0.005:
                    errs.append(f"{sym}: band ceiling {hi} vs pack "
                                f"{band['hi']}")
        if not band and not any(NOBAND_PHRASE in pt for pt in pts):
            errs.append(f"{sym}: pack has no pe_band and no point says so "
                        f"('{NOBAND_PHRASE}')")
        if band and any(NOBAND_PHRASE in pt for pt in pts):
            errs.append(f"{sym}: claims no band but the pack has one "
                        f"(n={band.get('n')}) — the caveat is stale")

        # 10. Every <code> key in prose must exist and be non-NULL in THIS
        #     row's cluster_metrics. Kept from it_services as the general form:
        #     a live WORD_DIMS phrase can name a column the current cluster
        #     does not carry, so a sentence copied from an earlier batch reads
        #     perfectly and attributes its rank to nothing. Here it is `dso`
        #     that is absent from every row, and `capex_intensity_3y`,
        #     `div_yield`, `fcf_yield` and `peg` that are NULL on DHARMAJ only.
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

        # 11. THE NEW ONE. Five rows share one cash pattern, so the shared
        #     sentence is mandatory on each — but a shared sentence would let a
        #     row claim a deterioration it did not suffer. Three of the five
        #     fell from an already negative or near-zero prior mean, so for
        #     them the latest year is a level, not a fall. Only MBAPL, which
        #     fell from 0.297, may say otherwise. The elif keeps it from going
        #     stale: a rerun that clears a flag fails the build.
        flags = ((p.get("earnings_quality") or {}).get("flags") or [])
        eq = p.get("earnings_quality") or {}
        if sym in CASH_ROWS:
            latest, prior, may_fall = CASH_ROWS[sym]
            if not flags:
                errs.append(f"{sym}: in CASH_ROWS but the pack now carries no "
                            f"earnings-quality flag")
            for field, want in (("cfo_op_latest", latest),
                                ("cfo_op_prior_mean", prior)):
                got = eq.get(field)
                if got is None or abs(float(got) - want) > 0.0005:
                    errs.append(f"{sym}: CASH_ROWS says {field}={want}, pack "
                                f"says {got}")
            if CASH not in " ".join(pts):
                errs.append(f"{sym}: flagged on cash but carries no CASH "
                            f"sentence")
            for fig in (f"{latest:.3f}", f"{prior:.3f}"):
                if not any(fig in pt for pt in pts):
                    errs.append(f"{sym}: no point states the cash figure "
                                f"{fig}")
            said = [i + 1 for i, pt in enumerate(pts)
                    if re.search(r"deteriorat", pt, re.I)]
            if said and not may_fall:
                errs.append(f"{sym}: point(s) {said} call the cash number a "
                            f"deterioration, but the prior-years mean was "
                            f"{prior} — it is a level, not a fall")
            if may_fall and DETERIORATION not in " ".join(pts):
                errs.append(f"{sym}: fell from a positive base ({prior}) but "
                            f"no point carries DETERIORATION")
            if not may_fall and DETERIORATION in " ".join(pts):
                errs.append(f"{sym}: carries DETERIORATION on a prior mean of "
                            f"{prior}")
        else:
            if flags:
                errs.append(f"{sym}: pack carries {len(flags)} "
                            f"earnings-quality flag(s) but is not in "
                            f"CASH_ROWS")
            if CASH in " ".join(pts):
                errs.append(f"{sym}: carries the CASH sentence with no flag")

        # 12. KRISHANA and MBAPL trade at ten and thirteen times their own
        #     ten-year average multiple. No cohort rank shows that — both are
        #     mid-pack on the PE rank — so wherever the multiple is stated the
        #     band average travels with it. This is the only guard protecting
        #     the actual finding of the batch.
        if sym in RERATED:
            avg = RERATED[sym]
            mult = f"{live['pe_ttm']:.2f}x"
            for where, text in (("verdict", v["verdict"]),
                                ("trigger", v["trigger"]),
                                *((f"point {i + 1}", pt)
                                  for i, pt in enumerate(pts))):
                if mult in text and f"{avg:.2f}x" not in text:
                    errs.append(f"{sym}: {where} states {mult} without the "
                                f"own-band average {avg:.2f}x it is a "
                                f"multiple of")

        # 13. A pillar percentile computed on part of its declared weight may
        #     be quoted only alongside what is missing underneath it. Unlike
        #     MOM95 this is NOT uniform — two rows answering a narrower
        #     question than their peers — so the renormalisation sits in the
        #     SAME point, and the figure is banned from headline and trigger.
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

        # 14. The 9-reading floor. The mature bucket is 11 names and reads its
        #     valuation metrics on 3 to 8 of them; DHARMAJ's mid-tier growth
        #     metrics have 5 readings. A rank out of 3 is noise wearing a
        #     rank's clothes, and a caveat printed next to a number loses to
        #     the number. So these rows state no denominator under 9 at all.
        if sym in FLOOR_SYMS:
            if THIN not in p0:
                errs.append(f"{sym}: point one does not carry THIN")
            for pt in allprose:
                for d in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                    if int(d) < DENOM_FLOOR:
                        errs.append(f"{sym}: states a denominator of {d}, "
                                    f"under the {DENOM_FLOOR}-reading floor "
                                    f"this row is held to")
        elif THIN in p0:
            errs.append(f"{sym}: carries THIN but is not held to the floor")

        # 15. PARADEEP is `WATCH — no verdict`, and it is the held position in
        #     this batch with the least usable evidence. The label is the
        #     finding, so the headline must carry it, point one must carry the
        #     explanation, and no other row may use the phrase.
        if NOVERDICT in p0:
            if not v["verdict"].startswith("WATCH — no verdict"):
                errs.append(f"{sym}: carries NOVERDICT but the headline does "
                            f"not say so")
        elif "no verdict" in v["verdict"]:
            errs.append(f"{sym}: headline says 'no verdict' but point one "
                        f"carries no explanation")

        # 16. MOM95 exactly once per row. Zero means a momentum percentile is
        #     quoted as if scored on 100 points; twice is the bloat that makes
        #     a reader skip the caveat on the row that needs it.
        if sym in MOM95_SYMS:
            got = sum(MOM95 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM95 appears {got}x in the points, "
                            f"expected exactly 1")

        # 17. No promoter figure may be stated for a row whose promoter_pct is
        #     NULL. Every row here has one, which is exactly why the guard
        #     stays: the next cluster will not.
        if live.get("promoter_pct") is None and any(
                re.search(r"promoter", pt, re.I) for pt in allprose):
            errs.append(f"{sym}: names promoter but promoter_pct is NULL")

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
