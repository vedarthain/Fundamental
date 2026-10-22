"""defense_aero — the 10 tracked names, written against the real peer set.

WHY THIS FILE IS SHAPED THIS WAY

Fourth batch written with `peer_ranks` in the pack and the generic pass-2
checker, so the rules the chemicals, fmcg and textiles batches established
hold here unchanged: every denominator is a per-metric READING COUNT rather
than the cohort size, the cohort sentence names the bucket the scorer actually
used, and the guards below cover the structural claims neither pass can see.

What is specific to this batch:

CHOICE 1 — THE SMALLEST COHORT WRITTEN SO FAR, IN BOTH BUCKETS.

`scoring/scorer.py` peers on `(cluster_id, maturity_tier)` when the bucket
clears `MIN_PEERS = 10`. Here veteran holds 16 and mid holds exactly 10 — the
floor itself. Both clear it, so all 10 rows are `score_status = 'full'` and
none needs the mixed-tier caveat. Two cohort sentences; guard 2 fails any row
whose sentence does not match its own bucket.

A 16-name veteran cohort is already thin, and the per-metric counts under it
are thinner: `pct_above_200ema_252d` 11, `peg` 11, `ret_12m_rel` 12, `pe_ttm`
13, `np_cagr_5y` 14, `cfo_pat_3y` 15. Nothing in the veteran prose is quoted
against a count it does not have.

CHOICE 2 — THE MID BUCKET IS 10 NAMES AND ITS PRICE METRICS COLLAPSE TO FOUR.

This is the DOLLAR problem from the textiles batch, but across three rows
instead of one. The mid bucket's per-metric counts: `pe_ttm` 4, `opm_now` 5,
`opm_prev` 5, every `ttm_*` 5, `ev_ebitda_ttm` 6, `ev_sales_ttm` 7, all four
shareholding columns 7, `pct_above_200ema_252d` 7, `np_cagr_3y` 8,
`ret_12m_rel` 8, `cfo_pat_3y` 9, `fcf_yield` 9. UNIMECH's `peg` is read by
exactly one company — itself — and the pack marks it not rankable.

A rank out of 4 is not a rank. Guard 11 rejects any stated denominator below 9
on CYIENTDLM, KRISHNADEF and UNIMECH, so those three rows are forced onto the
thirteen metrics the whole bucket reports plus their own absolute figures.

CHOICE 3 — THE DEAD METRICS, AGAIN, PLUS DELIVERY.

The sanity block reports `roe_latest` and `tech_net_score_scaled` NULL for
100% of the universe, `p_premium` 99.6% and `book_value_cagr_3y` 99.5%. No row
argues from one. `delivery_data` is 12 distinct sessions, so a delivery
percentage is one day's print; guard 6 fails any row that quotes one. SIGMAADV
has no delivery row at all, which its own point says.

CHOICE 4 — FIVE ROWS CARRY AN EARNINGS-QUALITY FLAG AND NO TWO ARE THE SAME.

AXISCADES collected -0.008 of operating profit against a 0.536 prior mean —
nil, from a normal level. BEL collected 0.191 against 0.639: the best
return-on-capital record in the cluster having its worst collection year.
SIGMAADV collected -4.125 against a prior mean of 8.934, which is a sign flip
on a number that was nine times operating profit. CENTUM's level is 0.446 —
above the 0.40 threshold — and only the FALL from 1.117 is flagged.
DATAPATTNS is the mirror: 0.214 now against a prior mean of 0.140, so the
level is flagged and the direction is not, because it has been low for years.

Guard 10 maps each flagged symbol to the phrase naming ITS OWN defect. The
textiles lesson applies directly: requiring one generic phrase on all five
would pass a row that named the wrong problem, and here CENTUM's and
DATAPATTNS's problems are opposite ends of the same metric.

CHOICE 5 — CENTUM'S REPORTED PROFIT IS NOT ITS PROFIT.

A one-time other-income gain of ₹95.4cr pre-tax (₹91.3cr after tax) was
stripped from the latest quarter before any figure in this pack was computed,
as the scorer does. That is why `ttm_np_pct` reads -753.24% and sits 16th of
16: the comparison window contains the strip. Any screener will show a
spectacular profit number for this quarter. Guard 12 requires point one to say
so, because a reader who checks one number elsewhere and finds it disagrees
will discard the whole row rather than the one figure.

Its own PE band is the second half of the same problem: seven years running
16.35-1219.16x with an average of 335.96x. That is not a band, it is a
loss-year artefact, and the row says so rather than quoting it as a reference.

CHOICE 6 — FOUR ROWS HAVE A PILLAR SCORED ON PART OF ITS DECLARED WEIGHT.

AXISCADES and CENTUM have neither `pe_ttm` nor `peg`, so valuation is scored
on 40 of its 100 declared points. CYIENTDLM and KRISHNADEF have no `peg`, so
valuation is scored on 65. SIGMAADV has neither `ret_12m_rel` nor
`pct_above_200ema_252d` — 190 price bars against the ~450 the metric needs —
so momentum is scored on 67.

SIGMAADV is the one that matters: momentum 73 is 4th of 16 with both of the
components that would tell you whether the trend is durable missing. Guard 13
requires any point quoting one of these five percentiles to name the
renormalisation in the same point. A percentile on a partial pillar answers a
narrower question than the scorecard asks, and quoting it bare is the defect.

CHOICE 7 — KRISHNADEF HAS SEVEN QUARTERS AND THEREFORE NO TTM COMPARISON.

`ttm_sales_pct`, `ttm_op_pct`, `ttm_np_pct`, `opm_now` and `opm_prev` are all
NULL. Guard 14 rejects any mention of those five on this row — not just a
rank, the key itself — and requires point one to say why. Its quality 77 and
valuation 92 rest on three-year annual aggregates with no recent-period
cross-check underneath them, and the row has to say that out loud rather than
let two high percentiles carry it.
"""

import json
import re

PACK = "/tmp/def10.json"
OUT = "build/verdicts/defense-aero-10-verdicts.json"
SOURCE_REPORT = "defense_aero — 10 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

# Measured against app.portfolio_holding on 2026-10-22, not recalled. The pack
# carries no membership flag, so point one's held/not-held line is a claim
# like any other and this is what checks it.
HELD = {"BEL"}

EMIT = {"ASTRAMICRO", "AXISCADES", "BEL", "CENTUM", "CYIENTDLM",
        "DATAPATTNS", "HAL", "KRISHNADEF", "SIGMAADV", "UNIMECH"}

VET = ("Peered against 16 veteran-tier peers inside <code>defense_aero</code> "
       "— the scorer's bucket is (cluster, maturity tier) and this one clears "
       "the 10-peer floor, so every rank below is against those veterans "
       "rather than the whole cluster, and the row is badged <code>full</code> "
       "with no mixed-tier caveat. Sixteen is a thin cohort and the "
       "per-metric reading counts under it are thinner still, so every "
       "denominator below is the metric's own. ")

MID = ("Peered against 10 mid-tier peers inside <code>defense_aero</code> — "
       "the scorer's bucket is (cluster, maturity tier) and this one sits "
       "exactly on the 10-peer floor, so every rank below is against those "
       "mid-tier names rather than the whole cluster, and the row is badged "
       "<code>full</code> with no mixed-tier caveat. ")

TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company "
       "on the platform; the momentum pillar renormalises around the "
       "components that do exist, so the percentile is a narrower question "
       "than the scorecard asks rather than a lost weight.")

# The sentence the three mid rows carry, and the reason none of them may state
# a denominator under 9. Ten names, but only thirteen metrics are read by nine
# or more of them; price and recent-period metrics are read by four to seven.
THIN = ("Ten names is the floor, and most metrics here are read by far fewer "
        "— 4 peers report an earnings multiple, 5 an operating margin, 7 a "
        "shareholding split. A rank out of 4 is not a rank, so no denominator "
        "below 9 appears below and the rest of the argument runs on the "
        "company's own figures. ")

# CENTUM only. The strip is upstream of every figure in the pack, so a reader
# comparing one number against a screener will find it disagrees — and will
# discard the row rather than the number unless this is stated first.
ONETIME = ("One number has to come before the rest: a one-time other-income "
           "gain of ₹95.4cr pre-tax, ₹91.3cr after tax, was stripped out of "
           "the latest quarter before anything here was computed, which is "
           "what the scorer does. A screener will show a spectacular profit "
           "for this quarter and this row will not agree with it. The "
           "stripped comparison is why the TTM net figure below is a large "
           "negative rather than a large positive. ")

# KRISHNADEF only. Seven quarters of listed history, so there is no
# TTM-versus-prior-TTM window at all and no latest-period margin.
NOTTM = ("Seven quarters of listed history is the constraint on this whole "
         "row: there is no TTM-versus-prior-TTM comparison, no latest-period "
         "operating margin, and no PEG. Everything below is a three-year "
         "annual aggregate or an absolute, with no recent-period cross-check "
         "underneath it. ")

# SIGMAADV only. The one row with no delivery row at all, which is the single
# exemption guard 6 grants to the word it otherwise rejects outright.
NODELIV = ("There is also no delivery row for this symbol, so accumulation "
           "cannot be separated from churn.")

# Metrics NULL for >=95% of the universe. Naming one is a claim about a number
# the platform does not hold.
DEAD = ("book_value_cagr_3y", "p_premium", "roe_latest")

# Rows the pack flagged for an earnings-quality gap, and the phrase each one's
# prose must carry. A dict rather than a set because the five flags are five
# different defects (CHOICE 4) — and CENTUM's and DATAPATTNS's are opposite
# ends of the same metric, so one shared phrase would pass a row that named
# the wrong problem. Read off pack[sym]["earnings_quality"]["flags"], and
# guard 10 asserts the pack still carries a flag for every symbol listed here,
# so a rerun that clears a flag fails the build instead of shipping a stale
# caveat.
EQ_FLAGGED = {
    "AXISCADES": "operating cash was effectively nil",
    "BEL": "19 paise of every rupee",
    "CENTUM": "level is still above the threshold",
    "DATAPATTNS": "low for years, not newly low",
    "SIGMAADV": "a sign flip, not a slip",
}

# Rows whose pillar percentile is computed on part of its declared weight
# (CHOICE 6), and the phrase that must appear in the SAME point as any
# mention of that pillar's figure. The percentile itself is not wrong; quoting
# it without saying what is missing from underneath it is.
PILLAR_WEIGHT = {
    "AXISCADES": ("valuation", "40 of its 100 declared points"),
    "CENTUM": ("valuation", "40 of its 100 declared points"),
    "CYIENTDLM": ("valuation", "65 of its 100 declared points"),
    "KRISHNADEF": ("valuation", "65 of its 100 declared points"),
    "SIGMAADV": ("momentum", "67 of its 100 declared points"),
}


SPEC = {

# ---------------------------------------------------------------- veterans

"HAL": {
 "confidence": "medium",
 "verdict": "WATCH — composite 100, first of 16 veteran peers, with return on capital 31.96%, third of 16, but the growth is at the slow end of the cluster and 35.09x sits above an own nine-year band topping out at 33.40x",
 "points": [
  "<b>Not held — HAL is on your watchlist.</b> Hindustan Aeronautics, ₹327,098cr and first of 16 by market cap in this bucket — design, manufacture, repair and overhaul of military aircraft and aero-engines for the Ministry of Defence: LCA Tejas, LCH Prachand, the HTT-40 trainer, Su-30 MKI and the AL-31FP engine; <code>promoter_pct</code> is 71.64%, fifth of 16. " + VET + "Quality 74, valuation 65, momentum 64, composite 100.",
  "<b>The quality record is the real thing here.</b> <code>roce_3y</code> 31.96% is third of 16 and <code>roce_5y</code> 30.20% is second of 16 — the same answer over two windows, so the return is structural rather than a good year. <code>roe_avg_above_threshold_10y</code> 1.000 is tied first of 16, a two-way tie spanning positions 1 to 2: every one of the last ten years cleared the ROE hurdle. <code>np_growth_above_inflation_7y</code> 1.000 is tied first of 16, a three-way tie spanning positions 1 to 3, and <code>np_consistency_10y</code> 1.658 is third of 16. <code>op_margin_3y</code> 30.91% is fourth of 16 with <code>opm_now</code> 29.64% against <code>opm_prev</code> 31.48% at fourth of 15, so the margin is giving a little back. <code>cfo_pat_3y</code> 1.302 is fourth of 15 and <code>fcf_yield</code> 3.15% is first of 16 — the profit converts and there is free cash after capex, which is not true of most of this cluster.",
  "<b>What you are paying 35.09x for is not growing quickly.</b> <code>rev_cagr_5y</code> 7.67% is 13th of 16 and <code>np_cagr_5y</code> 15.74% is 12th of 14 — the bottom third of the cluster on both. <code>ttm_op_pct</code> +1.2% is tenth of 15 while <code>ttm_sales_pct</code> +7.4% is eighth of 15 and <code>ttm_np_pct</code> +12.2% is eighth of 16, so the latest twelve months added revenue without adding operating profit. <code>sales_yoy_q</code> +14.45% is 11th of 16 and <code>np_yoy_q</code> +14.88% is seventh of 16. <code>peg</code> 2.230 is third of 11 — growth-adjusted this is one of the dearer rows in the bucket, not one of the cheaper ones.",
  "<b>The multiple is above its own nine-year ceiling and the chart is mid-pack.</b> <code>pe_ttm</code> 35.09x is 11th of 13 — cheap relative to this cluster — but the own nine-year band runs 3.02-33.40x with an average of 13.74x, so the stock trades above everything in its own usable history and at more than twice its own mean. <code>pb</code> 7.97x is 11th of 16 and <code>ev_ebitda_ttm</code> 24.71x is 13th of 15. <code>wc_days</code> -622.04 is 15th of 16: the order book is funded by customer advances, which is a structural advantage and also why <code>inv_days</code> 362.16 at third of 16 costs it nothing. The chart: <code>ret_12m_rel</code> +13.92% is seventh of 12, <code>ret_6m_rel</code> +20.81% is seventh of 15, <code>ret_3m_rel</code> +14.09% is sixth of 15, <code>ema_stack_bull</code> 1.000 is tied first of 15, a five-way tie spanning positions 1 to 5, and the close held above its 200-day EMA on 56.35% of the last 252 sessions, ninth of 11. <code>fii_pct</code> 9.34% is fourth of 16, <code>dii_pct</code> 11.90% is fifth of 16 and <code>shareholders</code> 1,211,981 is second of 16. " + TNS,
  "<i>The uncomfortable answer on HAL is that composite 100 is a quality score, not a price score. Composite 100 is first of 16 and quality 74 is first of 16; every one of the last ten years cleared the ROE hurdle and <code>roce_5y</code> 30.20% is second of 16 — and <code>rev_cagr_5y</code> 7.67% is 13th of 16 with TTM operating profit up 1.2%. At 35.09x the stock sits above its own nine-year band of 3.02-33.40x with an average of 13.74x, and <code>peg</code> 2.230 is third of 11. Nothing here is broken and nothing here is cheap: the margin gave back 1.8 points this year and the order book is the entire thesis. Confidence is medium because this platform holds no order-book data, and for this company that is the only number that matters.</i>",
 ],
 "trigger": "rev_cagr_5y lifting toward the mid-teens with ttm_op_pct following it -> a 35.09x multiple on a quality record ranked first of 16 becomes defensible rather than full. opm_now slipping under 28% while the multiple stays above its own nine-year ceiling of 33.40x -> paying a peak multiple for a decelerating margin on a company whose order book this platform cannot see.",
 "evidence": ["roce_3y", "roce_5y", "roe_avg_above_threshold_10y", "np_growth_above_inflation_7y", "np_consistency_10y", "op_margin_3y", "opm_now", "opm_prev", "cfo_pat_3y", "fcf_yield", "rev_cagr_5y", "np_cagr_5y", "ttm_op_pct", "ttm_sales_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "peg", "pe_ttm", "pb", "ev_ebitda_ttm", "wc_days", "inv_days", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"BEL": {
 "confidence": "medium",
 "verdict": "HOLD — composite 81, fourth of 16 veteran peers, on return on capital 33.74%, first of 16, but cash conversion fell to 0.191 times operating profit from a prior-years mean of 0.639",
 "points": [
  "<b>Held — BEL is in your portfolio.</b> Bharat Electronics, ₹272,545cr and second of 16 by market cap in this bucket — a Government of India defence electronics enterprise under the Ministry of Defence; <code>promoter_pct</code> is 51.14%, tenth of 16. " + VET + "Quality 69, valuation 58, momentum 55, composite 81.",
  "<b>Return on capital is first of 16 and the cash behind it was not collected.</b> <code>roce_3y</code> 33.74% is first of 16 and <code>roce_5y</code> 31.05% is first of 16 — no veteran peer here earns more on its capital over either window. <code>roe_avg_above_threshold_10y</code> 1.000 is tied first of 16, a two-way tie spanning positions 1 to 2, and <code>np_growth_above_inflation_7y</code> 1.000 is tied first of 16, a three-way tie spanning positions 1 to 3. Against that: in FY2026 operating cash flow was 0.191 times operating profit against a prior-years mean of 0.639 — 19 paise of every rupee of operating profit reached the bank, where the prior average was closer to 64 paise. <code>cfo_pat_3y</code> 0.510 is tenth of 15, so the three-year picture sits below the cluster middle too, not just the latest year.",
  "<b>Margins and growth are strong and both are giving a little back.</b> <code>op_margin_3y</code> 27.62% is fifth of 16, with <code>opm_now</code> 28.55% against <code>opm_prev</code> 29.73% at fifth of 15. <code>ttm_sales_pct</code> +19.83% is fifth of 15, <code>ttm_op_pct</code> +15.10% is sixth of 15 and <code>ttm_np_pct</code> +11.75% is ninth of 16 — revenue growing faster than profit, which is the margin step showing up. <code>rev_cagr_5y</code> 15.77% is ninth of 16 and <code>np_cagr_5y</code> 26.08% is tenth of 14, so the five-year growth record is middling for this cluster even though the return on capital is not. <code>np_consistency_10y</code> 1.655 is fourth of 16. <code>wc_days</code> 34.08 is ninth of 16 and <code>inv_days</code> 134.52 is tenth of 16.",
  "<b>The price has moved against you and the chart agrees.</b> <code>pe_ttm</code> 44.34x is ninth of 13 and the own ten-year band runs 3.32-48.31x with an average of 18.49x — the multiple is near its own ten-year ceiling and nearly two and a half times its decade mean. <code>pb</code> 11.36x is seventh of 16, <code>ev_ebitda_ttm</code> 30.16x is 11th of 15 and <code>peg</code> 1.700 is fifth of 11. The chart has stopped working: <code>ret_12m_rel</code> -1.19% is ninth of 12, <code>ret_6m_rel</code> -8.16% is 13th of 15, <code>ret_3m_rel</code> -0.83% is ninth of 15, <code>ema_stack_bull</code> 0.000 puts it in a ten-way tie spanning positions 6 to 15, and the close held above its 200-day EMA on 67.86% of the last 252 sessions, seventh of 11. Ownership is the counterweight: <code>fii_pct</code> 18.02% is first of 16, <code>dii_pct</code> 21.02% is first of 16 and <code>shareholders</code> 2,604,298 is first of 16 — the widest institutional and retail register in this bucket. " + TNS,
  "<i>The uncomfortable part of holding BEL is that the return on capital is first of 16 and the cash conversion is tenth of 15. 33.74% on capital, every one of the last ten years above the ROE hurdle, TTM revenue up 19.83% — and 0.191 times operating profit collected in FY2026 against a 0.639 prior mean, with <code>cfo_pat_3y</code> 0.510 saying three years were not much better. At 44.34x against an own ten-year band of 3.32-48.31x with an average of 18.49x, the multiple already contains the quality. A twelve-month relative return of -1.19% is the market taking the price back toward the earnings rather than the thesis breaking. Hold, and read the receivables line in the next annual report rather than the order-inflow press release.</i>",
 ],
 "trigger": "cfo_pat_3y moving back above 1.0 with FY2027 operating cash near the 0.639 prior mean -> the 33.74% return on capital is being collected again and 44.34x is a quality premium rather than a stretch. opm_now slipping under 27% while cfo_pat_3y stays near 0.5 -> margin and collection failing together on a multiple already near its own ten-year ceiling of 48.31x.",
 "evidence": ["roce_3y", "roce_5y", "roe_avg_above_threshold_10y", "np_growth_above_inflation_7y", "cfo_pat_3y", "op_margin_3y", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "rev_cagr_5y", "np_cagr_5y", "np_consistency_10y", "wc_days", "inv_days", "pe_ttm", "pb", "ev_ebitda_ttm", "peg", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct", "shareholders", "promoter_pct"],
},

"ASTRAMICRO": {
 "confidence": "medium",
 "verdict": "WATCH — quality 52, tied eighth of 16 veteran peers, with foreign institutions at 10.74% and domestic institutions at 16.09%, both third of 16, filling a promoter register that holds almost nothing",
 "points": [
  "<b>Not held — ASTRAMICRO is on your watchlist.</b> Astra Microwave Products, ₹15,086cr and seventh of 16 by market cap in this bucket — RF and microwave modules, sub-systems and radar systems for defence, space and meteorology: AESA and precision-approach radar, electronic warfare modules and systems, telemetry, satellite electronics and GaN/GaAs MMIC products to 40 GHz, with HAL among its named customers; <code>promoter_pct</code> is 6.54%, 16th of 16. " + VET + "Quality 52, valuation 52, momentum 56, composite 50.",
  "<b>There is effectively no promoter in this company and the institutions have taken the space.</b> <code>promoter_pct</code> 6.54% is 16th of 16 — no veteran peer here has a smaller controlling holding, and the comparison inside the same bucket is HAL at 71.64% and BEL at 51.14%. <code>public_pct</code> 66.64% is second of 16. What filled the gap is institutional: <code>fii_pct</code> 10.74% is third of 16 and <code>dii_pct</code> 16.09% is third of 16, with <code>shareholders</code> 117,894 at ninth of 16. A defence electronics business with no anchor shareholder and a two-thirds public float is a governance fact rather than a valuation one — it decides who sets strategy, and in a sector where the customer is the government, it is worth knowing before the numbers.",
  "<b>The operating trend is better than the percentiles suggest and the latest quarter is worse.</b> <code>op_margin_3y</code> 25.16% is sixth of 16 with <code>opm_now</code> 28.51% against <code>opm_prev</code> 25.99% at sixth of 15 — the margin is improving, and <code>op_margin_trend_7y</code> +0.024 at third of 16 says it has been improving for seven years. <code>np_cagr_5y</code> 50.24% is fifth of 14 and <code>np_growth_above_inflation_5y</code> 1.000 is tied first of 16, a six-way tie spanning positions 1 to 6. Then the quarter: <code>sales_yoy_q</code> -11.55% is 14th of 16 and <code>np_yoy_q</code> -24.09% is 11th of 16, both negative, on a business whose revenue is order timing rather than run rate. <code>roce_3y</code> 17.59% is eighth of 16 and <code>roce_5y</code> 15.80% is eighth of 16, and <code>roe_avg_above_threshold_10y</code> 0.000 is tied 14th of 16, a three-way tie spanning positions 14 to 16: zero of the last ten years cleared the ROE hurdle.",
  "<b>Working capital is the cost of this model and the price already pays for the growth.</b> <code>wc_days</code> 288.24 is third of 16 and <code>inv_days</code> 193.47 is fifth of 16 — more than nine months of working capital, which is what building radar sub-systems to order costs. <code>cfo_pat_3y</code> 0.668 is ninth of 15 and <code>fcf_yield</code> +0.02% is ninth of 16, so two-thirds of reported profit reached operating cash over three years and nothing was left after capex. FY2026 itself was far better — operating cash was 1.157 times operating profit against a prior-years mean of -0.036 — which is the right direction and one year of it. <code>pe_ttm</code> 79.80x is sixth of 13, <code>pb</code> 11.48x is sixth of 16, <code>ev_ebitda_ttm</code> 41.01x is ninth of 15, <code>ev_sales_ttm</code> 13.27x is ninth of 16 and <code>peg</code> 1.588 is sixth of 11, against an own ten-year band of 10.21-87.77x with an average of 37.42x — mid-bucket on every measure and roughly twice its own decade mean. " + TNS,
  "<i>A mid-pack row on almost everything, with two exceptions: <code>op_margin_trend_7y</code> +0.024 at third of 16, and <code>promoter_pct</code> 6.54% at 16th of 16. The second is why confidence is medium rather than higher — composite 50 is the platform saying it has no strong opinion, and the governance question underneath it is not something a percentile answers. <code>ret_12m_rel</code> +59.54% at second of 12 has already paid for the margin improvement, and the latest quarter went backwards on both lines. Watch whether FY2027 repeats FY2026's 1.157 times operating profit or reverts to the negative prior mean: one year is a data point, two is a model.</i>",
 ],
 "trigger": "cfo_pat_3y rising toward 1.0 as the FY2026 collection repeats -> a 79.80x multiple on a seven-year improving margin and 50.24% five-year profit growth starts to make sense. sales_yoy_q staying negative for a second quarter with wc_days above 288 -> order timing turning into a funding problem in a company holding a 6.54% promoter stake and nobody obvious to put equity in.",
 "evidence": ["promoter_pct", "fii_pct", "dii_pct", "shareholders", "op_margin_3y", "opm_now", "opm_prev", "op_margin_trend_7y", "np_cagr_5y", "np_growth_above_inflation_5y", "sales_yoy_q", "np_yoy_q", "roce_3y", "roce_5y", "roe_avg_above_threshold_10y", "wc_days", "inv_days", "cfo_pat_3y", "fcf_yield", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "ret_12m_rel"],
},

"DATAPATTNS": {
 "confidence": "medium",
 "verdict": "WATCH — composite 19, 14th of 16 veteran peers, on ten-year profit growth above inflation 1.000, first of 16, because the price has taken all of it: 83.31x earnings and 12.86x book value, third of 16",
 "points": [
  "<b>Not held — DATAPATTNS is on your watchlist.</b> Data Patterns (India), ₹22,320cr and fifth of 16 by market cap in this bucket — a single-segment defence and aerospace electronics designer and manufacturer: low-level lightweight radar, digital wideband receivers for fighter radar-warning, 20-inch cockpit displays, mission management and display computers, the Talon Shield jammer pod and transportable precision approach radar; <code>promoter_pct</code> is 42.41%, 14th of 16. " + VET + "Quality 56, valuation 28, momentum 59, composite 19.",
  "<b>The operating record is the strongest thing in this cluster and the row still scores 19 on composite.</b> <code>op_margin_3y</code> 40.63% is second of 16 with <code>opm_now</code> 39.65% against <code>opm_prev</code> 38.36% at second of 15. <code>np_growth_above_inflation_10y</code> 1.000 is first of 16 — ten of the last ten years grew profit faster than inflation, and no other veteran here does that over a ten-year window. <code>np_growth_above_inflation_7y</code> 1.000 is tied first of 16, a three-way tie spanning positions 1 to 3. <code>ttm_sales_pct</code> +33.81% is fourth of 15, <code>ttm_op_pct</code> +38.30% is fourth of 15 and <code>ttm_np_pct</code> +24.90% is fourth of 16; <code>rev_cagr_5y</code> 31.33% is sixth of 16 and <code>np_cagr_5y</code> 30.36% is ninth of 14. <code>roce_3y</code> 20.28% is sixth of 16 and <code>roce_5y</code> 19.86% is fifth of 16.",
  "<b>Almost none of it converts, and that is structural rather than a bad year.</b> <code>cfo_pat_3y</code> 0.354 is 11th of 15 — about a third of the profit reported over three years reached operating cash. FY2026 was 0.214 times operating profit and the prior-years mean was 0.140, so this is low for years, not newly low: the pack flags the level and not the direction, which is the worse of the two readings. <code>wc_days</code> 321.15 is first of 16 and <code>inv_days</code> 108.10 is 11th of 16 — the longest working-capital cycle among these veterans, with the inventory not where it sits. <code>fcf_yield</code> -0.14% is 11th of 16. A 40.63% operating margin that takes 321 days of working capital to earn is a margin on paper and a funding requirement in practice.",
  "<b>The price is where composite 19 comes from.</b> Valuation 28 is 16th of 16 — no veteran peer here is dearer on the pillar taken whole. <code>pe_ttm</code> 83.31x is fifth of 13, <code>pb</code> 12.86x is third of 16, <code>ev_sales_ttm</code> 24.12x is second of 16 and <code>ev_ebitda_ttm</code> 56.11x is seventh of 15, with <code>peg</code> 2.744 at first of 11 — growth-adjusted, the dearest row in this bucket. The own five-year band runs 38.81-74.63x with an average of 56.16x, so 83.31x is above a band that is only five years long and was never cheap inside it. The chart is still mostly working: <code>pct_above_200ema_252d</code> 0.873 is second of 11 and <code>ret_12m_rel</code> +56.02% is fourth of 12, while <code>ret_6m_rel</code> +6.22% is tenth of 15 and <code>ret_3m_rel</code> -5.76% is 12th of 15, so the recent leg has stalled. <code>fii_pct</code> 12.50% is second of 16 and <code>dii_pct</code> 11.98% is fourth of 16. " + TNS,
  "<i>Composite 19 at 14th of 16 is the platform saying the price has taken everything the business has earned and some of what it has not. The business side is not in question: <code>op_margin_3y</code> 40.63% at second of 16, <code>np_growth_above_inflation_10y</code> 1.000 at first of 16, TTM revenue up 33.81%. The price side is 83.31x against an own five-year band of 38.81-74.63x with an average of 56.16x, <code>peg</code> 2.744 at first of 11, and <code>wc_days</code> 321.15 at first of 16 — growth funded by working capital and priced above a five-year band. Confidence is medium because both halves are unambiguous: this is a question about what you pay, not about what you would own.</i>",
 ],
 "trigger": "cfo_pat_3y moving above 0.70 with wc_days falling under 250 -> the 40.63% margin starts producing cash and the multiple has something to compound into. pe_ttm holding above 83x while ttm_op_pct decelerates under 20% -> paying the bucket's first-of-11 PEG for growth that is slowing, on a row the platform already scores 19 on composite.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "np_growth_above_inflation_10y", "np_growth_above_inflation_7y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "rev_cagr_5y", "np_cagr_5y", "roce_3y", "roce_5y", "cfo_pat_3y", "wc_days", "inv_days", "fcf_yield", "pe_ttm", "pb", "ev_sales_ttm", "ev_ebitda_ttm", "peg", "pct_above_200ema_252d", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "fii_pct", "dii_pct", "promoter_pct"],
},

"AXISCADES": {
 "confidence": "low",
 "verdict": "WATCH — momentum 75, third of 16 veteran peers, on a row where operating cash was effectively nil last year and net profit halved while operating profit stood still",
 "points": [
  "<b>Not held — AXISCADES is on your watchlist.</b> AXISCADES Technologies, ₹8,579cr and tenth of 16 by market cap in this bucket — engineering, electronics and manufacturing for aerospace, defence and AI: embedded electronics, automatic test equipment, tooling, wire harnesses, precision assemblies, mission electronics and radar and air-defence applications, with Aerospace, Defence and ESAI together about 78% of FY2026 consolidated revenue; <code>promoter_pct</code> is 58.03%, eighth of 16. " + VET + "Quality 45, valuation 29, momentum 75, composite 25. Valuation 29 is scored on 40 of its 100 declared points — this company reports neither an earnings multiple nor a PEG — so the pillar is renormalised around what remains and answers a narrower question than the scorecard asks.",
  "<b>Last year the company collected nothing.</b> In FY2026 operating cash flow was -0.008 times operating profit against a prior-years mean of 0.536: operating cash was effectively nil, from a level that had been ordinary. <code>cfo_pat_3y</code> 1.195 is fifth of 15, which is the confusing part — over three years the conversion is good, and the latest year is a sign change on it. <code>fcf_yield</code> -0.13% is tenth of 16. <code>inv_days</code> 24.87 is 14th of 16 and <code>wc_days</code> 44.85 is eighth of 16, so this is not an inventory business and the cash did not go into stock; it went into receivables or into an acquisition's balance sheet, and the pack cannot tell you which.",
  "<b>Net profit halved while operating profit stood still, so the damage is below EBIT.</b> <code>ttm_np_pct</code> -53.78% is 14th of 16 while <code>ttm_op_pct</code> +0.74% is 11th of 15 and <code>ttm_sales_pct</code> +3.64% is 11th of 15. <code>sales_yoy_q</code> +94.16% is third of 16 and <code>np_yoy_q</code> -171.47% is 15th of 16 in the same quarter, which is what consolidation into the top line and a loss appearing at the bottom looks like. <code>op_margin_3y</code> 14.30% is 11th of 16, with <code>opm_now</code> 12.71% against <code>opm_prev</code> 13.08% at 12th of 15. <code>roce_3y</code> 12.88% is 12th of 16 and <code>roce_5y</code> 12.08% is 14th of 16. <code>np_consistency_10y</code> 0.991 is 14th of 16 and <code>np_growth_above_inflation_10y</code> 0.444 is tied 11th of 16, a four-way tie spanning positions 11 to 14 — the ten-year record clears inflation in under half its years.",
  "<b>There is no earnings multiple, and the measures that do exist are the dearest in the bucket.</b> <code>ev_ebitda_ttm</code> 143.15x is first of 15 — no veteran peer here is dearer on EBITDA — with <code>pb</code> 11.79x at fifth of 16 and <code>ev_sales_ttm</code> 15.26x at seventh of 16. Both <code>pe_ttm</code> and <code>peg</code> are absent, which is why the valuation pillar is renormalised, and the own six-year band of 3.58-89.63x with an average of 46.57x is a 25-fold range rather than a reference point. The chart is the best thing on this row: <code>ema_stack_bull</code> 1.000 is tied first of 15, a five-way tie spanning positions 1 to 5, the close held above its 200-day EMA on 84.13% of the last 252 sessions, fourth of 11, <code>ret_3m_rel</code> +40.31% is fourth of 15, <code>ret_12m_rel</code> +41.82% is fifth of 12 and <code>ret_6m_rel</code> +16.32% is eighth of 15. <code>fii_pct</code> 1.45% is 13th of 16 and <code>dii_pct</code> 1.96% is ninth of 16 — institutions are not in this one. " + TNS,
  "<i>Momentum 75 at third of 16, on a row where net profit halved and operating cash went to nil, is the whole tension. <code>ev_ebitda_ttm</code> 143.15x at first of 15 is being paid for a 3.64% TTM revenue increase and a 0.74% operating profit increase. The three-year <code>cfo_pat_3y</code> 1.195 at fifth of 15 says the business has collected before, which is the only reason this is a watch rather than an avoid. Confidence is low: with no earnings multiple, no PEG, an own six-year band of 3.58-89.63x with an average of 46.57x, and an acquisition moving through both the revenue line and the cash flow, there is no stable number here to anchor on. Wait for one clean annual report.</i>",
 ],
 "trigger": "one clean annual report with operating cash back near the 0.536 prior mean and ttm_np_pct positive -> the EBITDA multiple has earnings underneath it and 143.15x stops being a division by almost nothing. ttm_op_pct staying under 5% through another year of nil collection -> an acquisition that bought revenue and no cash, on a row with no earnings multiple to fall back on.",
 "evidence": ["cfo_pat_3y", "fcf_yield", "inv_days", "wc_days", "ttm_np_pct", "ttm_op_pct", "ttm_sales_pct", "sales_yoy_q", "np_yoy_q", "op_margin_3y", "opm_now", "opm_prev", "roce_3y", "roce_5y", "np_consistency_10y", "np_growth_above_inflation_10y", "ev_ebitda_ttm", "pb", "ev_sales_ttm", "ema_stack_bull", "pct_above_200ema_252d", "ret_3m_rel", "ret_12m_rel", "ret_6m_rel", "fii_pct", "dii_pct", "promoter_pct"],
},

"CENTUM": {
 "confidence": "low",
 "verdict": "WATCH — momentum 78, second of 16 veteran peers, with return on capital 3.59%, 15th of 16, and a reported quarterly profit that disappears once a ₹95.4cr one-time gain is stripped out",
 "points": [
  "<b>Not held — CENTUM is on your watchlist.</b> Centum Electronics, ₹5,829cr and 12th of 16 by market cap in this bucket — electronics system design and manufacturing across EMS, build-to-spec and engineering R&D: PCB assemblies, box builds, line replaceable units, full system integration, radars, electronic warfare systems, satellite payloads, avionics and cockpit systems, alongside powertrain electronics and medical imaging; <code>promoter_pct</code> is 46.82%, 13th of 16. " + VET + ONETIME + "Quality 39, valuation 58, momentum 78, composite 62. Valuation 58 is scored on 40 of its 100 declared points — this company reports neither an earnings multiple nor a PEG — so the pillar is renormalised around what remains and answers a narrower question than the scorecard asks.",
  "<b>The return on capital is last in this cluster over five years, and not by a one-year dip.</b> <code>roce_3y</code> 3.59% is 15th of 16 and <code>roce_5y</code> 2.69% is 16th of 16 — no veteran peer here earns less on its capital over five years. <code>rev_cagr_5y</code> 5.13% is 15th of 16, <code>np_consistency_10y</code> 0.766 is 15th of 16 and <code>np_growth_above_inflation_10y</code> 0.333 is tied 15th of 16, a two-way tie spanning positions 15 to 16. <code>op_margin_3y</code> 11.82% is 12th of 16, with <code>opm_now</code> 11.76% against <code>opm_prev</code> 12.34% at 13th of 15. That is two decades of contract electronics producing a low-single-digit return on capital, which is what the model gives you: you are paid a margin on someone else's design.",
  "<b>The cash flow is the one genuinely good number, and it is deteriorating.</b> <code>cfo_pat_3y</code> 1.500 is second of 15 and <code>fcf_yield</code> +1.95% is fourth of 16 — over three years this business turned more of its profit into cash than almost anything else here, helped by <code>wc_days</code> -30.70 at 12th of 16, a negative working-capital cycle funded by customer advances. The flag is the direction: FY2026 collected 0.446 times operating profit against a prior-years mean of 1.117. The level is still above the threshold the scorer uses, so this is a deterioration rather than a failure — but it more than halved in one year, and <code>inv_days</code> 174.77 at seventh of 16 is where to look for it.",
  "<b>The price has run and the band it ran from is unusable.</b> <code>pb</code> 16.98x is second of 16 while <code>ev_sales_ttm</code> 5.51x is 15th of 16 — expensive on book, cheap on sales, which is a business carrying very little equity against a lot of revenue — and <code>ev_ebitda_ttm</code> 40.49x is tenth of 15. There is no earnings multiple and no PEG, and the own seven-year band of 16.35-1219.16x with an average of 335.96x is a loss-year artefact rather than a range: four digits in a PE band means a year with almost no profit in the denominator, and nothing in it can serve as a reference. The chart is the opposite story: <code>pct_above_200ema_252d</code> 0.889 is first of 11, <code>ret_12m_rel</code> +61.45% is first of 12, <code>ret_6m_rel</code> +45.87% is fourth of 15 and <code>ret_3m_rel</code> +17.72% is fifth of 15, while <code>ema_stack_bull</code> 0.000 puts it in a ten-way tie spanning positions 6 to 15. <code>dii_pct</code> 19.67% is second of 16 against <code>fii_pct</code> 3.31% at seventh of 16, and <code>shareholders</code> 30,466 is 15th of 16 — a narrow register. " + TNS,
  "<i>Momentum 78 at second of 16 and <code>ret_12m_rel</code> +61.45% first of 12, on a company whose <code>roce_5y</code> 2.69% is 16th of 16. That is the row. The reported quarterly profit that drove the move contains a ₹95.4cr one-time other-income gain which this pack strips out, leaving <code>ttm_np_pct</code> -753.24% at 16th of 16 — so the number a screener shows and the number here are not the same number, and the gap is not small. Confidence is low: no earnings multiple, no PEG, an own seven-year band of 16.35-1219.16x with an average of 335.96x, and a re-rating built on a profit line that needed an adjustment before it could be read. <code>cfo_pat_3y</code> 1.500 at second of 15 is the one thing worth coming back for.</i>",
 ],
 "trigger": "roce_3y lifting above 8% as the design-led share of revenue rises -> a contract manufacturer turning into an engineering business, and 16.98x book has something to hold onto. cfo_pat_3y falling under 1.0 as the FY2026 collection of 0.446 repeats -> the one good number on this row going, on a 2.69% five-year return on capital that nothing else supports.",
 "evidence": ["roce_3y", "roce_5y", "rev_cagr_5y", "np_consistency_10y", "np_growth_above_inflation_10y", "op_margin_3y", "opm_now", "opm_prev", "cfo_pat_3y", "fcf_yield", "wc_days", "inv_days", "pb", "ev_sales_ttm", "ev_ebitda_ttm", "pct_above_200ema_252d", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "ema_stack_bull", "dii_pct", "fii_pct", "shareholders", "promoter_pct", "ttm_np_pct"],
},

"SIGMAADV": {
 "confidence": "low",
 "verdict": "WATCH — composite 31, 12th of 16 veteran peers, at 36.04x book value, first of 16, on a negative three-year operating margin and last year's operating cash at -4.125 times operating profit",
 "points": [
  "<b>Not held — SIGMAADV is on your watchlist.</b> Sigma Advanced Solutions, ₹16,883cr and sixth of 16 by market cap in this bucket — a tier-1 aerospace and defence precision engineering group: aero-engine components, sub-assemblies and Class I fabrications, aero-structures, military engine and structure assemblies, drones and counter-drone systems, UAVs and loitering munitions, and missile subsystems, with UK subsidiaries Nasmyth and Bromford and aerospace around 75% of the April 2026 order book; <code>promoter_pct</code> is 66.24%, sixth of 16. " + VET + "Quality 40, valuation 40, momentum 73, composite 31. Momentum 73 is scored on 67 of its 100 declared points: 190 price bars against the roughly 450 the 200-EMA trend metric needs, so both the twelve-month relative return and the 200-EMA reading are absent and the pillar is renormalised around what is left. Absence there is a short listing history, not a weak trend. " + NODELIV,
  "<b>The growth is extraordinary and the arithmetic behind it is a base effect.</b> <code>rev_cagr_5y</code> 75.04% is second of 16 and <code>np_cagr_5y</code> 175.99% is second of 14, which over a five-year window means the starting year was tiny. <code>sales_yoy_q</code> 70.839 is first of 16 — the latest quarter's sales are seventy-one times the year-ago quarter's, which is an acquisition and a reporting-base change rather than organic growth — while <code>np_yoy_q</code> -0.825 is 14th of 16, so the same quarter's profit went backwards. <code>ttm_np_pct</code> +12.64% is seventh of 16 and is the only TTM figure the pack holds for this row: <code>ttm_sales_pct</code> and <code>ttm_op_pct</code> are both absent, as is <code>opm_prev</code>, so there is no comparable twelve-month revenue or operating-profit line at all.",
  "<b>The three-year operating margin is negative and the seven-year trend is the worst reading in the bucket.</b> <code>op_margin_3y</code> -6.19% is 15th of 16 and <code>op_margin_trend_7y</code> -0.271 is 16th of 16 — the margin has been going one way for seven years and the direction is down. <code>opm_now</code> 14.40% is tenth of 16, so the latest period is positive where the three-year average is not. <code>roce_3y</code> 17.18% is ninth of 16 against <code>roce_5y</code> 12.39% at 13th of 16, <code>np_consistency_10y</code> 1.045 is 13th of 16 and <code>np_growth_above_inflation_7y</code> 0.667 is eighth of 16. <code>cfo_pat_3y</code> is absent, so three-year cash conversion cannot be checked at all — and the one year that can be is the flagged one: FY2026 operating cash was -4.125 times operating profit against a prior-years mean of 8.934, a sign flip, not a slip, on a number that had been nine times operating profit.",
  "<b>Nothing in this bucket is priced like this.</b> <code>pb</code> 36.04x is first of 16, <code>pe_ttm</code> 108.54x is second of 13, <code>ev_ebitda_ttm</code> 124.14x is third of 15 and <code>ev_sales_ttm</code> 19.97x is fourth of 16 — the dearest row here on book value and inside the top three on every other measure the platform holds. <code>peg</code> 0.617 is ninth of 11, which looks cheap and is an artefact of dividing a 108x multiple by a five-year profit CAGR built off a tiny base. The own eight-year band runs 9.70-82.15x with an average of 36.27x, so 108.54x sits above everything in its own history and at three times its own mean. <code>fcf_yield</code> -0.64% is 12th of 16 and <code>wc_days</code> 220.93 is fourth of 16. The chart is where this row earns its momentum reading: <code>ret_3m_rel</code> +88.40% is first of 15 and <code>ret_6m_rel</code> +272.33% is first of 15, while <code>ema_stack_bull</code> 0.000 puts it in a ten-way tie spanning positions 6 to 15 — the stock has nearly quadrupled relative to the market in six months without the moving averages lining up behind it. <code>fii_pct</code> 0.13% is 15th of 16 and <code>dii_pct</code> 0.02% is 14th of 16: no institution is in this. " + TNS,
  "<i>Momentum 73 at fourth of 16 is scored on 67 of its 100 declared points, with both the twelve-month relative return and the 200-EMA trend reading absent — so the one pillar this row scores well on is the one the platform can see least of. Underneath it: <code>op_margin_3y</code> -6.19% at 15th of 16, <code>op_margin_trend_7y</code> -0.271 at 16th of 16, no three-year cash conversion at all, FY2026 operating cash at -4.125 times operating profit against a prior mean of 8.934, and <code>pb</code> 36.04x at first of 16. <code>ret_6m_rel</code> +272.33% is real and first of 15. Confidence is low for structural reasons: 190 price bars, no comparable TTM revenue line, no cash-conversion history and a quarterly sales figure that is a base change. This is a position taken on an order book, and this platform does not hold one.</i>",
 ],
 "trigger": "two clean annual reports with operating cash positive and op_margin_3y turning positive -> the integration is finished and a 108.54x multiple has a margin underneath it. ret_6m_rel giving back its +272.33% while op_margin_trend_7y stays negative -> a re-rating unwinding on a row with no cash-conversion history, no comparable TTM revenue line and no institutional holder to defend it.",
 "evidence": ["rev_cagr_5y", "np_cagr_5y", "sales_yoy_q", "np_yoy_q", "ttm_np_pct", "op_margin_3y", "op_margin_trend_7y", "opm_now", "roce_3y", "roce_5y", "np_consistency_10y", "np_growth_above_inflation_7y", "pb", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "peg", "fcf_yield", "wc_days", "ret_3m_rel", "ret_6m_rel", "ema_stack_bull", "fii_pct", "dii_pct", "promoter_pct"],
},

# ------------------------------------------------------------------ mid tier

"CYIENTDLM": {
 "confidence": "low",
 "verdict": "WATCH — composite 70, fourth of 10 mid-tier peers, on three-year profit consistency 1.932, first of 10, at 71.37x earnings while the last twelve months of revenue went backwards",
 "points": [
  "<b>Not held — CYIENTDLM is on your watchlist.</b> Cyient DLM, ₹5,993cr and third of 10 by market cap in this bucket — the Cyient group's end-to-end electronics manufacturing arm for high-reliability sectors: cockpit display units, flight management systems, surveillance radar, communication and navigation systems, RF products, UAVs, PCB assembly, harnesses, box build and precision machining, with Honeywell, Collins Aerospace, BEL, BAE Systems and Thales named as customers. " + MID + THIN + "Quality 43, valuation 72, momentum 74, composite 70. Valuation 72 is scored on 65 of its 100 declared points — there is no PEG for this company — so the pillar is renormalised around what remains and answers a narrower question than the scorecard asks. There is no own-history PE band either: not enough usable annual history.",
  "<b>The record is steady and the thing it is steady around is almost nothing.</b> <code>np_consistency_3y</code> 1.932 is first of 10 — no mid-tier peer here has a smoother three-year profit line. But <code>rev_cagr_3y</code> 2.88% is ninth of 10 and <code>op_margin_3y</code> 9.46% is ninth of 10, so what is consistent is a thin margin on a revenue line that has barely moved in three years. <code>op_margin_trend_3y</code> +0.004 is third of 10, which says the margin is drifting up rather than down, and <code>roce_3y</code> 10.36% is seventh of 10. Over the last twelve months revenue fell 1.5% while operating profit rose 1.5% and net profit rose 2.9%; <code>opm_now</code> 10.00% against <code>opm_prev</code> 9.70% is the same story — a contract manufacturer holding its margin by not growing.",
  "<b>Working capital is the problem and the cash conversion shows it.</b> <code>cfo_pat_3y</code> 0.245 is sixth of 9 — under a quarter of three years of reported profit reached operating cash. <code>inv_days</code> 187.30 is third of 10 and <code>wc_days</code> 143.75 is fourth of 10, so more than six months of inventory sits inside a business running a 9.46% operating margin: every rupee of growth costs cash before it earns any. <code>fcf_yield</code> -1.52% is fifth of 9. FY2026 was an improvement — operating cash was 0.425 times operating profit against a prior-years mean of -0.159 — so the direction is right and the level is still low.",
  "<b>You are paying 71.37x for a business compounding revenue at 2.88% a year.</b> <code>pb</code> 5.92x is sixth of 10, the earnings multiple is 71.37x and EV/sales is 4.20x — neither of the last two is rankable in a bucket where only four and seven companies report them, and the pack holds no own-history PE band for this row. Promoters hold 52.11%, foreign institutions 0.24% and domestic institutions 29.19%; the domestic figure is the parent's stake rather than a fund view, which is worth knowing before reading it as institutional conviction. The chart has worked: <code>ret_6m_rel</code> +93.34% is second of 10 and <code>ret_3m_rel</code> +18.44% is fifth of 10, the twelve-month relative return is +68.38%, and <code>ema_stack_bull</code> 0.000 puts it in a five-way tie spanning positions 6 to 10 — the moving averages are not stacked despite the move. The close held above its 200-day EMA on 50.00% of the last 252 sessions. " + TNS,
  "<i>Composite 70 at fourth of 10, in a bucket of ten names, with valuation 72 scored on 65 of its 100 declared points and no PE band at all, is a weak signal dressed as a strong one. The narrower summary: <code>np_consistency_3y</code> 1.932 at first of 10, <code>rev_cagr_3y</code> 2.88% at ninth of 10, <code>op_margin_3y</code> 9.46% at ninth of 10, <code>cfo_pat_3y</code> 0.245 at sixth of 9, and 71.37x earnings. A high-reliability EMS business with Honeywell and Collins as customers is a real franchise; at 71.37x on 2.88% three-year revenue growth you are paying for the customer list rather than for the results. Confidence is low because the bucket is ten names, four of them report an earnings multiple, and there is no own history to compare the current one against.</i>",
 ],
 "trigger": "rev_cagr_3y lifting into double digits with cfo_pat_3y above 0.60 -> the customer list converts into growth and cash, and 71.37x has something to grow into. inv_days extending past 200 while opm_now slips under 9% -> working capital absorbing a thin margin, in a ten-name bucket where only four peers report an earnings multiple to warn you.",
 "evidence": ["np_consistency_3y", "rev_cagr_3y", "op_margin_3y", "op_margin_trend_3y", "roce_3y", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "cfo_pat_3y", "inv_days", "wc_days", "fcf_yield", "pb", "pe_ttm", "ev_sales_ttm", "promoter_pct", "fii_pct", "dii_pct", "ret_6m_rel", "ret_3m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d"],
},

"UNIMECH": {
 "confidence": "low",
 "verdict": "WATCH — composite 90, second of 10 mid-tier peers, with return on capital 27.63%, second of 10, and net profit down 12.1% over the last twelve months at 111.93x earnings",
 "points": [
  "<b>Not held — UNIMECH is on your watchlist.</b> Unimech Aerospace and Manufacturing, ₹8,061cr and second of 10 by market cap in this bucket — integrated precision engineering for aerospace, defence, energy and semiconductors across Aero and MRO Tooling and Precision Components: engine stands and transportation systems, engine lifting and balancing equipment, turbine assembly fixtures, drilling jigs and airframe assembly tooling, ground support equipment and turnkey engineered assemblies. " + MID + THIN + "Quality 70, valuation 69, momentum 85, composite 90. There is no own-history PE band — not enough usable annual history — so the 111.93x multiple has nothing of its own to be measured against.",
  "<b>The margin and the return are genuinely good and the growth is not.</b> <code>op_margin_3y</code> 35.89% is second of 10 and <code>roce_3y</code> 27.63% is second of 10 — a tooling business earning aerospace margins at aerospace returns. <code>np_consistency_3y</code> 1.862 is third of 10. Against that, <code>rev_cagr_3y</code> 7.33% is eighth of 10 and three-year profit growth is 4.34%, so three years of compounding sit at the slow end of this bucket. <code>op_margin_trend_3y</code> -0.031 is eighth of 10: the margin is drifting down, and <code>opm_now</code> 33.18% against <code>opm_prev</code> 34.92% is that drift in a single step.",
  "<b>Net profit fell while revenue grew, and the gap sits below EBIT.</b> Over the last twelve months revenue rose 15.6% and operating profit 9.8% while net profit fell 12.1% — a 22-point divergence between the operating and net lines, which means interest, depreciation on new capacity, or tax rather than trading. <code>cfo_pat_3y</code> 0.913 is third of 9 and <code>fcf_yield</code> +0.07% is third of 9, so conversion is among the better ones in this bucket and nothing is left after capex, which is what a company building capacity looks like. FY2026 operating cash was 0.793 times operating profit against a prior-years mean of 0.427. <code>wc_days</code> 46.26 is seventh of 10 and <code>inv_days</code> 38.11 is eighth of 10 — a short cycle, which is the structural advantage of tooling over electronics assembly.",
  "<b>The price assumes the growth arrives.</b> <code>pb</code> 10.93x is fourth of 10; the earnings multiple is 111.93x, EV/sales 28.28x and EV/EBITDA 66.73x, none of them rankable in a bucket where four, seven and six companies respectively report them. <code>peg</code> 1.038 is read by exactly one company in this bucket — itself — so the pack marks it not rankable and no rank for it appears here. Promoters hold 79.82%, the tightest register in this bucket, with foreign institutions at 0.43%. The chart is strong: <code>ret_6m_rel</code> +69.41% is third of 10 and <code>ret_3m_rel</code> +44.33% is third of 10, the twelve-month relative return is +69.10%, and <code>ema_stack_bull</code> 1.000 is tied first of 10, a five-way tie spanning positions 1 to 5. The close held above its 200-day EMA on 49.60% of the last 252 sessions — under half the year above trend, despite those relative returns. " + TNS,
  "<i>Composite 90 at second of 10 is the highest score in this batch outside HAL, and it is scored in a ten-name bucket where four peers report an earnings multiple. What is solid: <code>op_margin_3y</code> 35.89% at second of 10, <code>roce_3y</code> 27.63% at second of 10, <code>cfo_pat_3y</code> 0.913 at third of 9. What is not: <code>rev_cagr_3y</code> 7.33% at eighth of 10, three-year profit growth of 4.34%, net profit down 12.1% over the last twelve months, and 111.93x earnings with no own band to anchor it. A 79.82% promoter holding leaves very little free float, which cuts both ways on a stock up 69% relative in a year. Confidence is low — not because the business looks weak, but because the price needs a growth rate the three-year record does not contain and the bucket is too thin to cross-check it.</i>",
 ],
 "trigger": "rev_cagr_3y accelerating past 20% with the net line catching up to operating profit -> 111.93x becomes a growth multiple rather than a scarcity multiple. opm_now slipping under 30% while the net line stays negative -> margin compression and a below-EBIT leak together, on a 79.82% promoter holding with almost no float to absorb selling.",
 "evidence": ["op_margin_3y", "roce_3y", "np_consistency_3y", "rev_cagr_3y", "np_cagr_3y", "op_margin_trend_3y", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "cfo_pat_3y", "fcf_yield", "wc_days", "inv_days", "pb", "pe_ttm", "ev_sales_ttm", "ev_ebitda_ttm", "peg", "promoter_pct", "fii_pct", "ret_6m_rel", "ret_3m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d"],
},

"KRISHNADEF": {
 "confidence": "low",
 "verdict": "WATCH — composite 80, third of 10 mid-tier peers, with return on capital 20.51%, third of 10, on seven quarters of listed history and no recent-period comparison anywhere in the row",
 "points": [
  "<b>Not held — KRISHNADEF is on your watchlist.</b> Krishna Defence and Allied Industries, ₹1,673cr and sixth of 10 by market cap in this bucket — two segments, defence and dairy: bulbars, armoured steel profiles, alloy steel castings, ballast bricks, composite doors, modular vehicle barriers and weld consumables on one side, milk cooling tanks on the other, for defence, naval, shipbuilding and dairy customers. " + MID + NOTTM + THIN + "Quality 77, valuation 92, momentum 55, composite 80. Valuation 92 is scored on 65 of its 100 declared points — there is no PEG for this company — so the pillar is renormalised around what remains and answers a narrower question than the scorecard asks. There is no own-history PE band either.",
  "<b>The three-year growth is real and the window is short.</b> <code>rev_cagr_3y</code> 51.83% is second of 10 and three-year profit growth is 105.23%, which across three annual observations off a small base is a direction rather than a rate. <code>op_margin_3y</code> 17.64% is fifth of 10 with <code>op_margin_trend_3y</code> +0.033 at second of 10 — the margin has been rising across those three years. <code>roce_3y</code> 20.51% is third of 10, while <code>np_consistency_3y</code> 1.654 is eighth of 10, so the profit line carries more scatter than most of this bucket. The latest quarter had sales down 15.18% and profit up 20.68%, a divergence that seven quarters of history cannot put in any context.",
  "<b>The cash is better than the bucket and the balance sheet is light.</b> <code>cfo_pat_3y</code> 0.694 is fourth of 9 and <code>fcf_yield</code> +0.98% is first of 9 — the only mid-tier name here with a positive free cash flow yield. FY2026 operating cash was 1.633 times operating profit against a prior-years mean of -0.459, a large improvement and one year of it. <code>inv_days</code> 24.32 is tenth of 10 and <code>wc_days</code> 44.11 is eighth of 10 — the shortest working-capital cycle in this bucket, which for a steel-fabrication business means working to order rather than to stock. <code>pb</code> 8.65x is fifth of 10.",
  "<b>Valuation 92 is the highest valuation percentile in this batch, and it is measured on 65 of its 100 declared points.</b> The earnings multiple is 38.66x, EV/EBITDA 28.02x and EV/sales 7.01x; four, six and seven companies in this bucket report those respectively, so none carries a rank worth stating, and there is no own-history PE band to compare the current multiple against. What the percentile actually says is that 38.66x is cheap relative to the three other mid-tier names that report a multiple at all. Promoters hold 59.90% and <code>shareholders</code> number 18,720, the narrowest register in this bucket. The chart is mid-pack: <code>ret_6m_rel</code> +10.31% is seventh of 10 and <code>ret_3m_rel</code> -6.19% is seventh of 10, the twelve-month relative return is +50.25%, and <code>ema_stack_bull</code> 1.000 is tied first of 10, a five-way tie spanning positions 1 to 5. The close held above its 200-day EMA on 81.35% of the last 252 sessions. " + TNS,
  "<i>Quality 77 at second of 10 and composite 80 at third of 10 rest on seven quarters of listed history. There is no recent-period comparison, no latest-period operating margin and no PEG — so two high percentiles are carrying a row with almost no recent evidence underneath them. What is checkable: <code>rev_cagr_3y</code> 51.83% at second of 10, <code>roce_3y</code> 20.51% at third of 10, <code>fcf_yield</code> +0.98% at first of 9, FY2026 operating cash at 1.633 times operating profit, and 38.66x earnings. Confidence is low and that is a statement about the evidence rather than about the company: a defence-and-dairy fabricator compounding revenue at 52% off a small base may well be a good business, and this platform cannot yet tell you whether the last two quarters were the trend or the peak.</i>",
 ],
 "trigger": "four more quarters reported with the growth rate holding above 30% -> there is finally a recent-period window to check the three-year aggregates against, and 38.66x on a 20.51% return on capital is cheap. sales_yoy_q staying negative for a second quarter while op_margin_trend_3y flattens -> a short history turning out to have captured a cycle peak, with no earlier record to fall back on.",
 "evidence": ["rev_cagr_3y", "np_cagr_3y", "op_margin_3y", "op_margin_trend_3y", "roce_3y", "np_consistency_3y", "sales_yoy_q", "np_yoy_q", "cfo_pat_3y", "fcf_yield", "inv_days", "wc_days", "pb", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "promoter_pct", "shareholders", "ret_6m_rel", "ret_3m_rel", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d"],
},
}


# --------------------------------------------------------------------- guards

# The cohort sentence each bucket is required to carry, and the adjective its
# stated count must be written against.
TIER_SENTENCE = {"veteran": VET, "mid": MID}

# Spelled band widths, for guard 9. The prose says "own nine-year band"; the
# pack says n=9. A band quoted with the wrong width is a claim about how much
# history exists, and on CENTUM the width is part of why the band is unusable.
_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}

# Guard 11: every "<ordinal> of N" denominator in the three mid rows. The floor
# is 9 because the mid bucket is 10 names and only thirteen metrics are read by
# 9 or more of them; price and recent-period metrics are read by 4 to 7, and a
# rank out of 4 is not a rank.
#
# It matches a RANK, not every "of N", for two reasons the textiles batch paid
# for: a bare `\w+\s+of\s+(\d+)` fires on THIN's own sentence ("a rank out of 4
# is not a rank") and on "a prior-years mean of 0.425", where `\d+` takes the
# leading zero of a decimal. So the left side must be an ordinal and the right
# side must not be a decimal's integer part.
_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
# The lookahead is `(?!\.\d)` and not `(?!\.)` for a reason the textiles
# mutation harness found: `(?!\.)` also rejects a rank at the END of a
# sentence, so "is first of 6." sailed straight through the guard whose entire
# job is to catch it.
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
MID_FLOOR_SYMS = {"CYIENTDLM", "KRISHNADEF", "UNIMECH"}
MID_DENOM_FLOOR = 9

# Guard 14: KRISHNADEF has seven quarters, so these five columns are all NULL
# in the pack. The ban is on the KEY, not on a rank — a sentence that names
# `opm_now` at all on this row is describing a number that does not exist.
NO_RECENT_SYMS = {"KRISHNADEF"}
NO_RECENT_KEYS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct",
                  "opm_now", "opm_prev")


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These guards
    cover the third category — structural claims neither pass can see, like
    whether the cohort sentence agrees with the cohort, whether a flagged row
    names the right defect, or whether a percentile computed on part of its
    declared weight is quoted without saying so.
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

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. The cohort sentence must match the bucket the scorer actually
        #    used, in BOTH the tier and the count. This cluster spans two
        #    buckets of 16 and 10, so a copied VET block on a mid row would
        #    quote 16 against a 10-name cohort.
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

        # 3. Every row in this cluster is `full`. If the scorer's bucketing
        #    changes this stops building rather than shipping a stale claim.
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
        #    exempted only inside the TNS sentence, which exists to say it is
        #    missing.
        for pt in pts:
            for d in DEAD:
                if d in pt:
                    errs.append(f"{sym}: prose names dead metric '{d}'")
            if "tech_net_score_scaled" in pt and TNS not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside TNS")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. delivery_data holds 12 distinct sessions, so a delivery percentage
        #    is one day's print. No row may quote one. The single exemption is
        #    NODELIV, which exists to say SIGMAADV has no delivery row at all —
        #    an absence, not a figure.
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

        # 8. Every evidence key must resolve in the live cluster_metrics or
        #    verdict-load.py rejects the whole row. Catching it here names the
        #    symbol and the key; the loader only names the key. The NULL test
        #    matters more in this batch than any previous one — SIGMAADV has
        #    six NULL columns and KRISHNADEF five.
        live = (p.get("metrics") or {}).get("cluster_metrics") or {}
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")

        # 9. Any own-history PE band quoted in prose must match the pack in
        #    every number it states — width, low, high, average. A band is four
        #    numbers transcribed by hand, and the width is itself a claim about
        #    how much usable history exists. Three forms, because the headline
        #    is plain text and has to say it in fewer words.
        band = p.get("pe_band") or {}

        def _width(yr: str, where: str) -> None:
            if _YEAR_WORD.get(yr.lower()) != band.get("n"):
                errs.append(f"{sym}: says {yr}-year band in {where}, pack "
                            f"n={band.get('n')}")

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
            for yr, hi in re.findall(
                    r"own (\w+)-year band topping out at ([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a band high; pack has none")
                    continue
                _width(yr, "the topping-out form")
                if abs(float(hi) - band["hi"]) > 0.005:
                    errs.append(f"{sym}: band high {hi} vs pack {band['hi']}")
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
        #     defect the pack actually flagged — not a generic caveat. Five
        #     rows, five different defects (CHOICE 4), and CENTUM's and
        #     DATAPATTNS's are opposite ends of the same metric, so a shared
        #     phrase would pass a row that named the wrong problem. The second
        #     half is what keeps this from going stale: if a rerun clears the
        #     flag, the build fails rather than shipping a caveat about a
        #     problem that no longer exists.
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

        # 11. The mid bucket is 10 names and its price and recent-period
        #     metrics are read by 4 to 7 of them (CHOICE 2). Every denominator
        #     these three rows state must be a real one.
        if sym in MID_FLOOR_SYMS:
            if THIN not in p0:
                errs.append(f"{sym}: point one does not carry THIN")
            for pt in allprose:
                for d in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                    if int(d) < MID_DENOM_FLOOR:
                        errs.append(f"{sym}: states a denominator of {d}, "
                                    f"under the {MID_DENOM_FLOOR}-reading "
                                    f"floor this row is held to")

        # 12. CENTUM's latest quarter had a one-time gain stripped upstream of
        #     every figure in the pack (CHOICE 5). A reader who checks one
        #     number against a screener finds it disagrees, and discards the
        #     row rather than the number, unless point one says so first.
        if sym == "CENTUM":
            if ONETIME not in p0:
                errs.append(f"{sym}: point one does not carry ONETIME")
            if not any("95.4" in pt for pt in pts):
                errs.append(f"{sym}: no point states the stripped amount")

        # 13. A pillar percentile computed on part of its declared weight
        #     (CHOICE 6) may be quoted only alongside what is missing from
        #     underneath it. In the POINTS the renormalisation phrase must be
        #     in the SAME point — a caveat two paragraphs away is not attached
        #     to the claim. In the headline and the trigger the figure is
        #     banned outright, because neither has room for the caveat and the
        #     headline is the part most readers see alone.
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

        # 14. KRISHNADEF has seven quarters, so the five recent-period columns
        #     are NULL (CHOICE 7). Naming the key at all is describing a number
        #     that does not exist, so the ban is on the key rather than on a
        #     rank beside it.
        if sym in NO_RECENT_SYMS:
            if NOTTM not in p0:
                errs.append(f"{sym}: point one does not carry NOTTM")
            for pt in allprose:
                for k in NO_RECENT_KEYS:
                    if k in pt:
                        errs.append(f"{sym}: names '{k}', which is NULL in "
                                    f"the pack — seven quarters of history")

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
            # Read by scripts/verdict-ranks-check.py; verdict-load.py ignores
            # top-level keys it does not require, so the waivers travel with
            # the batch rather than in a second file that could drift from it.
            "rank_waivers": v.get("rank_waivers", []),
            **({"prior": v["prior"]} if "prior" in v else {}),
        })

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"guards passed -> {OUT} ({len(out)} verdicts)")
    for o in out:
        print(f"  {o['symbol']:<12}{o['verdict'][:84]}")


if __name__ == "__main__":
    main()
