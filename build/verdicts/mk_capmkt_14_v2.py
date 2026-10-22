"""capital_markets v2 — the 14 names re-peered out of `bfsi_nbfc`, rewritten.

WHY THIS FILE EXISTS

`mk_capmkt_16.py` wrote 16 verdicts on 2026-10-21 whose point one said, in
every single row, that the percentiles were "direction, not rank" because the
company was being scored inside `bfsi_nbfc` against 182 balance-sheet lenders.
That was true when it was written. On 2026-10-22 it stopped being true: three
whitelists were added to `etl/src/fundamental_etl/clusters/rules.py` ahead of
the `bfsi_nbfc` fallback, `assign-clusters` moved 14 of those 16 names, and
`score --snapshot 2026-10-21` re-scored them on the scorecards their business
models actually warrant.

So this is not a refresh. **The 16 verdicts are now wrong in a specific,
mechanical way**, and all three failure modes had to be fixed at once:

1. **Point one asserts the wrong cluster, the wrong peer count and the wrong
   composite.** ASHIKAG's said "Scored inside <code>bfsi_nbfc</code> against
   182 balance-sheet lenders ... Composite 76." It is now in `bfsi_broker`
   against 42 peers at composite 42.

2. **The metrics the prose argued from no longer exist.** The three new
   scorecards do not compute `loan_book_cagr_3y`, `roa_3y`, `equity_to_assets`,
   `p_aum`, `roe_5y`, `roe_7y`, `roe_excess_13_Ny` or `book_value_cagr_Ny` —
   those are lender metrics. 37 frozen `evidence` keys across the 14 rows
   stopped resolving. `scripts/verdict-load.py` would now **refuse** eleven of
   the sixteen rows outright (an unresolvable evidence key has been a fatal
   error since 2026-10-13), which is the cleanest possible proof that the prose
   was arguing from numbers the platform no longer holds.

3. **Two of the calls were artefacts of the misfiling and change on the
   evidence.** See CHOICE 4.

CHOICE 1 — THE CAVEAT IS REPLACED, NOT DROPPED. IT IS NOW A DIFFERENT CAVEAT.

Writing "correctly peered, no caveat" would be the comfortable lie. The peer
pools are small and the maturity buckets are smaller:

    bfsi_rta_rating    n=5    veteran 3, mature 2
    bfsi_amc_wealth    n=16   veteran 9, mature 5, mid 2
    bfsi_broker        n=43   veteran 32, mature 5, mid 6

`MIN_PEERS = 10` in `scoring/scorer.py`. The peer bucket is
**(cluster_id, maturity_tier)**, not cluster_id — so a bucket under 10 falls
back to (cluster, all-tiers) and the row is badged
`partial-cluster-mixed-tiers`. Nine of these 14 carry that badge, and
`bfsi_amc_wealth` carries it on **all 16** of its members because its largest
tier is 9 — one short. That is the honest new caveat and every point one states
it: the comparison is now against the right business model, at mixed maturity,
in a pool of 5 / 16 / 43.

This matters more than it sounds. `score_status` went `full` ->
`partial-cluster-mixed-tiers` for 9 of the 14. The trade taken deliberately:
**16 correct peers honestly badged thin beats 182 wrong ones badged `full`.**

CHOICE 2 — THE "OF THE 16" SUPERLATIVES ARE GONE. RANKS ARE AGAINST THE REAL
CLUSTER NOW.

v1 restricted every superlative to the hand-picked 16-name batch or a named
sub-group, because the cluster was useless as a comparison set. That constraint
is lifted: the clusters are now the right pools, so every rank claim in this
file is stated against **the cluster, with the denominator**, e.g. "the most
expensive of the 37 brokers carrying a PE". `check_capmkt_14_v2.py` evaluates
each one in code against `app.metrics_snapshot.cluster_metrics` at snapshot
2026-10-21. Denominators differ per metric because coverage differs — 43
brokers, but only 37 with a `pe_ttm` and 32 with a ten-year series — and the
denominator quoted is always the one with the reading, never the cluster size.

CHOICE 3 — SBIFUNDS CONTAMINATES EVERY BROKER SUPERLATIVE AND IS NOT FIXED
HERE.

Measured while writing this: **SBI Funds Management sits in `bfsi_broker`.**
NSE labels it `industry = 'Capital Markets'`, and the pre-existing
`bfsi_broker` rule catches Capital Markets, so an AMC with ₹10,000bn+ of
managed assets is pooled with 42 brokers. It ranks 1st of 43 on `pb`,
`roe_3y`, `roce_3y`, `roce_5y`, `op_margin_3y` and `shareholders`, and 1st of
32 on `np_growth_above_inflation_10y` and `roe_avg_above_threshold_7y/10y`.

This is the *mirror image* of the defect just fixed — that one was non-lenders
labelled "Finance" falling into the lender fallback; this one is an AMC
labelled "Capital Markets" falling into the broker rule. GROWW
(Billionbrains Garage Ventures) is in the same cluster by the same rule and
belongs there; SBIFUNDS does not.

Consequence for this file, stated rather than hidden: **where SBIFUNDS is rank
1, the claim is written as "second of 43, behind SBI Funds Management, which is
an AMC misfiled into this cluster".** WEALTH is the row most affected — it is
2nd on `roce_3y`, `roce_5y` and `op_margin_3y`, behind SBIFUNDS on all three.
Not silently promoting it to 1st is the point: a superlative that becomes true
only after an unfixed bug is corrected is not a superlative yet.

The fix belongs on a `main` session with `rules.py`, not here — this checkout
writes `build/verdicts/` only (CLAUDE.md §4).

CHOICE 4 — TWO RATING CHANGES, BOTH DOWNGRADES, BOTH CAUSED BY THE RE-PEERING.

**CRISIL: ACCUMULATE -> HOLD.** This is the single most valuable thing the
reclassification produced and it is unwelcome. v1 called it "the best
seven-year return of any fee business here" and rated it ACCUMULATE. It was
being compared to NBFCs. Its real peer set is CAMS, KFINTECH, CARERATING and
ICRA, and against those four:

    op_margin_3y   CRISIL 28.59%  —  LOWEST OF THE FIVE (CAMS 45.11%,
                                     KFINTECH 42.70%, CARERATING 38.05%,
                                     ICRA 34.99%)
    opm_now        CRISIL 29.79%  —  lowest of the five
    pe_ttm         CRISIL 37.59x  —  second-highest (KFINTECH 47.64x)
    roce_3y        CRISIL 34.65%  —  second (CAMS 48.28%)
    div_yield      CRISIL 1.32%   —  lowest of the five
    composite      CRISIL 54      —  third (CARERATING 61, CAMS 56)

Composite fell 81 -> 54. The franchise argument survives — `roe_avg_above_
threshold` is 1.00 on all three windows, the only name of the three with the
test to clear it every year — but "superior economics" does not. CRISIL has the
thinnest operating margin in its own industry at nearly the highest multiple.
ACCUMULATE rested on a comparison with lenders. HOLD is what the right
comparison supports.

**VLSFINANCE: HOLD -> AVOID.** v1's hold rested on one number:
`book_value_cagr_10y` 25.07%, "a compounding balance sheet", hold it as a
discounted basket. That metric is not in the broker scorecard, so I went to the
annual rows — and they say something v1 did not check. Reserves peaked at
₹2,947.72cr in FY2024 and are ₹2,081.81cr at FY2026, with share count down
34.92m -> 31.50m on buybacks. **Book value per share: ₹854 (FY2024) -> ₹671
(FY2026), -21.4% in two years.** The ten-year CAGR is real and the two-year
direction is the opposite of it. Add `roe_avg_above_threshold_5y` 0.000 and
`_7y` 0.000 — rank 32 of 32, zero years above the hurdle in five and in seven —
and `np_cagr_5y` -43.28%, worst of 33. A 0.32x book that is itself shrinking
21% every two years is not a discount, it is tracking.

The other twelve calls are unchanged in direction. Six of them are *better
supported* than they were, because a claim about the right peer group is worth
more than the same claim about the wrong one.

CHOICE 5 — PNBGILTS AND ARCIL ARE NOT IN THIS FILE, AND THEIR v1 VERDICTS STAND.

The segment list has 17 entries; ASHIKA is a dead ticker (v1 choice 2, still
uncorrected in `bfsi_segments.py`); 14 moved; PNBGILTS and ARCIL stayed in
`bfsi_nbfc` deliberately. Both take principal risk on a leveraged debt book —
G-sec primary dealing and distressed-asset acquisition — so `pb`, `roa_3y` and
`equity_to_assets` fit them better than `fcf_yield` and `op_margin_3y`. The
reasoning is recorded in `rules.py` so a later pass does not "finish the job".

Their v1 verdicts are therefore **still accurate**, including the "direction,
not rank" caveat, and are not reloaded. Do not assume a 16-row batch needs 16
new rows.

CHOICE 6 — WHAT WOULD MAKE THIS BATCH WRONG AGAIN (CLAUDE.md §5)

Nothing automatic, and the honest version of that is: every rank claim here is
pinned to snapshot 2026-10-21 and three pool sizes. If `bfsi_amc_wealth`
gains three veterans it crosses MIN_PEERS, all 16 rows go `full`, and the
"mixed maturity" sentence in five of these point-ones becomes false — in the
safe direction, but false. If SBIFUNDS is moved to `bfsi_amc_wealth` (CHOICE 3)
then WEALTH's three second-places become firsts and `bfsi_amc_wealth` crosses
MIN_PEERS at the same time, which breaks both. The countable guard for that —
a DQ assertion that no verdict's quoted peer denominator differs from the live
cluster count by more than ±2 — does not exist. It is the follow-up this block
is asking for.

CHOICE 7 — HOLDINGS

Nothing here is held (`app.portfolio_holding` empty for all 14). CHOICEIN and
PRIMESECU are on the watchlist. Each of the 14 has exactly one prior verdict —
its v1 row — and the table is append-only on (symbol, generated_at), so these
rows are a second version rather than a replacement. Two of them disagree with
their predecessor and say so in the prose, which is the only acceptable way to
contradict a published call.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_capmkt_14_v2.py
"""

import json
import re

PACK = "/tmp/capmkt14.json"
PEERS_JSON = "/tmp/capmkt_peers.json"
OUT = "build/verdicts/capmkt-14-v2-verdicts.json"
GENERATED_AT = "2026-10-22T11:00:00+00:00"
SOURCE_REPORT = "capital_markets v2 — re-peered"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

# Choice 1. One of these opens the percentile sentence in every point one, and
# the guard below checks that the row carries the one matching its cluster.
THIN_RTA = ("Re-peered out of <code>bfsi_nbfc</code> into "
            "<code>bfsi_rta_rating</code> on 2026-10-22, so the percentiles "
            "below are finally a rank against ratings and registry businesses "
            "rather than against lenders — but the pool is 5 names and no "
            "maturity bucket in it reaches the 10-peer floor, so every row in "
            "it mixes tiers.")

THIN_AMC = ("Re-peered out of <code>bfsi_nbfc</code> into "
            "<code>bfsi_amc_wealth</code> on 2026-10-22, so the percentiles "
            "below rank it against asset and wealth managers rather than "
            "lenders — but the pool is 16 names whose largest maturity bucket "
            "is 9, one short of the 10-peer floor, so all 16 mix tiers.")

THIN_BROKER = ("Re-peered out of <code>bfsi_nbfc</code> into "
               "<code>bfsi_broker</code> on 2026-10-22, so the percentiles "
               "below rank it against 42 broking and securities-dealing peers "
               "rather than against lenders.")

MIXED = (" Its own maturity bucket is under the 10-peer floor, so this row "
         "mixes tiers to reach a usable pool.")

TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company on "
       "the platform; the momentum pillar renormalises around the components "
       "that do exist, so the percentile is a narrower question than the "
       "scorecard asks rather than a lost weight.")

SBI = ("SBI Funds Management, which is an asset manager misfiled into this "
       "cluster by the same kind of industry-label defect that put the "
       "capital-markets names in "
       "with the lenders")

EMIT = {"CHOICEIN", "PRIMESECU"}

CLUSTER = {
    "CRISIL": "bfsi_rta_rating",
    "AKCAPIT": "bfsi_amc_wealth", "ARYAMAN": "bfsi_amc_wealth",
    "PRIMESECU": "bfsi_amc_wealth", "PIONRINV": "bfsi_amc_wealth",
    "THEINVEST": "bfsi_amc_wealth",
    "WEALTH": "bfsi_broker", "CHOICEIN": "bfsi_broker",
    "ASHIKAG": "bfsi_broker", "AVONMORE": "bfsi_broker",
    "AFSL": "bfsi_broker", "ALGOQUANT": "bfsi_broker",
    "BLBLIMITED": "bfsi_broker", "VLSFINANCE": "bfsi_broker",
}

SPEC = {

# ------------------------------------------------------------------------ hold
# CRISIL is first because it is the downgrade and the whole point of the batch.

"CRISIL": {
 "confidence": "medium",
 "verdict": "HOLD — downgraded from ACCUMULATE. Against its real peers it has the thinnest operating margin of the five ratings and registry names at the second-highest multiple",
 "points": [
  "<b>Not held, not on your watchlist.</b> CRISIL Ltd, ₹33,243cr, credit ratings and research plus analytics delivered to S&P Global, which holds the 66.64% promoter stake. " + THIN_RTA + MIXED + " Quality 52, valuation 50, momentum 59, composite 54.",
  "<b>This is a downgrade and the reason is that the previous verdict was comparing it to the wrong companies.</b> On 2026-10-21 it sat in <code>bfsi_nbfc</code> at composite 81 and the verdict called it the best fee business in the batch. Its peers are CAMS, KFINTECH, CARERATING and ICRA, and against those four <code>op_margin_3y</code> 28.59% is the <i>lowest of the five</i> — CAMS 45.11%, KFINTECH 42.70%, CARERATING 38.05%, ICRA 34.99% — with <code>opm_now</code> 29.79% also last. <code>pe_ttm</code> 37.59x is the second-highest of the five behind KFINTECH's 47.64x, <code>div_yield</code> 1.32% the lowest, and composite 54 is third, behind CARERATING at 61 and CAMS at 56. Nothing about the company changed. The comparison did.",
  "<b>The franchise argument does survive, and it is the reason this is a hold rather than a reduce.</b> <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> are all 1.000 — every one of the last five, seven and ten years averaged a return on equity above the threshold, and it is the only one of the three names here carrying the test to clear it on all three windows (CARERATING 0.400/0.571/0.700, ICRA 0.600/0.429/0.600). These are level tests, so the denominators are 5, 7 and 10. <code>roce_3y</code> 34.65% and <code>roce_5y</code> 36.11% are second of the five behind CAMS. A regulated ratings licence plus contracted analytics work for a 66.64% parent is still the least cyclical revenue in this industry.",
  "<b>The trailing year is clean and the valuation is no longer the argument it was.</b> TTM sales +22.03%, operating profit +25.22%, net profit +21.53%, with <code>opm_now</code> 29.79% against <code>opm_prev</code> 29.04% — a +0.76pp step, and the pack flags no earnings-quality blocker on this row, which is true of only one other name in these 14. <code>pe_ttm</code> 37.59x still sits below its own ten-year band average of 45.43x on a 32.05-71.11x range. But a discount to your own history means less when four direct competitors are cheaper or better: ICRA is at 22.05x and CARERATING at 27.99x, both on fatter margins. <code>ret_12m_rel</code> +2.20%, close above its 200-day EMA on 26.19% of the last 252 sessions, <code>shareholders</code> 88,482, <code>fii_pct</code> 6.38% — the lowest of the five. " + TNS,
  "<i>Uncomfortable first: the previous verdict's central claim was an artefact of a clustering bug, and correcting the bug costs CRISIL its rating. What is left is a genuinely excellent balance sheet and a ten-year unbroken hurdle record attached to the weakest margin structure in its own industry, priced above three of its four competitors. Ratings is a two-and-a-half-player market in India and the licence is not going anywhere, so there is no case for selling — but the case for accumulating required CRISIL to be the best business here, and measured against the right four names it is the second or third. Hold. The thing the pack cannot see at all is the S&P relationship, which is both the franchise and the single point of failure.</i>",
 ],
 "trigger": "op_margin_3y closing toward CAMS's 45% while pe_ttm stays under 40x -> the margin gap was mix rather than structure and the franchise premium is earned. opm_now slipping under 28%, or the analytics revenue share falling in the annual report -> the thinnest margin in the industry gets thinner and a 37.59x multiple has nothing holding it up.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "pe_ttm", "roce_3y", "roce_5y", "div_yield", "roe_avg_above_threshold_10y", "ttm_np_pct", "ret_12m_rel", "pct_above_200ema_252d", "fii_pct"],
},

"WEALTH": {
 "confidence": "medium",
 "verdict": "HOLD — the best return on capital of any genuine broker in the cluster, with the worst quarterly revenue fall of all 39 and a 64% margin that was 76% a year ago",
 "points": [
  "<b>Not held, not on your watchlist.</b> Wealth First Portfolio Managers, ₹924cr, independent wealth management, asset management and insurance broking. " + THIN_BROKER + " Quality 86, valuation 46, momentum 26, composite 84 — the second-highest composite of these 14.",
  "<b>The quality pillar is the real thing, and it now ranks against companies that do the same job.</b> <code>roce_3y</code> 38.81%, <code>roce_5y</code> 35.54% and <code>op_margin_3y</code> 78.96% are each second of the pool, in all three cases behind " + SBI + ". Among businesses that actually broke and advised, those are the best capital returns in the cluster. <code>roe_3y</code> 29.45% is third of 43. <code>roe_avg_above_threshold_5y</code> 1.000 — five of five years above the hurdle — with <code>_7y</code> 0.857 (6 of 7) and <code>_10y</code> 0.900 (9 of 10), fourth and fourth of the 32 names carrying the level tests. Under the lender scorecard this all read as an unlevered ROE that was 'less impressive than it looks'. On a fee scorecard it reads as what it is.",
  "<b>The deterioration is now a cluster-worst rather than a batch-worst.</b> <code>sales_yoy_q</code> -42.28% is the worst of all 39 brokers with a quarterly comparison, and <code>np_yoy_q</code> -35.28% is 36th of 39. Over the year, TTM sales +1.01% but operating profit -14.91% and net profit -8.48%, with <code>opm_now</code> 64.26% against <code>opm_prev</code> 76.29% — a -12.03pp step and the pack's one blocker here. A 76% operating margin on advisory fees was never a steady state; the point is that the direction is now established over a year and a quarter, and the quarter is the worst in a pool of 39.",
  "<b>The price has come down but not far enough to meet it.</b> <code>pe_ttm</code> 27.96x is mid-pack of the 37 brokers with a PE, but against its own ten-year band of 4.04-37.16x whose average is 16.62x it is 1.68x its own average — on falling earnings. <code>pb</code> 6.14x is 6th of 43. <code>ret_12m_rel</code> -17.35% and the close above its 200-day EMA on only 7.94% of the last 252 sessions, 27th of 32: the market started marking it down a while ago, from a long way up. <code>div_yield</code> 1.50% is 5th of the 23 payers. " + TNS,
  "<i>The honest read: this is the best operator in the cluster among the firms that genuinely broke and advised, and it is also the one with the fastest-falling revenue line in a pool of 39, at nearly 1.7x its own average multiple. Those facts cannot all be priced correctly. Hold rather than sell, because a 39% return on capital and a 1.00 five-year hurdle record is not a business that breaks in a quarter. Hold rather than add, because a -42.28% quarter at 27.96x is the market still extending credit. Two more quarters confirming the margin step makes this a reduce, and the re-peering has not changed that — it has only made the quality side of the argument stronger.</i>",
 ],
 "trigger": "sales_yoy_q returning to growth with opm_now stabilising above 64% -> the fall was deal timing in a lumpy advisory book and the best roce_3y in the cluster at 27.96x is defensible. A third consecutive quarter of falling revenue, or opm_now under 55% -> the 76% margin was the cycle, and a 6.14x book de-rates faster than the earnings fall.",
 "evidence": ["roce_3y", "roce_5y", "op_margin_3y", "roe_3y", "roe_avg_above_threshold_5y", "sales_yoy_q", "np_yoy_q", "opm_now", "opm_prev", "ttm_np_pct", "pe_ttm", "pb", "div_yield", "ret_12m_rel", "pct_above_200ema_252d"],
},

"AKCAPIT": {
 "confidence": "medium",
 "verdict": "HOLD — the steadiest profit record of the nine wealth names with a decade of data, and zero years above the return hurdle in five, seven or ten, at a PE through its own ten-year high",
 "points": [
  "<b>Not held, not on your watchlist.</b> A K Capital Services, ₹1,152cr, SEBI Category I merchant banking — debt syndication, bond and NCD placement. " + THIN_AMC + MIXED + " Quality 43, valuation 56, momentum 52, composite 35.",
  "<b>Its record is the steadiest in the pool and also the least remunerative, and those two facts are one fact.</b> <code>np_consistency_10y</code> 1.822 is the highest of the nine names carrying the index — which runs 0 to 2 and combines the share of profitable years with the inverse of profit variability, and is not a pass rate. But <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> are all 0.000: not one year in five, seven or ten averaged a return on equity above the hurdle, bottom three of the nine with the tests alongside PIONRINV and THEINVEST. <code>roe_3y</code> 9.75% is 14th of 16 and <code>roce_3y</code> 8.74% is 15th of 16. Set against HDFCAMC, NAM-INDIA and ABSLAMC, which all score 1.000 on all three windows, this is the clearest statement of what the re-peering bought: under the lender scorecard a sub-hurdle ROE was one metric among many; against asset managers it is the defining fact.",
  "<b>The trailing year is good and most of it is not operating.</b> TTM sales +15.22% and operating profit +15.37% with <code>opm_now</code> 70.35% against <code>opm_prev</code> 70.25% — a flat margin, so the top line did the work. <code>opm_now</code> 70.35% is third of 16, behind HDFCAMC's 79.65% and ICICIAMC's 73.97%, which is respectable company. But TTM net profit +34.44% is second of 16 against that +15.37% operating line: the pack flags net profit outrunning operating profit by 17%, so the difference sits below EBIT in other income, tax or interest. And cash conversion was -0.64 in FY2026 against a prior-years mean of -0.14 — reported profit is not being collected, and has not been for some time.",
  "<b>Valuation is cheap in the pool and expensive against itself.</b> <code>pe_ttm</code> 10.07x is 14th of the 15 brokers-and-managers here with a PE, which looks like deep value next to ANANDRATHI at 79.03x. Against its own history it is through the ceiling: ten years of data give a band of 2.36-9.01x averaging 4.72x, and 10.07x is <i>above the decade high</i>. The band low is not quoted — a 2.36x reading cannot be told apart from a split adjustment — but a high built on ten years is a usable ceiling and this price is past it. <code>div_yield</code> 3.44% is third of the 12 payers; <code>earnings_yield_trend</code> -0.0533 is the worst of the 12 carrying it. <code>shareholders</code> 2,825 is 15th of 16. With 133 price bars there is no 200-EMA reading, so the momentum pillar scored on 65% of its declared weight — thin, not weak. " + TNS,
  "<i>Uncomfortable read: you are paying a decade-high multiple for a business that has not cleared the return hurdle in a single one of the last ten years, and whose profit growth this year came from below the operating line while cash conversion was negative. The 3.44% dividend and the 1.822 consistency index are what make it a hold rather than an avoid — this is a boring, reliably mediocre fee business, not a deteriorating one. There is no case for adding above every print in its own ten-year history. The practical risk is the exit: 2,825 shareholders on a ₹1,152cr company.</i>",
 ],
 "trigger": "roe_3y clearing the hurdle while opm_now holds near 70% and cash conversion turns positive -> the syndication book finally translates and the decade-high multiple is a step change rather than a top. pe_ttm staying above 9x with roe_avg_above_threshold still 0.000 -> you are paying a record price for a sub-hurdle return and the dividend is the only return you get.",
 "evidence": ["np_consistency_10y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "roe_3y", "roce_3y", "opm_now", "opm_prev", "ttm_np_pct", "ttm_op_pct", "pe_ttm", "div_yield", "earnings_yield_trend", "shareholders"],
},

"ARYAMAN": {
 "confidence": "medium",
 "verdict": "HOLD — the best cash conversion and the best seven-year margin trend of the 16 wealth names, with the worst trailing revenue fall in the pool at -46.94%",
 "points": [
  "<b>Not held, not on your watchlist.</b> Aryaman Financial Services, ₹765cr, SEBI Category I merchant banking — SME IPO lead management and corporate advisory. " + THIN_AMC + MIXED + " Quality 60, valuation 71, momentum 19, composite 65.",
  "<b>Two metrics the lender scorecard never asked about are the best in the pool, and they are the right two for a fee business.</b> <code>cfo_pat_3y</code> 1.396 is the highest of all 16 — operating cash exceeding reported profit by 40% over three years, against 360ONE and NUVAMA at 0.000 — and <code>op_margin_trend_7y</code> +0.1025 is the highest of the nine with a seven-year trend. <code>fcf_yield</code> 4.76% is second of 16 behind PIONRINV. <code>np_cagr_5y</code> 58.71% is second of the 14 with a five-year series. A merchant bank that collects what it books and has widened its margin for seven years is a better object than v1's lender-scorecard view of it could show.",
  "<b>The trailing year reverses all of it.</b> <code>ttm_sales_pct</code> -46.94% is the worst of all 16, <code>ttm_op_pct</code> -29.95% is 14th and <code>sales_yoy_q</code> -30.77% is 15th. <code>opm_now</code> 61.29% against <code>opm_prev</code> 46.43% is a +14.87pp step and the pack's blocker here, and it runs the wrong way for the right reason: the margin rose because the revenue that vanished was the low-margin half. Revenue halving is the fact. The margin improvement is its arithmetic consequence, not an offset. A 58.71% five-year profit CAGR earned across the 2021-2024 small-cap issuance boom and a -46.94% year immediately after it are the same business telling you that SME issuance volume sets its earnings.",
  "<b>Cheap against its own history, and the history is of a busier market.</b> <code>pe_ttm</code> 26.00x against an own band of 12.90-65.09x averaging 29.36x — 11% below that average, and 10th of the 15 here with a PE. <code>shareholders</code> 2,215 is the lowest of all 16: there is no liquidity and no way to change your mind quickly. With 47 price bars there is no 200-EMA reading and no 9/20/50 stack at all, so the momentum pillar scored on just 35% of its declared weight — momentum 19 is a listing-history fact about this price series, not a measured downtrend. " + TNS,
  "<i>The honest read: the re-peering improves this row's case without changing its call. Best cash conversion in the pool, best seven-year margin trend, second-best five-year profit growth — and the worst revenue year of all 16, in a business whose revenue is other people's IPOs. At 26.00x on halved revenue you are paying a normal multiple for what is either a trough or a new level, and the pack cannot tell you which. Hold a position; do not build one at 2,215 shareholders. The decision variable is Indian SME issuance volume, which is a market call rather than a company call.</i>",
 ],
 "trigger": "ttm_sales_pct returning to growth with opm_now holding above 55% -> the trough was issuance timing, the 1.396 cash conversion is the tell that the business is sound, and 26.00x is cheap against a 29.36x own average. A second year of falling revenue, or cfo_pat_3y dropping under 1.0 -> the five-year CAGR was one boom, and the earnings base is far below what the multiple assumes.",
 "evidence": ["cfo_pat_3y", "op_margin_trend_7y", "fcf_yield", "np_cagr_5y", "ttm_sales_pct", "ttm_op_pct", "sales_yoy_q", "opm_now", "opm_prev", "pe_ttm", "shareholders"],
},

"CHOICEIN": {
 "confidence": "medium",
 "verdict": "HOLD — the only broker in the cluster to beat inflation in every one of the last four and six years, at 71.00x earnings, 9.68x book and zero cash conversion",
 "points": [
  "<b>Not held — CHOICEIN is on your watchlist.</b> Choice International, ₹16,186cr, retail broking and wealth management with an attached NBFC, investment bank, AMC and government-advisory arm — at ₹16,186cr the second-largest of the 14 capital-markets names re-peered out of <code>bfsi_nbfc</code> on 2026-10-22, behind CRISIL at ₹33,243cr. " + THIN_BROKER + " Quality 59, valuation 19, momentum 57, composite 32.",
  "<b>Its compounding record is the best in the cluster and the re-peering makes that claim stronger, not weaker.</b> <code>np_growth_above_inflation_5y</code> 1.000 and <code>_7y</code> 1.000 are each <i>first of the 32 brokers carrying the tests</i> — net profit beat inflation in 4 of the last 4 year-steps and 6 of 6, the denominators being N-1 because each step needs two points — and <code>_10y</code> 0.889 is 8 of 9, second of 32. It shares the 5y and 7y top spot with " + SBI + ", so among actual brokers it is alone. <code>np_cagr_5y</code> 41.97% is fourth of 33. v1 could only say this was the best of a hand-picked 16; it is the best of 32 peers.",
  "<b>The trailing year holds up, which is what separates it from the rest of the re-peered group.</b> TTM sales +26.47%, operating profit +33.72%, net profit +32.48%, with <code>opm_now</code> 35.28% against <code>opm_prev</code> 33.37% — a +1.91pp step. Twelve of those 14 rows carry a margin-step or earnings-quality blocker of some kind — CHOICEIN's own is a cash-conversion flag rather than a margin break — so a business whose margin barely moved while profit grew a third is the most informative single fact here. <code>roe_3y</code> 16.33% and <code>roce_3y</code> 17.65% are both 16th of 43 — unremarkable, and earned without the balance-sheet distortion the old scorecard was reading.",
  "<b>Everything good about it has been paid for, and the cash is not arriving.</b> <code>pe_ttm</code> 71.00x is the second-highest of the 37 brokers with a PE, behind only AVONMORE's 95.58x, and <code>pb</code> 9.68x is fifth of 43. There is no own-history anchor: its ten-year band low of 1.82x cannot be told apart from a split adjustment, so there is no way to say whether 71x is high or normal for this stock. Against that, <code>cfo_pat_3y</code> 0.000 puts it in the bottom nine of 42, all nine tied at the floor, and cash conversion was -0.64 in FY2026 — three years in which operating cash did not arrive at all, in a business with a lending arm that consumes it. <code>fii_pct</code> 10.10% is fifth of 36 and the close held above its 200-day EMA on 63.10% of the last 252 sessions, fourth of 32. " + TNS,
  "<i>The uncomfortable part: the best compounding record of 32 brokers belongs to the second-most-expensive one, whose three-year cash conversion is zero. A perfect 4-of-4 and 6-of-6 inflation record deserves a premium — but 71.00x earnings and 9.68x book on retail broking means two years of lower market turnover takes a third off the earnings and the multiple at once, and a business that reports profit without collecting it has no cushion when that happens. Hold if you own it. Adding at 71x requires believing Indian retail participation only goes one way, which is the assumption this entire cluster is built on and which none of its 43 members has been tested through a bear market.</i>",
 ],
 "trigger": "cfo_pat_3y turning positive while opm_now holds near 35% -> the profit is real cash, the inflation record is structural, and 71.00x is a growth multiple rather than a cycle multiple. Market turnover falling with opm_now under 28%, or cash conversion staying negative -> a 9.68x book on broking revenue de-rates far faster than the earnings fall, which is how every broker in this cluster has previously broken.",
 "evidence": ["np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "np_cagr_5y", "opm_now", "opm_prev", "ttm_np_pct", "roe_3y", "roce_3y", "pe_ttm", "pb", "cfo_pat_3y", "fii_pct", "pct_above_200ema_252d"],
},

"AFSL": {
 "confidence": "medium",
 "verdict": "HOLD — the highest FII stake of all 43 brokers and 0.82x book at 8.87x earnings, where the +427.79% revenue line is bullion turnover at a 0.80% margin",
 "points": [
  "<b>Not held, not on your watchlist.</b> Abans Financial Services, ₹1,030cr, the ABANS Group holding entity — PMS, AIFs and GIFT City fund management alongside commodity, bullion and multi-currency dealing. " + THIN_BROKER + MIXED + " Quality 50, valuation 90, momentum 65, composite 72.",
  "<b>The revenue line should be discounted almost entirely, and the cluster rank makes that unmistakable.</b> <code>ttm_sales_pct</code> +427.79% is the highest of the 36 brokers with a trailing comparison — next is INDOTHAI at +217.64% — while <code>opm_now</code> 0.80% is 34th of 37 and <code>op_margin_3y</code> 5.83% is 38th of 43. A five-fold revenue increase that takes the operating margin under one percent is gross bullion and commodity turnover being booked as revenue: volume passing through the books, not business being won. Read the growth as a reporting artefact and the margin as its consequence. <code>ev_sales_ttm</code> 0.047 — 37th of 40 — is the same fact seen from the valuation side.",
  "<b>Underneath the artefact the valuation is real and someone has done the work.</b> <code>pe_ttm</code> 8.87x is 32nd of 37 and <code>pb</code> 0.82x is 39th of 43 — priced below book while the cluster's quality names trade at multiples of it. <code>fii_pct</code> 20.71% is <i>the highest of all 36 brokers with a reading</i>, ahead of IIFLCAPS at 15.34% and 5PAISA at 15.11%, which is unusual at ₹1,030cr and is the single most interesting fact on the row. <code>fcf_yield</code> 13.13% is fifth of 41, <code>cfo_pat_3y</code> 1.136 seventh of 42, and <code>earnings_yield_trend</code> +0.0155 second of 34. The cash side of this business is genuinely good.",
  "<b>Its quality record is short rather than bad, and the price has done nothing at all.</b> It is the mature-tier anomaly here: <code>np_consistency_5y</code> 1.822 is first of the five brokers with a five-year index, but there is no ten-year consistency reading, no <code>np_growth_above_inflation_*</code> and no <code>roe_avg_above_threshold_*</code> at all — the hurdle and inflation questions are unanswered on this row rather than passed, and composite 72 is built without them. <code>ret_12m_rel</code> +8.30% while the close held above its 200-day EMA on 3.17% of the last 252 sessions, 29th of 32 — a stock that has gone nowhere for a year and spent essentially all of it below its own trend. " + TNS,
  "<i>The honest read: strip the pass-through revenue and you have a sub-book financial trading and fund-management group at 8.87x with the highest foreign ownership in its cluster, 13% free cash yield, and a price that has not moved in twelve months. That is interesting and it is not a buy, because a 0.80% operating margin means one bad trading year takes earnings to zero and there is no fee annuity underneath — and the eight-year history is too short to tell you how often that happens. Hold, treat the revenue growth as noise, and note that 20.71% FII at this size means the institutional holder is the liquidity risk as well as the endorsement.</i>",
 ],
 "trigger": "opm_now recovering toward 4% while sales growth normalises -> the mix is turning back toward fee and agency income and 0.82x book at 8.87x is plainly cheap. opm_now staying under 1% with pb under 0.8x, or fii_pct falling sharply -> the market is pricing a trading book that can lose a year's earnings in a quarter, and the one institutional validator is leaving.",
 "evidence": ["ttm_sales_pct", "opm_now", "opm_prev", "op_margin_3y", "ev_sales_ttm", "pe_ttm", "pb", "fii_pct", "fcf_yield", "cfo_pat_3y", "earnings_yield_trend", "np_consistency_5y", "ret_12m_rel", "pct_above_200ema_252d"],
},

# ----------------------------------------------------------------------- watch

"PRIMESECU": {
 "confidence": "medium",
 "verdict": "WATCH — worst of all 16 wealth names on four separate measures at once, composite down 61 to 15, with the price still above its 200-day EMA on three-quarters of the year",
 "points": [
  "<b>Not held — PRIMESECU is on your watchlist.</b> Prime Securities, ₹952cr, investment banking, corporate advisory and wealth management. " + THIN_AMC + MIXED + " Quality 27, valuation 55, momentum 41, composite 15 — the lowest of the 14 capital-markets names re-peered out of <code>bfsi_nbfc</code> on 2026-10-22, and down from 61 before the re-peering.",
  "<b>It is the worst row in its pool on four measures, and they are the four that matter.</b> <code>opm_now</code> 10.22% is the lowest of all 16, <code>ttm_np_pct</code> -87.29% the lowest, <code>ttm_op_pct</code> -72.08% the lowest, and <code>np_yoy_q</code> -80.82% the lowest. Not bottom-quartile — last, four times. <code>opm_now</code> 10.22% against <code>opm_prev</code> 41.85% is a -31.63pp step, the largest single-year margin break of the 14 re-peered names and the pack's first blocker here. The quarter confirms the year rather than softening it, and cash conversion was -0.10 in FY2026 against a prior mean of +0.23. There is no <code>pe_ttm</code> at all: the earnings base has effectively gone, so the valuation pillar scored on 45% of its declared weight.",
  "<b>The long record is genuinely respectable, which is the whole tension.</b> <code>roe_avg_above_threshold_10y</code> 0.500 — five of ten years above the hurdle — is fourth of the nine names with the test, and <code>np_consistency_10y</code> 1.657 is sixth of nine. That is a middling-to-decent decade, not a chronic underperformer. An advisory firm with that history and one catastrophic year is a different proposition from one that was always marginal, and the re-peering sharpened this rather than changing it: against asset and wealth managers the decade reads ordinary where against lenders it read strong.",
  "<b>But the price is behaving as though nothing happened.</b> The close held above its 200-day EMA on 74.21% of the last 252 sessions — fifth of the 11 with the reading — and <code>ret_12m_rel</code> +2.80% is positive and sixth of 12. The stock is near its highs while operating profit fell 72% and the margin fell 32 points. Its own ten-year PE band of 7.00-59.23x averaging 21.04x is quotable and cannot be applied: there is no current E to compare it to. " + TNS,
  "<i>The uncomfortable answer first: this is the one row in the batch where the market's price and the company's accounts are telling opposite stories, and no number in the pack resolves which is right. A deal-driven advisory book can lose 87% of its profit to mandate timing and get it back in one transaction — or the fee pipeline is gone and the price has not found out. Watch rather than act, because a position taken now is a bet on which of those it is, taken at no discount whatsoever. Look at the next quarter's revenue line, not its profit line. The composite falling 61 to 15 on re-peering is not new information about the company; it is the old number having been flattering.</i>",
 ],
 "trigger": "opm_now recovering above 30% with np_yoy_q turning positive -> the collapse was mandate timing, the five-of-ten hurdle decade is the real business, and the price was right to ignore it. A second quarter near 10% margins while the close stays above its 200-day EMA -> the gap between accounts and price closes downward, and 74.21% above-EMA becomes the risk rather than the comfort.",
 "evidence": ["opm_now", "opm_prev", "ttm_np_pct", "ttm_op_pct", "np_yoy_q", "roe_avg_above_threshold_10y", "np_consistency_10y", "pct_above_200ema_252d", "ret_12m_rel", "sales_yoy_q"],
},

"ASHIKAG": {
 "confidence": "medium",
 "verdict": "WATCH — the re-peering deleted the reorganisation artefact that was inflating its quality pillar, and quality fell 72 to 46 with nothing put in its place",
 "points": [
  "<b>Not held, not on your watchlist.</b> Ashika Global Securities, ₹2,830cr, an RBI-registered NBFC-ICC holding company doing broking, loans against securities, investment banking and wealth — formerly Ashika Credit Capital Ltd. " + THIN_BROKER + MIXED + " Quality 46, valuation 25, momentum 54, composite 42 — down from 76.",
  "<b>The previous verdict's central finding has been fixed by deletion, and that is worth stating plainly.</b> v1 showed that <code>loan_book_cagr_3y</code> 370.51% and <code>book_value_cagr_3y</code> 314.40% were identical to four decimal places to the figures carried by the dead ASHIKA ticker — the same accounts read twice through a corporate reorganisation — and that <code>quality_pct</code> 72 was built on them. The broker scorecard does not compute either metric. So the artefact is gone from the score, quality fell to 46, and the composite fell 76 to 42. The surviving fragment is <code>np_cagr_3y</code> 137.35%, first of the five brokers with a three-year series, and it is the same artefact: do not read it as performance.",
  "<b>What the right scorecard now shows is a business that does not convert.</b> <code>cfo_pat_3y</code> 0.000 is 35th of 42 and cash conversion was -0.67 in FY2026; <code>fcf_yield</code> -5.75% is 38th of 41; <code>op_margin_trend_3y</code> -0.0959 is the worst of the six brokers with a three-year margin trend. <code>op_margin_3y</code> 63.20% is sixth of 43 and should be read with care — a holding company booking interest and investment income has a high margin by construction. <code>roe_3y</code> 9.50% is 28th of 43 and <code>roce_3y</code> 11.60% is 30th.",
  "<b>Almost nothing else is measurable yet.</b> Six completed quarters means no TTM-versus-prior comparison at all; 130 price bars means no 200-EMA reading, so the momentum pillar scored on 65% of its declared weight; there are no delivery-volume rows; and there is no own-history PE band, so <code>pe_ttm</code> 37.68x — 10th of 37 — has no anchor against its own past. <code>shareholders</code> 4,572 is 39th of 41. The one hard fact worth watching is ownership: the promoter stake moved from 58.00% to <code>promoter_pct</code> 74.32% in a single quarter, fifth-highest of 41, and promoters buying a sixth of the company is a real signal in a name where no other signal is yet trustworthy. " + TNS,
  "<i>The honest answer is unchanged and now better evidenced: this company has not existed in its current form long enough to be valued. The scorecard used to read a reorganisation as 370% book growth and award a 72 quality pillar for it; on the right scorecard the artefact simply is not asked about, and what shows instead is zero three-year cash conversion and the worst margin trend of the six brokers measurable on it. At 37.68x with no own-history band, six quarters of accounts and no delivery data, any verdict here is a guess dressed as analysis. Watch four more quarters. The promoter move to 74.32% is what makes it worth waiting for rather than skipping.</i>",
 ],
 "trigger": "Four more quarters of clean accounts with cfo_pat_3y turning positive -> the reorganisation washes out, the metrics start measuring the business, and 37.68x can actually be assessed. The promoter stake falling back toward 58%, or cash conversion staying at zero -> the one trustworthy signal reverses and there is nothing left to wait for.",
 "evidence": ["np_cagr_3y", "cfo_pat_3y", "fcf_yield", "op_margin_trend_3y", "op_margin_3y", "roe_3y", "roce_3y", "pe_ttm", "promoter_pct", "shareholders"],
},

# ----------------------------------------------------------------- speculative

"ALGOQUANT": {
 "confidence": "medium",
 "verdict": "SPECULATIVE — second-highest book multiple of all 43 brokers at 15.22x, where the entire +102.77% profit growth is an 11pp margin step on 15.77% revenue growth",
 "points": [
  "<b>Not held, not on your watchlist.</b> Algoquant Fintech, ₹2,047cr, broking and financing in Indian capital markets — formerly Hindustan Everest Tools, incorporated 1962 and renamed in November 2021. A tool manufacturer that became a trading firm four years ago. " + THIN_BROKER + MIXED + " Quality 75, valuation 10, momentum 84, composite 58.",
  "<b>The headline growth is margin, not revenue, and that distinction decides the row.</b> <code>ttm_np_pct</code> +102.77% is third of the 32 brokers with a trailing comparison and <code>ttm_op_pct</code> +95.64% second — on <code>ttm_sales_pct</code> of only +15.77%, 12th of 36. The gap is <code>opm_now</code> 26.89% against <code>opm_prev</code> 15.91%: a +10.98pp step in one year, the pack's blocker here. Doubling profit on 16% more revenue means the margin did the work, and an 11-point margin move at a proprietary dealing operation is a result, not a trend.",
  "<b>On returns it leads the cluster; on price it leads by more.</b> <code>roe_3y</code> 30.70% is second of all 43 and <code>roce_3y</code> 30.57% third, in both cases behind " + SBI + " — so among genuine brokers it is first on both. And <code>pb</code> 15.22x is also second of 43, behind the same misfiled AMC. You are paying fifteen times book for a 31% return on that book, which prices roughly a decade of the current return continuing. <code>valuation_pct</code> 10 is the lowest of these 14 and the number is not an artefact of the old scorecard: <code>pe_ttm</code> 45.05x is sixth of 37 and <code>ev_sales_ttm</code> 7.44x tenth of 40.",
  "<b>And the pillars behind composite 58 are thin on both sides.</b> With 207 price bars and three years of history there is no 200-EMA reading, no own-history PE band, and no <code>earnings_yield_trend</code>, <code>fcf_yield</code> or <code>div_yield</code> — the valuation pillar scored on 60% of its declared weight and the momentum pillar on 65%. <code>np_cagr_3y</code> 16.57% is fourth of the five brokers with a three-year series. What the row cannot tell you is where the trading profit comes from: an algorithmic book earns from strategies whose edge decays, and the pack has no visibility into strategy concentration, leverage within the book, or whether one volatile year produced the margin step. That is not a data-collection gap; no fundamental pack can close it for this business model. " + TNS,
  "<i>Uncomfortable first: a four-year-old business identity, a one-year 11-point margin step, the second-highest book multiple of 43 peers and no own-history band to anchor any of it. Those are the conditions under which a verdict is labelled speculative rather than dressed as a hold. The 30.70% return on equity is real — and 15.22x book has priced it as permanent, which for an algorithmic trading edge is the single assumption least likely to hold. The re-peering did not change the call; it replaced a meaningless comparison with a 43-name one that says the same thing more loudly. Position size is the only risk control available here.</i>",
 ],
 "trigger": "opm_now holding near 27% for four more quarters with sales growth above 20% -> the margin step was operating leverage in a scaling platform rather than one good volatility year, and the return is repeatable. opm_now reverting toward 16%, or roe_3y under 20% -> 15.22x book has nothing underneath it, and the de-rating compounds with the earnings fall.",
 "evidence": ["ttm_np_pct", "ttm_op_pct", "ttm_sales_pct", "opm_now", "opm_prev", "roe_3y", "roce_3y", "pb", "pe_ttm", "ev_sales_ttm", "np_cagr_3y"],
},

"BLBLIMITED": {
 "confidence": "medium",
 "verdict": "SPECULATIVE — the cheapest earnings and the highest free-cash yield of all 43 brokers, with the second-worst ten-year profit consistency. Composite 94 survived the re-peering, which is the uncomfortable part",
 "points": [
  "<b>Not held, not on your watchlist.</b> BLB Ltd, ₹86cr, trading and investment in shares, securities and commodities — the smallest company of these 14 and a single-segment proprietary book. " + THIN_BROKER + " Quality 41, valuation 98, momentum 67, composite 94 — the highest of these 14.",
  "<b>Composite 94 on the right scorecard is a harder fact than composite 87 on the wrong one was.</b> v1 called it a demonstration that the lender scorecard was measuring the wrong thing. It is now measured against 42 broking and dealing peers and it went <i>up</i>. The reason is the valuation pillar at 98: <code>pe_ttm</code> 4.38x is the cheapest of the 37 brokers with a PE, <code>fcf_yield</code> 41.98% is <i>the highest of all 41</i> — next is MASTERTR at 24.62% — <code>earnings_yield_trend</code> +0.0722 is the highest of 34, <code>pb</code> 0.66x is 41st of 43 and <code>ev_sales_ttm</code> 0.231 is 36th of 40. On every price measure in the scorecard it is at or near the cheap extreme, and that is a real reading rather than a lender metric misapplied.",
  "<b>The quality side says why, and the ten-year record is the indictment.</b> <code>np_consistency_10y</code> 0.578 is 31st of the 32 brokers carrying the index — an index running 0 to 2, not a pass rate, where the cluster leader STEELCITY is at 1.769. <code>roe_avg_above_threshold_10y</code> 0.100 means one year in ten above the hurdle, 21st of 32; <code>_5y</code> 0.200 is one in five. <code>op_margin_3y</code> 2.47% is 39th of 43 and <code>roe_3y</code> 7.90% is 33rd. Against that, <code>np_cagr_5y</code> 114.29% is first of 33 — and it is first off a base that was negative, which is arithmetic rather than information. Reserves ran ₹125.04cr in FY2017 to ₹120.00cr in FY2026: a decade of trading that compounded book value by nothing at all.",
  "<b>The recent prints are extreme in both directions and the base is near zero.</b> <code>np_yoy_q</code> +283.11% is fourth of 39 and <code>sales_yoy_q</code> +58.24% sixth — both measured against a FY2026 that reported a ₹18.38cr operating loss. Only five completed quarters are available, so there is no TTM-versus-prior reading; cash conversion was 0.33 in FY2026 against a prior-years mean of 73.50, which is a collapse in the ratio rather than a level. <code>promoter_pct</code> 45.77% is 33rd of 41 and <code>fii_pct</code> is 0.00%. The own-history band is refused on four usable years. " + TNS,
  "<i>Uncomfortable first: the highest composite in this batch belongs to a ₹86cr proprietary trading book whose reserves are lower than they were ten years ago, and re-peering it correctly made the score go up. That is not a scorecard failure this time — it is the scorecard honestly reporting that a company can be the cheapest thing in its cluster on five separate price measures while being nearly the least consistent earner in it. Those are the same fact. What is left after you strip the arithmetic is a tiny, almost unlevered pool of capital at 4.38x trailing earnings with a 42% free-cash yield and no demonstrated ability to compound. It is not uninvestable; it is unanalysable, which is why the label is speculative. Take it as a closed-end discount play and size it accordingly.</i>",
 ],
 "trigger": "Two or three consecutive profitable years lifting np_consistency_10y above 1.2 -> the trading book has found a repeatable process and 4.38x with a 42% free-cash yield is a genuine discount. Reserves falling below the FY2026 ₹120cr, or fcf_yield reverting toward the cluster median -> a decade of going nowhere becomes a decade of slow losses, and no multiple is low enough for that.",
 "evidence": ["pe_ttm", "fcf_yield", "earnings_yield_trend", "pb", "ev_sales_ttm", "np_consistency_10y", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_5y", "op_margin_3y", "roe_3y", "np_cagr_5y", "np_yoy_q", "sales_yoy_q", "promoter_pct", "fii_pct"],
},

# ----------------------------------------------------------------------- avoid

"VLSFINANCE": {
 "confidence": "medium",
 "verdict": "AVOID — downgraded from HOLD. The compounding book the previous verdict rested on has been shrinking: book value per share is down 21% in two years, and it has cleared the return hurdle in zero of the last seven years, worst of all 32",
 "points": [
  "<b>Not held, not on your watchlist.</b> VLS Finance, ₹667cr, proprietary investment and alternate-investments management with a broking arm. " + THIN_BROKER + " Quality 42, valuation 75, momentum 57, composite 65.",
  "<b>This is a downgrade, and it is a downgrade because the previous verdict's one supporting number does not survive being looked at over the right window.</b> v1 held it on <code>book_value_cagr_10y</code> 25.07% — a compounding balance sheet behind a 0.34x price — and the broker scorecard does not carry that metric, so I went to the annual rows. Reserves: ₹243.34cr at FY2017, peaking at ₹2,947.72cr at FY2024, and ₹2,081.81cr at FY2026. Share count fell 34.92m to 31.50m on buybacks over the same two years. <b>Book value per share went ₹854 at FY2024 to ₹671 at FY2026 — down 21.4%.</b> The ten-year CAGR is real and the two-year direction is the opposite of it. A 0.32x discount to a book that is itself falling a fifth every two years is not a discount; it is tracking.",
  "<b>The long-run return record is the worst in the cluster, and the re-peering is what revealed it.</b> <code>roe_avg_above_threshold_5y</code> 0.000 and <code>_7y</code> 0.000 are both <i>32nd of 32</i> — not one year in five, and not one in seven, averaged a return on equity above the hurdle. <code>np_cagr_5y</code> -43.28% is 33rd of 33, the worst five-year profit record of every broker with the series. <code>np_growth_above_inflation_5y</code> 0.250, <code>_7y</code> 0.333 and <code>_10y</code> 0.333 are 31st, 31st and 31st of 32. <code>roce_3y</code> 5.46% is 40th of 43 and <code>roe_3y</code> 4.59% is 36th. Under the lender scorecard these questions were asked differently and the row scored composite 43 with a hold; asked properly, it is close to last in its cluster on every long-run test there is.",
  "<b>What looks good is the current year, and the current year is a realisation artefact.</b> <code>opm_now</code> 64.51% against <code>opm_prev</code> 39.53% is a +24.98pp step, <code>ttm_np_pct</code> +93.28% is fourth of 32 and <code>ttm_op_pct</code> +47.57% fourth of 31 — on <code>ttm_sales_pct</code> -9.58%, which is 30th of 36. For a company whose revenue is portfolio realisations, that combination says it sold different things this year, not that anything improved; the pack also flags net profit outrunning operating profit by 31% and cash conversion of -0.96 in FY2026 against a prior mean of +1.11. <code>op_margin_3y</code> 64.72% is fourth of 43 and means nothing for the same reason. <code>pb</code> 0.32x is 42nd of 43 and <code>fcf_yield</code> 15.79% fourth of 41 — genuinely cheap, on genuinely shrinking capital. " + TNS,
  "<i>The uncomfortable answer: I had this as a hold on the strength of a ten-year book-growth number, and checking the two most recent years of the same series reverses the conclusion. A ten-year 25% compounder that has given back a fifth of its book in two years while clearing the return hurdle in zero of seven is not a discounted basket of assets — it is a portfolio being drawn down, and a minority holder has no way to influence that. 0.32x book is the market pricing the trajectory, not missing it. Avoid. What would change it is a corporate action — a sale, a demerger, a large buyback at this discount — not a good quarter, and ten years says management is not inclined.</i>",
 ],
 "trigger": "Reserves per share recovering above the FY2024 ₹854 with roe_avg_above_threshold_5y rising off 0.000 -> the drawdown was realisations returned to holders, the book is compounding again, and 0.32x is then the best value in the cluster. Book value per share falling below ₹600, or another year of np_cagr_5y deeply negative -> the discount is structural and the capital is being consumed rather than deployed.",
 "evidence": ["roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "np_cagr_5y", "np_growth_above_inflation_5y", "np_growth_above_inflation_10y", "roce_3y", "roe_3y", "opm_now", "opm_prev", "ttm_np_pct", "ttm_op_pct", "ttm_sales_pct", "op_margin_3y", "pb", "fcf_yield"],
},

"AVONMORE": {
 "confidence": "medium",
 "verdict": "AVOID — the most expensive of all 37 brokers carrying a PE at 95.58x, on the second-worst five-year profit record in the cluster",
 "points": [
  "<b>Not held, not on your watchlist.</b> Avonmore Capital & Management Services, ₹356cr, an RBI-registered NBFC with sub-broker advisory, debt and equity dealing and merchant banking. " + THIN_BROKER + " Quality 40, valuation 43, momentum 58, composite 26.",
  "<b>It is the most expensive thing in a 43-name cluster on the worst evidence in it.</b> <code>pe_ttm</code> 95.58x is <i>first of the 37 brokers with a PE</i> — ahead of CHOICEIN at 71.00x — while <code>np_cagr_5y</code> -29.81% is 32nd of 33, five years of profit shrinking at nearly 30% a year. <code>earnings_yield_trend</code> -1.1276 is the worst of all 34 carrying it and is out of family with everything else: the next-worst is GCSL at -0.583. The earnings yield has not drifted down, it has fallen off a cliff, which is what a near-zero earnings base does to the measure. <code>roe_3y</code> 4.64% is 35th of 43 and <code>roce_3y</code> 9.21% is 34th.",
  "<b>The long record shows it used to be a different company.</b> <code>roce_5y</code> 20.37% is 11th of 37 against <code>roce_3y</code> 9.21% at 34th — the five-year figure is more than double the three-year one, so the deterioration is recent and steep. <code>np_growth_above_inflation_7y</code> 0.667 (4 of 6 year-steps) and <code>_10y</code> 0.667 (6 of 9) are eighth and seventh of 32, which is a respectable decade. <code>roe_avg_above_threshold_5y</code> 0.400 is 13th of 32. This is a business that did clear its hurdle about as often as the cluster median and has stopped.",
  "<b>Nothing in the recent prints rescues it.</b> TTM sales +12.26% but operating profit -39.68% and net profit -42.83%, 27th and 26th of their cohorts, with <code>opm_now</code> 11.58% against <code>opm_prev</code> 21.55% — a -9.97pp step and the pack's blocker here. <code>np_yoy_q</code> +196.35% looks like a recovery and is not: a near-tripling off a base that had already collapsed leaves absolute profit far below what a 95.58x multiple assumes. The own-history band is unusable — a ten-year low of 0.11x is not a possible price-to-earnings ratio, and that single impossible number is the clearest evidence in this batch that the low end of these computed bands cannot be trusted. <code>ret_12m_rel</code> -23.05% is 28th of 35 and the close held above its 200-day EMA on 11.51% of 252 sessions, 24th of 32. The one genuinely good number is <code>cfo_pat_3y</code> 2.000, second of 42 — cash is arriving, there is just very little of it. " + TNS,
  "<i>The uncomfortable read is unchanged and now measured against the right 43: there is no version of these numbers in which 95.58x is defensible. A -29.81% five-year profit CAGR, a margin down ten points, a return on capital that has halved from its own five-year level, priced at the highest multiple in its cluster. The multiple is high because the earnings are nearly zero, not because anyone is paying for growth — which is the most dangerous kind of expensive, since one further bad quarter makes the PE infinite rather than high. Avoid.</i>",
 ],
 "trigger": "opm_now recovering above 20% with roce_3y closing toward its own 20.37% five-year level -> the collapse was cyclical, the decade is the real business, and the earnings base can grow into the multiple. np_cagr_5y staying deeply negative while pe_ttm holds near 95x -> the earnings base keeps shrinking, the multiple keeps rising mechanically, and the equity is revalued down on every print.",
 "evidence": ["pe_ttm", "np_cagr_5y", "earnings_yield_trend", "roe_3y", "roce_3y", "roce_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "roe_avg_above_threshold_5y", "opm_now", "opm_prev", "ttm_np_pct", "np_yoy_q", "ret_12m_rel", "pct_above_200ema_252d", "cfo_pat_3y"],
},

"THEINVEST": {
 "confidence": "medium",
 "verdict": "AVOID — last of all 16 wealth names on return on equity, return on capital and operating margin simultaneously, and the cheapest of them on sales, which is the only thing in its favour",
 "points": [
  "<b>Not held, not on your watchlist.</b> The Investment Trust of India, ₹470cr, ITI Group — asset management, broking, lending and investment banking. " + THIN_AMC + MIXED + " Quality 35, valuation 66, momentum 27, composite 25.",
  "<b>It is last in its pool on the three measures that define a fee business.</b> <code>roe_3y</code> 4.31%, <code>roce_3y</code> 8.72% and <code>op_margin_3y</code> 23.88% are each <i>16th of 16</i>, and <code>roce_5y</code> 7.19% is 14th of 14 — last on that too. <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> are all 0.000, bottom three of the nine with the tests, and <code>np_consistency_10y</code> 1.434 is ninth of nine. Set against HDFCAMC at 81.6% operating margin and ICICIAMC at 100.4% return on capital, this is not a cyclical trough; four percent on equity for three years and seven percent on capital for five is the business.",
  "<b>The price has agreed for a year and the latest year made the record worse.</b> <code>ret_12m_rel</code> -29.42% is 11th of the 12 with the reading and the close held above its 200-day EMA on 1.98% of the last 252 sessions, 10th of 11 — below its own trend for 98% of a year. TTM sales -22.28% is 15th of 16 and operating profit -45.84% is 15th, with <code>opm_now</code> 17.47% against <code>opm_prev</code> 25.07%, a -7.60pp step. The pack flags four separate earnings-quality problems on this row — the margin step, net profit holding up 57% better than operating profit (so the profit is coming from below EBIT), cash conversion of -2.87 in FY2026, and that conversion having fallen from a prior mean of +0.50. More blockers than any other row in these 14.",
  "<b>Cheapness is the entire counter-argument and it is not enough.</b> <code>ev_sales_ttm</code> 1.317 is the cheapest of all 16 — the pool median is around 8x — and <code>pe_ttm</code> 14.10x is 13th of 15. <code>cfo_pat_3y</code> 0.983 is third of 16, which reads well until you note the FY2026 conversion of -2.87 sitting inside it. <code>np_cagr_5y</code> 108.88% is first of the 14 with a five-year series and is first off a near-zero base: in FY2021 net profit was ₹1.58cr. The own-history PE band is refused — a 365.21x high built on a near-zero earnings base is arithmetic, not information. " + TNS,
  "<i>The uncomfortable answer: being the cheapest company in your peer group on sales while being last in it on return on equity, return on capital and operating margin at the same time is not a discount, it is the market correctly valuing capital that is being consumed slowly. A diversified financial holding company at these returns only re-rates on a sale, a demerger or a change of control, none of which this pack can see and none of which has happened in a decade. The re-peering did not change the call — it replaced four lender-scorecard comparisons with four peer-group last-places. Avoid, and note the trigger is a corporate action rather than a good quarter.</i>",
 ],
 "trigger": "roe_3y clearing 10% and cash conversion turning positive while the price reclaims its 200-day EMA -> the operating businesses have started earning and 1.32x sales is then a genuine discount rather than a verdict. roce_5y staying under 8% with the price below its trend -> the discount is permanent, the capital is not being converted into returns, and the holding is dead money.",
 "evidence": ["roe_3y", "roce_3y", "roce_5y", "op_margin_3y", "roe_avg_above_threshold_5y", "np_consistency_10y", "ret_12m_rel", "pct_above_200ema_252d", "ttm_sales_pct", "ttm_op_pct", "opm_now", "opm_prev", "ev_sales_ttm", "pe_ttm", "cfo_pat_3y", "np_cagr_5y"],
},

"PIONRINV": {
 "confidence": "medium",
 "verdict": "AVOID — the scorecard now calls it the cheapest thing in its peer group with valuation 100, on quarterly revenue down 56.24%, the worst of all 16, and profit growth sourced from outside operations",
 "points": [
  "<b>Not held, not on your watchlist.</b> Pioneer Investcorp, ₹63cr, merchant banking and dealing in government securities — the smallest company in these 14 by a wide margin. " + THIN_AMC + MIXED + " Quality 43, valuation 100, momentum 6, composite 55.",
  "<b>Lead with the disagreement: the valuation pillar is maxed and I am still saying avoid.</b> <code>valuation_pct</code> 100 is not a lender-scorecard artefact — it is the asset-manager scorecard reporting that <code>fcf_yield</code> 8.60% is the highest of all 16, <code>earnings_yield_trend</code> +0.0163 the highest of the 12 carrying it, and <code>pe_ttm</code> 8.56x the cheapest of the 15 with one. On price, measured against the right peers, nothing in the pool is cheaper. The reason to override it is in the next two points, and if those resolve the other way this is the most mispriced row in the batch.",
  "<b>The revenue is falling faster than anything else in the pool and the profit line does not offset it.</b> <code>sales_yoy_q</code> -56.24% is the worst of all 16 — next is ARYAMAN at -30.77% — and <code>np_yoy_q</code> -45.15% is 15th of 16. <code>ttm_np_pct</code> +73.72% is first of 16 and sits against <code>ttm_op_pct</code> -2.09% at 11th: the pack flags net profit holding up 77% better than operating profit, so the trailing profit growth came from below the operating line in investment gains, other income or tax, while operations went slightly backwards. The ratio that reads first-of-16 is therefore the one not to use.",
  "<b>Returns are near the bottom and the price trend is the worst-scored here.</b> <code>roe_3y</code> 5.69% is 15th of 16, <code>roce_3y</code> 8.75% is 14th and <code>roce_5y</code> 7.72% is 13th of 14, with <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> all 0.000 — zero years above the hurdle on any window. <code>momentum_pct</code> 6 is the lowest of these 14, with three-month and one-month returns of -46.07% and -34.81%. There are 131 price bars despite an old listing — the usable series starts 2026-04-20 — so there is no 200-EMA reading and the momentum pillar scored on 65% of its declared weight; the trend metrics are thin as well as adverse. There are no delivery rows at all. The own band is refused: a 151.71x high on a near-zero earnings base is arithmetic. <code>shareholders</code> 4,586 is 14th of 16 and at ₹63cr the exit is as poor as the entry. " + TNS,
  "<i>Uncomfortable first: the re-peering handed this row a perfect valuation score and I am declining it. Quarterly revenue down 56%, operating profit slightly negative, the trailing profit growth sourced from non-operating items, zero years above the return hurdle in ten, and the worst momentum reading in the batch — an 8.56x PE and an 8.60% free-cash yield do not compensate for that combination, because both are computed on an earnings base that the operating line says is not repeating. A ₹63cr company is also too small to express a view in. Avoid. If two quarters of revenue stabilise with operating profit positive, this becomes the most interesting row in the batch, and that is the honest shape of the call.</i>",
 ],
 "trigger": "sales_yoy_q returning toward flat with ttm_op_pct turning positive -> the fall was mandate timing, the 8.56x PE and 8.60% free-cash yield are real, and valuation_pct 100 was right. A second quarter of revenue down more than a third, or roce_3y staying under 9% -> the earnings base behind every cheap multiple on this row is gone and the valuation score is measuring a number that no longer exists.",
 "evidence": ["fcf_yield", "earnings_yield_trend", "pe_ttm", "sales_yoy_q", "np_yoy_q", "ttm_np_pct", "ttm_op_pct", "roe_3y", "roce_3y", "roce_5y", "roe_avg_above_threshold_10y", "ret_3m_rel", "shareholders"],
},

}


# ---------------------------------------------------------------------- guards

def guards(spec: dict, pack: dict) -> list[str]:
    """Refuse to emit a batch whose prose has drifted from its own rules.

    Every one of these fired at least once while the file was being written,
    which is the only evidence that a guard is worth keeping (CLAUDE.md §5 —
    a check nobody can make fail is decoration).
    """
    errs = []

    if set(spec) != set(CLUSTER):
        errs.append(f"spec/CLUSTER mismatch: {set(spec) ^ set(CLUSTER)}")

    expect = {"bfsi_rta_rating": THIN_RTA, "bfsi_amc_wealth": THIN_AMC,
              "bfsi_broker": THIN_BROKER}

    for sym, v in spec.items():
        pts = v["points"]
        p0 = pts[0]
        cl = CLUSTER[sym]

        # 1. Point one must carry the caveat matching its actual cluster, and
        #    must NOT carry either of the other two. v1's bug was a single
        #    hardcoded sentence; three clusters means three sentences and the
        #    wrong one is worse than none.
        if expect[cl] not in p0:
            errs.append(f"{sym}: point one lacks the {cl} re-peering sentence")
        for other, txt in expect.items():
            if other != cl and txt in p0:
                errs.append(f"{sym}: point one carries {other}'s sentence")

        # 2. The old caveat must be gone. This is the whole reason for the file.
        for pt in pts:
            if "direction, not rank" in pt:
                errs.append(f"{sym}: still carries v1's 'direction, not rank'")
            # "of the 16" is legitimate for bfsi_amc_wealth, which really does
            # have 16 members — so the v1 tell is the *batch* phrasing, not the
            # number. Explicit parens: the earlier form bound `and` tighter than
            # `or` and so flagged every amc_wealth row.
            if ("of the batch" in pt
                    or "of these 16" in pt
                    or "of the 16 capital-markets" in pt
                    or ("of the 16" in pt and cl != "bfsi_amc_wealth")):
                errs.append(f"{sym}: still ranks against the v1 16-name batch")

        # 3. No lender metric may be named anywhere. These do not exist in any
        #    of the three new scorecards, so quoting one is unverifiable prose
        #    AND an unresolvable evidence key.
        DEAD = ("loan_book_cagr", "roa_3y", "equity_to_assets", "p_aum",
                "roe_excess_13", "roe_5y", "roe_7y", "book_value_cagr")
        # A dead metric may be named in ONE case only: a point that cites it to
        # explain that the old verdict rested on it and the new scorecard does
        # not carry it. That is the honest form of a downgrade, and banning it
        # outright would force the two downgrades to hide their own reason. The
        # exemption is per-point and requires the disclaimer in the SAME point,
        # so it cannot be satisfied by a disclaimer three paragraphs away.
        OK = ("does not compute", "does not carry")
        for pt in pts:
            if any(o in pt for o in OK):
                continue
            for d in DEAD:
                if d in pt:
                    errs.append(f"{sym}: names dead lender metric '{d}' "
                                f"without saying the scorecard dropped it")
        # The verdict line and the trigger stay absolute: they are read without
        # the surrounding prose, so a bare dead metric there is a claim.
        for d in DEAD:
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead metric '{d}'")
        for d in DEAD:
            if any(d in k for k in v["evidence"]):
                errs.append(f"{sym}: evidence carries dead lender key '{d}'")

        # 4. The mixed-tier sentence must be present exactly when the scored
        #    row actually carries the badge. Both directions are errors: a
        #    missing caveat overclaims, a spurious one undermines a good row.
        st = pack[sym]["scores"]["score_status"]
        mixed = st == "partial-cluster-mixed-tiers"
        has = MIXED in p0
        if cl == "bfsi_amc_wealth" or cl == "bfsi_rta_rating":
            # THIN_AMC/THIN_RTA already say the whole pool mixes tiers, but the
            # per-row sentence still has to agree with score_status.
            pass
        if mixed != has:
            errs.append(f"{sym}: score_status={st} but MIXED sentence "
                        f"{'present' if has else 'absent'}")

        # 5. np_consistency is an index 0-2, never a pass rate (VERDICT_WRITING
        #    §3). roe_avg_above_threshold_Ny IS a rate, denominator N.
        for pt in pts:
            if "np_consistency" in pt and re.search(r"np_consistency\w*</code>\s*[\d.]+\s*(of|in)\s", pt):
                errs.append(f"{sym}: np_consistency written as a pass rate")

        # 6. Every evidence key must appear in the live cluster_metrics for
        #    this symbol, or verdict-load.py rejects the row outright. Catching
        #    it here names the symbol and the key; the loader only says which.
        live = set(pack[sym].get("_cm", {}))
        for k in v["evidence"]:
            if live and k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics")

        # 6b. A row that is actually published may not refer to a group the
        #     reader cannot see. Only CHOICEIN and PRIMESECU ship, so "these
        #     14" — which read fine when all fourteen were going out together
        #     — is now a pronoun with no antecedent on the page. The phrase is
        #     allowed only where the same point names what the 14 are. The
        #     twelve unpublished rows keep the loose form; they are a record,
        #     not a page.
        if sym in EMIT:
            for pt in pts:
                if ("these 14" in pt or "the fourteen" in pt
                        or "those 14" in pt or "the 14 " in pt):
                    if not ("capital-markets names re-peered" in pt
                            or "re-peered names" in pt
                            or "of those 14 rows" in pt):
                        errs.append(f"{sym}: refers to a 14-name group the "
                                    f"reader cannot see, unanchored")

        # 7. A downgrade must say it is one, in the verdict line, or the
        #    append-only history reads as though nothing changed.
        if sym in ("CRISIL", "VLSFINANCE") and "downgraded" not in v["verdict"].lower():
            errs.append(f"{sym}: rating changed but verdict line does not say so")

        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

    return errs


def main() -> None:
    pack_raw = json.load(open(PACK))
    pack = {d["symbol"]: d for d in pack_raw["symbols"]}
    peers = json.load(open(PEERS_JSON))
    for cl, members in peers.items():
        for m in members:
            if m["symbol"] in pack:
                pack[m["symbol"]]["_cm"] = m["cm"]

    missing = set(SPEC) - set(pack)
    if missing:
        raise SystemExit(f"pack is missing {sorted(missing)} — rebuild {PACK}")

    errs = guards(SPEC, pack)
    if errs:
        print(f"GUARD FAILED ({len(errs)}):")
        for e in errs:
            print("  " + e)
        raise SystemExit(1)

    # Scope rule, set 2026-10-22: verdicts are written only for symbols Deb
    # actually holds or is watching. Measured against app.user_watchlist and
    # app.portfolio_holding rather than taken from the prose, because the
    # prose's "on your watchlist" line is a claim like any other and the pack
    # carries no membership flag to check it against.
    #
    # The other 12 rows keep their v1 prose live and wrong — Deb's call, made
    # with the consequence stated. Their v2 text stays in SPEC and still runs
    # the guards, because deleting it would destroy the only record of how the
    # re-peering changed those calls, and SPEC is cheaper to keep than rebuild.
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
            "evidence": {k: pack[sym]["_cm"][k] for k in v["evidence"]},
            "snapshot_date": SNAPSHOT,
            "price_asof": PRICE_ASOF,
            "model": MODEL,
            "source_report": SOURCE_REPORT,
        })

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"guards passed -> {OUT} ({len(out)} verdicts)")
    for o in out:
        print(f"  {o['symbol']:<12}{o['verdict'][:84]}")


if __name__ == "__main__":
    main()
