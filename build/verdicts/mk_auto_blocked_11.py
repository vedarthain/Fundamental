"""The 11 auto_oem names that cannot carry a verdict, written as rows that say
why rather than rows that guess.

Deliberate choices, recorded so the next batch does not re-litigate them:

1. Label is `WATCH — no verdict: <the specific defect>` for 9 of the 11. A
   missing field is not a bear case, and "WATCH" with no reason reads as a
   judgement the data cannot support.

   The exception, and the test for it: OLAELEC and TIL carry `kind: "AVOID"`
   because their missing earnings multiple is not a coverage failure — it is
   absent *because there are no earnings*, and that is itself the finding.
   OLAELEC has never reported a positive operating profit in six annual rows;
   TIL earned ₹5.7cr of operating profit against a ₹47.4cr interest bill. In
   both cases the row would say less if it withheld the call. The guards below
   make an AVOID row pay for the label: it must quote the deciding rupee figure
   in the label, lay out the rupee series in the points, and still name what is
   NULL. If the bear case cannot be written from the annual series alone, the
   row goes back to WATCH.
2. confidence = "low" on all 11, by construction. These rows exist because the
   inputs are untrustworthy; any other value would be the row contradicting
   itself.
3. Three points, not five. There is not enough to say.
4. **Every named defect names the field and its value.** "Data is thin" is
   useless; "pe_ttm is NULL and the valuation pillar scored 0 of its 100
   declared points" is actionable. This is Deb's standing instruction.
5. Point three is always "what IS legible" — the resolved metrics, stated as
   facts without a conclusion. A no-verdict row should still be worth reading.
6. evidence keys are non-NULL only. A NULL key is permanently uncheckable by
   the Verdict tab, and an evidence list that cannot load is decoration.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_auto_blocked_11.py
"""

import json

PACK = "build/verdicts/auto-blocked-11.json"
OUT = "build/verdicts/auto-blocked-11-verdicts.json"
GENERATED_AT = "2026-10-09T18:30:00+00:00"
SOURCE_REPORT = "auto-oem-blocked-11 v1"
MODEL = "claude-opus-4-7"

SPEC = {

"AMBAAUTO": {
 "verdict": "WATCH — no verdict: momentum unresolved, so there is no composite, and pe_ttm is NULL",
 "points": [
  "<b>Not held, and misfiled twice over.</b> Amba Auto Sales and Services, ₹199cr, is an authorised <i>dealer</i> for Bajaj Auto and LG Electronics — retail and after-sales, not manufacturing — and it is scored inside an OEM cluster. There is no composite rank at all: the momentum pillar did not resolve, so the composite is suppressed by design rather than low.",
  "<b>What specifically cannot be trusted.</b> <code>pe_ttm</code>, <code>ev_ebitda_ttm</code>, <code>ev_sales_ttm</code>, <code>peg</code> and <code>div_yield</code> are all NULL, so the valuation 50 was scored on 22 of its 100 declared points. <code>promoter_pct</code> and <code>shareholders</code> are NULL, so there is no ownership read. There are 0 usable quarters, so <code>ttm_sales_pct</code>, <code>ttm_op_pct</code> and <code>ttm_np_pct</code> are all NULL — no this-year-versus-last-year comparison exists. And 109 price bars against the ~450 the metric needs means <code>pct_above_200ema_252d</code> is absent: that is a short listing history, not a weak trend.",
  "<i>What is legible, stated without a conclusion: 13 of 33 cluster metrics resolved. Three-year ROCE 23.80% and three-year operating margin 7.37% with a positive three-year trend of 0.0309 — thin margins on fast turns, which is what a dealership is. Asset turnover 2.559. Debt/equity 2.141, largely inventory funding. Cash conversion 0.0874 of three-year profit and free-cash-flow yield -1.67%, and the pack flags FY2026 conversion at 0.13 of operating profit. 6.90x book. Three-year revenue CAGR 12.78%. No verdict until there is a quarterly series and an earnings multiple.</i>",
 ],
 "trigger": "Four usable quarters plus a resolved pe_ttm, so the valuation pillar scores on more than 22 of 100 -> re-read as a dealership on dealership multiples. Cash conversion staying under 0.40 of operating profit for another year -> the thin margin and 2.1x gearing become the finding, and no multiple is needed to reach it.",
 "evidence": ["pb", "debt_equity", "cfo_pat_3y", "op_margin_3y", "roce_3y", "asset_turnover"],
},

"ATHERENERG": {
 "verdict": "WATCH — no verdict: the valuation pillar scored 0 of its 100 declared points",
 "points": [
  "<b>Not held.</b> Ather Energy, ₹55,766cr, electric two-wheelers, battery packs and charging. The valuation percentile of 3 is not a statement that the stock is expensive — it was computed on <b>zero</b> of the pillar's 100 declared points, because every single input is NULL: <code>pe_ttm</code>, <code>pb</code>, <code>ev_ebitda_ttm</code>, <code>peg</code>, <code>fcf_yield</code> and <code>div_yield</code>. There is no own-history PE band either. On this name the platform has no valuation opinion at all.",
  "<b>The balance sheet is contaminated, and the defect is named.</b> The FY2026 annual row is a stub — sales present, balance sheet wholly NULL — which is the Shanti Gold defect, and the scorer reads those gaps as zeros. That is why <code>asset_turnover</code>, <code>cfo_pat_3y</code> and <code>debt_equity</code> do not resolve, and it holds the quality pillar to 66 of 100 declared points. Treat every balance-sheet figure here as unusable rather than absent. Separately, the pack flags the operating margin stepping +15.9 points in one year, from -23.11% to -7.24% — a move that size is a mix change or a one-off, not a trend.",
  "<i>What is legible: it is a loss-making business growing fast. Three-year operating margin -25.31%, five-year ROCE -70.57%, three-year ROCE -78.96%. Five-year revenue CAGR 73.15% and TTM revenue +67.2%, with quarterly sales +88.8%. Promoter holding 39.58%, with 16.77% foreign and 29.82% domestic institutions and 254,569 shareholders. Momentum 83 rests on 369 price bars with no 200-day EMA reading, so read it as recent strength only. No verdict while the loss is this deep and the price cannot be measured.</i>",
 ],
 "trigger": "A repaired FY2026 balance sheet plus a resolved pb and fcf_yield, so the valuation pillar scores above zero -> write a real verdict; the growth rate deserves one. The operating margin failing to keep closing toward breakeven from -7.24% -> the loss becomes the finding regardless of what the price turns out to be.",
 "evidence": ["op_margin_3y", "roce_5y", "rev_cagr_5y", "ttm_sales_pct", "promoter_pct", "shareholders"],
},

"BIKEWO": {
 "verdict": "WATCH — no verdict: composite 85 and momentum 97 rest on price returns alone",
 "points": [
  "<b>Not held.</b> Bikewo Green Tech, ₹159cr, retails and distributes electric two-wheelers and runs charging points. Composite 85 and momentum 97 are the highest-looking numbers on any of these eleven rows and both are artefacts — this is the row most likely to be misread as a buy.",
  "<b>Why the 97 carries no information.</b> The momentum pillar scored on 58 of its 100 declared points: <code>sales_yoy_q</code> and <code>np_yoy_q</code> are NULL because there are 0 usable quarters, so the percentile is built from price returns and nothing else — and those returns are <code>ret_12m_rel</code> of +606.6% and <code>ret_6m_rel</code> of +598.6% against the market. A percentile computed off a six-fold move is measuring the move, not the business. The valuation 54 is scored on 22 of 100 points, with <code>pe_ttm</code>, <code>ev_ebitda_ttm</code>, <code>ev_sales_ttm</code>, <code>peg</code> and <code>div_yield</code> all NULL, and there is no own-history PE band.",
  "<i>What is legible: 16 of 33 cluster metrics resolved. Three-year revenue CAGR 48.03% and three-year profit CAGR 39.93%, on a three-year operating margin of 9.43% whose three-year trend is slightly negative at -0.0056. Three-year ROCE 8.07% — a low return for that growth rate. Cash conversion is exactly 1.0 of three-year profit, free-cash-flow yield -3.17%, debt/equity 0.147, 3.81x book, asset turnover 1.071. <code>promoter_pct</code> and <code>shareholders</code> are both NULL, so there is no ownership or liquidity read on a ₹159cr company. No verdict.</i>",
 ],
 "trigger": "Four usable quarters and a resolved pe_ttm, with three-year ROCE above 15% -> re-read; the growth is real even if the percentiles are not. The six-month relative return unwinding while the operating margin trend stays negative -> the 97 was the whole story and there is nothing underneath it.",
 "evidence": ["pb", "debt_equity", "cfo_pat_3y", "op_margin_3y", "roce_3y", "rev_cagr_3y"],
},

"DELTIC": {
 "verdict": "WATCH — no verdict: the valuation pillar did not resolve, so there is no composite",
 "points": [
  "<b>Not held.</b> Delta Autocorp, ₹55cr, makes electric scooters and three-wheelers. There is no composite rank: the valuation pillar is unresolved, so the composite is suppressed outright rather than scored low.",
  "<b>What specifically is missing.</b> The valuation pillar reached only 12 of its 100 declared points — <code>pe_ttm</code>, <code>ev_ebitda_ttm</code>, <code>ev_sales_ttm</code>, <code>peg</code>, <code>fcf_yield</code> and <code>div_yield</code> are all NULL, leaving price-to-book of 0.685 as the only multiple that exists. There is no own-history PE band. There are 0 usable quarters, so all three TTM growth figures are NULL. And at 427 price bars against the ~450 required, <code>pct_above_200ema_252d</code> is absent by about four weeks of listing history — the momentum 48 was scored on 48 of 100 points.",
  "<i>What is legible: 14 of 33 cluster metrics resolved. It trades at 0.685x book with debt/equity of 0.0168 — effectively unlevered — and three-year ROCE of 22.91%. The three-year operating margin is 11.87% but its three-year trend is -0.0349, so the margin is falling, and three-year profit CAGR is 0.51% against revenue CAGR of 12.54% — growth that is not reaching profit. Cash conversion 0.307 of three-year profit. The stock is 49.4% behind the market over twelve months. Below book with a clean balance sheet and a falling margin is a starting point, not a verdict.</i>",
 ],
 "trigger": "A resolved pe_ttm or ev_ebitda_ttm plus four usable quarters, so the valuation pillar scores above 12 of 100 -> write a real verdict; at 0.685x book it would be worth having. The three-year operating-margin trend staying negative with profit CAGR near zero -> the discount to book is the market being right, not an opportunity.",
 "evidence": ["pb", "debt_equity", "roce_3y", "op_margin_3y", "cfo_pat_3y", "ret_12m_rel"],
},

"EBIX": {
 "verdict": "WATCH — no verdict: not an auto company, and the growth figures are base-effect arithmetic",
 "points": [
  "<b>Not held, and misfiled outright.</b> Ebix Ltd, ₹362cr, describes its core business as hospitality, securities trading, digital marketing and real estate. There is no vehicle or component activity in the overview at all, yet it is scored inside an OEM cluster — so every pillar percentile it carries was measured against carmakers. This is a classification defect, not a thin-data one, and nothing the scorecard says about it can be repaired by better coverage.",
  "<b>The growth numbers are unusable and the reason is arithmetic.</b> <code>rev_cagr_3y</code> reads 37.67 — that is 3,767% a year — and <code>ttm_op_pct</code> reads +2,934.9%, with the operating margin going from 0.2242% to 4.1331%. Those are ratios off a near-zero base, not growth, and the three-year operating-margin trend of -0.1296 points the other way. Three-year ROCE is -0.68%. The pack also flags FY2026 cash conversion at -0.23 of operating profit.",
  "<i>What is legible, and how little of it there is: the valuation 91 was scored on 25 of its 100 declared points, with <code>pe_ttm</code>, <code>pb</code>, <code>peg</code>, <code>fcf_yield</code> and <code>div_yield</code> all NULL — only EV/EBITDA of 4.653x and EV/sales of 0.490x resolve, and a 91st percentile built on two enterprise multiples against manufacturers is meaningless. <code>cfo_pat_3y</code> and <code>debt_equity</code> are NULL. There are 39 price bars, so no 200-day EMA and no 9/20/50 stack, and no delivery row. Promoter holding 42.70%, 23,516 shareholders. No verdict, and it should not be in this cluster.</i>",
 ],
 "trigger": "Reclassification out of auto_oem into a cluster that matches the hospitality and financial-services business -> re-read from scratch against the right peers. It stays in auto_oem and the 91st valuation percentile keeps being computed against carmakers off two enterprise multiples -> read the row as no signal at all rather than as cheap, however much data arrives.",
 "evidence": ["ev_ebitda_ttm", "ev_sales_ttm", "op_margin_3y", "roce_3y", "asset_turnover", "promoter_pct"],
},

"GURUNANAK": {
 "verdict": "WATCH — no verdict: composite 75 on 14 of 33 metrics, and cash conversion of -0.76",
 "points": [
  "<b>Not held.</b> Gurunanak Agriculture India, ₹40cr — the second-smallest of these eleven, behind Victory Electric Vehicles at ₹33cr. Composite 75 and quality 73 look respectable and rest on 14 of 33 cluster metrics resolving. There is also no company overview, so there is no qualitative read at all: what this company actually does is not in the data.",
  "<b>What specifically cannot be trusted.</b> The valuation 59 was scored on 22 of its 100 declared points — <code>pe_ttm</code>, <code>peg</code>, <code>ev_ebitda_ttm</code>, <code>ev_sales_ttm</code> and <code>div_yield</code> are all NULL — and there is no own-history PE band. There are 0 usable quarters, so <code>ttm_sales_pct</code>, <code>ttm_op_pct</code> and <code>ttm_np_pct</code> are NULL and <code>opm_now</code> and <code>opm_prev</code> with them: the current-year direction is unknown. 230 price bars against ~450 means no 200-day EMA reading, and the momentum 47 scored on 30 of 100 points. <code>promoter_pct</code>, <code>fii_pct</code>, <code>dii_pct</code> and <code>shareholders</code> are all NULL — no ownership read on a ₹40cr company.",
  "<i>The one hard fact runs against the 73. Cash conversion was -0.76 of operating profit in FY2026 against a prior-years mean of 0.47 — a deterioration, not a level, which points at receivables and inventory. Free-cash-flow yield -5.52%. Against that: 0.852x book, debt/equity 0.0441, three-year ROCE 33.52% and a three-year operating margin of 19.23% with a positive trend of 0.0518. But three-year revenue CAGR is -2.43% — the business is not growing. No verdict: the quality percentile and the cash flow disagree, and there is not enough here to settle it.</i>",
 ],
 "trigger": "Cash conversion back above the 0.47 prior-years mean, with four usable quarters and a company overview on file -> re-read; at 0.85x book and 33% ROCE it would deserve a real look. Another year of negative operating cash -> the -0.76 is the level, and the composite 75 is an artefact of what is missing.",
 "evidence": ["pb", "debt_equity", "roce_3y", "op_margin_3y", "cfo_pat_3y", "fcf_yield"],
},

"MERCURYEV": {
 "verdict": "WATCH — no verdict: a PE band of 2.69x to 705.54x, and a stub balance-sheet year",
 "points": [
  "<b>Not held.</b> Mercury EV-Tech, ₹704cr. It is one of only two of these eleven that has an own-history PE band at all, and the band is useless: 4 usable years running from <b>2.69x to 705.54x</b> with an average of 255.24x. Current <code>pe_ttm</code> is 180.52x. There is no reading of that range that tells you whether 180x is cheap or dear — treat the band as unusable rather than as context. EV/EBITDA is 252.45x. There is also no company overview.",
  "<b>The balance sheet is contaminated and the defect is named.</b> The FY2026 annual row is a stub — sales present, balance sheet wholly NULL — the Shanti Gold defect, with the scorer reading the gaps as zeros. That is why <code>pb</code>, <code>debt_equity</code>, <code>asset_turnover</code> and <code>fcf_yield</code> are all NULL, and it holds the valuation pillar to 73 of 100 declared points and quality to 84. <code>cfo_pat_3y</code> comes back as exactly 0.0 and the pack flags FY2025 conversion at -5.39 of operating profit, so there is no usable cash figure either.",
  "<i>What is legible: this year is going backwards. TTM net profit -47.59% and operating profit -32.44% on revenue up only 4.21%, with the operating margin at 5.59% against 8.62% a year ago and a three-year mean of 9.17% — the three-year margin trend is -0.0405. Three-year ROCE 3.06%. Three-year revenue CAGR of 115.3% and profit CAGR of 44.9% are base effects behind that. Promoter holding 59.17%, 75,062 shareholders, 93 price bars so no 200-day EMA. No verdict while the only price anchor spans 260-fold.</i>",
 ],
 "trigger": "A repaired FY2026 balance sheet giving a resolved pb and debt_equity, with operating margin back above the 9.17% three-year mean -> re-read. Another year of falling operating profit at 180x earnings -> the conclusion does not need the PE band to be fixed.",
 "evidence": ["pe_ttm", "ev_ebitda_ttm", "cfo_pat_3y", "op_margin_3y", "roce_3y", "promoter_pct"],
},

"OLAELEC": {
 "kind": "AVOID",
 "verdict": "AVOID — six straight years of operating losses, and the latest year halved revenue while still losing ₹1,833cr",
 "points": [
  "<b>Not held, and the missing earnings multiple is the finding rather than a gap.</b> Ola Electric Mobility, ₹17,162cr, electric scooters and lithium-ion cells. <code>pe_ttm</code>, <code>peg</code> and <code>ev_ebitda_ttm</code> are NULL and there is no own-history PE band — but not because coverage failed. The company has never reported a positive operating profit: the six annual rows run -₹277cr, -₹800cr, -₹1,252cr, -₹1,266cr, -₹1,735cr and -₹978cr. There is no numerator for a multiple to divide into, and there never has been. Composite 15 on quality 12, valuation 24, momentum 28.",
  "<b>Revenue is now going backwards too, which is what changes this from a loss-making growth story to an avoid.</b> Sales went ₹2,631cr → ₹5,010cr → ₹4,514cr → ₹2,253cr: the last year is half the peak. TTM revenue -49.16%, quarterly sales -45.05%, three-year revenue CAGR -32.94%. The operating margin is -48.94% against -47.89% a year earlier and a three-year mean of -35.70%, with the three-year trend at -0.0907 — the loss per rupee of sales is widening as the sales shrink. Interest is ₹360cr a year against no operating profit. Three-year ROCE -25.18%, free-cash-flow yield -11.50%, debt/equity 0.825.",
  "<i>What would have to be true for this to work, and is not: scale. At 5.12x book, 12.77x EV/sales and asset turnover of 0.289, the price is paying for volume growth that has reversed. Promoters have taken their holding from 36.78% to 32.96% across the last four quarters while 1.94 million retail shareholders sit on the register. It has lagged the market 36.2% over twelve months and spent 15.1% of the year above its 200-day EMA, with the 9/20/50 stack not bullish. Confidence is low because <code>cfo_pat_3y</code>, <code>np_cagr_3y</code> and <code>ttm_np_pct</code> are NULL — the quality pillar carries 82 of 100 points — but the absence of those three does not point the other way.</i>",
 ],
 "trigger": "Revenue growth turning positive with the operating margin closing toward breakeven from -48.94% -> re-read; a resolved EV/EBITDA would follow on its own, and the avoid comes off. Another year of contraction at a widening loss -> the ₹17,162cr of market value is being set by the cell-factory story rather than by the P&L, and the gap closes downward.",
 "evidence": ["pb", "debt_equity", "op_margin_3y", "fcf_yield", "roce_3y", "ttm_sales_pct", "ev_sales_ttm"],
},

"TIL": {
 "kind": "AVOID",
 "verdict": "AVOID — ₹5.7cr of operating profit against ₹47.4cr of interest, on 3.4x gearing at 18.6x book",
 "points": [
  "<b>Not held, and not data-blocked — it is the best-covered name on this list.</b> TIL Limited, ₹2,064cr, material-handling and crane equipment, listed since 1995. 34 of 40 cluster metrics resolve. <code>pe_ttm</code> and <code>peg</code> are NULL, and the own-history PE band is useless at 1.11x to 536.38x over 5 years, but the reason is legible: the latest year earned ₹5.7cr of operating profit and paid ₹47.4cr of interest, for a net loss of ₹30.8cr. The lenders have taken the entire operating profit in each of the last seven years — the last time it covered its interest bill was three years into a ten-year record.",
  "<b>The one good-looking number is an artefact, and here is which one.</b> Three-year ROCE reads 40.13% against five-year ROCE of -22.30%. That gap is a single row: a year with -₹74.6cr of operating profit and +₹253.9cr of net profit — a non-operating gain, not trading. Strip it and the three-year operating margin of -35.14% is the honest figure. <code>cfo_pat_3y</code> is exactly 0.0 and the pack flags FY2026 cash conversion at <b>-15.46</b> of operating profit: the reported profit is not being collected at all. The ROE threshold was cleared in 1 of the last 10 years, 1 of 7 and 1 of 5.",
  "<i>What the price is asking for. Debt/equity 3.444, 18.59x book, EV/EBITDA 92.61x, free-cash-flow yield -4.76% — a balance sheet that needs equity priced as though the turn has already happened. The recent operating lines are genuinely better: TTM operating profit +81.98% on revenue +21.29%, margin 5.00% against 3.34%. That is real, and it is still not enough to cover ₹47.4cr of interest. Promoter holding fell from 70.12% to 61.30% over the last two quarters. 14,689 shareholders, and no delivery row to read the flow. Confidence is low because <code>ttm_np_pct</code> is NULL and there is no company overview — the recovery could be larger than it looks. The leverage does not care.</i>",
 ],
 "trigger": "Operating profit covering interest more than once over, with cash conversion turning positive from -15.46 -> the avoid comes off and this becomes a real recovery candidate at a sane multiple. Another year of operating profit below the interest bill on 3.4x gearing -> the equity is an option, not a holding, and 18.6x book is the wrong price for one.",
 "evidence": ["pb", "debt_equity", "ev_ebitda_ttm", "op_margin_3y", "roce_5y", "cfo_pat_3y", "roe_avg_above_threshold_10y"],
},

"TUNWAL": {
 "verdict": "WATCH — no verdict: 0 usable quarters and no earnings multiple of any kind",
 "points": [
  "<b>Not held.</b> Tunwal E-Motors, ₹149cr, electric two-wheelers. Score status is partial-cluster-mixed-tiers, 18 of 34 cluster metrics resolve, and there is no company overview — so the qualitative read is financials-only.",
  "<b>What specifically is missing.</b> <code>pe_ttm</code>, <code>peg</code>, <code>ev_ebitda_ttm</code> and <code>ev_sales_ttm</code> are all NULL, which leaves price-to-book of 1.188 as the only multiple and holds the valuation 42 to 27 of its 100 declared points; there is no own-history PE band. There are 0 usable quarters, so <code>sales_yoy_q</code>, <code>np_yoy_q</code>, <code>opm_now</code>, <code>opm_prev</code> and all three TTM growth figures are NULL — the momentum 37 was scored on 58 of 100 points, from price returns alone. <code>promoter_pct</code>, <code>fii_pct</code>, <code>dii_pct</code> and <code>shareholders</code> are NULL, so there is no ownership or liquidity read.",
  "<i>What is legible: five-year ROCE 22.75% and three-year 22.99% — consistent, and the best five-year figure on this list. Five-year revenue CAGR 38.59% and profit CAGR 53.05%, on a three-year operating margin of 10.40% whose trend is flat at 0.0012. Against that, cash conversion is 0.24 of three-year profit and free-cash-flow yield is -16.50%, so the growth is being funded rather than self-financing. Debt/equity 0.216, 1.188x book, dividend yield 0.39%. It has lagged the market 21.6% over twelve months and spent 18.7% of the year above its 200-day EMA. No verdict until a quarterly series exists.</i>",
 ],
 "trigger": "Four usable quarters plus a resolved pe_ttm, with cash conversion above 0.50 -> write a real verdict; a 22.75% five-year ROCE at 1.19x book would deserve one. Free-cash-flow yield staying near -16% while revenue grows -> the growth is consuming the balance sheet and the missing multiple is beside the point.",
 "evidence": ["pb", "debt_equity", "roce_5y", "op_margin_3y", "cfo_pat_3y", "fcf_yield", "rev_cagr_5y"],
},

"VICTORYEV": {
 "verdict": "WATCH — no verdict: 14 of 33 metrics, no earnings multiple, and cash conversion of -3.54",
 "points": [
  "<b>Not held.</b> Victory Electric Vehicles International, ₹33cr — the smallest name in the cluster. 14 of 33 cluster metrics resolve and there is no company overview, so the qualitative read is financials-only.",
  "<b>What specifically cannot be trusted.</b> <code>pe_ttm</code>, <code>peg</code>, <code>ev_ebitda_ttm</code>, <code>ev_sales_ttm</code> and <code>div_yield</code> are all NULL, leaving price-to-book of 0.692 as the only multiple and holding the valuation 50 to 22 of its 100 declared points; there is no own-history PE band. There are 0 usable quarters, so all three TTM figures and both operating-margin readings are NULL. 177 price bars against ~450 means no 200-day EMA, and the momentum 36 scored on 30 of 100 points. <code>promoter_pct</code> and <code>shareholders</code> are NULL — no ownership or liquidity read on a ₹33cr company.",
  "<i>What is legible, and it is not encouraging. Cash conversion was -3.54 of operating profit in FY2026 against a prior-years mean of 0.85 — a deterioration, not a level — and free-cash-flow yield is -15.35%. The business is shrinking: three-year revenue CAGR -18.41% and three-year profit CAGR -33.69%, with the three-year operating-margin trend at -0.0130. Against that, three-year ROCE is 29.38% and the three-year operating margin 14.19%, debt/equity is 0.0392 and it trades at 0.692x book. A clean balance sheet below book, with revenue and profit both contracting and cash going out. No verdict.</i>",
 ],
 "trigger": "Cash conversion back above the 0.85 prior-years mean with revenue growth positive, plus four usable quarters -> re-read; below book with 29% ROCE would be worth a verdict. Another year of negative free cash flow on shrinking revenue -> the discount to book is not a floor and the no-verdict becomes an avoid.",
 "evidence": ["pb", "debt_equity", "roce_3y", "op_margin_3y", "cfo_pat_3y", "fcf_yield", "rev_cagr_3y"],
},

}

DERIVED_KEYS = {"pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
                "delivery_pct", "pledge_pct"}


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}

    if set(SPEC) != set(rows):
        raise SystemExit(f"spec/pack mismatch: "
                         f"spec-only={sorted(set(SPEC) - set(rows))} "
                         f"pack-only={sorted(set(rows) - set(SPEC))}")

    out = []
    for sym, s in SPEC.items():
        row = rows[sym]
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        scores = row.get("scores") or {}
        points, verdict, trig = s["points"], s["verdict"], s["trigger"]

        # --- guards. Each one has to be able to fail; see CLAUDE.md s5.
        kind = s.get("kind", "NOVERDICT")
        if len(points) != 3:
            raise SystemExit(f"{sym}: {len(points)} points, these rows take 3")
        if kind == "NOVERDICT":
            if not verdict.startswith("WATCH — no verdict:"):
                raise SystemExit(f"{sym}: label must be 'WATCH — no verdict: <defect>'")
            if len(verdict.split(":", 1)[1].strip()) < 20:
                raise SystemExit(f"{sym}: the label names no specific defect")
        else:
            # An AVOID row in this batch is the exception: the missing field is
            # itself the finding. It has to earn that by naming the P&L, not by
            # asserting a direction. Two guards, both able to fail:
            if not verdict.startswith("AVOID — "):
                raise SystemExit(f"{sym}: kind=AVOID but label is {verdict[:30]!r}")
            if verdict.count("₹") < 1:
                raise SystemExit(f"{sym}: an AVOID label here must quote the figure "
                                 f"that decides it, not just assert a direction")
            if points[0].count("₹") + points[1].count("₹") < 4:
                raise SystemExit(f"{sym}: an AVOID row must lay out the rupee series "
                                 f"that makes the missing multiple irrelevant")
            if "NULL" not in points[0]:
                raise SystemExit(f"{sym}: an AVOID row must still name what is NULL "
                                 f"and say why it does not change the call")
        if "Not held" not in points[0]:
            raise SystemExit(f"{sym}: point one must state it is not held")
        if not points[0].startswith("<b>"):
            raise SystemExit(f"{sym}: point one must open bold")
        if not points[-1].startswith("<i>"):
            raise SystemExit(f"{sym}: the last point must be the italic close")
        # The whole purpose of these rows: name the field, not just the shortfall.
        # An AVOID row puts the P&L in point two, so the field names move to
        # point one; a no-verdict row must carry them in point two, where the
        # defect paragraph is.
        probe = points[0] if kind == "AVOID" else points[1]
        if "<code>" not in probe:
            raise SystemExit(f"{sym}: the defect paragraph names no field in <code>")
        if sum(p.count("<code>") for p in points) < 3:
            raise SystemExit(f"{sym}: fewer than 3 named fields across the row")
        if trig.count("->") < 2:
            raise SystemExit(f"{sym}: trigger is one-sided — a wish, not a trigger")

        evidence = {}
        for k in s["evidence"]:
            if k in DERIVED_KEYS:
                evidence[k] = None
                continue
            if k not in cm:
                raise SystemExit(f"{sym}: evidence key {k} is not a cluster metric")
            v = cm[k]
            if v is None:
                raise SystemExit(f"{sym}: evidence key {k} is NULL — "
                                 f"a no-verdict row must still anchor on live fields")
            evidence[k] = v
        if len(evidence) < 3:
            raise SystemExit(f"{sym}: {len(evidence)} evidence keys, need 3+")

        snap = scores.get("snapshot_date") or pack.get("generated_at", "")[:10]
        out.append({
            "symbol": sym,
            "generated_at": GENERATED_AT,
            "verdict": verdict,
            "confidence": "low",
            "points": points,
            "trigger_text": trig,
            "evidence": evidence,
            "snapshot_date": snap,
            "price_asof": snap,
            "model": MODEL,
            "source_report": SOURCE_REPORT,
        })

    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    kinds = {}
    for sym, s in SPEC.items():
        kinds[s.get("kind", "NOVERDICT")] = kinds.get(s.get("kind", "NOVERDICT"), 0) + 1
    print(f"-> {OUT}  {len(out)} rows  {kinds}")
    for r in out:
        print(f"   {r['symbol']:<12} {r['confidence']:<6} {r['verdict'][:84]}")


if __name__ == "__main__":
    main()
