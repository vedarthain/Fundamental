"""fmcg_food_agri — the 12 tracked names, written against the real peer set.

WHY THIS FILE IS SHAPED THIS WAY

Second batch written with `peer_ranks` in the pack and the generic pass-2
checker, so the rules the chemicals batch established hold here unchanged:
every denominator is a per-metric READING COUNT rather than the cohort size,
the cohort sentence names the bucket the scorer actually used, and the guards
below cover the structural claims neither pass can see.

What is different, and it is the whole reason this file needed a decision
before a word of prose was written:

CHOICE 1 — THIS CLUSTER SPANS THREE BUCKETS, NOT TWO.

`scoring/scorer.py` peers on `(cluster_id, maturity_tier)` when the bucket
clears `MIN_PEERS = 10`. Here all three clear it — veteran 102, mid 32,
mature 28 — so all 12 rows are `score_status = 'full'` and none needs the
mixed-tier caveat. Three cohort sentences, and guard 2 fails any row whose
sentence does not match its own bucket.

CHOICE 2 — NESTLEIND IS IN THE MID BUCKET AND THAT IS A DATA ARTEFACT.

Nestlé India is a ₹2.38 lakh crore company sitting in a 32-name mid-tier
bucket, ranked #1 of 32 on market cap by a factor nothing in that bucket
approaches. The cause is not size, it is history: the company moved its
financial year end from December to March, so `annual` holds four rows —
2023-12-31, 2024-03-31, 2025-03-31, 2026-03-31 — and the first of those is a
stub with sales present and the balance sheet wholly NULL. The maturity tier
is derived from usable annual history, so a 1959-incorporated company reads as
mid-tier.

The consequence for the prose is specific and the guard enforces it: this row
quotes NO pillar percentile. Not quality 73, not valuation 28, not composite
57. Those are percentiles against a bucket Nestlé does not belong to, and the
per-metric reading counts underneath them are thin enough to make it worse —
`pe_ttm` has 17 readings, `opm_now` 8, `ttm_np_pct` 7, `div_yield` 5. A rank
out of 7 is not a rank. The verdict says which bucket it was scored in, says
why, and then argues from the company's own figures instead.

This is the same failure class as OCCLLTD's quality pillar in the chemicals
batch — a corporate event read as a business fact — except here it inflates
rather than deflates, and against a cohort rather than a metric.

CHOICE 3 — MANORAMA IS MID-TIER FOR A REAL REASON, AND IS THINNER STILL.

Two annual rows, both post-listing. Its quality pillar scored on 40% of its
declared weight and its valuation pillar on 70%. Unlike NESTLEIND the tier is
honest — the company genuinely has no history — but the renormalised pillars
answer a narrower question than the scorecard asks, so the prose names which
components are absent wherever it leans on one.

CHOICE 4 — THE DEAD METRICS, AGAIN, PLUS DELIVERY.

The sanity block reports `book_value_cagr_3y`, `p_premium`, `roe_latest` and
`tech_net_score_scaled` NULL for >=95% of every tier. `delivery_data` holds 12
distinct sessions, so a delivery percentage is one day's print. No row quotes
one; guard 6 fails any that does.

CHOICE 5 — TWO ROWS CARRY AN EARNINGS-QUALITY BLOCKER AND MUST SAY SO.

GOKULAGRO's net profit outran operating profit by 16% over the TTM (NP +59%
vs OP +37%) and DODLA's held up better by 17% (NP -5% vs OP -19%). In both the
difference sits below EBIT. A PE quoted on that base is not a PE on
operations, and guard 10 requires the caveat on any row the pack flagged.
"""

import json
import re

PACK = "/tmp/fmcg12.json"
OUT = "build/verdicts/fmcg-food-agri-12-verdicts.json"
SOURCE_REPORT = "fmcg_food_agri — 12 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

# Measured against app.portfolio_holding on 2026-10-22, not recalled. The pack
# carries no membership flag, so point one's held/not-held line is a claim
# like any other and this is what checks it.
HELD = {"GOKULAGRO", "LTFOODS", "NESTLEIND", "VADILALIND"}

EMIT = {"MARICO", "NESTLEIND", "BALRAMCHIN", "CCL", "LTFOODS", "HERITGFOOD",
        "GOKULAGRO", "PARAGMILK", "VADILALIND", "BECTORFOOD", "DODLA",
        "MANORAMA"}

VET = ("Peered against 102 veteran-tier peers inside "
       "<code>fmcg_food_agri</code> — the scorer's bucket is (cluster, "
       "maturity tier) and this one clears the 10-peer floor, so every rank "
       "below is against those veterans rather than the whole cluster, and "
       "the row is badged <code>full</code> with no mixed-tier caveat. ")

MID = ("Peered against 32 mid-tier peers inside "
       "<code>fmcg_food_agri</code> — the scorer's bucket is (cluster, "
       "maturity tier) and this one clears the 10-peer floor, so every rank "
       "below is against those mid-tier names rather than the whole cluster, "
       "and the row is badged <code>full</code> with no mixed-tier caveat. ")

MAT = ("Peered against 28 mature-tier peers inside "
       "<code>fmcg_food_agri</code> — the scorer's bucket is (cluster, "
       "maturity tier) and this one clears the 10-peer floor, so every rank "
       "below is against those mature names rather than the whole cluster, "
       "and the row is badged <code>full</code> with no mixed-tier caveat. ")

TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company "
       "on the platform; the momentum pillar renormalises around the "
       "components that do exist, so the percentile is a narrower question "
       "than the scorecard asks rather than a lost weight.")

# The sentence NESTLEIND's row is required to carry, and the reason it may
# quote no pillar percentile at all.
FY_BREAK = ("The tier is an artefact of a calendar change, not of size: "
            "Nestlé moved its year end from December to March, so the "
            "platform holds four annual rows and the oldest is a stub with "
            "sales present and the balance sheet wholly NULL. Maturity tier "
            "is derived from usable annual history, so a company incorporated "
            "in 1959 is bucketed mid-tier. No pillar percentile is quoted on "
            "this row for that reason, and the reading counts underneath them "
            "are thin enough to make it worse — 8 peers carry an "
            "operating margin here and 7 carry a TTM profit change. ")

# Metrics NULL for >=95% of every tier. Naming one is a claim about a number
# the platform does not hold.
DEAD = ("book_value_cagr_3y", "p_premium", "roe_latest")

# Rows the pack flagged for an earnings-quality gap. Guard 10 requires each to
# carry the caveat somewhere in its points.
EQ_FLAGGED = {"GOKULAGRO", "DODLA"}


SPEC = {

# ---------------------------------------------------------------- veterans

"MARICO": {
 "confidence": "medium",
 "verdict": "WATCH — quality 78, fourth of 102 veterans, against valuation 14, 99th of 102, and 24.12x book, fourth of 95",
 "points": [
  "<b>Not held — MARICO is on your watchlist.</b> Marico, ₹1,01,546cr, the second-largest company in this cluster at <code>market_cap</code> second of 102 — Parachute, Saffola, Livon, Set Wet, with a hair-oils and edible-oils core and a foods arm growing on top of it; promoters hold 58.92%. " + VET + "Quality 78, valuation 14, momentum 61, composite 71.",
  "<b>The quality pillar is close to the best in the cluster and it is not an artefact.</b> <code>roce_3y</code> 47.62% is third of 101 and <code>roce_5y</code> 45.31% is third of 101 — the same answer over two windows, which is what separates a durable return from one good year. <code>op_margin_3y</code> 19.28% is fourth of 101. <code>np_consistency_10y</code> 1.802 is third of 102, and <code>roe_avg_above_threshold_10y</code> 1.000 is tied first of 102: every one of the last ten years cleared the ROE hurdle, and only one other veteran here can say that. <code>wc_days</code> -60.82 means the business is funded by its own trade creditors.",
  "<b>You are paying for all of it and then some.</b> <code>pb</code> 24.12x is fourth of 95, <code>ev_ebitda_ttm</code> 37.72x is fourth of 77 and <code>peg</code> 5.654 is fifth of 43 — three independent valuation measures all inside the most expensive five names of the cohort. <code>pe_ttm</code> 53.78x is 12th of 74, and the own ten-year band runs 34.75-54.30x with an average of 46.95x, so the multiple sits a whisker under its own decade high rather than at a normal level. That is what valuation 14 is reporting, and it is the single reason this is a WATCH and not an ACCUMULATE.",
  "<b>Momentum is strong on trend and flat on stack, and the register is institutional.</b> The close held above its 200-day EMA on 92.86% of the last 252 sessions, first of 86 — no veteran here spent more of the year above trend. Against that <code>ema_stack_bull</code> 0.0 puts it in the 72-way tie spanning positions 20 to 91, so the short-term stack is not aligned; <code>ret_12m_rel</code> +14.22% is 23rd of 87. Foreign institutions hold 23.40%, the highest of 83, domestic institutions 12.87%, ninth of 81, and <code>public_pct</code> 4.49% is the lowest of all 101 — there is almost no retail float left to absorb a de-rating. " + TNS,
  "<i>A business the cluster cannot match on returns, priced as though that will continue for a decade. The operating margin has already stepped down — <code>opm_now</code> 17.45% against <code>opm_prev</code> 19.00% — while TTM sales grew 25.1% and profit only 13.1%, so the growth being bought is currently margin-dilutive. Quality 78 is real; valuation 14 is the whole argument.</i>",
 ],
 "trigger": "opm_now recovering through 19% with ttm_np_pct catching up to ttm_sales_pct -> the foods mix stops diluting and a 53x multiple has something to grow into. pe_ttm holding above the 54.30x band high while opm_now stays under 17% -> a decade-high price on a decelerating margin, which is the configuration that de-rates without any news.",
 "evidence": ["roce_3y", "roce_5y", "op_margin_3y", "np_consistency_10y", "roe_avg_above_threshold_10y", "wc_days", "pb", "ev_ebitda_ttm", "peg", "pe_ttm", "pct_above_200ema_252d", "ema_stack_bull", "ret_12m_rel", "fii_pct", "dii_pct", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_np_pct"],
},

"BALRAMCHIN": {
 "confidence": "medium",
 "verdict": "WATCH — momentum 64, tied 17th of 102 veterans, on a 39.28x multiple against an own ten-year band that tops out at 28.10x",
 "points": [
  "<b>Not held — BALRAMCHIN is on your watchlist.</b> Balrampur Chini Mills, ₹14,575cr, integrated sugar with distillery and co-generation attached — a commodity processor whose earnings are set by cane cost, ethanol policy and the sugar cycle rather than by anything it controls; promoters hold 42.86%. " + VET + "Quality 53, valuation 22, momentum 64, composite 38. The valuation pillar scored on 80% of its declared weight, renormalised around a missing <code>peg</code>, so that percentile answers a narrower question than the scorecard asks.",
  "<b>The ten-year record is the opposite of what the consistency metric suggests.</b> <code>np_consistency_10y</code> 1.798 is fourth of 102, which reads as a strong row until it is set beside the growth tests: <code>np_growth_above_inflation_10y</code> 0.222 is tied 99th of 102, a four-way tie spanning positions 99 to 102, and <code>np_growth_above_inflation_7y</code> 0.167 is tied 93rd of 102, a ten-way tie spanning positions 93 to 102. Profit has been steady and has not beaten inflation — consistency around a flat line. <code>np_cagr_5y</code> -5.00% is 53rd of 77.",
  "<b>The multiple is the problem, not the business.</b> <code>pe_ttm</code> 39.28x is 16th of 74, and the own ten-year band runs 4.41-28.10x with an average of 14.75x. The stock is trading at roughly 2.7 times its own decade-average multiple and well clear of a ten-year high, on a TTM where profit fell: <code>ttm_np_pct</code> -11.31% against <code>ttm_sales_pct</code> +14.99%. <code>fcf_yield</code> -1.20% is 81st of 101 — it is consuming cash. For a cyclical, a decade-high multiple on falling profit is the late-cycle configuration.",
  "<b>Momentum is what is holding the price up, and the register has moved.</b> <code>ema_stack_bull</code> 1.000 is tied first of 91, a 19-way tie spanning positions 1 to 19 — and <code>ret_6m_rel</code> +37.35% is seventh of 88 with <code>ret_12m_rel</code> +57.00% fifth of 87. Domestic institutions hold 29.09%, second of 81, against <code>promoter_pct</code> 42.86%, 79th of 101: this is an institutionally-held name with a thin promoter block. The close held above its 200-day EMA on 62.30% of sessions, 16th of 86. " + TNS,
  "<i>A sugar cycle being priced as a growth story. The momentum and the institutional ownership are real and recent; the earnings underneath them have not beaten inflation over seven or ten years, and the multiple is at a decade high while free cash flow is negative. Nothing here needs to break for this to de-rate — the multiple only has to return to its own average.</i>",
 ],
 "trigger": "ttm_np_pct turning positive with fcf_yield back above zero and pe_ttm inside the 28.10x band high -> a cash-generating cyclical at a defensible multiple rather than a momentum trade. ema_stack_bull breaking down while pe_ttm stays above 30x -> the only support under a decade-high multiple is the trend, and the trend is the first thing to go.",
 "evidence": ["np_consistency_10y", "np_growth_above_inflation_10y", "np_growth_above_inflation_7y", "np_cagr_5y", "pe_ttm", "ttm_np_pct", "ttm_sales_pct", "fcf_yield", "ema_stack_bull", "ret_6m_rel", "ret_12m_rel", "dii_pct", "promoter_pct", "pct_above_200ema_252d", "roce_3y"],
},

"CCL": {
 "confidence": "medium",
 "verdict": "WATCH — seven-year profit growth above inflation, tied first of 102 veterans, and the close above its 200-day EMA on 91.27% of sessions, third of 86, against a margin trend falling for seven years",
 "points": [
  "<b>Not held — CCL is on your watchlist.</b> CCL Products, ₹12,544cr, instant-coffee manufacture for private-label buyers across Europe and the US with capacity in India and Vietnam — a contract processor whose customers are brands, not consumers; promoters hold 46.14%. " + VET + "Quality 70, valuation 34, momentum 53, composite 76.",
  "<b>The growth record is the best thing on this row and it is corroborated three ways.</b> <code>np_growth_above_inflation_7y</code> 0.833 is tied first of 102 in a 12-way tie spanning positions 1 to 12, <code>np_growth_above_inflation_10y</code> 0.778 is tied second of 102, a seven-way tie spanning positions 2 to 8, and <code>roe_avg_above_threshold_10y</code> 0.900 is tied third of 102, a two-way tie spanning positions 3 to 4. <code>rev_cagr_5y</code> +32.14% is second of 101. This is a company that has compounded through a decade and cleared the ROE hurdle in nine years of ten.",
  "<b>The margin trend is the counter-argument and it is seven years long.</b> <code>op_margin_trend_7y</code> -1.57% is 86th of 101 — the operating margin has been grinding down for seven years even while revenue compounded at 32%. <code>opm_now</code> 16.70% against <code>opm_prev</code> 17.05% continues it. That is the structural risk in private-label: volume is winnable and price is not, so revenue growth arrives at a lower margin each cycle. <code>op_margin_3y</code> 17.04% is still 12th of 101, so the level is good and the direction is not.",
  "<b>Priced near the top of its own decade, with the trend intact.</b> <code>pe_ttm</code> 27.16x is 26th of 74 against an own ten-year band of 14.22-35.82x averaging 25.85x — slightly above its own average rather than stretched. <code>pb</code> 5.350x is 12th of 95. The close held above its 200-day EMA on 91.27% of the last 252 sessions, third of 86, though <code>ret_3m_rel</code> -10.64% is 81st of 91 — the year was strong and the quarter was not. Foreign institutions hold 12.07%, fifth of 83, and domestic institutions 21.10%, fifth of 81. " + TNS,
  "<i>A genuine decade-long compounder with a margin that has leaked every year of it. TTM profit +36.5% against sales +24.1% says the current year is going the right way, and <code>cfo_pat_3y</code> 1.122 says the profit is cash. The question this row turns on is whether the seven-year margin slide is the price of growth or the end of it, and nothing in the pack answers that.</i>",
 ],
 "trigger": "op_margin_trend_7y turning positive with opm_now holding above 17% -> the private-label margin has found a floor and a 27x multiple is cheap for this growth record. opm_now falling under 14% while rev_cagr stays high -> revenue bought at a disappearing margin, and the compounding record stops meaning anything.",
 "evidence": ["np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "roe_avg_above_threshold_10y", "rev_cagr_5y", "op_margin_trend_7y", "opm_now", "opm_prev", "op_margin_3y", "pe_ttm", "pb", "pct_above_200ema_252d", "ret_3m_rel", "fii_pct", "dii_pct", "cfo_pat_3y", "ttm_np_pct", "ttm_sales_pct"],
},

"LTFOODS": {
 "confidence": "medium",
 "verdict": "HOLD — composite 88, 13th of 102 veterans, with a three-year return on capital of 18.22%, 16th of 101, bought at 21.68x against an own decade average of 12.52x",
 "points": [
  "<b>Held — LTFOODS is in your portfolio.</b> LT Foods, ₹13,838cr, Daawat and Royal basmati rice with branded distribution in India, the US and the Middle East — a branded staple rather than a commodity miller, which is what the margin and the multiple both rest on; promoters hold 51.00%. " + VET + "Quality 69, valuation 51, momentum 58, composite 88.",
  "<b>The returns are good and the balance sheet carries them.</b> <code>roce_3y</code> 18.22% is 16th of 101 and <code>roce_5y</code> 17.14% is 19th of 101 — consistent across windows. <code>rev_cagr_5y</code> +19.17% is 14th of 101 and <code>np_cagr_5y</code> +20.95% is 19th of 77, so profit has grown slightly faster than revenue over five years. <code>debt_equity</code> 0.356 is 57th of 89 — leverage is present but unremarkable for a working-capital-heavy rice business carrying <code>wc_days</code> 98.82.",
  "<b>The consistency record is middling and that is the honest reading.</b> <code>np_consistency_10y</code> 1.630 is 36th of 102, <code>np_growth_above_inflation_5y</code> 0.500 sits in a 41-way tie spanning positions 34 to 74, and <code>roe_avg_above_threshold_5y</code> 0.400 sits in a 16-way tie spanning 17 to 32 — two of the last five years cleared the hurdle. The composite of 88 is doing a lot of work on momentum and growth; the quality pillar underneath it is 69, which is good rather than exceptional.",
  "<b>The multiple has re-rated well past its own history.</b> <code>pe_ttm</code> 21.68x is 34th of 74 — middle of the cohort — but the own ten-year band runs 3.46-21.86x with an average of 12.52x, so the stock is at the very top of a decade-long range and roughly 1.7 times its own average. <code>ttm_sales_pct</code> +28.19% against <code>ttm_np_pct</code> +3.17% is the uncomfortable pair: revenue is growing strongly and profit is not following. <code>pct_above_200ema_252d</code> 45.24% is tied 35th of 86, a three-way tie spanning positions 35 to 37. " + TNS,
  "<i>A branded staple that has earned its re-rating and is now priced at the ceiling of it, with TTM profit growth of 3.2% against sales growth of 28.2%. Holding is defensible on the returns and the brand; adding here is paying a decade-high multiple for a year in which the margin is absorbing the growth. <code>cfo_pat_3y</code> 1.165 says the profit is real cash, which is why this is a HOLD rather than a REDUCE.</i>",
 ],
 "trigger": "ttm_np_pct converging on ttm_sales_pct with opm_now above 11% -> the growth is reaching the bottom line and a 21x multiple is sustainable. pe_ttm holding above the 21.86x band high while ttm_np_pct stays under 5% -> a decade-high multiple on flat profit, and the whole re-rating is unsupported.",
 "evidence": ["roce_3y", "roce_5y", "rev_cagr_5y", "np_cagr_5y", "debt_equity", "wc_days", "np_consistency_10y", "np_growth_above_inflation_5y", "roe_avg_above_threshold_5y", "pe_ttm", "ttm_sales_pct", "ttm_np_pct", "pct_above_200ema_252d", "cfo_pat_3y", "opm_now"],
},

"HERITGFOOD": {
 "confidence": "medium",
 "verdict": "WATCH — a three-year return on capital of 18.48%, 15th of 101 veterans, with cash conversion of 1.905, 20th of 84, against a TTM operating profit down 16.4%",
 "points": [
  "<b>Not held — HERITGFOOD is on your watchlist.</b> Heritage Foods, ₹3,452cr, dairy procurement and processing across Andhra Pradesh, Telangana and the southern states — milk, curd, value-added dairy — a business whose input cost is set by procurement season and whose output price moves slowly; promoters hold 41.30%. " + VET + "Quality 68, valuation 38, momentum 49, composite 69.",
  "<b>The capital returns and the cash are both strong, and both are backward-looking.</b> <code>roce_3y</code> 18.48% is 15th of 101 and <code>roce_5y</code> 17.06% is 21st of 101. <code>cfo_pat_3y</code> 1.905 is 20th of 84 — the three-year record converts profit into operating cash comfortably above one. <code>op_margin_trend_7y</code> +1.88% is fifth of 101, one of the few genuinely improving margin trends in this cluster. That is the bull case and it is entirely about the three to seven years behind us.",
  "<b>The current year has broken the trend hard.</b> <code>ttm_op_pct</code> -16.44% is 66th of 89 and <code>ttm_np_pct</code> -33.80% is 55th of 80, with <code>opm_now</code> 5.09% against <code>opm_prev</code> 6.93% — the margin has lost nearly two points. <code>np_yoy_q</code> -39.49% is 76th of 101, so the latest quarter is worse than the TTM rather than the start of a recovery. For a dairy processor that is a procurement-cost squeeze, and it is the single fact this row turns on.",
  "<b>The multiple has not come down with the earnings, and the float is retail.</b> <code>pe_ttm</code> 30.92x is 22nd of 74 against an own nine-year band of 2.29-29.42x averaging 16.25x — above the top of its own history on earnings that are falling, which is the arithmetic of a collapsing denominator rather than a re-rating. <code>public_pct</code> 50.34% is 20th of 101 and foreign institutions hold just 1.98%, 28th of 83: this is a retail-held name with little institutional support if the squeeze persists. The close held above its 200-day EMA on 26.59% of sessions, tied 47th of 86, a two-way tie spanning positions 47 to 48. " + TNS,
  "<i>A good dairy business in a bad procurement year, trading above the top of its own decade band because earnings fell faster than the price. The three-year returns are real; the TTM says the current operating profit is a third smaller than it was. Watch the margin, not the multiple — <code>opm_now</code> 5.09% is the number that has to turn.</i>",
 ],
 "trigger": "opm_now recovering through 7% with np_yoy_q back positive -> the procurement squeeze was a season and an 18% ROCE business is on sale. opm_now under 4.5% for another two quarters while pe_ttm stays above 30x -> the multiple is being held up by a shrinking earnings base and there is no institutional holder to defend it.",
 "evidence": ["roce_3y", "roce_5y", "cfo_pat_3y", "op_margin_trend_7y", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "np_yoy_q", "pe_ttm", "fii_pct", "pct_above_200ema_252d", "ret_12m_rel", "op_margin_3y"],
},

"GOKULAGRO": {
 "confidence": "medium",
 "verdict": "HOLD — composite 98, third of 102 veterans, on a three-year return on capital of 28.71%, fifth of 101, but TTM profit outran operating profit by 16 points and a PE on that base is not a PE on operations",
 "points": [
  "<b>Held — GOKULAGRO is in your portfolio.</b> Gokul Agro Resources, ₹6,105cr, edible-oil refining and agri-commodity processing out of Gujarat — a volume business on a thin spread, where the whole argument is throughput and working-capital turns rather than margin; <code>promoter_pct</code> is 74.24%, tenth of 101. " + VET + "Quality 73, valuation 68, momentum 61, composite 98.",
  "<b>The earnings-quality flag has to be read before anything else on this row.</b> Over the TTM, net profit grew 59.07% while operating profit grew 36.73% — net profit outran operating profit by 16 points, and the difference sits below EBIT: other income, a one-off, tax or interest, not trading. A PE quoted on this base is not a PE on operations. <code>cfo_pat_3y</code> 1.800 is 22nd of 84 so the three-year cash record is sound, but <code>cfo_op_latest</code> 0.481 against a prior-year mean of 0.608 says the most recent year converted less, not more. The composite of 98 is computed off the flagged base.",
  "<b>Strip that out and the capital returns are still genuinely good.</b> <code>roce_3y</code> 28.71% is fifth of 101 and <code>roce_5y</code> 27.14% is eighth of 101 — consistent across windows, which is hard on a 3% operating margin and is the signature of asset turns rather than pricing. <code>rev_cagr_5y</code> +23.40% is sixth of 101, <code>np_growth_above_inflation_7y</code> 0.833 is tied first of 102 in a 12-way tie spanning positions 1 to 12, and <code>roe_avg_above_threshold_5y</code> 1.000 is tied first of 102 in a seven-way tie spanning 1 to 7.",
  "<b>It is cheap on sales and expensive against its own history.</b> <code>ev_sales_ttm</code> 0.267x is 98th of 100 — almost the cheapest in the cluster on revenue, which is what a refiner should look like. <code>pe_ttm</code> 14.52x is 50th of 74, but the own ten-year band runs 2.89-8.41x averaging 5.94x, so the stock is at roughly 2.4 times its own decade-average multiple. <code>op_margin_3y</code> 2.55% is 80th of 101 and <code>opm_now</code> 3.06% is 77th of 100: there is no margin cushion at all, so a spread that moves against it moves straight through to profit. " + TNS,
  "<i>A high-turn refiner that has compounded genuinely, re-rated to 2.4 times its own decade multiple, and whose most recent profit growth came from below the operating line. Hold on the returns and the promoter stake; do not add on the composite, because the composite is reading a flagged base. The honest number to watch is <code>opm_now</code> 3.06% — on that margin, everything is volume.</i>",
 ],
 "trigger": "ttm_op_pct catching up to ttm_np_pct with cfo_op_latest back above 0.6 -> the profit is operating profit again and a 14.5x multiple is defensible. opm_now under 2.5% with the gap below EBIT persisting -> a thin-spread refiner at a decade-high multiple on earnings the operating line does not produce.",
 "evidence": ["roce_3y", "roce_5y", "rev_cagr_5y", "np_growth_above_inflation_7y", "roe_avg_above_threshold_5y", "cfo_pat_3y", "ev_sales_ttm", "pe_ttm", "op_margin_3y", "opm_now", "opm_prev", "ttm_op_pct", "ttm_np_pct", "promoter_pct", "pct_above_200ema_252d"],
},

"PARAGMILK": {
 "confidence": "low",
 "verdict": "WATCH — zero of the last ten years cleared the ROE hurdle and ten-year profit consistency of 0.993 is 76th of 102 veterans, on a stock that has outrun the index over three months",
 "points": [
  "<b>Not held — PARAGMILK is on your watchlist.</b> Parag Milk Foods, ₹3,334cr, dairy under Gowardhan and Go — cheese, ghee, paneer, whey — a value-added dairy processor rather than a liquid-milk one; <code>promoter_pct</code> 40.49% is 87th of 101, among the thinnest promoter blocks in the cluster. " + VET + "Quality 56, valuation 38, momentum 55, composite 50. The valuation pillar scored on 80% of its declared weight, renormalised around a missing <code>peg</code>.",
  "<b>The ten-year return record is the whole story and it is bad.</b> <code>roe_avg_above_threshold_10y</code> 0.000 sits in a 30-way tie spanning positions 73 to 102 — zero of the last ten years cleared the ROE hurdle, and the same is true at five and seven years. <code>roce_5y</code> 0.15% is 92nd of 101: over five years this business has earned essentially nothing on its capital. <code>np_consistency_10y</code> 0.993 is 76th of 102. Whatever the recent quarters show, a decade of capital returns at zero is the base rate here.",
  "<b>The recent numbers are better and thin.</b> <code>op_margin_trend_7y</code> +0.81% is 13th of 101 — the margin trend is genuinely improving — and <code>np_growth_above_inflation_5y</code> 1.000 is tied first of 102 in a six-way tie spanning positions 1 to 6. But <code>roce_3y</code> 12.26% is only 34th of 101, <code>ttm_op_pct</code> +1.40% is 45th of 89 and <code>np_yoy_q</code> -20.05% is 71st of 101. A five-year profit record measured off a near-zero base will clear inflation easily; that is arithmetic, not recovery.",
  "<b>The multiple cannot be read against its own history, and the trend is the only support.</b> <code>pe_ttm</code> 30.70x is 23rd of 74, but the own nine-year band runs 5.72-401.90x averaging 63.07x — a band whose high is 402 times earnings is a record of years when profit was near zero, not a valuation range, and nothing useful can be concluded from where 30.70x sits inside it. <code>ema_stack_bull</code> 1.000 is tied first of 91, a 19-way tie spanning positions 1 to 19, and <code>ret_3m_rel</code> +31.37% is ninth of 91, so the recent move is real. <code>pb</code> 2.649x is 32nd of 95. " + TNS,
  "<i>Confidence is low on purpose. A decade of zero ROE, an improving margin trend, a strong three-month move and an own-history PE band too wide to mean anything — those four facts do not resolve into a view. The honest position is that this needs another two or three quarters of <code>roce_3y</code> above 12% before the recovery is distinguishable from the cycle.</i>",
 ],
 "trigger": "roce_3y holding above 15% with roe_avg_above_threshold_5y finally clearing -> the value-added mix is earning its capital and a decade of zero returns is behind it. np_yoy_q negative for another two quarters with opm_now under 6% -> the margin trend was a cost cycle, not a mix shift, and the base rate reasserts.",
 "evidence": ["roe_avg_above_threshold_10y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roce_5y", "roce_3y", "np_consistency_10y", "op_margin_trend_7y", "np_growth_above_inflation_5y", "ttm_op_pct", "np_yoy_q", "pe_ttm", "ema_stack_bull", "ret_3m_rel", "pb", "promoter_pct"],
},

"VADILALIND": {
 "confidence": "medium",
 "verdict": "HOLD — quality 75, fifth of 102 veterans, with momentum 76, eighth of 102, on a three-year return on capital of 23.24%, 11th of 101",
 "points": [
  "<b>Held — VADILALIND is in your portfolio.</b> Vadilal Industries, ₹5,096cr, ice cream and frozen desserts with a processed-foods export arm — a seasonal branded business with real pricing power in its core geography; promoters hold 64.72%. " + VET + "Quality 75, valuation 43, momentum 76, composite 95.",
  "<b>The margin is the strongest claim on this row and it is still rising.</b> <code>op_margin_3y</code> 18.55% is sixth of 101, <code>opm_now</code> 18.73% is fifth of 100 and <code>opm_prev</code> 17.63% is eighth of 101 — a top-decile margin that went up rather than down. <code>op_margin_trend_7y</code> +1.40% is sixth of 101, so this is a seven-year direction and not a good quarter. <code>roce_3y</code> 23.24% is 11th of 101 and <code>roce_5y</code> 21.65% is 11th of 101, the same answer twice.",
  "<b>The growth is accelerating across every window the pack carries.</b> <code>ttm_sales_pct</code> +30.83% is 13th of 100, <code>ttm_op_pct</code> +38.96% is 21st of 89 and <code>ttm_np_pct</code> +56.57% is 12th of 80 — profit growing faster than operating profit growing faster than sales, which is operating leverage working in the right direction. <code>np_cagr_5y</code> +36.48% is tenth of 77 and <code>sales_yoy_q</code> +34.24% is 13th of 100, so the latest quarter continues it rather than ending it. <code>roe_avg_above_threshold_5y</code> 1.000 is tied first of 102 in a seven-way tie spanning positions 1 to 7.",
  "<b>Priced moderately against the cohort and unreadably against itself.</b> <code>pe_ttm</code> 23.27x is 32nd of 74 and <code>pb</code> 5.993x is tenth of 95 — mid-cohort on earnings, expensive on book, which is what a high-ROCE branded business should look like. The own ten-year band runs 7.80-139.04x averaging 33.68x; the 139x high is a year when profit collapsed, so the average is not a reference point and the band tells you little. <code>ret_6m_rel</code> +57.75% is fourth of 88 and <code>ret_12m_rel</code> +39.20% is 11th of 87. <code>shareholders</code> 19,041 is 66th of 101 — a small register for a ₹5,096cr company. " + TNS,
  "<i>The cleanest row in this batch: a high margin that is still rising, with accelerating growth and capital returns that agree across two windows. The reservations are the register size and <code>cfo_pat_3y</code> 0.993, which is 51st of 84 — the cash conversion is adequate rather than strong, so the operating leverage is showing up in profit faster than in cash. Hold; the case for adding depends on that gap closing.</i>",
 ],
 "trigger": "cfo_pat_3y moving above 1.2 while opm_now holds above 18% -> the operating leverage is converting to cash and the quality pillar is fully earned. opm_now falling back under 16% with sales_yoy_q decelerating under 15% -> the margin step was a cost window, and a 23x multiple on a seasonal business has no support.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "op_margin_trend_7y", "roce_3y", "roce_5y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "np_cagr_5y", "sales_yoy_q", "roe_avg_above_threshold_5y", "pe_ttm", "pb", "ret_6m_rel", "ret_12m_rel", "shareholders", "cfo_pat_3y"],
},

# ------------------------------------------------------------- mature tier

"BECTORFOOD": {
 "confidence": "medium",
 "verdict": "WATCH — quality 71, second of 28 mature peers, with domestic institutions at 25.96%, the highest of 16, bought at 41.76x earnings against an own six-year band topping out at 39.02x",
 "points": [
  "<b>Not held — BECTORFOOD is on your watchlist.</b> Mrs Bectors Food Specialities, ₹6,195cr, biscuits under Mrs Bector's Cremica and bakery under English Oven, with a quick-service-restaurant bun business supplying the large chains; promoters hold 49.04%. " + MAT + "Quality 71, valuation 33, momentum 49, composite 65.",
  "<b>Quality is second in the bucket and the components agree.</b> <code>op_margin_3y</code> 13.66% is sixth of 28, <code>roce_3y</code> 16.96% is eighth of 28 and <code>roce_5y</code> 16.91% is ninth of 28 — stable across windows. <code>cfo_pat_3y</code> 1.255 is sixth of 26, so the profit is cash. <code>np_cagr_5y</code> +25.31% is 11th of 25 and <code>rev_cagr_5y</code> +19.92% is 14th of 28: a real five-year compounder in a cohort of them.",
  "<b>The current year has flattened and the quarter has not reaccelerated.</b> <code>ttm_sales_pct</code> +11.11% is 13th of 17, <code>ttm_op_pct</code> +10.49% is 12th of 15 and <code>ttm_np_pct</code> +7.27% is 12th of 15 — bottom third of the mature bucket on all three. <code>opm_now</code> 12.81% against <code>opm_prev</code> 12.88% is flat, and <code>sales_yoy_q</code> +16.02% is 13th of 18. Note the denominators: this bucket is 28 names but only 15 to 18 carry a TTM reading, so these are ranks against a thin field.",
  "<b>The multiple is above the top of its own history and the holders are institutional.</b> <code>pe_ttm</code> 41.76x is third of 17 — the third most expensive mature name carrying a PE — against an own six-year band of 5.47-39.02x averaging 13.18x. The stock is clear of its own six-year high and at roughly three times its own average multiple, on growth that has decelerated. Domestic institutions hold 25.96%, the highest of 16, and foreign institutions 8.07%, second of 15. <code>pct_above_200ema_252d</code> 13.10% is 12th of 20 and <code>ret_12m_rel</code> -18.72% is 16th of 24. " + TNS,
  "<i>A good biscuit and bakery business whose five-year record is better than its current year, priced above the top of its own six-year band. The institutional register is the strongest argument for patience and the weakest for a re-rating — the buyers are already in. <code>fcf_yield</code> -0.07% is tenth of 28: it is funding its own capacity, which is where the growth has gone.</i>",
 ],
 "trigger": "sales_yoy_q reaccelerating through 20% with opm_now above 13% -> the QSR bun and bakery lines are compounding again and a 41x multiple has something behind it. ttm_op_pct under 5% for two more quarters while pe_ttm stays above 39.02x -> a six-year-high multiple on a business growing in single digits.",
 "evidence": ["op_margin_3y", "roce_3y", "roce_5y", "cfo_pat_3y", "np_cagr_5y", "rev_cagr_5y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "sales_yoy_q", "pe_ttm", "dii_pct", "fii_pct", "pct_above_200ema_252d", "ret_12m_rel", "fcf_yield"],
},

"DODLA": {
 "confidence": "medium",
 "verdict": "WATCH — a three-year return on capital of 20.71%, sixth of 28 mature peers, against a TTM operating profit down 18.8% while net profit fell only 5.0% — a 17-point gap that sits below EBIT",
 "points": [
  "<b>Not held — DODLA is on your watchlist.</b> Dodla Dairy, ₹6,015cr, milk and value-added dairy across the southern states with an African operation attached — procurement-led, like Heritage, and exposed to the same cane-season equivalent in milk prices; promoters hold 58.92%. " + MAT + "Quality 66, valuation 40, momentum 40, composite 50.",
  "<b>The earnings-quality flag is the first thing on this row.</b> Over the TTM, operating profit fell 18.81% while net profit fell only 5.05% — net profit held up better than operating profit by 17 points, and the difference sits below EBIT: other income, a one-off, tax or interest, not trading. A PE quoted on this base is not a PE on operations. <code>ttm_op_pct</code> -18.81% is 15th of 15 — the worst TTM operating-profit change of every mature name carrying one. <code>np_yoy_q</code> -35.36% is 17th of 18, so the latest quarter is worse again.",
  "<b>The balance sheet and the capital returns are the counterweight.</b> <code>debt_equity</code> 0.034 is 27th of 28 — effectively unlevered, and only one mature peer carries less debt. <code>roce_3y</code> 20.71% is sixth of 28 and <code>roce_5y</code> 19.53% is sixth of 28, the same answer twice. <code>cfo_pat_3y</code> 1.035 is eighth of 26 and <code>fcf_yield</code> +1.83% is sixth of 28 — it generates cash and does not need debt to do it. <code>wc_days</code> -16.45 is 27th of 28: suppliers fund the working capital.",
  "<b>Priced inside its own narrow band while the trend has broken.</b> <code>pe_ttm</code> 27.25x is sixth of 17 against an own five-year band of 20.03-28.66x averaging 24.01x — one of the few genuinely tight bands in this batch, and the stock sits just above its own average rather than stretched. But <code>pct_above_200ema_252d</code> 3.17% is 17th of 20 — the close was above trend on three percent of the year — and <code>ret_12m_rel</code> -16.16% is 15th of 24. <code>opm_now</code> 6.74% against <code>opm_prev</code> 9.39% has lost two and a half points. " + TNS,
  "<i>An unlevered, cash-generating dairy with good three-year capital returns, in the middle of a procurement squeeze that has taken a fifth off operating profit and whose reported profit is being held up from below the operating line. The valuation is the most defensible in this batch and the operating trend is the worst. Watch <code>opm_now</code>; the multiple is not the question here.</i>",
 ],
 "trigger": "opm_now recovering through 9% with ttm_op_pct back positive -> the squeeze was seasonal, and a 20% ROCE business with no debt at 27x is reasonable. opm_now under 6% for two more quarters with the gap below EBIT persisting -> operating profit halving while reported profit is propped from elsewhere, which is the configuration that surprises on a downgrade.",
 "evidence": ["ttm_op_pct", "ttm_np_pct", "np_yoy_q", "debt_equity", "roce_3y", "roce_5y", "cfo_pat_3y", "fcf_yield", "wc_days", "pe_ttm", "pct_above_200ema_252d", "ret_12m_rel", "opm_now", "opm_prev", "op_margin_3y"],
},

# ---------------------------------------------------------------- mid tier

"NESTLEIND": {
 "confidence": "low",
 "verdict": "HOLD — scored in a 32-name mid-tier bucket it does not belong in, at 46.10x book, second of 31, on a three-year revenue trend the December-to-March year change makes unreadable",
 "points": [
  "<b>Held — NESTLEIND is in your portfolio.</b> Nestlé India, ₹2,37,723cr, Maggi, Nescafé, KitKat, Cerelac — the largest packaged-foods company in the country and by a wide margin the largest thing in this bucket, <code>market_cap</code> first of 32; promoters hold 62.76%. " + MID + FY_BREAK,
  "<b>What the bucket does to the ranks, concretely.</b> The cohort is 32 names but the per-metric reading counts underneath it are far thinner: <code>pe_ttm</code> has 17 readings, <code>opm_now</code> 8, <code>ttm_np_pct</code> 7, <code>div_yield</code> 5, <code>fii_pct</code> 11. A position out of seven is not a rank, and a percentile built on a mixture of those counts is not a percentile. This row therefore quotes no pillar figure at all and argues from the company's own numbers, with peer ranks used only where the field is wide enough to carry one.",
  "<b>On its own figures the returns are extraordinary and the top line is not.</b> <code>roce_3y</code> 105.92% is first of 29 — the highest return on capital in the bucket by a distance, which is what a brand portfolio with negative working capital produces; <code>wc_days</code> -73.82 is 32nd of 32, the most negative in the cohort. <code>op_margin_3y</code> 23.39% is second of 32 and <code>np_consistency_3y</code> 1.922 is first of 29. Against that <code>rev_cagr_3y</code> -2.57% is 27th of 29 and <code>np_cagr_3y</code> -5.68% is 21st of 27 — both three-year windows span the stub year, so they are measuring the calendar change as much as the business. That is the clearest single consequence of the year-end move.",
  "<b>The current year is genuinely strong, and the price reflects a decade of this.</b> <code>ttm_sales_pct</code> +21.68%, <code>ttm_op_pct</code> +26.96% and <code>ttm_np_pct</code> +38.17% — profit growing faster than operating profit growing faster than sales, with <code>opm_now</code> 23.73% against <code>opm_prev</code> 22.74%. <code>cfo_pat_3y</code> 1.140 is eighth of 32, so it is cash. <code>pb</code> 46.10x is second of 31 and <code>pe_ttm</code> 60.39x; there is no own-history PE band because the usable annual history is four rows. <code>debt_equity</code> 0.086 is 27th of 31. " + TNS,
  "<i>Confidence is low because the scoring is, not because the business is. A 105.92% return on capital funded by negative working capital is as close to a structural moat as this platform measures, and it is being ranked against a bucket of mid-tier food companies because the year end moved. Hold on the business; do not read the pillar scores on this row, and do not compare the three-year growth figures to anything until a clean post-March history exists.</i>",
 ],
 "trigger": "a fourth clean March year closing, which lets rev_cagr_3y and the maturity tier be recomputed without the stub -> the ranks on this row become readable and the pillar scores can be used again. opm_now falling under 21% with ttm_sales_pct decelerating under 10% -> a 46x book multiple on a brand portfolio that has stopped growing, and the moat is being paid for twice.",
 "evidence": ["roce_3y", "wc_days", "op_margin_3y", "np_consistency_3y", "rev_cagr_3y", "np_cagr_3y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "cfo_pat_3y", "pb", "pe_ttm", "debt_equity", "promoter_pct"],
 "rank_waivers": [
  {"quote": "the largest packaged-foods company in the country",
   "reason": "a claim about the Indian market, not about the 32-name peer cohort; "
             "market_cap first of 32 is stated separately and is checked"},
 ],
},

"MANORAMA": {
 "confidence": "low",
 "verdict": "WATCH — quality 68, third of 32 mid-tier peers but scored on only 40% of the pillar's declared weight, at 15.96x book, fourth of 31",
 "points": [
  "<b>Not held — MANORAMA is on your watchlist.</b> Manorama Industries, ₹10,890cr, speciality fats and butters — shea and sal-based cocoa-butter equivalents sold to chocolate and cosmetics manufacturers, a niche with real technical barriers and a concentrated customer list. " + MID + "The tier is honest here: the platform holds two annual rows because the company has only that much usable history, unlike NESTLEIND in the same bucket.",
  "<b>Three pillars of the four are built on missing components and the prose must say which.</b> The quality pillar scored on 40% of its declared weight, renormalised around absent <code>roce_3y</code> (22 points), <code>rev_cagr_3y</code> (12), <code>np_cagr_3y</code> (12), <code>np_consistency_3y</code> (8) and <code>op_margin_trend_3y</code> (6) — that is every multi-year fundamental the pillar is supposed to weigh. The valuation pillar scored on 70%, renormalised around absent <code>peg</code> (20 points) and <code>fcf_yield</code> (10). There is no own-history PE band. Quality 68 is therefore a third of the question the scorecard asks, and the composite of 71 inherits that.",
  "<b>What can be measured is a very high margin and very fast growth.</b> <code>op_margin_3y</code> 25.31% is first of 32 — the highest three-year operating margin in the mid-tier bucket. <code>ttm_sales_pct</code> +59.79%, <code>ttm_op_pct</code> +67.89% and <code>ttm_np_pct</code> +80.37% are each first in the field, and <code>sales_yoy_q</code> +39.53% is fourth of 13 — but those last four denominators are 8, 8, 7 and 13, so they are ranks against a handful of names and should be read as the company's own numbers rather than as positions.",
  "<b>The price assumes the growth continues and the cash has not arrived yet.</b> <code>pb</code> 15.96x is fourth of 31 and <code>ev_sales_ttm</code> 7.529x is second of 17 — among the most expensive in the bucket on both. <code>cfo_pat_3y</code> 0.557 is 12th of 32 and the prior-year mean conversion is negative, so profit has not been converting to operating cash; <code>wc_days</code> 167.89 is ninth of 32, which is where it has gone — a long cash cycle in a business buying agricultural raw material. <code>pct_above_200ema_252d</code> 83.73% is second of 18 and <code>ret_12m_rel</code> +34.83% is sixth of 21. " + TNS,
  "<i>Confidence is low because most of the scorecard could not be computed. A 25.31% three-year operating margin and 60% revenue growth are genuine and unusual; 15.96x book with cash conversion of 0.557 and a 168-day cash cycle is the risk, and there is no history to tell you which way a working-capital squeeze goes here. This needs a third and fourth annual year before any pillar figure on it is worth quoting.</i>",
 ],
 "trigger": "cfo_pat_3y moving above 1.0 with wc_days falling under 140 -> the growth is self-funding and the multiple is defensible on a genuinely scarce product. sales_yoy_q decelerating under 20% while wc_days stays above 160 -> growth bought with working capital, at 16x book, with no history to cushion it.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "pb", "ev_sales_ttm", "cfo_pat_3y", "wc_days", "pct_above_200ema_252d", "ret_12m_rel", "pe_ttm", "np_yoy_q"],
},

}


# --------------------------------------------------------------------- guards

# The cohort sentence each bucket is required to carry, and the adjective its
# stated count must be written against.
TIER_SENTENCE = {"veteran": VET, "mid": MID, "mature": MAT}

# Spelled band widths, for guard 9. The prose says "own nine-year band"; the
# pack says n=9. A band quoted with the wrong width is a claim about how much
# history exists, which is exactly the claim NESTLEIND's row is about.
_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}

# Guard 11: anything that reads as a pillar score. NESTLEIND may quote none.
PILLAR_RX = re.compile(r"\b(quality|valuation|momentum|composite)\s+"
                       r"(?:of\s+)?\d+", re.I)


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These guards
    cover the third category — structural claims neither pass can see, like
    whether the cohort sentence agrees with the cohort, or whether a row the
    pack flagged for an earnings-quality gap actually says so.
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
        #    used, in BOTH the tier and the count. This cluster spans three
        #    buckets, so a copied VET block on a mature row would quote 102
        #    against a 28-name cohort — the defect the checker found in the
        #    published capital-markets prose.
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

        # 6. delivery_data holds 12 distinct sessions, so a delivery
        #    percentage is one day's print. No row may quote one.
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

        # 8. Every evidence key must resolve in the live cluster_metrics or
        #    verdict-load.py rejects the whole row. Catching it here names the
        #    symbol and the key; the loader only names the key.
        live = set((p.get("metrics") or {}).get("cluster_metrics") or {})
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics")

        # 9. Any own-history PE band quoted in prose must match the pack in
        #    all four numbers — width, low, high, average. A band is four
        #    numbers transcribed by hand, which is how the oil batch shipped a
        #    wrong one, and the width is itself a claim about how much usable
        #    history exists.
        band = p.get("pe_band") or {}
        for pt in allprose:
            for yr, lo, hi, avg in re.findall(
                    r"own (\w+)-year band (?:runs|of) ([\d.]+)-([\d.]+)x"
                    r"(?: with an average of | averaging )([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a PE band; pack has none")
                    continue
                if _YEAR_WORD.get(yr.lower()) != band["n"]:
                    errs.append(f"{sym}: says {yr}-year band, pack n="
                                f"{band['n']}")
                if (abs(float(lo) - band["lo"]) > 0.005
                        or abs(float(hi) - band["hi"]) > 0.005):
                    errs.append(f"{sym}: band {lo}-{hi} vs pack "
                                f"{band['lo']}-{band['hi']}")
                if abs(float(avg) - band["avg"]) > 0.005:
                    errs.append(f"{sym}: band average {avg} vs pack "
                                f"{band['avg']}")
            # Headline shorthands. The verdict field is plain text, so these
            # are the only form a band can take there.
            for hi in re.findall(r"tops? out at ([\d.]+)x", pt) + re.findall(
                    r"topping out at ([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a band high; pack has none")
                elif abs(float(hi) - band["hi"]) > 0.005:
                    errs.append(f"{sym}: band high {hi} vs pack {band['hi']}")
            for avg in re.findall(r"own decade average of ([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a decade average; pack has "
                                f"none")
                else:
                    if band["n"] != 10:
                        errs.append(f"{sym}: says decade average, pack n="
                                    f"{band['n']}")
                    if abs(float(avg) - band["avg"]) > 0.005:
                        errs.append(f"{sym}: decade average {avg} vs pack "
                                    f"{band['avg']}")

        # 10. A row the pack flagged for an earnings-quality gap must say
        #     where the gap sits. Quoting a PE on a base the operating line
        #     does not produce, without the caveat, is the one failure in this
        #     batch that would change a reader's decision.
        if sym in EQ_FLAGGED:
            if not any("below EBIT" in pt for pt in pts):
                errs.append(f"{sym}: in EQ_FLAGGED but no point says the gap "
                            f"sits below EBIT")

        # 11. NESTLEIND is scored against a bucket it does not belong to
        #     (CHOICE 2), so its pillar percentiles are not statements about
        #     the company. The row must carry the explanation and quote no
        #     pillar figure anywhere.
        if sym == "NESTLEIND":
            if FY_BREAK not in p0:
                errs.append(f"{sym}: point one does not carry FY_BREAK")
            for pt in allprose:
                m = PILLAR_RX.search(pt)
                if m:
                    errs.append(f"{sym}: quotes a pillar figure "
                                f"'{m.group(0)}' against a bucket it does "
                                f"not belong to")

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
