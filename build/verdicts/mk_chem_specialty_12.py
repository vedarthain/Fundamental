"""chemicals_specialty — the 12 tracked names, written against the real peer set.

WHY THIS FILE IS SHAPED THIS WAY

This is the first batch written with `peer_ranks` in the evidence pack
(`scripts/verdict-evidence.py`) and the generic pass-2 checker
(`scripts/verdict-ranks-check.py`). Everything the earlier batches did by hand
— deciding what the peer set is, counting it, re-deriving each rank in a
throwaway `check_<batch>.py` — is now read from the pack and asserted
mechanically. The consequence for the prose is specific:

**Every denominator in these verdicts is a per-metric READING COUNT, not the
cohort size.** The veteran cohort here is 104 names and the mid cohort is 36,
but `pe_ttm` has 90 readings among the veterans and 19 among the mid, and
`div_yield` has 79. Quoting "of the 104" beside a PE rank was exactly the
defect the checker found in the published capital-markets prose on its first
run, where 42/43/37/36/33 were all quoted from the all-tiers cluster while the
percentiles were computed against a 32-name bucket. So each claim below names
the count that actually carries the metric, and `verdict-ranks-check.py` fails
the batch if any of them is off by one.

CHOICE 1 — THE COHORT SENTENCE STATES THE BUCKET, NOT THE CLUSTER.

`scoring/scorer.py` peers on `(cluster_id, maturity_tier)` when that bucket
clears `MIN_PEERS = 10`, and falls back to `(cluster, all tiers)` otherwise.
`chemicals_specialty` clears it twice over: veteran 104, mid 36. So unlike the
capital-markets batch, **all 12 of these rows are `score_status = 'full'`** and
none of them needs the mixed-tier caveat. That is worth saying out loud because
the previous batch's caveat was load-bearing and its absence here is a finding,
not an omission. The guard below asserts `score_status == 'full'` for all 12 —
if the scorer's bucketing changes, this file stops building rather than
silently shipping a stale claim.

CHOICE 2 — FOUR METRICS ARE DEAD PLATFORM-WIDE AND THE PROSE MAY NOT USE THEM.

`verdict-evidence.py`'s sanity block reports `book_value_cagr_3y`,
`p_premium`, `roe_latest` and `tech_net_score_scaled` as NULL for >=95% of
every maturity tier. `tech_net_score_scaled` is NULL for every scored company
on the platform and carries 5 points of the momentum pillar, so every momentum
percentile here is renormalised around the components that do exist. `TNS`
below is that sentence and the guard requires it on any row whose prose leans
on momentum.

CHOICE 3 — DELIVERY PERCENTAGES ARE A SINGLE-DAY READING AND ARE LEFT OUT.

`delivery_data` holds 8-12 distinct sessions for these symbols. A delivery
percentage computed off that is one day's print, not an average. Rather than
caveat it twelve times, no verdict here quotes one; the guard fails any row
that does without the caveat.

CHOICE 4 — OCCLLTD'S QUALITY PILLAR IS AN ARTEFACT AND THE VERDICT SAYS SO.

`roce_3y` -13.65% is the lowest of the 34 mid-tier names carrying it, and the
annual series explains why: FY2023 and FY2024 have no sales at all, net profit
of -0.02cr and -0.06cr, total assets of 0.04cr and 0.11cr, and 10,000 shares
outstanding. Those are the pre-demerger shell years of a company that listed on
2024-10-29. Every three-year metric on this row averages two shell years with
one real one. This is the same failure class as ASHIKAG's `book_value_cagr_3y`
370% in the capital-markets batch — a corporate reorganisation read as
performance — except here it drags the pillar DOWN rather than up, which makes
it easier to miss and no less wrong. The verdict's job is to say which numbers
are arithmetic and which are the business.
"""

import json
import re

PACK = "/tmp/chem12b.json"
OUT = "build/verdicts/chem-specialty-12-verdicts.json"
SOURCE_REPORT = "chemicals_specialty — 12 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

# Measured against app.user_watchlist / app.portfolio_holding on 2026-10-22,
# not taken from the prose. Point one's "held" / "not held" line is a claim
# like any other and the pack carries no membership flag to check it against.
HELD = {"SRF"}

EMIT = {"OCCLLTD", "CHEMBONDCH", "GNFC", "SOLARINDS", "INDOBORAX",
        "NAVINFLUOR", "PIDILITIND", "PRIVISCL", "VISHNU", "SHREEPUSHK",
        "SRF", "AETHER"}

# The cohort sentence. The number in it is asserted against
# peer_ranks.cohort.n by the guard AND parsed by verdict-ranks-check.py's
# "cohort" form, so it is checked twice from two directions.
VET = ("Peered against 104 veteran-tier peers inside "
       "<code>chemicals_specialty</code> — the scorer's bucket is "
       "(cluster, maturity tier) and this one clears the 10-peer floor, so "
       "every rank below is against those veterans rather than the whole "
       "cluster, and the row is badged <code>full</code> with no mixed-tier "
       "caveat. ")

MID = ("Peered against 36 mid-tier peers inside "
       "<code>chemicals_specialty</code> — the scorer's bucket is "
       "(cluster, maturity tier) and this one clears the 10-peer floor, so "
       "every rank below is against those mid-tier names rather than the "
       "whole cluster, and the row is badged <code>full</code> with no "
       "mixed-tier caveat. ")

TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company "
       "on the platform; the momentum pillar renormalises around the "
       "components that do exist, so the percentile is a narrower question "
       "than the scorecard asks rather than a lost weight.")

# Metrics that are NULL for >=95% of every tier. Naming one in prose is a
# claim about a number the platform does not hold.
DEAD = ("book_value_cagr_3y", "p_premium", "roe_latest")


SPEC = {

# ------------------------------------------------------------------- mid tier

"OCCLLTD": {
 "confidence": "medium",
 "verdict": "WATCH — composite 100, first of the 28 mid-tier names with a score, resting on a quality pillar that spends two of its three years inside a shell company",
 "points": [
  "<b>Not held — OCCLLTD is on your watchlist.</b> OCCL Limited, ₹831cr, insoluble sulphur and sulphuric acid for the tyre and rubber industry, demerged from Oriental Carbon &amp; Chemicals and listed on 2024-10-29 with plants at Dharuhera and Mundra and 36% of FY26 revenue exported. " + MID + "Quality 39, valuation 82, momentum 90, composite 100.",
  "<b>The composite is first of 28 and the pillar underneath it is measuring a shell.</b> <code>roce_3y</code> -13.65% is the lowest of the 34 mid-tier names carrying it, and the annual series says why: FY2023 and FY2024 show no sales at all, net profit of -₹0.02cr and -₹0.06cr, total assets of ₹0.04cr and ₹0.11cr, and 10,000 shares outstanding. Those are the pre-demerger years. So <code>roce_3y</code>, <code>np_consistency_3y</code> 1.208 — 31st of 34 — and <code>capex_intensity_3y</code> 0.606, the highest of 29, each average two shell years against one real one. Quality 39 is not a judgment on this business; it is the arithmetic of a reorganisation, and the pillar itself scored on 74% of its declared weight with <code>rev_cagr_3y</code>, <code>np_cagr_3y</code> and <code>op_margin_trend_3y</code> all absent.",
  "<b>What is real is one full year, and it is very good.</b> FY2026 sales were ₹505.90cr against ₹306.73cr, operating profit ₹90.22cr against ₹53.01cr. <code>ttm_sales_pct</code> +40.17% is the highest of 17, <code>ttm_op_pct</code> +57.02% the highest of 16, and <code>ttm_np_pct</code> +116.24% second of 16 behind YASHO. <code>sales_yoy_q</code> +78.46% is first of 19 and <code>opm_now</code> 20.66% against <code>opm_prev</code> 18.45% is a margin that rose while volume rose — the combination this cohort mostly does not have.",
  "<b>But the 11x is quoted on a base that is partly tax, and the cash is going into the ground.</b> <code>pe_ttm</code> 11.11x is the cheapest of the 19 mid-tier names with a PE. Net profit outran operating profit by 38 points over the trailing year, and FY2026 paid ₹7.77cr of tax on ₹55.48cr of pre-tax profit against ₹7.18cr on ₹28.60cr the year before — an effective rate of 14% against 25%. <code>cfo_pat_3y</code> is sixth of 34 and reads well for the same shell-year reason, but cash conversion was 0.12 in FY2026 against a prior-years mean of 1.32, and <code>fcf_yield</code> -11.41% is 26th of 29 because Mundra is still being built. There is no usable own-history PE band, so 11.11x has no anchor but the cohort. " + TNS,
  "<i>The uncomfortable part first: composite 100 — first of the 28 mid-tier names with a score — belongs to a company with eighteen months of trading history whose three-year quality metrics are arithmetic on a ₹0.04cr shell. Strip them and what is left is one excellent operating year, 11x earnings that got a third of their growth from an effective tax rate halving, and negative free cash because the plant is not finished. None of that is a reason to avoid it; all of it is a reason not to read the composite as a verdict. Watch, and judge it on FY2027 — the first year in which every three-year average will be made of real years.</i>",
 ],
 "trigger": "Cash conversion back above 0.6 with opm_now holding near 20% as the Mundra spend closes -> 11x on a fully-taxed operating base with real three-year averages underneath it, and the composite starts meaning what it says. ttm_op_pct decelerating under 15% while cash conversion stays under 0.3 -> the one good year was a tyre-cycle restock funded off the balance sheet, and there is no history to fall back on.",
 "evidence": ["roce_3y", "np_consistency_3y", "capex_intensity_3y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "opm_now", "opm_prev", "pe_ttm", "cfo_pat_3y", "fcf_yield"],
},

"CHEMBONDCH": {
 "confidence": "medium",
 "verdict": "WATCH — composite 93, third of the 28 mid-tier names with a score, against three-year cash conversion of 0.184 that ranks 30th of 34",
 "points": [
  "<b>Not held — CHEMBONDCH is on your watchlist.</b> Chembond Chemicals, ₹593cr, specialty chemicals across water technologies, construction chemicals, cleaning and hygiene and distribution, with plants at Dudhwada, Baddi and Ranipet; promoter and promoter group hold 67.98%. Listed on the NSE on 2025-07-23. " + MID + "Quality 55, valuation 70, momentum 73, composite 93.",
  "<b>The return on capital is genuinely good and the cash behind it is not there.</b> <code>roce_3y</code> 25.65% is eighth of 34 and <code>np_consistency_3y</code> 1.938 is third of 34 — a steady, capital-efficient formulator. Against that, <code>cfo_pat_3y</code> 0.184 is 30th of 34 and cash conversion was 0.17 in FY2026. The prior-years mean is -0.41, so this is not a deterioration from a good level; it is a business that has not converted profit into operating cash in any year the platform can see. That single fact should decide this row.",
  "<b>Growth is real and unremarkable for the cohort.</b> <code>ttm_sales_pct</code> +18.39% is seventh of 17, <code>ttm_op_pct</code> +16.79% eighth of 16 and <code>ttm_np_pct</code> +19.72% eighth of 16 — middle of the pack on all three, with <code>opm_now</code> 14.47% against <code>opm_prev</code> 14.66% essentially flat. <code>np_yoy_q</code> +52.24% is eighth of 19. Nothing here is accelerating and nothing is breaking.",
  "<b>It is cheap for that growth, and part of the momentum score cannot be measured yet.</b> <code>pe_ttm</code> 15.49x is fourth-cheapest of the 19 mid-tier names with a PE and <code>ev_ebitda_ttm</code> 10.01x is seventh-cheapest of 20. <code>capex_intensity_3y</code> -0.126 is the lowest of 29 — it has spent almost nothing on fixed assets — which is why <code>fcf_yield</code> +3.89% is sixth of 29 despite the conversion problem: there is nothing to fund. There is no 200-EMA trend reading at all, because 322 price bars is short of the ~450 the metric needs, so the momentum pillar scored on 85% of its declared weight; absence there is a short listing history, not a weak trend. There is no own-history PE band either. " + TNS,
  "<i>The uncomfortable answer: composite 93 is third of the 28 mid-tier names with a score and the cash-flow statement does not support it. A chemicals formulator and distributor earning 25.65% on capital while collecting 17 paise of each rupee of operating profit is either funding a working-capital build that will reverse, or booking margin it cannot bank — and with <code>shareholders</code> 10,732, 22nd of 23, nobody is watching closely enough for the market to have settled which. The asset-light balance sheet means this is survivable rather than dangerous. Watch, and read the FY2027 cash-flow statement before the P&amp;L.</i>",
 ],
 "trigger": "cfo_pat_3y moving above 0.8 while roce_3y holds near 25% -> the conversion gap was working capital, and a 25% ROCE formulator at 15x earnings is plainly mispriced. Another year under 0.3 with opm_now still near 14% -> the profit is an accrual the business does not collect, and 25% on capital is a number on paper.",
 "evidence": ["roce_3y", "np_consistency_3y", "cfo_pat_3y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "np_yoy_q", "opm_now", "opm_prev", "pe_ttm", "ev_ebitda_ttm", "capex_intensity_3y", "fcf_yield", "shareholders"],
},

"AETHER": {
 "confidence": "medium",
 "verdict": "WATCH — at ₹20,193cr the largest of the 36 mid-tier peers, with valuation 13 the lowest of the 31 scored on it, 86.47x earnings and asset turnover of 0.36x",
 "points": [
  "<b>Not held — AETHER is on your watchlist.</b> Aether Industries, ₹20,193cr, advanced intermediates and specialty chemicals from Surat, Sachin, Panoli and Bharuch — contract and exclusive manufacturing was 46% of FY26 revenue against 26% in FY24, large-scale manufacturing 43% against 60%, CRAMS 9%. " + MID + "Quality 46, valuation 13, momentum 79, composite 29. At ₹20,193cr it is the largest of the 36, and composite 29 is 21st of the 28 mid-tier names with a composite — size and score pointing in opposite directions.",
  "<b>It has the best margin in its tier and the slowest balance sheet.</b> <code>opm_now</code> 31.34% is the highest of 17, <code>op_margin_3y</code> 27.46% is third of 34 and <code>op_margin_trend_3y</code> +0.046 is third of 33 — the margin is high and still rising. Against that, <code>asset_turnover</code> 0.36x is the lowest of 34 and <code>wc_days</code> 201.3 is fourth of 34. <code>roce_3y</code> 8.39% is 29th of 34: a 31% operating margin earning 8% on capital is the entire Aether question in one line, and it is a question about the denominator, not the margin.",
  "<b>The trailing year is strong and the institutions already own it.</b> <code>ttm_sales_pct</code> +34.44% is second of 17 behind OCCLLTD, <code>ttm_op_pct</code> +38.16% fourth of 16 and <code>ttm_np_pct</code> +34.01% sixth of 16 — and unusually for this batch, net profit did not outrun operating profit. <code>fii_pct</code> 7.42% is second of 22 and <code>dii_pct</code> 10.49% second of 19, both behind ACI, while <code>public_pct</code> 7.17% is the lowest of 23. The free float is the thinnest in the cohort and institutions hold most of what there is.",
  "<b>Everything is priced for the contract-manufacturing story.</b> <code>pe_ttm</code> 86.47x is the highest of the 19 mid-tier names with a PE, <code>ev_sales_ttm</code> 16.78x the highest of 21, <code>ev_ebitda_ttm</code> 47.21x the highest of 20, <code>pb</code> 8.22x fourth of 34 and <code>peg</code> 4.52 second of 11. Its own PE band runs 66.17-125.50x on four usable years, averaging 87.66x — so 86.47x is normal for Aether, and the honest reading of that is that it has never traded cheaply in a history too short to contain a downturn. The close held above its 200-day EMA on 96.03% of the last 252 sessions, the highest of 14, and cash conversion was 0.39 in FY2026 against a prior-years mean of 0.055. " + TNS,
  "<i>At ₹20,193cr this is the largest of the 36, and it scores 29. The reason is arithmetic rather than sentiment: 86.47x earnings on a business returning 8.39% on capital — <code>roce_3y</code> 29th of 34, with two hundred days of working capital inside it. Contracted CRAMS and exclusive-manufacturing revenue earns a premium because the revenue is visible; it does not earn an asset base this slow, and a four-year price history that has spent 96% of the last year above trend has not tested the premium once. Watch. The only question that matters is whether the capital starts earning the margin, or the margin comes down to meet the capital.</i>",
 ],
 "trigger": "roce_3y rising through 14% with asset_turnover above 0.5 -> the capex has begun earning, the CEM mix shift is real, and 86x is a growth multiple rather than a scarcity multiple. opm_now slipping under 27% while roce_3y stays under 9% -> an 8.22x book on a slow asset base de-rates on the earnings and the multiple together, and the 7.17% float makes that disorderly.",
 "evidence": ["opm_now", "op_margin_3y", "op_margin_trend_3y", "asset_turnover", "wc_days", "roce_3y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "fii_pct", "pe_ttm", "ev_sales_ttm", "ev_ebitda_ttm", "pb", "peg", "pct_above_200ema_252d"],
},

# --------------------------------------------------------------- veteran tier

"GNFC": {
 "confidence": "medium",
 "verdict": "WATCH — valuation 91, tied third of the 101 veterans scored on it, bought with an operating margin that went 6.60% to 14.76% in a single year",
 "points": [
  "<b>Not held — GNFC is on your watchlist.</b> Gujarat Narmada Valley Fertilizers and Chemicals, ₹7,795cr, a Government of Gujarat company in two segments — chemicals and petrochemicals (TDI, methanol, acetic and formic acid, aniline, nitric acid) and fertilisers. " + VET + "Quality 43, valuation 91, momentum 77, composite 91 — tenth of the 100 veterans with a composite, and valuation 91 is tied third of the 101 scored on it.",
  "<b>The cheapness is the whole case and it is not an illusion.</b> <code>pe_ttm</code> 7.52x is sixth-cheapest of the 90 veterans with a PE, <code>pb</code> 0.86x is 14th-cheapest of 102, <code>ev_ebitda_ttm</code> 4.32x is fourth-cheapest of 90, and <code>div_yield</code> 3.96% is third of 79. Its own ten-year PE band runs 3.51-18.48x averaging 8.25x, so 7.52x is slightly below its own decade average. This is a stock that has always been cheap, and its own band is the right anchor rather than the cluster.",
  "<b>The earnings the multiple is quoted on nearly doubled in a year, and the margin step says what happened.</b> <code>opm_prev</code> 6.60% to <code>opm_now</code> 14.76% is a +8.16pp step; <code>ttm_op_pct</code> +151.72% is third of 92 and <code>ttm_np_pct</code> +84.52% is 17th of 89, with <code>np_yoy_q</code> +275.90% 15th of 100. A move that size in a TDI and methanol book is the commodity spread, not an operating improvement — and the long record agrees: <code>np_cagr_5y</code> -17.08% is 68th of 88 and <code>rev_cagr_5y</code> -2.62% is 84th of 102. Profit shrank for five years and then tripled in one.",
  "<b>Cash and returns on capital do not corroborate the P&amp;L.</b> <code>cfo_pat_3y</code> 0.628 is 85th of 93, <code>roce_3y</code> 9.70% is 59th of 103 and <code>op_margin_3y</code> 8.48% is 65th of 102 — the three-year averages put it in the bottom half on every quality axis while the trailing year puts it near the top on growth. <code>np_growth_above_inflation_10y</code> 0.556 is five year-steps out of nine, the denominator being N-1 because each step needs two points, and that is tied 34th of 104. <code>roe_avg_above_threshold_10y</code> 0.300 — three years of ten above the hurdle — is tied 50th of 104. <code>wc_days</code> -27.2 is 88th of 102: negative working capital, which in a subsidised fertiliser book is as much a receivables-timing artefact as a strength. " + TNS,
  "<i>Uncomfortably: 7.52x is cheap on this year's earnings, and this year's earnings are a spread. GNFC has cleared the ROE hurdle in three years of ten, shrunk revenue over five, and earns under 10% on capital through the cycle — the correct multiple on that is a low one, and 7.52x against an 8.25x decade average says the market has not actually mispriced it so much as priced it accurately for years. What is genuinely good is the 3.96% dividend, third of 79, and a 0.86x book that limits how wrong this can go. Watch rather than buy, and the thing to watch is whether <code>opm_now</code> holds above 12% for four consecutive quarters, because a TDI spread does not.</i>",
 ],
 "trigger": "opm_now holding above 12% for four quarters with cfo_pat_3y rising through 0.9 -> the margin step was a mix and capacity change rather than a spread, and 7.52x on a sustainable base is genuinely cheap. opm_now falling back under 9% -> earnings halve, 7.52x becomes 15x at an unchanged price, and what is left is the dividend and the book.",
 "evidence": ["pe_ttm", "pb", "ev_ebitda_ttm", "div_yield", "opm_now", "opm_prev", "ttm_op_pct", "ttm_np_pct", "np_yoy_q", "np_cagr_5y", "rev_cagr_5y", "cfo_pat_3y", "roce_3y", "op_margin_3y", "np_growth_above_inflation_10y", "roe_avg_above_threshold_10y", "wc_days"],
},

"SOLARINDS": {
 "confidence": "medium",
 "verdict": "WATCH — quality 78, second of 103 veterans, bought at 27.88x book, second of 102, and 87.88x earnings against its own decade average of 53.95x",
 "points": [
  "<b>Not held — SOLARINDS is on your watchlist.</b> Solar Industries India, ₹1,75,007cr, industrial explosives and initiating systems with a defence and advanced-technologies arm, operating across India, Africa, the Balkans, Central Asia and South America. " + VET + "Quality 78, valuation 19, momentum 84, composite 82. At ₹1,75,007cr it is the largest of 104, and quality 78 is second of the 103 veterans scored on it, behind PIDILITIND.",
  "<b>The quality record is the real thing: quality 78 is second of 103 veterans scored on it.</b> <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> are each 1.000 — every year of the last five, seven and ten above the hurdle — and each is tied first of 104. <code>np_growth_above_inflation_5y</code> 1.000 is tied first of 104 and <code>_7y</code> 0.833 is tied first of 104, while <code>_10y</code> 0.778 is tied third of 104. <code>roce_3y</code> 31.69% is fourth of 103, <code>op_margin_3y</code> 26.30% sixth of 102, <code>np_cagr_5y</code> +39.63% sixth of 88 and <code>rev_cagr_5y</code> +25.64% eighth of 102. There is no argument to make about the business.",
  "<b>The argument is entirely about what it costs.</b> <code>pb</code> 27.88x is second of 102, behind only INDOKEM; <code>ev_ebitda_ttm</code> 52.49x is third of 90 and <code>pe_ttm</code> 87.88x is ninth of 90. Its own ten-year PE band runs 30.93-95.06x averaging 53.95x, so 87.88x is near the top of its own decade and well above the middle of it — on the only anchor that matters for a name this consistently re-rated, it is expensive against itself, not just against peers. <code>div_yield</code> 0.057% is 76th of 79.",
  "<b>Growth is still there and the cash behind it has thinned.</b> <code>ttm_sales_pct</code> +41.72% is ninth of 97, <code>ttm_op_pct</code> +51.77% 19th of 92 and <code>ttm_np_pct</code> +57.84% 24th of 89, with <code>opm_now</code> 27.32% against <code>opm_prev</code> 25.51%. But cash conversion was 0.23 in FY2026 against a prior-years mean of 0.76, <code>cfo_pat_3y</code> 1.364 is 39th of 93 and <code>fcf_yield</code> +0.33% is 67th of 103 — a defence and explosives order book being built into inventory and receivables. <code>public_pct</code> 7.10% is the lowest of 100, so the float is the thinnest in the veteran cohort. " + TNS,
  "<i>The uncomfortable part: on quality 78 it is second of 103 veterans, and that is not the question. <code>pb</code> 27.88x is second of 102 and 87.88x earnings sits near the top of its own ten-year band, which means the next five years of 25% compounding are already in the price and the margin for being slightly wrong is nil. The deterioration in cash conversion to 0.23 from a 0.76 mean is the first thing in years that would justify a de-rating, and at 27.88x book a de-rating does not need an earnings miss to hurt. Watch. Nobody should sell this business; nobody should pay 28x book for it either.</i>",
 ],
 "trigger": "Cash conversion recovering above 0.6 while opm_now holds near 27% and the defence order book converts -> the working-capital build was order-book timing and the compounding record is intact at any sane multiple. pe_ttm holding above its 95.06x band high, or cash conversion staying under 0.3 for another year -> the premium is being paid for a narrative the cash statement has stopped confirming.",
 "evidence": ["roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "roce_3y", "op_margin_3y", "np_cagr_5y", "rev_cagr_5y", "pb", "ev_ebitda_ttm", "pe_ttm", "div_yield", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "cfo_pat_3y", "fcf_yield"],
 "rank_waivers": [
  # The band is this company's OWN ten-year PE history, not a peer cohort:
  # 30.93-95.06x is in pack["pe_band"] and guard 9 checks it against the
  # prose. "Top of its own decade" has no rank to carry and never will, so the
  # sniffer can only be answered by waiving it or by deleting the one sentence
  # that says the thing a 27.88x book multiple most needs said.
  {"quote": "near the top of its own decade",
   "reason": "own ten-year PE band 30.93-95.06x avg 53.95x, verified by guard 9 "
             "against pack['pe_band'] — not a peer rank"},
  {"quote": "near the top of its own ten-year band",
   "reason": "same own-history band; see above"},
 ],
},

"PIDILITIND": {
 "confidence": "medium",
 "verdict": "WATCH — quality 79, the highest of the 103 veterans scored on it, trading at 56.78x against its own ten-year PE high of 53.40x",
 "points": [
  "<b>Not held — PIDILITIND is on your watchlist.</b> Pidilite Industries, ₹1,50,398cr, adhesives, sealants and construction chemicals through Consumer &amp; Bazaar and Business-to-Business segments — Fevicol, Dr. Fixit, M-Seal. " + VET + "Quality 79, valuation 22, momentum 59, composite 69. Quality 79 is the highest of the 103 veterans scored on it.",
  "<b>It is the cleanest row in this batch and the only one with no earnings-quality flag at all.</b> Net profit and operating profit grew within one point of each other over the trailing year, the margin stepped +1.23pp, and cash conversion was 0.80 in FY2026 against a prior-years mean of 0.77 — consistent, not a recovery. <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> are each 1.000, tied first of 104, and <code>np_consistency_10y</code> 1.730 is 14th of 104. <code>roce_3y</code> 28.60% is sixth of 103 and <code>op_margin_3y</code> 22.97% 11th of 102. <code>wc_days</code> -5.8 is 83rd of 102: it is funded by its own trade creditors.",
  "<b>What has gone is the growth rate.</b> <code>ttm_sales_pct</code> +14.09% is 37th of 97, <code>ttm_op_pct</code> +20.11% 46th of 92 and <code>ttm_np_pct</code> +21.41% 45th of 89 — the exact middle of the veteran cohort. <code>np_yoy_q</code> +29.74% is 69th of 100 and <code>sales_yoy_q</code> +21.27% 50th of 97. <code>rev_cagr_5y</code> +10.14% is 36th of 102 and <code>np_cagr_5y</code> +19.33% 17th of 88. This is a high-teens compounder, not a 25% one, and the price has noticed: <code>ret_12m_rel</code> +6.14% is 40th of 89 and the close held above its 200-day EMA on 45.63% of the last 252 sessions, tied 31st of 87.",
  "<b>The valuation is the one thing out of line with its own history.</b> <code>pe_ttm</code> 56.78x sits above its own ten-year band entirely — the band runs 20.84-53.40x averaging 38.20x, so the stock is dearer than it has been in any of the last ten years on this measure. <code>pb</code> 13.88x is third of 102 and <code>ev_ebitda_ttm</code> 36.15x seventh of 90. <code>shareholders</code> 509,811 is second of 100 behind TATACHEM, which is the retail-ownership profile of a name people buy because they know the brand. <code>fii_pct</code> 11.69% is eighth of 90. " + TNS,
  "<i>Uncomfortably simple: quality 79, the highest of the 103 veterans scored on it, is attached to a multiple above its own ten-year high, and <code>np_cagr_5y</code> +19.33% — the growth that earned it — is 17th of 88. 56.78x for 14% revenue growth needs the margin to keep expanding, and the margin is already 24.48%. Nothing is wrong with Pidilite and nothing about it is cheap; a position taken here is a bet on multiple persistence, not on earnings. Watch, and note that momentum 59 and a price above trend on only 45.63% of the year mean the market has been quietly reaching the same conclusion for a while.</i>",
 ],
 "trigger": "ttm_sales_pct reaccelerating above 18% with opm_now moving through 26% -> volume growth is back, the construction-chemicals leg is compounding, and 56.78x is defensible for a franchise this consistent. ttm_sales_pct staying near 14% while pe_ttm holds above the 53.40x band high -> the multiple is doing all the work, and a de-rating to the 38.20x band average is a third off the price with no bad news required.",
 "evidence": ["roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "np_consistency_10y", "roce_3y", "op_margin_3y", "wc_days", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "np_yoy_q", "sales_yoy_q", "rev_cagr_5y", "np_cagr_5y", "ret_12m_rel", "pct_above_200ema_252d", "pe_ttm", "pb", "ev_ebitda_ttm", "shareholders", "fii_pct", "opm_now"],
},

"NAVINFLUOR": {
 "confidence": "medium",
 "verdict": "WATCH — foreign institutions hold 23.73%, the highest of 90, and domestic institutions 28.46%, the highest of 87, against a 27.08% promoter stake and a three-year return on capital of 13.67%",
 "points": [
  "<b>Not held — NAVINFLUOR is on your watchlist.</b> Navin Fluorine International, ₹41,165cr, specialty fluorochemicals in three segments — specialty chemicals, high-performance products and CDMO — in the Padmanabh Mafatlal group. " + VET + "Quality 68, valuation 27, momentum 82, composite 70.",
  "<b>It is the most institutionally owned name in the cluster, and the promoter is barely in it.</b> <code>fii_pct</code> 23.73% is the highest of the 90 veterans with a reading and <code>dii_pct</code> 28.46% is the highest of 87 — over half the company held by professional money, which is unusual at ₹41,165cr. <code>promoter_pct</code> 27.08% is 98th of 100. That ownership structure is the single most important fact on this row and it cuts both ways: the fluorine franchise has been validated by everyone whose job is to validate it, and there is no promoter block to absorb a disappointment.",
  "<b>The trailing year is the strongest in the batch and two-thirds of it sits in a margin step.</b> <code>opm_prev</code> 25.09% to <code>opm_now</code> 33.90% is a +8.81pp move, and <code>opm_now</code> 33.90% is third of 97. <code>ttm_op_pct</code> +92.45% is 11th of 92 and <code>ttm_np_pct</code> +122.74% 13th of 89 against <code>ttm_sales_pct</code> +42.43%, eighth of 97 — so net profit outran operating profit by 16 points, below EBIT. A margin step that size in one year is a mix change toward CDMO and high-performance products, or it is a one-off; the verdict turns on which, and one year cannot tell you.",
  "<b>The capital returns have not followed the margin, and the price has already paid.</b> <code>roce_3y</code> 13.67% is 37th of 103 — a 33.90% operating margin earning under 14% on capital, because the CDMO build is capitalised and not yet turning. <code>pe_ttm</code> 52.13x is 15th of 90 against its own ten-year band of 14.80-76.89x averaging 44.46x, so it is above its own average and inside its range. <code>pb</code> 10.36x is seventh of 102. The close held above its 200-day EMA on every one of the last 252 sessions — 100.0%, tied first of 87 — and <code>ret_12m_rel</code> +70.38% is seventh of 89. <code>cfo_pat_3y</code> 2.032 is 15th of 93 and cash conversion was 0.83 in FY2026, so unlike most of this batch the cash is arriving. " + TNS,
  "<i>The uncomfortable read: the most crowded institutional register in the cluster — <code>fii_pct</code> the highest of 90, <code>dii_pct</code> the highest of 87 — sits on top of a 27.08% promoter stake and a 13.67% return on capital, and the earnings that justify 52x arrived through an 8.81pp margin step in a single year. The cash conversion is good and the franchise is genuine, which is why this is a watch rather than an avoid. But a stock held above its 200-day EMA on 100% of the year, owned past half by funds, with a promoter at 27%, has no natural buyer if the margin step turns out to have been a contract rather than a mix. Watch the second derivative: whether 33.90% holds for two more quarters.</i>",
 ],
 "trigger": "opm_now holding above 32% for two more quarters with roce_3y rising through 17% -> the CDMO mix shift is structural, the capital has started earning, and 52x is a reasonable price for the only fluorine franchise of this scale. opm_now reverting toward 26% -> the step was a contract, net profit falls by more than operating profit did on the way up, and a register this institutional sells together.",
 "evidence": ["fii_pct", "dii_pct", "promoter_pct", "opm_now", "opm_prev", "ttm_op_pct", "ttm_np_pct", "ttm_sales_pct", "roce_3y", "pe_ttm", "pb", "pct_above_200ema_252d", "ret_12m_rel", "cfo_pat_3y"],
},

"SRF": {
 "confidence": "medium",
 "verdict": "HOLD — the only name in this batch you own, recovering hard off a five-year earnings decline, at 32.99x against a decade average of 26.35x",
 "points": [
  "<b>Held — SRF is in your portfolio.</b> SRF Limited, ₹71,320cr, four businesses — chemicals, performance films and foil, technical textiles, and coated and laminated fabrics — with plants in India, Thailand, South Africa and Hungary and customers in 90-plus countries. " + VET + "Quality 60, valuation 32, momentum 56, composite 40 — 61st of the 100 veterans with a composite, which is the weakest score of the four large-cap names in this batch.",
  "<b>The five-year record is the reason the composite is where it is.</b> <code>np_cagr_5y</code> -0.72% is 44th of 88 — five years of no earnings growth at all — and <code>rev_cagr_5y</code> +6.15% is 48th of 102. <code>roce_3y</code> 12.52% is 44th of 103 and <code>op_margin_3y</code> 19.92% 18th of 102. <code>np_growth_above_inflation_10y</code> 0.667 is six year-steps of nine and tied 14th of 104; <code>roe_avg_above_threshold_10y</code> 0.600 is six years of ten and tied 20th of 104. This is a cyclical with a decent decade and a bad half-decade, and the scorecard is reading the half-decade.",
  "<b>The trailing year is a genuine recovery and it is not yet in the price.</b> <code>opm_prev</code> 19.57% to <code>opm_now</code> 22.45% is a +2.88pp step; <code>ttm_op_pct</code> +29.60% is 38th of 92 and <code>ttm_np_pct</code> +51.08% 26th of 89 on <code>ttm_sales_pct</code> of only +12.98%, 45th of 97 — margin-led, which is what a refrigerant and packaging-film cycle turn looks like. Net profit outran operating profit by 17 points, so part of that 51% sits below EBIT. Meanwhile <code>ret_12m_rel</code> -11.88% is 61st of 89 and the close held above its 200-day EMA on only 29.37% of the last 252 sessions, 51st of 87. The accounts are improving and the price has not.",
  "<b>The valuation is the part that makes this a hold rather than an add.</b> <code>pe_ttm</code> 32.99x is 29th of 90 against its own ten-year band of 3.20-69.90x averaging 26.35x — above its decade average, inside a range so wide it barely constrains anything, which is what a decade of cyclical earnings does to a PE band. <code>pb</code> 5.08x is 16th of 102 and <code>ev_ebitda_ttm</code> 16.23x 29th of 90. <code>cfo_pat_3y</code> 1.649 is 24th of 93 with cash conversion 0.75 in FY2026, so the cash is real. <code>fii_pct</code> 15.45% is fifth of 90 and <code>dii_pct</code> 22.44% sixth of 87. " + TNS,
  "<i>Uncomfortable first, since you own it: five years of zero earnings growth is not a blip in a cyclical, it is the cycle, and 32.99x against a 26.35x decade average means you are paying an above-average multiple for the first good year of a recovery that the refrigerant cycle will eventually reverse. What argues for holding is specific and worth stating: the margin recovery is operating-led, the cash conversion is 0.75, foreign and domestic institutions hold 38% between them, and the price has done nothing for twelve months while the accounts improved — so the re-rating has not been taken. Hold. Do not add at 5.08x book on a cyclical whose last five years produced no growth, and do not read composite 40 as a sell signal when it is mostly a backward-looking average.</i>",
 ],
 "trigger": "opm_now holding above 22% through two more quarters with ttm_sales_pct accelerating past 18% -> volume has joined the margin, the chemicals leg is compounding again, and the twelve-month price lag closes upward. opm_now falling back under 19% with ret_12m_rel staying negative -> the recovery was a restocking quarter, and 32.99x on a cyclical trough-to-peak earnings base is the expensive end of the cycle.",
 "evidence": ["np_cagr_5y", "rev_cagr_5y", "roce_3y", "op_margin_3y", "np_growth_above_inflation_10y", "roe_avg_above_threshold_10y", "opm_now", "opm_prev", "ttm_op_pct", "ttm_np_pct", "ttm_sales_pct", "ret_12m_rel", "pct_above_200ema_252d", "pe_ttm", "pb", "ev_ebitda_ttm", "cfo_pat_3y", "fii_pct", "dii_pct"],
 "rank_waivers": [
  # Tracking status, not a cohort position. SRF is the one name in this batch
  # that appears in app.portfolio_holding; "the only" counts Deb's holdings,
  # and there is no peer_ranks dimension for that.
  {"quote": "the only name in this batch you own",
   "reason": "tracking status from app.portfolio_holding, measured in HELD; "
             "not a peer-cohort claim"},
 ],
},

"INDOBORAX": {
 "confidence": "medium",
 "verdict": "WATCH — above its 200-day EMA on every session of the year, tied first of 87, at 24.07x against an own-history average of 5.34x",
 "points": [
  "<b>Not held — INDOBORAX is on your watchlist.</b> Indo Borax &amp; Chemicals, ₹1,355cr, boron and lithium products — borax decahydrate, boric acid, boron oxide and lithium hydroxide monohydrate — sold into India, South America and South-East Asia. " + VET + "Quality 66, valuation 36, momentum 83, composite 79 — 22nd of the 100 veterans with a composite.",
  "<b>The long record is the best part of the row and it is better than the composite suggests.</b> <code>np_growth_above_inflation_7y</code> 0.833 is five year-steps of six and tied first of 104; <code>_10y</code> 0.778 is seven of nine and tied third of 104; <code>_5y</code> 0.750 is three of four and tied third of 104. The denominators are N-1 because each step needs two points. <code>op_margin_3y</code> 23.04% is tenth of 102, <code>roce_3y</code> 17.51% 27th of 103 and <code>capex_intensity_3y</code> -0.074 is 100th of 102 — it has grown the inflation-beating record without spending on fixed assets, which is why <code>fcf_yield</code> +2.48% is 46th of 103 despite the small size.",
  "<b>Against that, the ROE hurdle has mostly not been cleared and the quarter is cooling.</b> <code>roe_avg_above_threshold_10y</code> 0.300 — three years of ten — is tied 50th of 104, so a company that has reliably beaten inflation has reliably not earned a good return on equity: the growth is real and it is low-return growth. <code>opm_prev</code> 23.25% to <code>opm_now</code> 22.28% is a -0.97pp step, <code>np_yoy_q</code> +59.31% is 55th of 100 and <code>sales_yoy_q</code> +31.34% 33rd of 97 — decelerating from a <code>ttm_sales_pct</code> of +29.69%, 14th of 97. Net profit outran operating profit by 17 points over the trailing year.",
  "<b>The price has run a long way past the company's own history.</b> The close held above its 200-day EMA on every one of the last 252 sessions — 100.0%, tied first of 87 — and <code>ret_12m_rel</code> +75.48% is fifth of 89, with a six-month return of +71.10%. <code>pe_ttm</code> 24.07x is 41st of 90, which is unremarkable against peers and extraordinary against itself: its own ten-year band runs 0.29-15.52x averaging 5.34x, so the stock now trades at more than four times its own decade-average multiple and well above the top of its own range. <code>promoter_pct</code> 38.41% is 92nd of 100 and <code>public_pct</code> 61.43% second of 100 — this is a retail-held float. Cash conversion was 1.97 in FY2026 against a prior-years mean of 0.14. " + TNS,
  "<i>The uncomfortable fact: <code>np_growth_above_inflation_7y</code> is genuinely tied first of 104, and the re-rating has already taken it. A stock that averaged 5.34x earnings for a decade and now trades at 24.07x has been re-priced for the lithium hydroxide option, not for the boron business, and <code>roe_avg_above_threshold_10y</code> 0.300 says the boron business does not earn a good return on equity. Cash conversion of 1.97 against a 0.14 mean is one year, not a trend. <code>public_pct</code> 61.43% — second of 100 — and 100% of the year above trend is the shape of a story that has been discovered. Watch. If the lithium revenue shows up in the segment disclosure this is cheap; if it does not, the own-history band is the gravity.</i>",
 ],
 "trigger": "Lithium hydroxide appearing as a disclosed revenue segment with roe_avg_above_threshold starting to clear and opm_now back above 23% -> the re-rating from 5.34x to 24.07x was anticipating a real business change. opm_now slipping under 20% with no lithium disclosure -> the multiple has no support from either the return on equity or the company's own ten-year band, and a retail float unwinds quickly.",
 "evidence": ["np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "op_margin_3y", "roce_3y", "capex_intensity_3y", "fcf_yield", "roe_avg_above_threshold_10y", "opm_now", "opm_prev", "np_yoy_q", "sales_yoy_q", "ttm_sales_pct", "pct_above_200ema_252d", "ret_12m_rel", "pe_ttm", "promoter_pct"],
},

"PRIVISCL": {
 "confidence": "medium",
 "verdict": "WATCH — three-year cash conversion of 2.061, 13th of 93, and five-year profit growth of +35.42%, ninth of 88, bought at 8.91x book with 88 days of working capital",
 "points": [
  "<b>Not held — PRIVISCL is on your watchlist.</b> Privi Speciality Chemicals, ₹12,584cr, aroma and fragrance chemicals — pinene derivatives, musk, phenol and citral — selling into fragrance and FMCG, which together were 67% of FY26 revenue, across North America, Europe, Asia and the Middle East. " + VET + "Quality 66, valuation 40, momentum 62, composite 65.",
  "<b>It converts and it compounds, which is a rarer pair in this batch than it sounds.</b> <code>cfo_pat_3y</code> 2.061 is 13th of 93 with cash conversion 0.84 in FY2026 against a prior-years mean of 0.49 — improving, not just adequate. <code>np_cagr_5y</code> +35.42% is ninth of 88 and <code>rev_cagr_5y</code> +16.25% 18th of 102. <code>op_margin_3y</code> 21.99% is 15th of 102 and <code>opm_now</code> 24.93% seventh of 97 against <code>opm_prev</code> 22.21%. <code>np_growth_above_inflation_5y</code> 0.750 is three year-steps of four, tied third of 104.",
  "<b>The capital intensity is where the fragrance model shows its cost.</b> <code>wc_days</code> 87.7 is 15th of 102 — nearly three months of working capital, which is what holding aroma-chemical inventory for FMCG customers requires — and <code>roce_3y</code> 16.36% is 32nd of 103 against a 21.99% three-year margin. <code>fcf_yield</code> +2.17% is 49th of 103. <code>np_consistency_10y</code> 1.580 is 54th of 104 and <code>roe_avg_above_threshold_10y</code> 0.500 — five years of ten — is tied 31st of 104: the decade is ordinary and the last five years are not, which is a specific claim about a turnaround rather than a franchise.",
  "<b>The price reflects the turnaround and its own band cannot tell you how much.</b> <code>pb</code> 8.91x is eighth of 102 and <code>pe_ttm</code> 35.97x is 25th of 90. Its own ten-year band runs 7.35-184.95x averaging 50.51x — a range that wide is a record of losses and recoveries rather than a valuation anchor, and quoting the 50.51x average as though 35.97x were a discount to it would be arithmetic on noise. The close held above its 200-day EMA on every one of the last 252 sessions, tied first of 87, while <code>ret_12m_rel</code> +22.35% is 24th of 89 and the last three months returned -8.42%. Net profit outran operating profit by 18 points over the trailing year. " + TNS,
  "<i>The uncomfortable part: the five-year numbers are excellent and the ten-year numbers are not, and <code>pb</code> 8.91x — eighth of 102 — is priced off the five. <code>np_cagr_5y</code> +35.42% is ninth of 88 and <code>np_consistency_10y</code> 1.580 is 54th of 104; both are true, and which one is the business depends on whether the Fairchem-era restructuring permanently changed the margin or merely caught a fragrance up-cycle. The cash conversion at 0.84 and rising is the best evidence for the optimistic reading. Against it: 88 days of working capital, 16.36% on capital, and a price that has spent the entire year above trend. Watch, and let the next two quarters say whether <code>opm_now</code> 24.93% is the new floor.</i>",
 ],
 "trigger": "opm_now holding near 25% with wc_days falling under 75 and cash conversion above 0.8 -> the restructuring is permanent, the capital intensity is coming down, and 8.91x book is defensible on a 20%+ compounder. opm_now reverting toward 20% with wc_days rising -> the five-year record was a fragrance cycle, the ten-year consistency rank is the honest one, and an 8.91x book has a long way to fall.",
 "evidence": ["cfo_pat_3y", "np_cagr_5y", "rev_cagr_5y", "op_margin_3y", "opm_now", "opm_prev", "np_growth_above_inflation_5y", "wc_days", "roce_3y", "fcf_yield", "np_consistency_10y", "roe_avg_above_threshold_10y", "pb", "pe_ttm", "pct_above_200ema_252d", "ret_12m_rel"],
},

"VISHNU": {
 "confidence": "medium",
 "verdict": "WATCH — seven-year profit growth above inflation, tied first of 104, and three-year cash conversion of 0.758, 78th of 93, with the quarter now flat",
 "points": [
  "<b>Not held — VISHNU is on your watchlist.</b> Vishnu Chemicals, ₹4,067cr, speciality inorganic chemicals from minerals in three segments — chromium, barium and strontium — sold into pharmaceuticals, pigments, ceramics, leather, refractories and water treatment. " + VET + "Quality 57, valuation 40, momentum 65, composite 48 — 53rd of the 100 veterans with a composite.",
  "<b>The inflation record is the strongest claim on the row.</b> <code>np_growth_above_inflation_7y</code> 0.833 is five year-steps of six and tied first of 104; <code>_10y</code> 0.778 is seven of nine, tied third of 104; <code>_5y</code> 0.750 is three of four, tied third of 104. The denominators are N-1 because each step needs two points. <code>np_cagr_5y</code> +14.98% is 19th of 88 and <code>rev_cagr_5y</code> +10.77% 32nd of 102. That is a small inorganic-chemicals business that has out-compounded inflation for most of a decade — which the composite of 48 does not convey.",
  "<b>What drags it is cash and the absence of a return on it.</b> <code>cfo_pat_3y</code> 0.758 is 78th of 93 and <code>fcf_yield</code> -1.21% is 80th of 103 — negative free cash. <code>div_yield</code> 0.050% is 78th of 79, so effectively nothing is returned. <code>roce_3y</code> 16.27% is 33rd of 103 and <code>roe_avg_above_threshold_10y</code> 0.400 — four years of ten above the hurdle — is tied 42nd of 104. <code>wc_days</code> 75.2 is 23rd of 102. The pattern is consistent: growth funded internally and by working capital, with nothing left over.",
  "<b>The trailing year has gone flat and the price is only now noticing.</b> <code>opm_prev</code> 15.71% to <code>opm_now</code> 15.45% is a -0.26pp step; <code>ttm_sales_pct</code> +16.61% is 30th of 97 but <code>ttm_op_pct</code> +14.71% is 52nd of 92 and <code>ttm_np_pct</code> +16.57% 50th of 89 — growth without operating leverage. <code>np_yoy_q</code> +23.03% is 73rd of 100 and <code>sales_yoy_q</code> +24.93% 43rd of 97. Against that the close held above its 200-day EMA on 95.24% of the last 252 sessions, fourth of 87, and <code>ret_12m_rel</code> +33.33% is 18th of 89 — while the last month returned -17.94%. <code>pe_ttm</code> 27.17x is 36th of 90 against its own ten-year band of 0.71-24.26x averaging 10.37x, so it trades above the top of its own decade. " + TNS,
  "<i>The uncomfortable summary: <code>np_growth_above_inflation_7y</code> 0.833, tied first of 104, is a real achievement and it has been achieved with negative free cash, a 0.050% dividend that is 78th of 79, and a <code>roce_3y</code> of 16.27% that places it 33rd of 103. Vishnu grows by consuming the cash it generates, which works until the chromium cycle turns, and <code>pe_ttm</code> 27.17x sits above the top of its own ten-year range — the market is paying a premium for the compounding record precisely when the trailing quarter has gone flat and the last month fell 17.94%. Watch. The number that decides it is <code>cfo_pat_3y</code>: a growth record funded by working capital is a different asset from one funded by operations.</i>",
 ],
 "trigger": "cfo_pat_3y rising through 1.0 with opm_now recovering above 17% -> the compounding record is cash-backed, the chromium franchise has pricing power, and 27x is a growth multiple. opm_now staying near 15% with fcf_yield negative for another year -> the inflation record was volume bought with working capital, and a price above its own ten-year PE high has nothing holding it up.",
 "evidence": ["np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "np_cagr_5y", "rev_cagr_5y", "cfo_pat_3y", "fcf_yield", "div_yield", "roce_3y", "roe_avg_above_threshold_10y", "wc_days", "opm_now", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "np_yoy_q", "sales_yoy_q", "pct_above_200ema_252d", "ret_12m_rel", "pe_ttm"],
},

"SHREEPUSHK": {
 "confidence": "medium",
 "verdict": "WATCH — ten-year profit consistency of 1.769, seventh of 104, and zero of the last five and seven years cleared the ROE hurdle",
 "points": [
  "<b>Not held — SHREEPUSHK is on your watchlist.</b> Shree Pushkar Chemicals &amp; Fertilisers, ₹1,612cr, an integrated dyes, dye-intermediates, fertiliser and animal-health producer — the chemicals division was 54.4% of FY26 segment revenue — with sites across Maharashtra, Madhya Pradesh and Haryana. " + VET + "Quality 51, valuation 40, momentum 67, composite 41 — 60th of the 100 veterans with a composite.",
  "<b>It is one of the most consistent earners in the cluster and it consistently earns too little.</b> <code>np_consistency_10y</code> 1.769 is seventh of 104 — the index runs 0 to 2 and this is a decade of steady profit, not a pass rate. But <code>roe_avg_above_threshold_5y</code> 0.000 and <code>roe_avg_above_threshold_7y</code> 0.000 mean not one of the last five or seven years cleared the return-on-equity hurdle, and <code>roe_avg_above_threshold_10y</code> 0.200 is two years of ten, tied 64th of 104. Steadiness and adequacy are different tests and this row passes the first while failing the second — which is the clearest statement of what Shree Pushkar is: a reliable, low-return commodity chemicals business.",
  "<b>The trailing year is the weakest growth in this batch.</b> <code>ttm_sales_pct</code> +15.65% is 34th of 97, but <code>ttm_op_pct</code> +7.36% is 58th of 92 and <code>ttm_np_pct</code> +7.99% 57th of 89, with <code>opm_prev</code> 11.00% falling to <code>opm_now</code> 10.21% — a -0.79pp step. <code>np_yoy_q</code> +9.40% is 80th of 100 and <code>sales_yoy_q</code> +10.04% 75th of 97. Revenue is growing at mid-teens and nothing is reaching the operating line, which for a dyes and dye-intermediate book is input cost.",
  "<b>Capital returns are thin, cash is adequate, and the price has been strong anyway.</b> <code>roce_3y</code> 10.62% is 55th of 103 and <code>op_margin_3y</code> 9.65% 56th of 102; <code>cfo_pat_3y</code> 0.843 is 71st of 93, though cash conversion was 1.02 in FY2026 against a prior-years mean of 0.49. <code>fcf_yield</code> +0.28% is 68th of 103. <code>ema_stack_bull</code> 1.0 is tied first of 97 and the close held above its 200-day EMA on 73.41% of the last 252 sessions, eighth of 87, with <code>ret_12m_rel</code> +26.88% 23rd of 89 and a three-month return of +24.79%. <code>pe_ttm</code> 22.51x is 44th of 90 against its own ten-year band of 6.35-20.04x averaging 14.06x — above the top of its own decade. <code>dii_pct</code> 0.00% is tied 79th of 87: no domestic institution owns any of it. " + TNS,
  "<i>Uncomfortably: <code>np_consistency_10y</code> seventh of 104 is the kind of number that reads as quality and is not. Zero of the last five years and zero of the last seven cleared the ROE hurdle, <code>roce_3y</code> is 10.62% and the operating margin is falling while revenue grows — this is a business that reliably produces an inadequate return, and the market has just re-rated it to 22.51x, above the top of its own ten-year PE range, on a three-month move of +24.79%. The integrated fertiliser-and-dyes model is defensible and the FY2026 cash conversion of 1.02 is encouraging. Neither justifies paying a decade-high multiple for a decade of sub-hurdle returns. Watch, and want a lower price.</i>",
 ],
 "trigger": "opm_now recovering through 13% with roe_avg_above_threshold_5y starting to clear -> the integration is finally earning its cost of capital and the consistency record becomes a quality record. opm_now falling under 9% while pe_ttm holds above the 20.04x band high -> a sub-hurdle business at a decade-high multiple, which is the configuration that de-rates on no news at all.",
 "evidence": ["np_consistency_10y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "np_yoy_q", "sales_yoy_q", "roce_3y", "op_margin_3y", "cfo_pat_3y", "fcf_yield", "ema_stack_bull", "pct_above_200ema_252d", "ret_12m_rel", "pe_ttm", "dii_pct"],
},

}


# --------------------------------------------------------------------- guards


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These guards
    cover the third category — structural claims neither pass can see, like
    whether the cohort sentence agrees with the cohort.
    """
    errs: list[str] = []
    for sym, v in spec.items():
        p = pack[sym]
        pts = v["points"]
        p0 = pts[0]
        pr = p["peer_ranks"]
        tier = pr["cohort"]["tier"]
        n = pr["cohort"]["n"]

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. The cohort sentence must match the bucket the scorer actually
        #    used, in BOTH the tier and the count. A VET block on a mid-tier
        #    row would quote 104 against a 36-name cohort — the exact defect
        #    the checker found in the published capital-markets prose.
        want = VET if tier == "veteran" else MID
        if want not in p0:
            errs.append(f"{sym}: tier={tier} but point one carries the "
                        f"{'MID' if want is VET else 'VET'} cohort sentence")
        stated = re.search(r"against (\d+) (?:veteran|mid)-tier peers", p0)
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

        # 6. Delivery is a single-day reading here (8-12 sessions). No row is
        #    allowed to quote one at all.
        for pt in pts + [v["trigger"], v["verdict"]]:
            if re.search(r"deliver", pt, re.I):
                errs.append(f"{sym}: quotes delivery off "
                            f"{(p.get('delivery') or {}).get('sessions')} "
                            f"sessions — a single-day print")

        # 7. np_consistency is an index 0-2, never a pass rate.
        for pt in pts:
            if re.search(r"np_consistency\w*</code>\s*[\d.]+\s*(?:of|in)\s", pt):
                errs.append(f"{sym}: np_consistency written as a pass rate")

        # 8. Every evidence key must resolve in the live cluster_metrics or
        #    verdict-load.py rejects the whole row. Catching it here names the
        #    symbol and the key; the loader only names the key.
        live = set((p.get("metrics") or {}).get("cluster_metrics") or {})
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics")

        # 9. Any own-history PE band quoted in prose must match the pack. A
        #    band is three numbers and transcribing three numbers by hand is
        #    how the oil batch shipped a wrong one.
        band = p.get("pe_band") or {}
        for pt in pts:
            for lo, hi in re.findall(r"band runs ([\d.]+)-([\d.]+)x", pt):
                if not band:
                    errs.append(f"{sym}: quotes a PE band; pack has none")
                elif (abs(float(lo) - band["lo"]) > 0.005
                        or abs(float(hi) - band["hi"]) > 0.005):
                    errs.append(f"{sym}: band {lo}-{hi} vs pack "
                                f"{band['lo']}-{band['hi']}")

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
        if sym not in EMIT:
            continue
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
