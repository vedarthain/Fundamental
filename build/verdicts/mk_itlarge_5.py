"""it_services_large batch 1 — the five tracked large-cap IT names.

Peer set: HCLTECH, INFY, TCS, TECHM, WIPRO. The cluster's sixth member is
LTIMindtree (LTM), which is neither held nor watchlisted, so it is not written
here. This is the most homogeneous peer group written so far — five companies
selling the same thing to the same clients in the same currency — and that is
exactly what makes the one defect in it worth naming first.

Deliberate choices, recorded so the next IT batch does not re-litigate them:

1. **The cluster has six members, which is below the scoring floor, so every
   percentile here is direction, not rank — for the opposite reason to the
   capital-markets batch.** `MIN_PEERS = 10` in
   `etl/src/fundamental_etl/scoring/scorer.py`; with six names the
   `(cluster_id, maturity_tier)` bucket cannot be used and all six fall back to
   `(cluster_id, all_tiers)` and carry `score_status`
   'partial-cluster-mixed-tiers'. `_percentile_rank` is
   `round((1 - rank/(n-1)) * 100)`, so with n=6 **every per-metric percentile is
   one of {0, 20, 40, 60, 80, 100}** — a six-value lattice. The pillar
   percentiles are weighted means of those, which is why INFY reads 78 composite
   while sitting first of six: the number is not a position.

   capmkt's percentiles were untrustworthy because the cluster was *wrong*;
   these are untrustworthy because the cluster is *small*. Both get the same
   treatment — the flag goes in point one of every row and the guard enforces
   the exact sentence, so it cannot be dropped by editing prose. `main()` also
   asserts the cluster is still six names and still partial; if a seventh name
   is onboarded and the cluster crosses ten, this generator fails rather than
   silently publishing a caveat that has stopped being true.

2. **LTM is named in every row and counted in none of them.** It is the sixth
   cluster member, composite 41, and the only one of the six with no verdict
   after this batch. Every "of the five" superlative below excludes it; every
   six-name percentile caveat includes it. Writing it would mean writing a
   verdict for a symbol Deb does not track, which is the `dormant` bucket the
   Verdict tab already complains about 133 times.

3. **No sub-groups, and that is the point.** capmkt needed four because the
   cluster mixed ratings agencies with G-sec dealers. Here the five are
   genuinely comparable, so the scoping device is an explicit count instead:
   every superlative must carry "of the five", "of the six", "of the four", a
   bare `of N`, or a reference to the company's own history. That is a stricter
   guard than capmkt's sub-group phrases, not a looser one.

4. **Four own-history PE bands are quoted; WIPRO's is refused.** The rule is
   the same as capmkt: `n >= 8 and lo >= 4.0 and hi <= 100`. HCLTECH
   (7.25-26.68, avg 17.35), INFY (7.67-36.16, avg 20.90), TCS (9.11-36.25, avg
   23.93) and TECHM (13.54-46.72, avg 22.53) all pass on ten years. WIPRO has
   ten years too, but `lo` 2.77 is below the 4.0x floor and almost certainly the
   same artefact the pack's own loader warned about while building this batch:

       split_factor_dropped_no_step ... ex_date=2024-12-03 split_factors=[0.5]
       ... treating it as already vendor-adjusted and NOT applying them

   So for the cheapest name of the five, the one comparison that matters most —
   is 14.26x cheap against its own history, or normal? — cannot be made. The
   WIPRO row has to say that rather than quote a band average of 10.28x that
   would make 14.26x look expensive on a number built from a corporate action.

5. **WIPRO's holding is stated, not turned into a return.** `avg_cost` 301.50
   against `broker_ltp` 164.02 implies -45.6%, and 301.50/2 = 150.75 implies
   +8.8%. Which one is true depends on whether the broker adjusted the cost for
   the December 2024 action, and nothing in the pack or in
   `app.portfolio_holding` records that. So the row prints both figures and
   refuses the percentage. The guard rejects any "% below cost" phrasing in that
   row specifically — HCLTECH, which carries no corporate action, does state its
   -15.1%.

6. **`np_consistency_10y` is not quoted anywhere in this batch.** The five sit
   at 1.8035-1.8586 — a span of 0.055 on an index that runs 0 to 2. It
   discriminates nothing here, and quoting it would manufacture a rank out of
   noise. The guard forbids the string outright, which is a tighter rule than
   capmkt's (which allowed it with an "index, not a pass rate" disclaimer).

   The two pass rates that ARE quoted keep their denominators:
   `roe_avg_above_threshold_Ny` is **n of N** (5y->5, 7y->7, 10y->10), and
   `np_growth_above_inflation_Ny` is **n of N-1** (5y->4, 7y->6, 10y->9). Both
   directions are guarded, because getting either backwards changes the claim.

7. **The spine of the batch: `op_margin_trend_7y` is negative for all six.**
   TCS -0.14pp, INFY -0.43pp, WIPRO -0.45pp, LTM -0.51pp, TECHM -0.57pp and
   HCLTECH -0.84pp. Not one large Indian IT company has expanded its operating
   margin over seven years, while `rev_cagr_5y` across the six tops out at
   LTM's 12.83% and at HCLTECH's 11.03% among the five written here.
   That is the sector fact every row is written against: these are cash-return
   stories, not compounding stories, and the valuation question is whether the
   multiple agrees. Any row quoting the field must say "all six" — the guard
   checks it, because a single-name margin decline reads as a company problem
   and it is not one.

8. **All five are medium confidence.** Four of them carry no pack blocker at
   all, which would ordinarily allow `high` under VERDICT_WRITING §5. They do
   not get it: a six-name lattice is a real limit on every percentile in the
   row, and `tech_net_score_scaled` is NULL for all 3,178 scored symbols on the
   platform, so the momentum pillar scored on 95 of its 100 declared points
   everywhere. TECHM has the one explicit blocker — valuation on 75 of 100
   because `peg` is absent — and that is named in its point one.

9. **Delivery is unusable and not quoted.** `golden.delivery_data` holds 12
   distinct sessions in total, so any delivery percentage would be a single-day
   reading dressed as a trend. Dead metrics never quoted:
   `book_value_cagr_3y`, `p_premium`, `roe_latest`, `tech_net_score_scaled`.

10. **Two held, five watchlisted, none previously written.** HCLTECH (6 shares,
    cost 1466.80) and WIPRO (50 shares, cost 301.50) are in
    `app.portfolio_holding`; all five are in `app.user_watchlist`;
    `app.stock_verdict` returns zero rows for all five. So this batch sets no
    precedent it has to agree with, and the two held rows are the only ones
    where the call costs something today.

11. **The ROCE/ROE split is a cluster-metric fact, not an oversight.**
    `it_services_large` scores `roce_3y` and `roce_5y`; there is no `roe_3y`,
    `roa_3y`, `pb` or `equity_to_assets` in this cluster's metric set the way
    there is in `bfsi_nbfc`. Nothing below may quote a field that is not in
    `cluster_metrics`, and the evidence loop enforces it.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_itlarge_5.py
"""

import json
import re

PACK = "/tmp/itlarge5.json"
OUT = "build/verdicts/itlarge-5-verdicts.json"
GENERATED_AT = "2026-10-22T12:00:00+00:00"
SOURCE_REPORT = "it-services-large v1"
MODEL = "claude-opus-4-7"

# Choice 1. Verbatim in point one of every row; the guard checks identity, not
# a substring, so the caveat cannot be softened.
LATTICE = ("Scored inside <code>it_services_large</code>, a cluster of only six "
           "names — below the ten-peer minimum the scorer needs, so all six "
           "carry <code>score_status</code> 'partial-cluster-mixed-tiers' and "
           "every per-metric percentile can take only one of six values. Read "
           "the percentiles here as direction, not rank.")

# Choice 2.
SIXTH = ("The sixth cluster member is LTIMindtree (LTM, composite 41), which "
         "is neither held nor watchlisted and is not written in this batch: "
         "every count of five below excludes it, every six-name percentile "
         "caveat includes it.")

# Choice 8.
TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company on "
       "the platform, so the momentum pillar scored on 95 of its 100 declared "
       "points and renormalised around the components that do exist.")

# Choice 7. Required in any row that quotes op_margin_trend_7y.
SPINE = ("<code>op_margin_trend_7y</code> is negative for all six cluster "
         "members — not one large Indian IT company has expanded its operating "
         "margin over seven years")

SPEC = {

# ------------------------------------------------------------------ accumulate

"INFY": {
 "confidence": "medium",
 "verdict": "ACCUMULATE — the best composite of the six at 78, on 15.65x against its own ten-year average of 20.90x, with the only improving cash conversion of the five and the best inflation-beating record of the five — bought from a selling promoter and a shrinking FII book",
 "points": [
  "<b>Not held — INFY is on your watchlist, added 2026-09-19 at a close of ₹1,051.40.</b> Infosys Ltd, ₹473,865cr, second of the five written here by market cap, an AI-first consulting and technology services business with a 13.82% promoter holding. " + LATTICE + " Quality 64, valuation 70, momentum 46, composite 78 — the highest composite of the six, and the highest valuation percentile of the six. " + SIXTH,
  "<b>The long record is the most consistent of the five, and it is consistent on the measure that is hardest to game.</b> <code>roe_avg_above_threshold_5y</code>, <code>_7y</code> and <code>_10y</code> all read 1.0 — the average ROE cleared 13% in 5 of 5, 7 of 7 and 10 of 10 years, one of three of the five with an unbroken record on every window. <code>np_growth_above_inflation</code> is 3 of 4, 5 of 6 and 7 of 9: the best of the five on all three windows, and the gap is not small — TCS manages 4 of 9 and WIPRO 5 of 9 on the ten-year. <code>np_cagr_5y</code> 7.42% is the fastest of the five and <code>roce_5y</code> 38.32% the second-highest of the five, behind TCS's 59.28%. <code>dso</code> 71.99 days is the second-lowest of the five, behind WIPRO's 53.55.",
  "<b>The trailing year is the only clean one in the batch.</b> TTM sales +11.22%, operating profit +10.08%, net profit +11.08% — net profit growing faster than operating profit, which no other name of the five manages; everywhere else in this batch each step down the P&L is slower than the one above it. <code>opm_now</code> 23.70% against <code>opm_prev</code> 23.95% is a -0.25pp step, the smallest of the five. And <code>cfo_op_latest</code> 0.804 against a prior mean of 0.750 is the **only material improvement in cash conversion of the five**: TCS's +0.001 is flat and the other three fell, two of them sharply. " + SPINE + "; Infosys's -0.43pp is the second-flattest of the six, so it is losing margin more slowly than four of its peers rather than escaping the trend.",
  "<b>The valuation is the whole case, and the market disagrees loudly.</b> <code>pe_ttm</code> 15.65x sits inside an own ten-year band of 7.67-36.16x whose average is 20.90x — 25% below its own ten-year average. <code>peg</code> 2.11 is the lowest of the four names here carrying one, <code>ev_ebitda_ttm</code> 9.47x the second-lowest of the five, <code>fcf_yield</code> 6.34% the second-highest of the five and <code>div_yield</code> 4.10% third of the five. Against all of that: <code>ret_12m_rel</code> -17.92% is the **worst twelve-month relative return of the five**, <code>ema_stack_bull</code> is 0, the close was above its 200-day EMA on 18.25% of the last 252 sessions, <code>promoter_pct</code> has fallen 14.52 to 14.38 to 13.82 over three quarters and <code>fii_pct</code> 27.09% is down from 30.27% over the same span. " + TNS,
  "<i>The uncomfortable part is that everything attractive here is a comparison with the past and everything unattractive is a comparison with the present: cheapest-versus-own-history, best-versus-peers on records that are five to ten years old, and meanwhile it is the worst-performing stock of the five over a year, with the promoter and foreign institutions both selling into it. That is what accumulation is for — you are not being asked to believe the market is wrong today, only to buy a 25% discount to a decade average from people who want out. Accumulate in tranches rather than at market, because nothing in the price action says the selling is finished. The thing that would break the thesis is the margin: a 23.70% operating margin funds the dividend and the buybacks, and if it starts stepping down by more than a quarter-point a year the discount is not a discount.</i>",
 ],
 "trigger": "pe_ttm holding under 17x while opm_now stays above 23% and cfo_op_latest stays above 0.80 -> you are being handed a 25% discount to a ten-year average on unbroken margins and improving cash, and the promoter selling is noise. opm_now under 22%, or a second year of ttm_np_pct below ttm_sales_pct -> the 2026 cleanliness was a one-year effect and 15.65x is the correct price for a business whose margin is eroding faster than TCS's.",
 "evidence": ["roe_avg_above_threshold_10y", "np_growth_above_inflation_7y", "np_cagr_5y", "roce_5y", "dso", "opm_now", "opm_prev", "ttm_np_pct", "ttm_sales_pct", "pe_ttm", "peg", "ev_ebitda_ttm", "fcf_yield", "div_yield", "ret_12m_rel", "pct_above_200ema_252d", "promoter_pct", "fii_pct", "op_margin_trend_7y"],
},

"TCS": {
 "confidence": "medium",
 "verdict": "ACCUMULATE — a 61.17% three-year return on capital, far the highest of the five, at 17.62x against its own ten-year average of 23.93x; what you are paying for is the slowest trailing profit growth of the four names here that grew at all, +4.4% and the weakest ten-year inflation record of the five",
 "points": [
  "<b>Not held — TCS is on your watchlist, added 2026-09-19 at a close of ₹2,105.00.</b> Tata Consultancy Services, ₹909,370cr — the largest of the five written here, 1.9x Infosys and 5.1x Tech Mahindra — with a Tata Group promoter holding of 71.77%. " + LATTICE + " Quality 62, valuation 58, momentum 49, composite 68 — second of the six. " + SIXTH,
  "<b>On capital efficiency it is not in the same conversation as the other four.</b> <code>roce_3y</code> 61.17% and <code>roce_5y</code> 59.28% are the highest of the five by a factor of 1.6 over Infosys's 37.98% and 3.4x over Wipro's 17.86%. <code>op_margin_3y</code> 26.73% and <code>opm_now</code> 26.45% are both the highest of the five, and <code>roe_avg_above_threshold</code> clears 13% in 5 of 5, 7 of 7 and 10 of 10 years. " + SPINE + "; TCS's -0.14pp is the flattest of the six, which on a seven-year view makes it the only one of the five that has roughly held its margin rather than conceded it.",
  "<b>The trailing year is where the discount comes from, and it is a real problem rather than a timing one.</b> TTM net profit +4.39% is the slowest growth of the four names of the five whose trailing profit grew at all — only Wipro's, at -2.42%, is worse — against TTM sales +9.92% and TTM operating profit +8.78% — profit growing at under half the rate of revenue, with <code>opm_now</code> 26.45% versus <code>opm_prev</code> 26.72% accounting for only a fraction of the gap. <code>np_growth_above_inflation</code> is 2 of 4, 3 of 6 and 4 of 9: the weakest ten-year record of the five, which says a 61% ROCE has been compatible with mediocre per-share progress for a decade. <code>cfo_ebitda_3y</code> 0.66 is the lowest of the five and <code>dso</code> 92.56 days the highest of the five; <code>cfo_op_latest</code> 0.720 against a prior mean of 0.719 is flat, so the cash is neither a tell nor a comfort.",
  "<b>Valuation and momentum point the same way, which is unusual and useful.</b> <code>pe_ttm</code> 17.62x sits in an own ten-year band of 9.11-36.25x averaging 23.93x — 26% below its own ten-year average, the widest discount to own history of the four names here with a quotable band. <code>ev_ebitda_ttm</code> 11.30x, <code>peg</code> 2.73, <code>div_yield</code> 4.38% the second-highest of the five, <code>fcf_yield</code> 4.88% the second-lowest of the five, ahead only of Tech Mahindra's 3.47%. The price action is the most washed-out of the five: the close was above its 200-day EMA on just 4.37% of the last 252 sessions — 11 sessions out of 252, the fewest of the five — with <code>ret_12m_rel</code> -11.06% and <code>fii_pct</code> 9.07% down from 11.48% a year ago while the promoter stake has not moved at all. " + TNS,
  "<i>The uncomfortable read: you are buying the best business of the five at a 26% discount to its own history precisely because its earnings growth has become ordinary, and nothing in this pack tells you the growth comes back. What makes it worth owning anyway is that a 61% return on capital with a 4.38% dividend does not need growth to pay you — it needs only to not break, and a -0.14pp seven-year margin trend is the strongest evidence in this batch that it is not breaking. Accumulate; do not expect re-rating to do the work. The specific thing to watch is the profit-versus-revenue gap: +4.4% profit on +9.9% revenue for a second year means the margin story I just credited is over.</i>",
 ],
 "trigger": "ttm_np_pct recovering above 8% while opm_now holds above 26% -> the one-year profit lag was wage and currency timing, and 17.62x on a 61% ROCE is the cheapest quality in the batch. A second year of ttm_np_pct under 6%, or opm_now under 25% -> the discount to a 23.93x own average is the market correctly repricing a business that has stopped growing per share, and the dividend is the whole return.",
 "evidence": ["roce_3y", "roce_5y", "op_margin_3y", "opm_now", "opm_prev", "op_margin_trend_7y", "roe_avg_above_threshold_10y", "np_growth_above_inflation_10y", "ttm_np_pct", "ttm_op_pct", "ttm_sales_pct", "cfo_ebitda_3y", "dso", "pe_ttm", "ev_ebitda_ttm", "peg", "div_yield", "fcf_yield", "pct_above_200ema_252d", "ret_12m_rel", "fii_pct", "promoter_pct"],
},

# ------------------------------------------------------------------------ hold

"HCLTECH": {
 "confidence": "medium",
 "verdict": "HOLD — held about 15.1% below cost; the fastest five-year revenue growth of the five and the best price action of the four non-Mahindra names, but 20.80x against its own ten-year average of 17.35x and the steepest seven-year margin decline of the six",
 "points": [
  "<b>Held — 6 shares at a recorded average cost of ₹1,466.80 against a broker LTP of ₹1,244.85, about 15.1% below cost, first seen 2026-07-16; HCLTECH is also on your watchlist, added 2026-08-11 at a close of ₹1,365.40.</b> HCL Technologies, ₹381,053cr, third of the five written here by market cap, HCL Group promoter holding 60.88%. " + LATTICE + " Quality 56, valuation 54, momentum 58, composite 59 — third of the six. " + SIXTH,
  "<b>It grows faster than the other four and that is not a small thing in this cluster.</b> <code>rev_cagr_5y</code> 11.03% is the fastest of the five — 2.8x Wipro's 3.96% — and TTM sales +12.76% is the second-fastest of the five, behind Tech Mahindra's +13.60%. <code>roce_3y</code> 29.71% is third of the five, and <code>roe_avg_above_threshold</code> clears 13% in 5 of 5, 7 of 7 and 10 of 10 years: one of three of the five with an unbroken record on every window. <code>np_growth_above_inflation</code> is 2 of 4, 3 of 6 and 5 of 9 — middling, and the gap between 11.03% revenue growth and a 5-of-9 inflation record is the whole argument of the next point.",
  "<b>The growth is being bought with margin, and the cash is going the wrong way.</b> <code>op_margin_trend_7y</code> -0.84pp is the **steepest decline of the six** — " + SPINE + ", and HCL Technologies is conceding it fastest. <code>opm_now</code> 20.60% against <code>opm_prev</code> 21.17% continues that in the trailing year, so TTM net profit +7.92% lags TTM operating profit +9.69%, which in turn lags TTM sales +12.76%: each step down the P&L is slower than the one above it. <code>cfo_op_latest</code> 0.747 against a prior mean of 0.855 is a 0.108 deterioration, the second-largest of the five behind Tech Mahindra's 0.223, and <code>dso</code> 88.46 days is the second-highest of the five. Fast revenue converting to slower profit converting to slower cash is a describable pattern, not three unrelated numbers.",
  "<b>And unlike the two accumulates, it is not cheap against itself.</b> <code>pe_ttm</code> 20.80x against an own ten-year band of 7.25-26.68x averaging 17.35x — 20% **above** its own ten-year average, and one of only two of the four quotable bands trading above its own average (the other is Tech Mahindra at a far greater premium). <code>peg</code> 3.87 is the second-highest of the four names carrying one, <code>ev_ebitda_ttm</code> 11.07x third of the five, <code>div_yield</code> 3.85% fourth of the five and <code>fcf_yield</code> 5.42% third of the five. The price action is the best of the four names outside Tech Mahindra: <code>ret_12m_rel</code> -2.21%, <code>ema_stack_bull</code> 1, and the close above its 200-day EMA on 35.32% of the last 252 sessions, the second-highest of the five. <code>fii_pct</code> 14.90% is down from 19.15% five quarters ago, with domestic institutions taking the other side at 18.75%. " + TNS,
  "<i>The honest read on a position you already own: the reason to hold rather than add is that you are paying a 20% premium to the stock's own decade average for the fastest-eroding margin of the six and a cash conversion that fell 0.108 in a year. The reason to hold rather than sell is that it is also the fastest-growing of the five with an unbroken ten-year ROE record and the best momentum of the four names that are not Tech Mahindra — none of which is consistent with a business in trouble. Practically, 6 shares at ₹7,469 is too small for this call to matter to your portfolio; the decision that matters is whether you would add, and the answer is not at 20.80x. If you want more large-cap IT exposure, INFY and TCS are both at discounts to their own history and this one is not.</i>",
 ],
 "trigger": "opm_now recovering above 21.2% while rev_cagr stays near 11% -> the margin was the cost of winning share and the premium multiple is earned; add. pe_ttm above 20x with opm_now under 20.5% or cfo_op_latest under 0.75 for another year -> you are paying a premium for declining quality, and the proceeds belong in INFY at 15.65x.",
 "evidence": ["rev_cagr_5y", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "roce_3y", "roe_avg_above_threshold_10y", "op_margin_trend_7y", "opm_now", "opm_prev", "dso", "pe_ttm", "peg", "ev_ebitda_ttm", "div_yield", "fcf_yield", "ret_12m_rel", "ema_stack_bull", "pct_above_200ema_252d", "fii_pct", "dii_pct"],
},

# ---------------------------------------------------------------------- reduce

"WIPRO": {
 "confidence": "medium",
 "verdict": "REDUCE — the cheapest multiple, the highest dividend and the best cash conversion of the five, bought with the slowest revenue growth of the five, the only falling trailing profit of the five, an ROE that cleared 13% in 2 of the last 5 years, and a domestic-institutional holding that has fallen by more than a third in two quarters",
 "points": [
  "<b>Held — 50 shares at a recorded average cost of ₹301.50 against a broker LTP of ₹164.02, first seen 2026-07-16; WIPRO is also on your watchlist, added 2026-08-25 at a close of ₹180.09.</b> No percentage gain or loss is stated here on purpose: Wipro's price history carries a 2024-12-03 corporate action with a factor of 0.5 that the evidence pack's loader explicitly declined to apply (<code>split_factor_dropped_no_step</code>, treating the vendor series as already adjusted), and nothing in the holdings record says whether the broker adjusted the average cost for it. Unadjusted the position is 45.6% down; halved it is 8.8% up. Wipro Ltd, ₹186,916cr, fourth of the five written here, promoter holding 72.59%. " + LATTICE + " Quality 51, valuation 67, momentum 37, composite 50 — fourth of the six. " + SIXTH,
  "<b>What is cheap is genuinely cheap, and it is cheap on cash rather than on earnings.</b> <code>pe_ttm</code> 14.26x, <code>ev_ebitda_ttm</code> 9.10x and <code>ev_sales_ttm</code> 2.03x are all the lowest of the five; <code>div_yield</code> 6.17% and <code>fcf_yield</code> 7.63% are both the highest of the five, and the dividend alone is 1.5x Infosys's. The operating quality behind that cash is the best in the batch on two measures: <code>cfo_ebitda_3y</code> 0.80 is the highest of the five and <code>dso</code> 53.55 days is the lowest of the five by 18 days over Infosys's 71.99. **Its own-history PE band is not quotable**, which matters more here than anywhere else in this batch: the ten-year low reads 2.77x, below the 4.0x floor this batch uses, almost certainly the same December 2024 action — so for the cheapest name of the five, the question of whether 14.26x is cheap against its own history simply cannot be answered from this data.",
  "<b>It is cheap because it is the only one of the five that is not growing.</b> <code>rev_cagr_5y</code> 3.96% is the slowest of the five and less than four-tenths of HCL Technologies' 11.03%; <code>np_cagr_5y</code> 1.92% is the second-slowest of the five, ahead only of Tech Mahindra's -3.58%. TTM net profit -2.42% is the **only negative trailing net profit of the five**, against TTM sales +8.22% (also the slowest of the five) and TTM operating profit +5.24%; <code>np_yoy_q</code> -1.40% is the only negative quarter of the five, so the quarter confirms the year rather than softening it. <code>roe_avg_above_threshold</code> is the worst of the five on every window — 13% was cleared in 2 of 5, 4 of 7 and 7 of 10 years — and <code>np_growth_above_inflation</code> 1 of 4 is the worst five-year inflation record of the five. <code>roce_3y</code> 17.86% and <code>roce_5y</code> 17.81% are both the lowest of the five, and <code>peg</code> 7.42 is the highest of the four names carrying one.",
  "<b>Domestic institutions reached this conclusion two quarters before you did.</b> <code>dii_pct</code> has gone 8.38 to 7.86 to 5.22 across three quarters — down by more than a third, the sharpest institutional exit of the five by a wide margin, at a time when domestic institutions were adding to Infosys and HCL Technologies. <code>fii_pct</code> 8.85% is the lowest of the five. The price agrees: <code>ema_stack_bull</code> 0, one of two of the five whose moving averages are not stacked bullishly; <code>ret_6m_rel</code> -4.60% is the only negative six-month relative return of the five; <code>ret_12m_rel</code> -16.37%; and the close was above its 200-day EMA on 12.70% of the last 252 sessions — 32 sessions out of 252. <code>shareholders</code> 3,041,147 is the most of the five, so there is no liquidity constraint on acting. " + SPINE + "; Wipro's -0.45pp is middling, which is the one place it does not stand out. " + TNS,
  "<i>The uncomfortable answer first: this is the one position in the batch I would actively shrink, and the valuation percentile of 67 is the reason it is tempting not to. A 6.17% dividend and a 7.63% free-cash yield do bound the downside, and that is why this is reduce and not sell. But what you own is the slowest-growing and only profit-shrinking name of the five, with the worst ten-year return record of the five, being sold by the domestic institutions who know it best — and because the own-history band is corrupted by a corporate action, I cannot even tell you that 14.26x is cheap relative to its own past. Cheap-on-cash with no growth is a value trap unless the cash is returned, and the cash here is being returned, which is the whole argument for keeping some. Take the position down; put the proceeds in TCS or INFY, both of which are at discounts to their own histories rather than to their peers.</i>",
 ],
 "trigger": "ttm_np_pct back above zero with ttm_sales_pct above 10% and dii_pct stabilising -> the trailing year was a trough in a cash-rich business and a 6.17% yield at 14.26x is worth holding in full. Another quarter of negative np_yoy_q, or dii_pct under 5% -> the cheapness is a declining business being correctly priced and the dividend is funding your exit, not your return.",
 "evidence": ["pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "div_yield", "fcf_yield", "cfo_ebitda_3y", "dso", "rev_cagr_5y", "np_cagr_5y", "ttm_np_pct", "ttm_sales_pct", "ttm_op_pct", "np_yoy_q", "roe_avg_above_threshold_5y", "np_growth_above_inflation_5y", "roce_3y", "roce_5y", "peg", "dii_pct", "fii_pct", "ema_stack_bull", "ret_6m_rel", "ret_12m_rel", "pct_above_200ema_252d", "shareholders", "op_margin_trend_7y", "promoter_pct"],
},

# ----------------------------------------------------------------------- avoid

"TECHM": {
 "confidence": "medium",
 "verdict": "AVOID — the best-performing stock of the five over twelve months and the one not to own: 32.19x against its own ten-year average of 22.53x, on the lowest operating margin of the five, the only negative five-year profit CAGR of the five, and a 36% jump in reported operating profit whose cash conversion fell 0.223 in the same year",
 "points": [
  "<b>Not held — TECHM is on your watchlist, added 2026-10-04 at a close of ₹1,533.00.</b> Tech Mahindra, ₹177,899cr, the smallest of the five written here, Mahindra Group promoter holding 34.96%. " + LATTICE + " Quality 44, valuation 34, momentum 68, composite 32 — the lowest composite of the six and the highest momentum percentile of the six. One pack blocker, and it lands on the pillar this verdict leans on: the **valuation pillar scored on 75 of its 100 declared points**, renormalised around a missing <code>peg</code> (25 points) — Tech Mahindra is the only one of the five without a PEG, because the five-year profit CAGR it would divide by is negative. That is why this row is medium rather than high confidence. " + SIXTH,
  "<b>The momentum is real and it should be stated before anything else, because it is the reason this is a difficult call rather than an easy one.</b> <code>ret_12m_rel</code> +30.47% is the only positive twelve-month relative return of the five and sits 32.7pp above the next best; <code>ret_6m_rel</code> +33.66% and <code>ret_3m_rel</code> +20.46% are both the highest of the five. The close was above its 200-day EMA on 52.78% of the last 252 sessions — 133 sessions out of 252, the most of the five — with <code>ema_stack_bull</code> 1. The fundamentals behind that are the best trailing set in the batch: TTM sales +13.60%, TTM operating profit +36.13% and TTM net profit +23.22% are all the highest of the five, and <code>opm_now</code> 17.19% against <code>opm_prev</code> 14.34% is a +2.85pp step, the only margin expansion of the five.",
  "<b>Every one of those numbers is a recovery from the worst base of the five, not a new level.</b> <code>op_margin_3y</code> 12.57% is the lowest of the five by 6.80pp over Wipro's 19.37%, and even after a +2.85pp year <code>opm_now</code> 17.19% is still the lowest of the five. <code>np_cagr_5y</code> -3.58% is the only negative five-year profit CAGR of the five. <code>roe_avg_above_threshold</code> clears 13% in 4 of 5, 6 of 7 and 9 of 10 years — better than Wipro's and worse than the other three — and <code>np_growth_above_inflation</code> is 2 of 4, 4 of 6 and 6 of 9. So a +36.13% operating-profit year restores a company to the bottom of its peer group; it does not move it up the group. " + SPINE + ", and Tech Mahindra's -0.57pp is fifth of the six.",
  "<b>And the cash did not follow the profit, in the one year when the profit moved most.</b> <code>cfo_op_latest</code> 0.683 against a prior mean of 0.906 is a fall of 0.223 — by far the largest of the five, more than double HCL Technologies' 0.108 — in the same twelve months that reported operating profit rose 36.13%. Profit up sharply, cash conversion down sharply is the textbook accrual pattern, and it is the single fact that makes this AVOID rather than HOLD. The price gives it no room: <code>pe_ttm</code> 32.19x is the highest of the five and 43% above its own ten-year average of 22.53x inside a band of 13.54-46.72x; <code>ev_ebitda_ttm</code> 14.08x is the highest of the five; <code>div_yield</code> 2.54% and <code>fcf_yield</code> 3.47% are both the lowest of the five. Ownership is split: <code>dii_pct</code> 36.92% is the second-highest of the five behind Infosys's 42.78% and is up from 32.13% a year ago, while <code>fii_pct</code> 18.66% is down from 23.28% over the same span — domestic institutions are buying the recovery and foreign ones are selling it. " + TNS,
  "<i>The uncomfortable answer: the best-performing stock of the five over the last year is the one I would not buy, and I may well be early rather than right — DII buying and a 133-session run above the 200-day EMA say a lot of people with better channel information disagree. The case against is not the recovery, it is the price of the recovery. You pay 43% above a decade average and the highest EV/EBITDA of the five for the lowest operating margin of the five, the only negative five-year profit CAGR of the five, and a 36% operating-profit jump whose cash conversion went the other way by 0.223. Any two of those three would be survivable; together they mean there is no margin left for the recovery being timing rather than structure. This is AVOID, not a short thesis: if the margin holds for two more quarters and the cash catches up, it becomes a legitimate HOLD at a lower multiple.</i>",
 ],
 "trigger": "opm_now holding above 17% for two more quarters with cfo_op_latest back above 0.85 -> the turnaround is structural, the accrual worry was working-capital timing, and the only remaining objection is the multiple. opm_now slipping back under 15%, or cfo_op_latest under 0.70 for a second year -> the 36.13% operating-profit year was accrual-led, and a 32.19x multiple on the lowest margin of the five has a long way to fall.",
 "evidence": ["ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "ema_stack_bull", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "opm_now", "opm_prev", "op_margin_3y", "np_cagr_5y", "op_margin_trend_7y", "roe_avg_above_threshold_5y", "np_growth_above_inflation_10y", "pe_ttm", "ev_ebitda_ttm", "div_yield", "fcf_yield", "dii_pct", "fii_pct", "promoter_pct"],
},

}

DERIVED_KEYS = {"pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
                "delivery_pct", "pledge_pct"}

LABELS = ("BUY", "ACCUMULATE", "HOLD", "WATCH", "AVOID", "REDUCE", "SELL",
          "SPECULATIVE")

# Choice 1. Asserted against the pack, not trusted from this comment.
CLUSTER = "it_services_large"
CLUSTER_SIZE = 6
MIN_PEERS = 10          # scorer.py:48 — if the cluster crosses this, re-decide
LTM = "LTM"             # choice 2: the sixth member, deliberately unwritten

# Choice 2, continued. LTM is not in PACK — it is untracked, so the batch pack
# was built for five symbols. But four claims in this file are scoped "of the
# six", and the first version of this generator checked the all-six margin
# claim against the five symbols it could see: a check that could not fail on
# the only name it needed to cover (CLAUDE.md §5). These figures come from a
# separate single-symbol evidence pack built 2026-10-22 from the same
# 2026-10-21 snapshot, and they are what the "of the six" claims rest on.
# Ordinal positions within the six are re-derived in check_itlarge_5.py.
LTM_FACTS = {
    "composite_pct": 41,
    "quality_pct": 52,
    "valuation_pct": 40,
    "momentum_pct": 46,
    "op_margin_trend_7y": -0.005139914250017399,
    "rev_cagr_5y": 0.1282576461552174,
}

# Choice 3. A superlative is allowed only where the point it sits in names its
# peer set by an explicit count, or points at the company's own history.
SCOPE_PHRASES = ("of the five", "of the six", "of the four", "of the three",
                 "of the two", "own history", "own ten-year", "own decade",
                 "own past", "in the batch", "of this batch", "in this batch")
SCOPE_COUNT = re.compile(r"of (?:the |those |only |just )?\d+")
SUPERLATIVES = ("highest", "lowest", "cheapest", "best", "worst", "fastest",
                "slowest", "richest", "smallest", "largest", "biggest",
                "steepest", "flattest", "sharpest", "widest",
                "most expensive", "most consistent", "washed-out")

# Choice 4. n >= 8 AND lo >= 4.0 AND hi <= 100.
BAND_QUOTABLE = {"HCLTECH", "INFY", "TCS", "TECHM"}
BAND_RULE = (8, 4.0, 100.0)

# Choice 10.
HELD = {"HCLTECH", "WIPRO"}
WATCHLISTED = {"HCLTECH", "INFY", "TCS", "TECHM", "WIPRO"}

# Choice 5. WIPRO's cost basis cannot be turned into a return, and the guard
# refuses the phrasings that would.
NO_RETURN = {"WIPRO"}
RETURN_PHRASES = re.compile(r"(below cost|above cost|down \d|up \d|paper loss)")

# Choice 7. Any row quoting the field must say the trend is cluster-wide.
SPINE_FIELD = "op_margin_trend_7y"


# Choice 6. Every "n of N" within reach of one of these anchors must use that
# anchor's denominators. Written as an allow-list rather than a hunt for the
# one wrong phrasing: the first version of this guard searched for the literal
# string capmkt happened to use ("beat inflation in 3 of the last 4 years"),
# and this batch phrases it "is 3 of 4", so the guard matched nothing and
# passed green on a deliberately corrupted denominator. A check that cannot
# fail (CLAUDE.md §5), caught only because it was negative-tested.
PASS_RATE_ANCHORS = (
    ("inflation", {4, 6, 9}, "np_growth_above_inflation_Ny is n of N-1 "
                             "(5y->4, 7y->6, 10y->9)"),
    ("13%", {5, 7, 10}, "roe_avg_above_threshold_Ny is n of N "
                        "(5y->5, 7y->7, 10y->10)"),
)
N_OF_N = re.compile(r"\b\d+ of (?:the last )?(\d+)\b")


def _pass_rate_denominators(sym, body):
    """Choice 6. Both pass rates, both directions, both guarded.

    A window stops at the next anchor, not at a fixed length: WIPRO's point
    three states both pass rates in one sentence, and a flat 140-char window
    from "13%" swallowed the inflation rate's 1-of-4 and failed it against the
    ROE denominators.
    """
    starts = sorted(m.start() for a, _, _ in PASS_RATE_ANCHORS
                    for m in re.finditer(re.escape(a), body))
    for anchor, allowed, rule in PASS_RATE_ANCHORS:
        for m in re.finditer(re.escape(anchor), body):
            nxt = next((s for s in starts if s > m.start()), len(body))
            window = body[m.end():min(nxt, m.end() + 140)]
            for hit in N_OF_N.finditer(window):
                n = int(hit.group(1))
                if n not in allowed:
                    raise SystemExit(
                        f"{sym}: {hit.group(0)!r} written within 140 chars of "
                        f"{anchor!r}, but {rule}. Allowed denominators "
                        f"{sorted(allowed)}")


def _blocker_coverage(sym, blockers, body):
    """Every blocker the pack raised has to be visible in the prose.

    Generic on purpose: the numbers are parsed out of the blocker text, so a
    name added to this batch cannot silently skip its blockers the way a
    hand-kept table would.
    """
    for b in blockers:
        m = re.search(r"scored on (\d+)% of its declared weight", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: a pillar scored on {m.group(1)}% of its "
                             f"declared weight and the prose never says so")
        m = re.search(r"only (\d+) quarters", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: only {m.group(1)} quarters and the prose "
                             f"never says so")
        m = re.search(r"(\d+) price bars", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: {m.group(1)} price bars and the prose "
                             f"never says so")
        for frag, want, label in (
                ("no delivery row", "delivery", "the missing delivery rows"),
                ("no company overview", "overview", "the missing overview"),
                ("own-history PE band", "band", "the absent PE band"),
                ("composite suppressed", "composite", "the suppressed composite"),
                ("EMA stack", "EMA stack", "the missing EMA stack")):
            if frag in b and want not in body:
                raise SystemExit(f"{sym}: blocker names {label} and the prose "
                                 f"never mentions it")


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}

    if set(rows) != set(SPEC):
        raise SystemExit(f"spec/pack mismatch: "
                         f"spec-only={sorted(set(SPEC) - set(rows))} "
                         f"pack-only={sorted(set(rows) - set(SPEC))}")

    # Choice 1, as a check that can fail. If a seventh name is onboarded and
    # the cluster crosses MIN_PEERS, the six-value lattice caveat in every row
    # stops being true — so fail here rather than publish it.
    for sym, row in rows.items():
        sc = row.get("scores") or {}
        if sc.get("cluster_id") != CLUSTER:
            raise SystemExit(f"{sym}: cluster is {sc.get('cluster_id')!r}, not "
                             f"{CLUSTER!r} — every percentile claim is rescoped")
        if sc.get("score_status") != "partial-cluster-mixed-tiers":
            raise SystemExit(f"{sym}: score_status is {sc.get('score_status')!r}. "
                             f"The batch asserts the cluster is under the "
                             f"{MIN_PEERS}-peer floor; if it no longer is, the "
                             f"'direction, not rank' caveat has to be re-decided")
        # Choice 8: the TNS boilerplate claims this field is NULL. Prove it.
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        if cm.get("tech_net_score_scaled") is not None:
            raise SystemExit(f"{sym}: tech_net_score_scaled now reads "
                             f"{cm['tech_net_score_scaled']} — the '95 of 100 "
                             f"declared points' sentence is wrong in every row")
        # Choice 7: the spine claim is that all of them are negative.
        if (cm.get(SPINE_FIELD) or 0) >= 0:
            raise SystemExit(f"{sym}: {SPINE_FIELD} is {cm.get(SPINE_FIELD)} — "
                             f"the batch spine asserts all six are negative")

    # Choice 2/7: the sixth member, which the pack cannot see. Without this the
    # "negative for all six" claim is checked against five names.
    if LTM in rows:
        raise SystemExit(f"{LTM} is now in the pack — drop LTM_FACTS and let "
                         f"the loop above check it like the other five")
    if LTM_FACTS["op_margin_trend_7y"] >= 0:
        raise SystemExit(f"{LTM}: op_margin_trend_7y is "
                         f"{LTM_FACTS['op_margin_trend_7y']} — the batch spine "
                         f"claims all six are negative and it is not")
    if f"composite {LTM_FACTS['composite_pct']}" not in SIXTH:
        raise SystemExit(f"{LTM}: SIXTH quotes a composite that is not "
                         f"{LTM_FACTS['composite_pct']}")

    # Choice 4: the band rule, checked against the pack rather than trusted.
    n_min, lo_min, hi_max = BAND_RULE
    for sym, row in rows.items():
        band = row.get("pe_band") or {}
        ok = (band.get("n") or 0) >= n_min and \
             (band.get("lo") or 0) >= lo_min and \
             (band.get("hi") or 1e9) <= hi_max
        if ok and sym not in BAND_QUOTABLE:
            raise SystemExit(f"{sym}: band {band} now passes the rule but is "
                             f"excluded from BAND_QUOTABLE — the row refuses a "
                             f"comparison it is entitled to make")
        if not ok and sym in BAND_QUOTABLE:
            raise SystemExit(f"{sym}: band {band} fails n>={n_min}, "
                             f"lo>={lo_min}, hi<={hi_max} and the row quotes it")

    out = []
    for sym, s in SPEC.items():
        row = rows[sym]
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        scores = row.get("scores") or {}
        blockers = row.get("blockers") or []
        points, verdict, trig = s["points"], s["verdict"], s["trigger"]
        conf = s["confidence"]
        body = " ".join(points)

        if len(points) != 5:
            raise SystemExit(f"{sym}: {len(points)} points, expected 5")
        if verdict.split(" —")[0] not in LABELS:
            raise SystemExit(f"{sym}: label must open with one of {LABELS}, "
                             f"got {verdict[:20]!r}")
        if len(verdict.split("—", 1)[1].strip()) < 30:
            raise SystemExit(f"{sym}: headline says nothing after the label")

        # Choice 8: no high confidence in a six-name cluster.
        if conf != "medium":
            raise SystemExit(f"{sym}: {conf} confidence. Every row in this "
                             f"batch is medium — a six-value percentile lattice "
                             f"and a universe-wide NULL momentum component are "
                             f"limits on the whole batch, not on one row")

        if not points[-1].startswith("<i>"):
            raise SystemExit(f"{sym}: the last point is not italicised")
        for i, p in enumerate(points[:-1]):
            if not p.startswith("<b>"):
                raise SystemExit(f"{sym}: point {i+1} has no <b> lead sentence")

        # Holding status, in point one, matched against the DB-derived sets.
        if sym in HELD and not points[0].startswith("<b>Held —"):
            raise SystemExit(f"{sym}: is held and point one does not open with it")
        if sym not in HELD and "Not held" not in points[0]:
            raise SystemExit(f"{sym}: point one does not state it is not held")
        if sym in WATCHLISTED and "watchlist" not in points[0]:
            raise SystemExit(f"{sym}: is watchlisted and point one does not say so")

        # Choice 1 and 2: the two batch-wide caveats, verbatim, in point one.
        if LATTICE not in points[0]:
            raise SystemExit(f"{sym}: point one does not carry the six-name "
                             f"percentile caveat verbatim — every percentile in "
                             f"the row is then presented as a rank it is not")
        if SIXTH not in points[0]:
            raise SystemExit(f"{sym}: point one does not name LTM as the "
                             f"unwritten sixth member, so 'of the five' is "
                             f"unexplained")
        if TNS not in body:
            raise SystemExit(f"{sym}: the row never says tech_net_score_scaled "
                             f"is NULL, so momentum 95-of-100 goes unstated")

        # Choice 7. Keyed on the evidence list as well as the prose: a row can
        # quote the -0.84pp value without naming the field, and then the
        # cluster-wide trend reads as that company's own defect. The evidence
        # list is the thing that cannot be edited away while the claim stays.
        if (SPINE_FIELD in body or SPINE_FIELD in s["evidence"]) and SPINE not in body:
            raise SystemExit(f"{sym}: quotes {SPINE_FIELD} without saying the "
                             f"decline is true of all six — a cluster-wide "
                             f"trend reads as a company defect")

        # Choice 6: the index that discriminates nothing is not quoted at all.
        if "np_consistency" in body:
            raise SystemExit(f"{sym}: quotes np_consistency. The five sit in "
                             f"1.8035-1.8586 on a 0-2 index; any rank built on "
                             f"a 0.055 span is manufactured")
        _pass_rate_denominators(sym, body)

        if sum(p.count("<code>") for p in points) < 6:
            raise SystemExit(f"{sym}: fewer than 6 <code> field names across "
                             f"the row")

        # Choice 3.
        for p in points:
            low = p.lower()
            if not any(w in low for w in SUPERLATIVES):
                continue
            if any(ph in p for ph in SCOPE_PHRASES) or SCOPE_COUNT.search(p):
                continue
            raise SystemExit(f"{sym}: a superlative with no peer set counted in "
                             f"the same point: {p[:110]!r}")

        # Choice 4, in the prose.
        quotes_band = " band of " in body or "own ten-year average" in body
        if quotes_band and sym not in BAND_QUOTABLE:
            band = row.get("pe_band") or {}
            raise SystemExit(f"{sym}: quotes an own-history band, but it fails "
                             f"the n>={n_min}, lo>={lo_min}, hi<={hi_max} rule "
                             f"(n={band.get('n')}, lo={band.get('lo')}, "
                             f"hi={band.get('hi')})")
        if sym not in BAND_QUOTABLE and "not quotable" not in body:
            raise SystemExit(f"{sym}: has no quotable band and the row never "
                             f"says so — the reader is left to assume the "
                             f"comparison was made and came out neutral")

        # Choice 5.
        if sym in NO_RETURN:
            m = RETURN_PHRASES.search(body)
            if m:
                raise SystemExit(f"{sym}: states a return ({m.group(0)!r}) on a "
                                 f"cost basis whose split adjustment is unknown")
            if "on purpose" not in body:
                raise SystemExit(f"{sym}: refuses to state a return and never "
                                 f"says that the refusal is deliberate")
        if sym in HELD and sym not in NO_RETURN:
            hold = ("avg cost" in body.lower() or "average cost" in body.lower())
            if not hold or "LTP" not in body:
                raise SystemExit(f"{sym}: is held and point one does not give "
                                 f"both the cost basis and the broker LTP")

        if trig.count("->") < 2:
            raise SystemExit(f"{sym}: trigger is one-sided — a wish, not a trigger")

        _blocker_coverage(sym, blockers, body)

        evidence = {}
        for k in s["evidence"]:
            if k in DERIVED_KEYS:
                evidence[k] = None
                continue
            if k not in cm:
                raise SystemExit(f"{sym}: evidence key {k} is not an "
                                 f"{CLUSTER} cluster metric — this cluster "
                                 f"scores roce_*, not roe_*/pb/equity_to_assets")
            v = cm[k]
            if v is None:
                raise SystemExit(f"{sym}: evidence key {k} is NULL — a verdict "
                                 f"must anchor on fields that can be re-checked")
            evidence[k] = v
        if len(evidence) < 3:
            raise SystemExit(f"{sym}: {len(evidence)} evidence keys, need 3+")

        snap = str(scores.get("snapshot_date") or pack.get("generated_at", "")[:10])
        out.append({
            "symbol": sym,
            "generated_at": GENERATED_AT,
            "verdict": verdict,
            "confidence": conf,
            "points": points,
            "trigger_text": trig,
            "evidence": evidence,
            "snapshot_date": snap,
            "price_asof": snap,
            "model": MODEL,
            "source_report": SOURCE_REPORT,
        })

    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    buckets = {}
    for r in out:
        b = r["verdict"].split(" —")[0].split(":")[0].strip()
        buckets[b] = buckets.get(b, 0) + 1
    print(f"-> {OUT}  {len(out)} rows  {buckets}")
    print(f"   cluster {CLUSTER} has {CLUSTER_SIZE} members; {LTM} deliberately "
          f"unwritten")
    for r in out:
        print(f"   {r['symbol']:<10} {r['confidence']:<6} {r['verdict'][:80]}")


if __name__ == "__main__":
    main()
