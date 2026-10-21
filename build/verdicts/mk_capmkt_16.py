"""bfsi_nbfc batch 5 — the `capital_markets` segment, written as 16 verdicts.

Peer set: `build/verdicts/bfsi_segments.py` -> SEGMENTS["capital_markets"],
minus ASHIKA (choice 2). Ratings and analytics, merchant banking and advisory,
retail broking with an attached NBFC, proprietary investment books, a G-sec
primary dealer and an asset-reconstruction company. What they share is that
**none of them is a lender in the sense the cluster scorecard assumes** — which
is the first and most important thing about this batch.

Deliberate choices, recorded so batch 6 does not re-litigate them:

1. **The cluster is misfiled and every percentile in this file is direction,
   not rank.** `docs/SCORING_DESIGN.md` is explicit that all pillar scores are
   within-cluster per-metric percentiles, computed here across all 182
   `bfsi_nbfc` names. So <code>p_aum</code>, <code>loan_book_cagr_3y</code> and
   the 13% bank-ROE track rank CRISIL — a ratings and analytics firm with no
   loan book — against balance-sheet lenders. The handoff for this batch
   asserted capital_markets was "correctly peered"; it is not, and the defect
   is the same one that blocks `holding_investment`. Deb's call was to write all
   of them anyway, with the misfiling named in point one of every row and
   superlatives restricted to named sub-groups — the treatment SANDUMA and SOTL
   got in the oil batch. The guard enforces the point-one sentence, so the flag
   cannot be dropped by editing prose.

   This is also why `quality_pct` is not quoted as a rank anywhere: CRISIL
   ranks 10th of 180 on quality yet carries `quality_pct` 74, because the
   percentile is a weighted mean of per-metric percentiles, not a position.

2. **ASHIKA is a dead ticker and the batch is 16, not the 17 the segment file
   lists.** ASHIKA and ASHIKAG share identical annual rows for four of the last
   six years and identical <code>loan_book_cagr_3y</code> 370.51%,
   <code>np_cagr_3y</code> 137.35% and <code>book_value_cagr_3y</code> 314.40%;
   ASHIKAG's overview says "Formerly known as: Ashika Credit Capital Ltd";
   ASHIKA's `identity.is_active` is False; its last price bar is 2026-07-24
   against ASHIKAG's 2026-10-20; and it is **absent from `app.scores` at the
   2026-10-08 snapshot**, last scored 2026-08-30. Writing it would have
   published six-week-stale percentiles as current. `bfsi_segments.py` still
   contains it and needs correcting on a `main` session — the assertion in
   `main()` below is written against `SEGMENTS["capital_markets"] - {"ASHIKA"}`
   precisely so that correcting the file does not break this generator.

   Second-order finding worth fixing: `scripts/verdict-evidence.py` returned
   ASHIKA's pack with no flag that its scores predate the snapshot. That is a
   check that cannot fail (CLAUDE.md §5).

3. **Four sub-groups, and every superlative names one of them or an explicit
   count.** FEE — CRISIL, AKCAPIT, ARYAMAN, PRIMESECU, WEALTH, AFSL (ratings,
   merchant banking, advisory; revenue is fees). BROKER_NBFC — CHOICEIN,
   ASHIKAG, ALGOQUANT, THEINVEST, AVONMORE (broking plus a lending or
   investment arm). PROP — BLBLIMITED, VLSFINANCE, PIONRINV (the P&L is
   realisations on an own book). DEBT_PRINCIPAL — PNBGILTS, ARCIL (principal
   risk in debt: G-sec primary dealing, distressed-asset acquisition). A
   cross-group claim like "the cheapest of the 16" is allowed because the count
   is stated; "the cheapest here" is not, and the guard rejects it.

4. **Four own-history PE bands are quoted.** The rule applied is
   `n >= 8 and lo >= 4.0 and hi <= 100`: CRISIL (10 years, 32.05-71.11, avg
   45.43), ARYAMAN (12.90-65.09, avg 29.36), PRIMESECU (7.00-59.23, avg 21.04)
   and WEALTH (4.04-37.16, avg 16.62). Refused for a sub-4x low that cannot be
   told apart from a split adjustment: AKCAPIT 2.36, CHOICEIN 1.82, VLSFINANCE
   1.43, PNBGILTS 1.91, AVONMORE 0.13 (which is not a possible PE and is the
   clearest evidence the low end of these bands is unreliable). Refused for a
   high built on a near-zero earnings base, which makes the band arithmetic
   rather than informative: PNBGILTS 441.73, THEINVEST 365.21, PIONRINV 151.71.
   Refused on n: AFSL 4 years, BLBLIMITED 4. No band at all: ALGOQUANT,
   ASHIKAG, ARCIL.

   **AKCAPIT quotes its band high alone, not the band** — <code>pe_ttm</code>
   9.88x against a ten-year high of 9.01x is the single most useful valuation
   fact in the batch and a suspect low does not impeach the high. The guard
   still refuses the phrase " band of " for it.

5. **`np_consistency_Ny` is an index from 0 to 2, not a pass rate.**
   `_np_consistency()` in `etl/src/fundamental_etl/scoring/formulas.py` returns
   (share of years with positive net profit, 0-1) + (1/(1+CV), 0-1). It must
   never be written as "n of N". BLBLIMITED's 0.58 and AKCAPIT's 1.82 are both
   quoted bare. `np_growth_above_inflation_Ny` IS a pass rate, denominator N-1
   (5y->4, 7y->6, 10y->9); `roe_excess_13_Ny` is neither — it is the mean of
   (ROE - 13%) in percentage points (VERDICT_WRITING §3).

6. **ARCIL is the one data-blocked row: 3 points, `low`, labelled `WATCH — no
   verdict`.** It listed 2026-09-17, so it has 0 completed quarters of
   TTM-versus-prior, 24 price bars against the ~450 the trend metrics need, no
   <code>pe_ttm</code>, no PE band at all, no 200-EMA reading and no company
   overview. Its **momentum pillar scored on 0 of 100 declared points**, which
   suppresses <code>composite_pct</code> entirely. Everything the row does say
   comes from the balance sheet, which reads cleanly. The label matters:
   `verdictBucket()` in `web/src/lib/verdictTypes.ts` maps any prefix it does
   not recognise to **hold**, so a row headed "NO VERDICT" would render as an
   endorsement.

7. **Nothing here is held. CHOICEIN and PRIMESECU are on the watchlist.**
   Checked `app.portfolio_holding` (empty for all 17) and `app.user_watchlist`.
   None of the 16 has a prior verdict, so this batch sets no precedent it has
   to agree with.

8. **The spine of the batch is CRISIL against everything else.** It is the only
   name here with a franchise that does not depend on market turnover: a
   regulated ratings monopoly plus Global Analytical Centre work for S&P, at
   <code>roe_7y</code> 28.49% and <code>equity_to_assets</code> 65.89%, priced
   at 36.62x against its own ten-year average of 45.43x. Everything else is
   read against it and against the question the segment really asks — whether a
   38x or 70x multiple on two good years of market volume is a business or a
   cycle. AFSL, ALGOQUANT and BLBLIMITED carry the three highest composites of
   the batch and all three are composites of the wrong scorecard; that
   disagreement is the reason this file exists.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_capmkt_16.py
"""

import json
import re

PACK = "/tmp/capmkt17.json"
OUT = "build/verdicts/capmkt-16-verdicts.json"
GENERATED_AT = "2026-10-21T12:00:00+00:00"
SOURCE_REPORT = "bfsi-nbfc capital_markets v1"
MODEL = "claude-opus-4-7"

PEERS = "the 16 capital-markets names in this peer set"

# Choice 1. Every point one carries this, and the guard checks the tail of it.
MISFILED = ("Scored inside <code>bfsi_nbfc</code> against 182 balance-sheet "
            "lenders on a scorecard built for loan books, so the percentiles "
            "below are direction, not rank.")

TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company on "
       "the platform; the momentum pillar renormalises around the components "
       "that do exist, so the percentile is a narrower question than the "
       "scorecard asks rather than a lost weight.")

SPEC = {

# ------------------------------------------------------------------ accumulate

"CRISIL": {
 "confidence": "medium",
 "verdict": "ACCUMULATE — a regulated ratings franchise at 36.62x against its own ten-year average of 45.43x, on the best seven-year return of any fee business here",
 "points": [
  "<b>Not held, not on your watchlist.</b> CRISIL Ltd, ₹32,386cr, credit ratings and research plus analytics delivered to S&P Global, which holds the 66.64% promoter stake. The largest of " + PEERS + " by a factor of two. " + MISFILED + " Quality 74, valuation 22, momentum 60, composite 81.",
  "<b>The returns are the best of the six fee-and-advisory names, and they are earned without gearing.</b> <code>roe_7y</code> 28.49% and <code>roe_5y</code> 28.60% are the highest of the 13 names here that carry a seven-year reading, on <code>roa_3y</code> 18.01% and <code>equity_to_assets</code> 65.89% — about 1.52x assets to equity, which is a fee business with a cash pile, not a balance sheet. <code>roe_excess_13_7y</code> +15.49pp and <code>roe_excess_13_10y</code> +16.03pp; with WEALTH it is one of exactly two names in the batch clearing the 13% hurdle on all three windows. <code>np_consistency_10y</code> 1.74 is second of the 12 names with the index, behind AKCAPIT's 1.82 — and that is an index from 0 to 2, not a pass rate.",
  "<b>Nothing in the trailing year is strained.</b> TTM sales +22.03%, operating profit +25.22%, net profit +21.53%, with <code>opm_now</code> 29.79% against <code>opm_prev</code> 29.04% — a +0.76pp step, small enough that the pack flags no second blocker on this row. Net profit beat inflation in 3 of the last 4 years, 4 of 6 and 5 of 9: respectable rather than spotless, and the ten-year record is the weakest of the three windows.",
  "<b>The valuation is the argument.</b> <code>pe_ttm</code> 36.62x sits inside an own ten-year band of 32.05-71.11x whose average is 45.43x — 19% below that average and within 14% of the decade low. On the cluster's lender metrics it looks expensive and those are the ones to discard: <code>pb</code> 10.68x is the second-highest of the 16 and <code>p_aum</code> 16.76x the highest, both meaningless for a company whose asset is a rating licence rather than a book. <code>div_yield</code> 1.35%, <code>ret_12m_rel</code> -2.99%, close above its 200-day EMA on 23.41% of the last 252 sessions, <code>shareholders</code> 88,482 with <code>fii_pct</code> 6.38% and <code>dii_pct</code> 12.95%. " + TNS,
  "<i>The uncomfortable part is that you are paying 36.62x for a business whose Indian ratings revenue tracks corporate bond issuance, and bond issuance is cyclical even if the licence is not. What makes it ownable is that the analytics half is contracted work for a 66.64% parent, which is the least cyclical revenue in this entire segment, and that 36.62x is the cheapest this stock has been relative to its own history in a decade. Accumulate on weakness rather than at market. The thing that would break the thesis is a change in the S&P relationship, which the pack cannot see at all.</i>",
 ],
 "trigger": "pe_ttm holding under 40x while ttm_np_pct stays above 18% -> the discount to a 45.43x own average is being handed to you on unbroken earnings. roe_7y slipping under 24%, or the analytics revenue share falling in the annual report -> the franchise premium is what you bought and it is eroding.",
 "evidence": ["roe_7y", "roe_5y", "roa_3y", "equity_to_assets", "roe_excess_13_10y", "pe_ttm", "pb", "div_yield", "opm_now", "opm_prev", "ttm_np_pct", "np_consistency_10y"],
},

# ------------------------------------------------------------------------ hold

"WEALTH": {
 "confidence": "medium",
 "verdict": "HOLD — the highest asset return of the 16 on a near-unlevered book, but revenue fell 42% in the quarter and the margin dropped 12.03pp while the stock trades at 1.73x its own average PE",
 "points": [
  "<b>Not held, not on your watchlist.</b> Wealth First Portfolio Managers, ₹948cr, a capital-markets advisory and distribution business — one of the six fee-and-advisory names. " + MISFILED + " Composite 73.",
  "<b>On returns it is near the top of the batch, and the balance sheet explains why that is less impressive than it looks.</b> <code>roa_3y</code> 26.92% is the highest of the 16 and <code>roe_3y</code> 29.45% the second-highest, behind ALGOQUANT's 30.70%, but <code>equity_to_assets</code> 90.91% means about 1.10x assets to equity: there is no leverage, so the ROE is almost the ROA. That is a genuinely high return on capital employed, and it is a different achievement from a lender earning the same number at four times the gearing. <code>roe_excess_13_5y</code> and the seven- and ten-year excesses all clear the 13% hurdle, making it one of exactly two names here to do so on every window. Net profit beat inflation in 2 of 4 years, 4 of 6 and 5 of 9.",
  "<b>The trailing year is where the hold comes from.</b> TTM sales +1.01% but operating profit -14.91% and net profit -8.48%, and <code>opm_now</code> 64.26% against <code>opm_prev</code> 76.29% is a -12.03pp step — the pack's second blocker on this row. The quarter is worse than the year: <code>sales_yoy_q</code> -42.28%. A 76% operating margin on advisory fees was never a steady state, and the direction of travel is now established over both a year and a quarter.",
  "<b>And the price has not adjusted.</b> <code>pe_ttm</code> 28.70x against an own-history band of 4.04-37.16x whose average is 16.62x — 1.73x its own average, on earnings that are falling. <code>ret_12m_rel</code> -28.72% says the market has started to mark it down but from a long way up. <code>pb</code> and <code>p_aum</code> are both distorted by the all-equity balance sheet and are not the right lens here; the right lens is the fee line, and the fee line halved. " + TNS,
  "<i>The honest read: this is the highest asset return in the batch attached to the fastest-deteriorating revenue line, at nearly twice its own average multiple. Those three facts cannot all be priced correctly. Hold rather than sell because the balance sheet is 91% equity — there is no funding risk and no forced seller — and hold rather than add because a -42.28% quarter at 28.70x is the market still giving the benefit of the doubt. If the next two quarters confirm the margin step, this becomes a reduce.</i>",
 ],
 "trigger": "sales_yoy_q returning to growth with opm_now stabilising above 64% -> the fall was deal timing in a lumpy advisory book and a 29% unlevered ROE at 28.70x is defensible. A third consecutive quarter of falling revenue, or opm_now under 55% -> the 76% margin was the cycle and the multiple has to halve to meet it.",
 "evidence": ["roe_3y", "roa_3y", "equity_to_assets", "pe_ttm", "opm_now", "opm_prev", "ttm_np_pct", "ttm_sales_pct", "sales_yoy_q", "ret_12m_rel"],
},

"AKCAPIT": {
 "confidence": "medium",
 "verdict": "HOLD — the most consistent profit record of the 16 and the highest yield here, but a 9.88x PE above its own ten-year high of 9.01x and an ROE that has never cleared 13%",
 "points": [
  "<b>Not held, not on your watchlist.</b> A K Capital Services, ₹1,131cr, debt syndication and merchant banking — one of the six fee-and-advisory names. " + MISFILED + " Composite 49.",
  "<b>Its record is the steadiest in the batch, and also the most modest.</b> <code>np_consistency_10y</code> 1.82 is the highest of the 12 names carrying the index — an index from 0 to 2 combining positive-profit years with the inverse of profit variability, not a pass rate. But <code>roe_3y</code> 9.75%, <code>roe_5y</code> 10.10% and <code>roe_7y</code> 9.96% have never reached the 13% hurdle on any window: <code>roe_excess_13_5y</code> -2.90pp, <code>_7y</code> -3.04pp, <code>_10y</code> -2.41pp. Consistently fine is the whole profile.",
  "<b>The trailing year is good and the balance sheet is the thinnest of the fee names.</b> TTM net profit +34.44% with <code>opm_now</code> 70.35% against <code>opm_prev</code> 70.25% — a flat margin, so the profit growth is volume rather than a mix step, and the pack flags no second blocker. <code>equity_to_assets</code> 23.82% is about 4.20x assets to equity, the second-thinnest of the 16 and odd for a syndication business: it means the returns above are earned on borrowed money, which is what makes a sub-13% ROE on 4.2x gearing the weak number it is.",
  "<b>The valuation has already caught up and then some.</b> <code>pe_ttm</code> 9.88x is above its own ten-year high of 9.01x — this stock has not been this expensive relative to its own earnings in a decade, and the band average is 4.72x. The full band is not quoted because its 2.36x low cannot be told apart from a split adjustment, but a high built on ten years of data is a usable ceiling and this price is through it. Against that, <code>div_yield</code> 3.50% is the highest of the seven payers in the batch. <code>shareholders</code> 2,825 is the second-lowest of the 16, and with 132 price bars there is no 200-EMA trend reading, so the momentum pillar scored on 50% of its declared weight — thin, not weak. " + TNS,
  "<i>The uncomfortable read: you are being asked to pay a decade-high multiple for a 10% ROE, and the only thing making it palatable is a 3.50% dividend. Hold if you own it for the yield and the consistency; there is no case for adding at a price above every print in the stock's own ten-year history. The real risk is liquidity rather than the business — 2,825 shareholders on a ₹1,131cr company means the exit is worse than the entry.</i>",
 ],
 "trigger": "roe_3y clearing 13% while opm_now holds near 70% -> the gearing finally translates and the decade-high multiple is justified by a step change, not a cycle. pe_ttm staying above 9x while roe_3y stays under 10% -> you are paying a record price for a sub-hurdle return and the dividend is the only return you will get.",
 "evidence": ["np_consistency_10y", "roe_3y", "roe_5y", "roe_excess_13_5y", "equity_to_assets", "pe_ttm", "div_yield", "opm_now", "opm_prev", "ttm_np_pct", "shareholders"],
},

"ARYAMAN": {
 "confidence": "medium",
 "verdict": "HOLD — 12% below its own average PE with the best seven-year profit CAGR of the 16, but revenue halved in the trailing year and the margin rose 14.87pp as it did",
 "points": [
  "<b>Not held, not on your watchlist.</b> Aryaman Financial Services, ₹764cr, SME merchant banking and IPO advisory — one of the six fee-and-advisory names, and the smallest-held: <code>shareholders</code> 2,215 is the lowest of the 16. " + MISFILED + " Composite 51.",
  "<b>The long record is the best growth record in the batch.</b> <code>np_cagr_7y</code> 78.64% is the highest of the 11 names with a seven-year series, and <code>roe_3y</code> 22.39% is fourth of the 16. An SME merchant bank compounding profit at that rate through a period that contained the 2021-2024 small-cap issuance boom is a cycle statement as much as a franchise one, and the next point is why that matters.",
  "<b>The trailing year reverses it.</b> TTM sales -46.94% is the worst of the 13 names with a trailing comparison, and <code>opm_now</code> 61.29% against <code>opm_prev</code> 46.43% is a +14.87pp step — the pack's second blocker here, and it runs the wrong way for the right reason: the margin went up because the revenue that disappeared was the low-margin half. Revenue halving is the fact; the margin improvement is an arithmetic consequence of it, not an offset.",
  "<b>Valuation reads cheap against its own history and the history is of a different business.</b> <code>pe_ttm</code> 25.96x against an own band of 12.90-65.09x whose average is 29.36x — 12% below that average. But with 46 price bars there is no 200-EMA reading and no EMA stack at all, so the momentum pillar scored on 35% of its declared weight; that is a listing-history fact about this price series, not a weak trend. Read the valuation percentile as direction only: the cluster is pricing it against lenders. " + TNS,
  "<i>The honest read: a 78.64% seven-year profit CAGR and a -46.94% trailing year are the same business telling you that SME issuance volumes, not skill, set its earnings. At 25.96x on halved revenue you are paying a normal multiple for a trough year, which is either the right time or far too early — and with 2,215 shareholders you cannot change your mind quickly. Hold a position; do not build one here. The decision point is whether issuance recovers, which is a market-cycle call, not a company call.</i>",
 ],
 "trigger": "ttm_sales_pct returning to growth with opm_now holding above 55% -> the trough was issuance timing and 25.96x on a recovering fee line is cheap against a 29.36x own average. A second year of falling revenue, or roe_3y under 12% -> the seven-year CAGR was one boom and the earnings base is far below where the multiple assumes.",
 "evidence": ["np_cagr_7y", "roe_3y", "pe_ttm", "opm_now", "opm_prev", "ttm_sales_pct", "shareholders"],
},

"PRIMESECU": {
 "confidence": "medium",
 "verdict": "WATCH — the largest margin collapse in the batch, -31.63pp, with the price at its highs: no PE at all because trailing profit fell 87.29%",
 "points": [
  "<b>Not held — PRIMESECU is on your watchlist.</b> Prime Securities, ₹1,024cr, investment banking and advisory — one of the six fee-and-advisory names. " + MISFILED + " Composite 61.",
  "<b>Start with what broke, because it is the largest single-year break in the batch.</b> <code>opm_now</code> 10.22% against <code>opm_prev</code> 41.85% is a -31.63pp step, the biggest negative margin move of the 16 and the pack's second blocker on this row. TTM net profit -87.29% is the worst of the 13 names with a trailing comparison, and <code>np_yoy_q</code> -80.82% is the worst of the 15 with a quarterly one — so the quarter confirms the year rather than softening it. There is no <code>pe_ttm</code> to quote: the earnings base has effectively gone.",
  "<b>The long record is genuinely good, which is the whole tension.</b> <code>roe_excess_13_10y</code> +17.11pp is the highest of the 12 names carrying the test — a decade averaging 30% ROE against the 13% hurdle — on <code>equity_to_assets</code> 89.20%, about 1.12x assets to equity, so none of it came from gearing. Net profit beat inflation across the windows. An advisory firm with that history and one catastrophic year is a different proposition from one that was always marginal.",
  "<b>But the price is behaving as though nothing happened.</b> The close held above its 200-day EMA on 74.60% of the last 252 sessions — the highest of the 10 names with the reading — and <code>ret_12m_rel</code> +4.96% is positive. The stock is near its highs while earnings fell 87.29%. Its own PE band of 7.00-59.23x, average 21.04x, is quotable but cannot be applied: there is no current E to compare. With no valuation anchor the pillar scored on 60% of its declared weight. " + TNS,
  "<i>The uncomfortable answer first: this is the one name in the batch where the market's price and the company's accounts are telling opposite stories, and no number in the pack resolves which is right. A deal-driven advisory book can lose 87% of its profit to timing and get it all back in one mandate — or the fee pipeline is gone and the price has not found out. Watch rather than act, because a position taken now is a bet on which of the two it is, at no discount. The thing to look for is the next quarter's revenue line, not its profit line.</i>",
 ],
 "trigger": "opm_now recovering above 30% with np_yoy_q turning positive -> the collapse was mandate timing, the ten-year +17.11pp hurdle excess is the real business, and the price was right to ignore it. A second quarter near 10% margins while the price stays above its 200-day EMA -> the gap between accounts and price closes downward and 74.60% above-EMA becomes the risk rather than the comfort.",
 "evidence": ["opm_now", "opm_prev", "ttm_np_pct", "np_yoy_q", "roe_excess_13_10y", "equity_to_assets", "pct_above_200ema_252d", "ret_12m_rel"],
},

"AFSL": {
 "confidence": "medium",
 "verdict": "HOLD — the highest composite of the batch at 91 and 8.86x earnings, but the +427.79% revenue line is bullion turnover at a 0.80% margin, not fee growth",
 "points": [
  "<b>Not held, not on your watchlist.</b> Abans Financial Services, ₹1,029cr, commodity and bullion trading alongside broking and financial services — one of the six fee-and-advisory names, and the least fee-like of them. " + MISFILED + " Composite 91 is the highest of the 15 names here that carry one, with <code>valuation_pct</code> 84 the highest too.",
  "<b>The composite is built on a revenue line that should be discounted almost entirely.</b> <code>ttm_sales_pct</code> +427.79% is the highest of the 13 names with a trailing comparison, and <code>opm_now</code> 0.80% is the lowest of those 13, against <code>opm_prev</code> 4.04%. That combination is the signature of gross bullion and commodity turnover being booked as revenue: a five-fold sales increase that moves the margin to under one percent is volume passing through the books, not business being won. Read the revenue growth as a reporting artefact and the margin step as its consequence.",
  "<b>Underneath it, the valuation is real.</b> <code>pe_ttm</code> 8.86x, <code>pb</code> 0.82x and <code>p_aum</code> 0.66x — priced below book while the rest of the fee group trades at multiples of it. <code>fii_pct</code> 20.71% is the highest of the 16, which is unusual at this size and says someone institutional has done the work. The own-history band is not quoted: 4 usable years is below the 8 this batch requires. This is also the mature-tier anomaly of the batch — it carries no <code>roe_excess_13_*</code> and no <code>np_growth_above_inflation_*</code> reading at all, so the hurdle and inflation questions are unanswered here rather than passed.",
  "<b>And the price has done nothing whatsoever.</b> <code>ret_12m_rel</code> is exactly 0.00% and the close held above its 200-day EMA on 3.17% of the last 252 sessions — a stock that has been flat for a year and below its own trend for essentially all of it, while carrying the highest composite in the batch. One of those two readings is wrong, and the composite is the one computed against a lender scorecard. " + TNS,
  "<i>The honest read: the top composite in this batch belongs to the name whose numbers I trust least, which is a statement about the scorecard rather than about Abans. Strip the pass-through revenue and you have a sub-book-value financial trading firm at 8.86x with 20.71% foreign ownership and a price that has not moved in twelve months. That is interesting and it is not a buy, because a 0.80% operating margin means a single bad trading year takes the earnings to zero and there is no fee annuity underneath. Hold, and treat the composite as noise.</i>",
 ],
 "trigger": "opm_now recovering toward 4% while sales growth normalises -> the mix is turning back toward fee and agency income, and 0.82x book at 8.86x is then plainly cheap. opm_now staying under 1% with pb under 0.8x -> the market is pricing a trading book that can lose a year's earnings in a quarter, and it is right to.",
 "evidence": ["ttm_sales_pct", "opm_now", "opm_prev", "pe_ttm", "pb", "p_aum", "fii_pct", "ret_12m_rel", "pct_above_200ema_252d"],
},

"CHOICEIN": {
 "confidence": "medium",
 "verdict": "HOLD — the best inflation record of the 16 on all three windows and a genuinely compounding book, at 70.30x earnings and 9.59x book",
 "points": [
  "<b>Not held — CHOICEIN is on your watchlist.</b> Choice International, ₹16,027cr, retail broking and wealth management with an attached NBFC and advisory arm — the largest of the five broker-NBFCs. " + MISFILED + " Composite 83.",
  "<b>Its compounding record is the best in the batch and it is not close.</b> Net profit beat inflation in 4 of the last 4 years, 6 of 6 and 8 of 9 — the best reading on every one of the three windows among the 12 names here that carry the test. <code>book_value_cagr_10y</code> 40.22% is the highest of the 11 names with a ten-year series. <code>loan_book_cagr_3y</code> 47.64% is the fastest genuine book growth of the 16 once ASHIKAG's 370.51% reorganisation artefact is set aside. <code>roe_3y</code> 16.33% on <code>equity_to_assets</code> 40.39% — about 2.48x assets to equity, modest gearing for a business with a lending arm.",
  "<b>The trailing year holds up, which is what separates it from the rest of the broker group.</b> <code>opm_now</code> 35.28% against <code>opm_prev</code> 33.37% — a +1.91pp step, small enough that the pack flags no second blocker on this row. That is the smallest margin move of the five broker-NBFCs — the next-smallest is THEINVEST at -7.60pp — and in a group where every other margin story is a one-year artefact it is the most informative single fact.",
  "<b>Everything cheap about it has already been paid for.</b> <code>pe_ttm</code> 70.30x and <code>pb</code> 9.59x: the market has fully priced the compounding record. The own-history band is not quoted — its 1.82x low cannot be told apart from a split adjustment — so there is no historical anchor to say whether 70x is high or normal for this stock. The close held above its 200-day EMA on 67.06% of the last 252 sessions, second of the 10 names with the reading. " + TNS,
  "<i>The uncomfortable part: this is the best business in the batch after CRISIL and it is the second-most expensive thing in it. A 4-of-4, 6-of-6, 8-of-9 inflation record genuinely deserves a premium — but 70.30x earnings and 9.59x book on retail broking revenue means two years of lower market turnover takes a third off the earnings and the multiple at the same time. Hold if you own it. Adding at 70x requires believing Indian retail participation only goes one way, which is the single assumption this entire segment is built on and the one nobody here has tested through a bear market.</i>",
 ],
 "trigger": "ttm earnings growth holding above 25% with opm_now steady near 35% -> the compounding is structural, the 70.30x is a growth multiple rather than a cycle multiple, and the record supports it. Market turnover falling with opm_now under 28% -> a 9.59x book on a broking business de-rates far faster than the earnings fall, which is how every broker in this segment has previously broken.",
 "evidence": ["np_growth_above_inflation_10y", "book_value_cagr_10y", "loan_book_cagr_3y", "roe_3y", "equity_to_assets", "opm_now", "opm_prev", "pe_ttm", "pb", "pct_above_200ema_252d"],
},

"ASHIKAG": {
 "confidence": "medium",
 "verdict": "WATCH — a 72 quality pillar resting entirely on reorganisation arithmetic: a 370.51% three-year book growth that is identical to its own dead predecessor ticker",
 "points": [
  "<b>Not held, not on your watchlist.</b> Ashika Global Securities, ₹2,898cr, broking and investment services — one of the five broker-NBFCs, and formerly Ashika Credit Capital Ltd. " + MISFILED + " Composite 76.",
  "<b>The growth metrics are artefacts of that renaming and must not be read as performance.</b> <code>loan_book_cagr_3y</code> 370.51%, <code>book_value_cagr_3y</code> 314.40% and <code>np_cagr_3y</code> 137.35% are identical, to four decimal places, to the figures carried by the now-dead ASHIKA ticker — the same accounts read twice through a corporate reorganisation. <code>quality_pct</code> 72 is built on them, so the quality pillar here is measuring a restructuring, not a business. This is the single most important thing about the row: there is no three-year growth claim in this name that survives inspection.",
  "<b>Almost nothing else is measurable yet either.</b> Six completed quarters and 129 price bars mean the momentum pillar scored on half its declared weight; the momentum pillar scored on 50% of its declared weight; there are no delivery-volume rows at all; and there is no own-history PE band, so <code>pe_ttm</code> 38.60x has no anchor of any kind — not against its own past, and not against the 16, because the cluster's comparison is to lenders. " + TNS,
  "<b>The ownership change is the one hard fact worth watching.</b> The promoter stake moved from 58.00% at 2026-03-31 to 74.32% at 2026-06-30 — a 16.32pp increase in a single quarter. Promoters buying a sixth of the company at these levels is a real signal in a name where no other signal is yet trustworthy, and it is the reason this row is a watch rather than an avoid.",
  "<i>The honest answer is that this company has not existed in its current form long enough to be valued, and the scorecard does not know that — it has read a reorganisation as 370% book growth and awarded a 72 quality pillar for it. At 38.60x with no own-history band, no delivery data and six quarters of accounts, any verdict here would be a guess dressed as analysis. Watch it for four more quarters; the promoter move to 74.32% is what makes it worth the wait rather than worth skipping.</i>",
 ],
 "trigger": "Four more quarters of clean accounts with the growth rates normalising toward the broker group -> the reorganisation washes out, the metrics start measuring the business, and 38.60x can actually be assessed. The promoter stake falling back toward 58% -> the one trustworthy signal in the name reverses and there is nothing left to wait for.",
 "evidence": ["loan_book_cagr_3y", "book_value_cagr_3y", "np_cagr_3y", "pe_ttm", "promoter_pct"],
},

"ALGOQUANT": {
 "confidence": "medium",
 "verdict": "SPECULATIVE — the highest book multiple of the 16 at 14.11x, where the entire +102.77% profit growth is a 10.98pp margin step on 15.77% revenue growth",
 "points": [
  "<b>Not held, not on your watchlist.</b> AlgoQuant Fintech, ₹1,898cr, algorithmic trading and fintech services — one of the five broker-NBFCs, and formerly Hindustan Everest Tools, renamed in November 2021. A tool manufacturer that became an algorithmic trading firm four years ago. " + MISFILED + " Composite 88.",
  "<b>The headline growth is margin, not revenue, and the distinction decides the row.</b> <code>ttm_np_pct</code> +102.77% is the highest of the 13 names with a trailing comparison — on <code>ttm_sales_pct</code> of only +15.77%. The gap is <code>opm_now</code> 26.89% against <code>opm_prev</code> 15.91%, a +10.98pp step and the pack's second blocker on this row. Doubling profit on 16% more revenue means the margin did the work, and an 11pp margin move in one year at a proprietary trading operation is a result, not a trend.",
  "<b>On returns it leads the batch, on price it leads it by more.</b> <code>roe_3y</code> 30.70% is the highest of the 16 — above WEALTH's 29.45% — and <code>pb</code> 14.11x is also the highest of the 16. You are paying fourteen times book for a 31% return on that book, which prices roughly a decade of the current ROE continuing. There is no own-history PE band to check it against, and with 206 price bars the quality, valuation and momentum pillars scored on 82%, 75% and 65% of their declared weight respectively — so composite 88 is assembled from partial inputs on top of the wrong scorecard.",
  "<b>What the row cannot tell you is where the trading profit comes from.</b> An algorithmic trading book earns from strategies whose edge decays, and the pack has no visibility into strategy concentration, leverage within the book, or whether a single year's volatility produced the margin step. That is not a gap in the data collection; it is a gap no fundamental pack can close for this business model. " + TNS,
  "<i>Uncomfortable first: a four-year-old business identity, a one-year 11pp margin step, the highest book multiple in the batch and no own-history band to anchor any of it. Those are the conditions under which a verdict should be labelled speculative rather than dressed as a hold. The 30.70% ROE is real and the 14.11x book has priced it as permanent, which for an algorithmic trading edge is the one assumption least likely to hold. Position size is the only risk control available here.</i>",
 ],
 "trigger": "opm_now holding near 27% for four more quarters with sales growth above 20% -> the margin step was operating leverage in a scaling platform rather than one good volatility year, and the ROE is repeatable. opm_now reverting toward 16%, or roe_3y under 20% -> 14.11x book has nothing underneath it and the de-rating is multiplicative with the earnings fall.",
 "evidence": ["ttm_np_pct", "ttm_sales_pct", "opm_now", "opm_prev", "roe_3y", "pb"],
},

"THEINVEST": {
 "confidence": "medium",
 "verdict": "AVOID — the lowest returns on every window of the 16 and the worst price trend in the batch, at 0.64x book which is the only thing in its favour",
 "points": [
  "<b>Not held, not on your watchlist.</b> The Investment Trust of India, ₹472cr, broking, lending and investment banking — one of the five broker-NBFCs. " + MISFILED + " Composite 24.",
  "<b>The returns are the worst in the batch on every window, and they get worse the further back you look.</b> <code>roe_3y</code> 4.31%, <code>roe_5y</code> 3.00% and <code>roe_7y</code> 2.37% are each the lowest of their cohorts here, and <code>roe_excess_13_5y</code> -10.00pp and <code>roe_excess_13_7y</code> -10.63pp are the lowest of the 12 names carrying the test. Seven years of earning under 3% on equity is not a cycle; it is the business.",
  "<b>The price has agreed for a year.</b> <code>ret_12m_rel</code> -35.38% and the close above its 200-day EMA on only 1.98% of the last 252 sessions — both the worst of the 10 names with those readings. A stock below its own trend for 98% of a year while returning 2-4% on equity is not being overlooked. The pack's second blocker here is a margin step: <code>opm_now</code> 17.47% against <code>opm_prev</code> 25.07%, -7.60pp in one year, so the latest year made the record worse rather than better.",
  "<b>Cheapness is the entire counter-argument and it is not enough.</b> <code>pb</code> 0.64x prices the equity at a 36% discount to stated book. The own-history PE band is not quoted: its 365.21x high is built on a near-zero earnings base and is arithmetic rather than information. A note on scope: <code>p_aum</code> 0.7486x here and BLBLIMITED's 0.7485x are indistinguishable, so neither row claims to be cheaper than the other on that measure. " + TNS,
  "<i>The uncomfortable answer: 0.64x book on a business earning 2.37% over seven years is not a discount, it is the market correctly valuing capital that is being destroyed slowly. A sub-book financial holding company only re-rates on a sale, a demerger or a change of control, none of which this pack can see and none of which has happened in seven years. Avoid, and note that the one thing that would change the call is a corporate action rather than a good quarter.</i>",
 ],
 "trigger": "roe_3y clearing 10% with the price reclaiming its 200-day EMA -> the operating businesses have finally started earning and 0.64x book is then a genuine discount rather than a verdict. roe_5y staying under 4% while pb holds near 0.64x -> the discount is permanent, the book is not being converted into returns, and the holding is dead money.",
 "evidence": ["roe_3y", "roe_5y", "roe_7y", "roe_excess_13_5y", "pb", "p_aum", "ret_12m_rel", "pct_above_200ema_252d"],
},

"AVONMORE": {
 "confidence": "medium",
 "verdict": "AVOID — 97.02x earnings, the most expensive of the 16, on returns that fell from 13.49% over seven years to 4.64% over three",
 "points": [
  "<b>Not held, not on your watchlist.</b> Avonmore Capital & Management Services, ₹361cr, broking and financial services — one of the five broker-NBFCs and the second-smallest name in the batch. " + MISFILED + " Composite 28.",
  "<b>The returns have collapsed, and the seven-year figure is what shows it.</b> <code>roe_7y</code> 13.49% against <code>roe_3y</code> 4.64%: this business used to clear the 13% hurdle and now earns a third of it. <code>np_cagr_7y</code> -11.31% is the worst of the 11 names here with a seven-year series — seven years of profit shrinking at double digits annually. <code>opm_now</code> 11.58% against <code>opm_prev</code> 21.55% is a -9.97pp step, the pack's second blocker on this row, so the most recent year continued the direction rather than arresting it.",
  "<b>And the price has gone the other way.</b> <code>pe_ttm</code> 97.02x is the highest of the 14 names with a PE — the most expensive thing in the batch, on the worst long-run profit record in it. <code>earnings_yield_trend</code> -102.23pp is out of family with every other name here, where the next-worst reading is -6.53pp: the earnings yield has not drifted down, it has fallen off a cliff, which is what a near-zero earnings base does to the measure.",
  "<b>Nothing in the recent prints rescues it.</b> <code>np_yoy_q</code> +196.35% looks like a recovery and is not: a near-tripling off a base that had already collapsed leaves the absolute profit far below where the 97.02x multiple assumes. The own-history band is unusable — its low of 0.13x is not a possible price-to-earnings ratio, and that single impossible number is the clearest evidence in this batch that the low end of these computed bands cannot be trusted. On the 200-day EMA measure it reads exactly 0.1111, tied with WEALTH, so neither row ranks against the other there. " + TNS,
  "<i>The uncomfortable read: there is no version of these numbers in which 97.02x is defensible. A seven-year profit CAGR of -11.31%, a margin down 9.97pp, and a return on equity that has fallen by two-thirds, priced at the highest multiple in the segment — the multiple is high because the earnings are nearly zero, not because anyone is paying for growth. That is the most dangerous kind of expensive, because a single further bad quarter makes the PE infinite rather than high. Avoid.</i>",
 ],
 "trigger": "opm_now recovering above 20% with roe_3y clearing 10% -> the collapse was cyclical, the seven-year base is the real business, and the earnings base can grow into the multiple. np_cagr_3y staying negative while pe_ttm holds near 97x -> the earnings base keeps shrinking, the multiple keeps rising mechanically, and the equity is being revalued downward on every print.",
 "evidence": ["roe_7y", "roe_3y", "np_cagr_7y", "opm_now", "opm_prev", "pe_ttm", "earnings_yield_trend", "np_yoy_q"],
},

"BLBLIMITED": {
 "confidence": "medium",
 "verdict": "SPECULATIVE — the cheapest earnings of the 16 at 4.47x on a 94.16% equity balance sheet, and the worst profit consistency in the batch at 0.58",
 "points": [
  "<b>Not held, not on your watchlist.</b> BLB Ltd, ₹88cr, proprietary trading and investment — one of the three proprietary-book names and the smallest company of the 16. " + MISFILED + " Composite 87.",
  "<b>It is the cheapest and the most erratic thing here, and those are the same fact.</b> <code>pe_ttm</code> 4.47x is the cheapest of the 14 names with a PE, while <code>np_consistency_10y</code> 0.58 is the worst of the 12 names carrying the index by a wide margin — the next-worst is 1.38 — on an index that runs from 0 to 2 and is not a pass rate. <code>roe_excess_13_10y</code> -12.29pp is also the worst of those 12: a decade averaging roughly 0.7% ROE against a 13% hurdle. A proprietary trading book with no consistent earnings is priced at four times whatever the last year happened to produce.",
  "<b>There is no leverage and almost no balance-sheet risk.</b> <code>equity_to_assets</code> 94.16% is the highest of the 16 — about 1.06x assets to equity — so the company is its own capital, with no funding structure that can fail. <code>loan_book_cagr_3y</code> -10.53% is the lowest of the 16 and should be read as a shrinking investment book rather than a lending failure; <code>book_value_cagr_10y</code> 0.44% is the lowest of the 11 names with a ten-year series, which is the real indictment: a decade of trading that compounded book value by essentially nothing.",
  "<b>The recent prints are extreme in both directions.</b> <code>np_yoy_q</code> +283.11% is the highest of the 15 names with a quarterly comparison and <code>earnings_yield_trend</code> +7.22pp the highest of the batch — both off a base near zero, so both are arithmetic. Only 5 completed quarters are available, so there is no TTM-versus-prior reading at all. <code>promoter_pct</code> 45.77% is the lowest of the 16 and <code>fii_pct</code> is 0.00%. The own band is refused on 4 usable years. A scope note: its <code>p_aum</code> 0.7485x and THEINVEST's 0.7486x are indistinguishable and neither row ranks against the other. " + TNS,
  "<i>Uncomfortable first: composite 87 on a ₹88cr proprietary trading book whose ten-year book-value growth is 0.44% is the clearest single demonstration that this scorecard is measuring the wrong thing. Strip it away and what remains is a tiny, unlevered, wholly promoter-independent pool of capital at 4.47x trailing earnings that has created no value in ten years. That is cheap for a reason and it is not uninvestable — it is unanalysable, which is why the label is speculative. If you take it, take it as a closed-end discount play and size it accordingly.</i>",
 ],
 "trigger": "Two or three consecutive years of positive profit lifting np_consistency above 1.2 -> the trading book has found a repeatable process and 4.47x on improving consistency is a genuine discount. book_value_cagr turning negative, or the equity base shrinking -> a decade of going nowhere becomes a decade of slow losses and there is no multiple low enough for that.",
 "evidence": ["pe_ttm", "np_consistency_10y", "roe_excess_13_10y", "equity_to_assets", "loan_book_cagr_3y", "book_value_cagr_10y", "np_yoy_q", "earnings_yield_trend", "promoter_pct", "p_aum"],
},

"VLSFINANCE": {
 "confidence": "medium",
 "verdict": "HOLD — the cheapest book of the 16 at 0.34x, where book value compounded 25.07% over ten years while five-year profit fell 43.28% a year",
 "points": [
  "<b>Not held, not on your watchlist.</b> VLS Finance, ₹724cr, an investment and proprietary trading company — one of the three proprietary-book names. " + MISFILED + " Composite 43.",
  "<b>The whole row is one contradiction, and it is the most instructive number pair in the batch.</b> <code>book_value_cagr_10y</code> 25.07% is third of the 11 names with a ten-year series, while <code>np_cagr_5y</code> -43.28% is the worst of the 13 names with a five-year series. Both are true because they measure different things: the book compounds on unrealised marks as the portfolio appreciates, while the P&L only records what was sold. An investment company that is not realising gains looks like a failing business and a compounding balance sheet at the same time.",
  "<b>Priced at a third of that book.</b> <code>pb</code> 0.34x is the cheapest of the 16 — a 66% discount to stated book — on <code>equity_to_assets</code> 90.33%, about 1.11x assets to equity, so the book is real capital and not a geared position. The own-history PE band is not quoted: its 1.43x low cannot be told apart from a split adjustment. <code>ret_12m_rel</code> +8.66% is the highest of the 10 names here with the reading, so the discount has begun to narrow rather than widen.",
  "<b>The operating record is the reason the discount exists.</b> Net profit beat inflation in 1 of the last 4 years, 2 of 6 and 3 of 9 — the worst reading on all three windows of the 12 names carrying the test. <code>opm_now</code> 64.51% against <code>opm_prev</code> 39.53% is a +24.98pp step and the pack's second blocker here, and for a company whose revenue is realisations that step says only that it sold different things this year, not that anything improved. " + TNS,
  "<i>The honest read: 0.34x book is the kind of discount that is either the best value in the batch or a permanent feature, and the deciding variable is capital allocation rather than performance. Ten years of 25% book growth with nothing distributed and nothing realised is management choosing to hold the portfolio, and a minority holder has no way to force that. Hold it as a discounted basket of assets and expect the discount to persist; the worst inflation record in the segment is the price of admission, not an anomaly to be fixed.</i>",
 ],
 "trigger": "Realisations lifting np_cagr back toward positive while pb stays under 0.5x -> the gap between book and P&L starts closing and a 66% discount is being handed to you on real assets. pb falling under 0.3x with the inflation record unchanged -> the discount is structural, the portfolio is not being converted into shareholder returns, and the book value is a number rather than a claim.",
 "evidence": ["book_value_cagr_10y", "np_cagr_5y", "pb", "equity_to_assets", "ret_12m_rel", "np_growth_above_inflation_10y", "opm_now", "opm_prev"],
},

"PIONRINV": {
 "confidence": "medium",
 "verdict": "AVOID — the lowest momentum pillar of the 16 at 11, with quarterly revenue down 56.24% and the trailing profit growth coming from outside operations",
 "points": [
  "<b>Not held, not on your watchlist.</b> Pioneer Investcorp, ₹90cr, investment banking and a proprietary book — one of the three proprietary-book names, and the second-smallest of the 16. " + MISFILED + " Composite 33.",
  "<b>The revenue is falling faster than anything else in the batch.</b> <code>sales_yoy_q</code> -56.24% is the worst of the 15 names with a quarterly comparison. And the profit line does not offset it: <code>ttm_np_pct</code> +73.72% sits against <code>ttm_op_pct</code> -2.09%, which means the trailing profit growth came from below the operating line — investment gains or other income, not the business — while operations went slightly backwards.",
  "<b>The price trend is the worst-scored in the batch.</b> <code>momentum_pct</code> 11 is the lowest of the 15 names here carrying a momentum reading, with technical three-month and one-month returns of -45.90% and -32.68%. There are 130 price bars despite a 2016 listing — the series begins 2026-04-20 — so the longer trend metrics are thin rather than adverse: there is no 200-EMA reading and the momentum pillar scored on 50% of its declared weight, and there are no delivery-volume rows at all. The own-history band is refused: its 151.71x high is built on a near-zero earnings base.",
  "<b>Cheap on the balance-sheet measures, and the balance sheet is geared.</b> <code>p_aum</code> 0.32x is the cheapest of the 16 and <code>pb</code> 0.52x the second-cheapest, but <code>equity_to_assets</code> 37.46% means about 2.67x assets to equity — this is a proprietary book with borrowed money behind it, unlike BLBLIMITED at 1.06x or VLSFINANCE at 1.11x. The same 0.5x book discount means something materially different at 2.67x gearing than at 1.1x. " + TNS,
  "<i>Uncomfortable first: of the three proprietary-book names this is the only one where a bad year can impair the equity rather than just shrink it, because it is the only one that is geared. Revenue down 56%, operating profit slightly negative, the profit growth sourced from non-operating items and the worst price trend in the segment — a 0.52x book does not compensate for that combination. Avoid. The small size compounds it: at ₹90cr the exit is as poor as the entry.</i>",
 ],
 "trigger": "sales_yoy_q returning to growth with ttm_op_pct positive -> the operating business is intact, the fall was deal timing, and 0.32x AUM on a working investment bank is a real discount. Another quarter of falling revenue with operating profit negative -> the 2.67x gearing turns a shrinking fee book into a balance-sheet problem rather than an earnings one.",
 "evidence": ["sales_yoy_q", "ttm_np_pct", "ttm_op_pct", "p_aum", "pb", "equity_to_assets"],
},

"PNBGILTS": {
 "confidence": "medium",
 "verdict": "HOLD — the most levered balance sheet of the 16 at 16.67x assets to equity, correct for a G-sec primary dealer, with the lowest composite in the batch and a 2.79% yield",
 "points": [
  "<b>Not held, not on your watchlist.</b> PNB Gilts, ₹1,289cr, a primary dealer in government securities, 74.07% owned by Punjab National Bank — one of the two debt-principal names, where the risk taken is principal risk in bonds rather than fees. " + MISFILED + " Composite 19 is the lowest of the 15 names here that carry one.",
  "<b>The gearing is the business model, and the scorecard reads it as a defect.</b> <code>equity_to_assets</code> 6.00% means about 16.67x assets to equity, by far the most levered of the 16 — the next-thinnest is 4.20x. <code>roa_3y</code> 0.63% is the lowest of the 16, and multiplied by that gearing it produces <code>roe_3y</code> 10.31%, which is mid-pack. A primary dealer is required to bid at government auctions and carries inventory to do it; running a 6% equity ratio on a sovereign-debt book is the mandate, not recklessness. The low composite is substantially the cluster applying lender metrics to a dealer.",
  "<b>The trailing year is genuinely bad, and it is rate-driven.</b> <code>ttm_np_pct</code> -69.90% and <code>np_yoy_q</code> -49.58%, with <code>opm_now</code> 83.38% against <code>opm_prev</code> 94.08% — a -10.70pp step and the pack's second blocker on this row. <code>opm_now</code> 83.38% is still the highest of the 13 names with the reading, which is what a bond book looks like: almost no operating cost, all of the volatility in the carry and the mark. Profit at a primary dealer falls when yields rise, and that is a market input rather than a management failure.",
  "<b>Priced below book with a real dividend.</b> <code>pb</code> 0.75x and <code>p_aum</code> 0.34x, with <code>div_yield</code> 2.79% — the second-highest of the seven payers in the batch. The own-history band is refused outright: a 1.91x low and a 441.73x high describe arithmetic on a near-zero earnings year, not a valuation range. <code>shareholders</code> 84,279, which for this size is unusually wide and reflects the PNB parentage. " + TNS,
  "<i>The honest read: the lowest composite in the batch belongs to the one name here whose business is the easiest to understand, and the gap is the scorecard's, not the company's. What you actually own is a leveraged, state-bank-sponsored bet on Indian bond yields falling, at 0.75x book with a 2.79% yield while you wait. That is a legitimate position and it is not an equity investment in the ordinary sense — the earnings will not compound, they will oscillate with the rate cycle. Hold it only if you want that exposure deliberately; there is no quality story underneath to fall back on.</i>",
 ],
 "trigger": "Falling bond yields lifting ttm_np_pct back to positive while pb stays near 0.75x -> the rate cycle turns, a 16.67x-levered book is where that gain lands first, and you were paid 2.79% to wait. Yields rising further with opm_now under 75% -> the mark-to-market runs the other way and 6.00% equity to assets leaves very little room before the book itself is impaired.",
 "evidence": ["equity_to_assets", "roa_3y", "roe_3y", "ttm_np_pct", "np_yoy_q", "opm_now", "opm_prev", "pb", "p_aum", "div_yield", "shareholders"],
},

# ------------------------------------------------------------- data-blocked

"ARCIL": {
 "confidence": "low",
 "verdict": "WATCH — no verdict: listed 2026-09-17, so there are zero completed quarters to compare and the momentum pillar scored on 0 of 100 points, which suppresses the composite entirely",
 "points": [
  "<b>Not held, not on your watchlist.</b> Asset Reconstruction Company (India) Ltd, ₹4,546cr, acquisition and resolution of distressed bank loans — one of the two debt-principal names. " + MISFILED + " It listed on 2026-09-17, three weeks before the 2026-10-08 snapshot, and that single fact disqualifies most of this pack.",
  "<b>What is absent, by name.</b> <code>pe_ttm</code> is NULL and there is no own-history PE band at all (n is NULL), because <code>ttm_vs_prior</code> is empty — zero completed quarters since listing, so there is no trailing-year comparison of sales, operating profit or net profit. <code>pct_above_200ema_252d</code> and <code>ema_stack_bull</code> are both NULL — no 200-EMA reading and no 9/20/50 EMA stack — on 24 price bars against the roughly 450 those metrics require. The consequence is specific: the **momentum pillar scored on 0 of its 100 declared points**, so <code>momentum_pct</code> is NULL and <code>composite_pct</code> is suppressed — this is the only name of the 16 with no composite. The valuation pillar scored on 55% of its declared weight for the same reason. There is also no company overview in the pack, so the business description above is from the identity record alone. Nothing here can be unblocked by a better query; it needs four quarters of filings and about eighteen months of price history. " + TNS,
  "<i>What does read cleanly is the balance sheet, and it is worth recording for when the rest arrives: <code>pb</code> 1.20x and <code>p_aum</code> 1.10x, <code>roa_3y</code> 7.56% on <code>equity_to_assets</code> 75.97% — about 1.32x assets to equity — giving <code>roe_3y</code> 9.89%, with <code>loan_book_cagr_3y</code> 27.09%, <code>book_value_cagr_3y</code> 10.87%, <code>np_cagr_3y</code> 3.16% and <code>np_consistency_3y</code> 1.97 — an index from 0 to 2, not a pass rate. <code>promoter_pct</code> 77.46% is the highest of the 15 names with the reading and <code>shareholders</code> 177,845 the highest of the 16, which is an IPO allotment register rather than a settled holder base. A distressed-asset buyer earning 7.56% on assets with almost no gearing is an interesting starting point, and that is the most that can honestly be said. No verdict until the first full year of filings; the label is a watch rather than a hold because an unlabelled row would render as an endorsement.</i>",
 ],
 "trigger": "Four completed quarters published, giving a real pe_ttm and a ttm_vs_prior comparison -> the valuation and earnings questions become answerable and this gets a proper verdict. The price history reaching roughly 450 bars without the resolution book growing -> the momentum pillar unblocks but the only clean metric left, a 27.09% three-year book growth, would be stale.",
 "evidence": ["pb", "p_aum", "roa_3y", "roe_3y", "equity_to_assets", "loan_book_cagr_3y", "np_consistency_3y", "promoter_pct", "shareholders"],
},

}

DERIVED_KEYS = {"pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
                "delivery_pct", "pledge_pct"}

LABELS = ("BUY", "ACCUMULATE", "HOLD", "WATCH", "AVOID", "REDUCE", "SELL",
          "SPECULATIVE")

# Choice 2. The segment file still lists ASHIKA; the pack still contains it.
DEAD = {"ASHIKA"}

# Choice 3. Sub-groups. Every name belongs to exactly one, and the guard checks
# the partition rather than trusting the comment.
SUBGROUPS = {
    "FEE": {"CRISIL", "AKCAPIT", "ARYAMAN", "PRIMESECU", "WEALTH", "AFSL"},
    "BROKER_NBFC": {"CHOICEIN", "ASHIKAG", "ALGOQUANT", "THEINVEST", "AVONMORE"},
    "PROP": {"BLBLIMITED", "VLSFINANCE", "PIONRINV"},
    "DEBT_PRINCIPAL": {"PNBGILTS", "ARCIL"},
}

# A superlative is only allowed if the point it sits in names its peer set:
# an explicit count, the batch, the segment, one of the four sub-groups, or
# the company's own history.
SCOPE_PHRASES = (
    "in the batch", "of the batch", "in this batch", "in the segment",
    "of the six fee-and-advisory", "of the five broker-NBFCs",
    "of the three proprietary-book", "of the two debt-principal",
    "own history",
)
SCOPE_COUNT = re.compile(r"of (?:the |those |only )?\d+")
SUPERLATIVES = ("highest", "lowest", "cheapest", "best", "worst", "fastest",
                "slowest", "richest", "smallest", "largest", "biggest",
                "most expensive", "most levered")

# Choice 4: n >= 8 usable years AND a low at or above 4.0x AND a high at or
# below 100x. Quoting any other band is a bug, so the guard checks the prose.
BAND_QUOTABLE = {"CRISIL", "ARYAMAN", "PRIMESECU", "WEALTH"}

WATCHLISTED = {"CHOICEIN", "PRIMESECU"}

# The one-year operating-margin blocker, per name, as the string the prose has
# to contain. Any name carrying that blocker and absent from this table fails.
MARGIN_STEP = {
    "ALGOQUANT": "10.98pp", "ARYAMAN": "14.87pp", "AVONMORE": "9.97pp",
    "PNBGILTS": "10.70pp", "PRIMESECU": "31.63pp", "THEINVEST": "7.60pp",
    "VLSFINANCE": "24.98pp", "WEALTH": "12.03pp",
}

# Choice 6. ARCIL is the data-blocked row. These must be verifiably absent —
# if any of them starts reading, the row has to be rewritten as a verdict.
ARCIL_ABSENT_CM = ("pe_ttm", "pct_above_200ema_252d", "ema_stack_bull")
ARCIL_ABSENT_SCORE = ("momentum_pct", "composite_pct")
# ...and these must resolve, because the row quotes every one of them.
ARCIL_PRESENT = ("pb", "p_aum", "roa_3y", "roe_3y", "equity_to_assets",
                 "loan_book_cagr_3y", "np_consistency_3y", "book_value_cagr_3y",
                 "np_cagr_3y", "promoter_pct", "shareholders", "div_yield",
                 "fii_pct", "dii_pct")

BLOCKED = {"ARCIL"}


def _blocker_coverage(sym, blockers, body):
    """Every non-boilerplate blocker must be visible in the prose.

    Generic on purpose: the numbers come out of the blocker text, so adding a
    name to this batch cannot silently skip its blockers the way a hand-kept
    table would.
    """
    for b in blockers:
        if "balance-sheet lender" in b:
            continue
        if "operating margin stepped" in b:
            if sym not in MARGIN_STEP:
                raise SystemExit(f"{sym}: carries a one-year margin-step "
                                 f"blocker and is not in MARGIN_STEP")
            if MARGIN_STEP[sym] not in body:
                raise SystemExit(f"{sym}: margin step not named in the prose "
                                 f"({MARGIN_STEP[sym]!r} is absent)")
            continue
        m = re.search(r"scored on (\d+)% of its declared weight", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: a pillar scored on {m.group(1)}% of its "
                             f"weight and the prose never says so")
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

    if set(rows) - DEAD != set(SPEC):
        raise SystemExit(f"spec/pack mismatch: "
                         f"spec-only={sorted(set(SPEC) - (set(rows) - DEAD))} "
                         f"pack-only={sorted((set(rows) - DEAD) - set(SPEC))}")

    import importlib.util
    spec_mod = importlib.util.spec_from_file_location(
        "bfsi_segments", "build/verdicts/bfsi_segments.py")
    seg = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(seg)
    # Choice 2: written against the segment minus ASHIKA, so that correcting
    # bfsi_segments.py on a main session does not break this generator.
    if set(seg.SEGMENTS["capital_markets"]) - DEAD != set(SPEC):
        raise SystemExit("spec is not the capital_markets segment minus ASHIKA "
                         "— every 'of the 16' superlative in this file is "
                         "scoped wrong")

    members = [s for g in SUBGROUPS.values() for s in g]
    if len(members) != len(set(members)) or set(members) != set(SPEC):
        raise SystemExit("SUBGROUPS is not a partition of the batch — the "
                         "sub-group superlatives cannot be trusted")

    out = []
    for sym, s in SPEC.items():
        row = rows[sym]
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        scores = row.get("scores") or {}
        blockers = row.get("blockers") or []
        points, verdict, trig = s["points"], s["verdict"], s["trigger"]
        conf = s["confidence"]
        body = " ".join(points)

        want = 3 if sym in BLOCKED else 5
        if len(points) != want:
            raise SystemExit(f"{sym}: {len(points)} points, expected {want}")
        if verdict.split(" —")[0] not in LABELS:
            raise SystemExit(f"{sym}: label must open with one of {LABELS}, "
                             f"got {verdict[:20]!r}")
        if len(verdict.split("—", 1)[1].strip()) < 30:
            raise SystemExit(f"{sym}: headline says nothing after the label")

        if not any("balance-sheet lender" in b for b in blockers):
            raise SystemExit(f"{sym}: lost the cluster-wide lender blocker — "
                             f"the confidence ceiling needs re-deciding")
        if sym in BLOCKED:
            if conf != "low":
                raise SystemExit(f"{sym}: data-blocked rows are low confidence")
            if not verdict.startswith("WATCH — no verdict"):
                raise SystemExit(f"{sym}: a data-blocked row must be labelled "
                                 f"'WATCH — no verdict' — verdictBucket() maps "
                                 f"anything it does not recognise to hold, "
                                 f"which renders as an endorsement")
        elif conf != "medium":
            raise SystemExit(f"{sym}: {conf} confidence, but a writable row in "
                             f"this cluster is medium by construction")

        if not points[-1].startswith("<i>"):
            raise SystemExit(f"{sym}: the last point is not italicised")
        for i, p in enumerate(points[:-1]):
            if not p.startswith("<b>"):
                raise SystemExit(f"{sym}: point {i+1} has no <b> lead sentence")
        if "Not held" not in points[0]:
            raise SystemExit(f"{sym}: point one does not state the holding status")
        if sym in WATCHLISTED and "watchlist" not in points[0]:
            raise SystemExit(f"{sym}: is watchlisted and point one does not say so")
        if sym not in WATCHLISTED and "not on your watchlist" not in points[0]:
            raise SystemExit(f"{sym}: point one must state it is not watchlisted")

        # Choice 1: the misfiling flag cannot be edited out of point one.
        if "direction, not rank" not in points[0]:
            raise SystemExit(f"{sym}: point one does not flag the cluster "
                             f"misfiling — every percentile in the row is then "
                             f"being presented as a rank it is not")
        if "quality_pct" in body and "direction, not rank" not in body:
            raise SystemExit(f"{sym}: quotes a pillar percentile as a rank")

        if sum(p.count("<code>") for p in points) < 4:
            raise SystemExit(f"{sym}: fewer than 4 <code> field names across the row")

        for p in points:
            low = p.lower()
            if not any(w in low for w in SUPERLATIVES):
                continue
            if any(ph in p for ph in SCOPE_PHRASES) or SCOPE_COUNT.search(p):
                continue
            raise SystemExit(f"{sym}: a superlative with no peer set named in "
                             f"the same point: {p[:110]!r}")

        if trig.count("->") < 2:
            raise SystemExit(f"{sym}: trigger is one-sided — a wish, not a trigger")

        if "tech_net_score_scaled</code> is" in body and "NULL" not in body:
            raise SystemExit(f"{sym}: tech_net_score_scaled mentioned without "
                             f"saying it is NULL")

        if " band of " in body and sym not in BAND_QUOTABLE:
            band = row.get("pe_band") or {}
            raise SystemExit(f"{sym}: quotes an own-history band, but it fails "
                             f"the n>=8, lo>=4.0, hi<=100 rule "
                             f"(n={band.get('n')}, lo={band.get('lo')}, "
                             f"hi={band.get('hi')})")

        # Choice 5: the two metrics that look like pass rates and are not.
        if "np_consistency" in body and "not a pass rate" not in body:
            raise SystemExit(f"{sym}: quotes np_consistency without saying it "
                             f"is an index from 0 to 2, not a pass rate")
        bad = re.search(r"inflation in \d+ of (?:the last )?(5|7|10)\b", body)
        if bad:
            raise SystemExit(f"{sym}: inflation pass rate written over {bad.group(1)} "
                             f"— the denominator is N-1 (5y->4, 7y->6, 10y->9)")

        _blocker_coverage(sym, blockers, body)

        if sym in BLOCKED:
            for k in ARCIL_ABSENT_CM:
                if cm.get(k) is not None:
                    raise SystemExit(f"{sym}: {k} now reads {cm[k]} — the "
                                     f"data-blocked row is out of date and has "
                                     f"to be rewritten as a verdict")
            for k in ARCIL_ABSENT_SCORE:
                if scores.get(k) is not None:
                    raise SystemExit(f"{sym}: {k} now reads {scores[k]} — "
                                     f"rewrite the row as a verdict")
            if row.get("pe_band"):
                raise SystemExit(f"{sym}: an own-history PE band now exists")
            if row.get("ttm_vs_prior"):
                raise SystemExit(f"{sym}: a TTM-vs-prior comparison now exists")
            for k in ARCIL_PRESENT:
                if cm.get(k) is None:
                    raise SystemExit(f"{sym}: {k} is NULL, but the row quotes "
                                     f"it as the part that reads cleanly")

        evidence = {}
        for k in s["evidence"]:
            if k in DERIVED_KEYS:
                evidence[k] = None
                continue
            if k not in cm:
                raise SystemExit(f"{sym}: evidence key {k} is not a bfsi cluster metric")
            v = cm[k]
            if v is None:
                raise SystemExit(f"{sym}: evidence key {k} is NULL — a verdict must "
                                 f"anchor on fields that can be re-checked")
            evidence[k] = v
        if len(evidence) < 3:
            raise SystemExit(f"{sym}: {len(evidence)} evidence keys, need 3+")

        snap = scores.get("snapshot_date") or pack.get("generated_at", "")[:10]
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
    for r in out:
        print(f"   {r['symbol']:<12} {r['confidence']:<6} {r['verdict'][:84]}")


if __name__ == "__main__":
    main()
