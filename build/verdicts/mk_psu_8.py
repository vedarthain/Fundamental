"""bfsi_nbfc batch 3 — the 8 `infra_psu_lenders`, written as verdicts.

Peer set: `build/verdicts/bfsi_segments.py` -> SEGMENTS["infra_psu_lenders"].
These are state-backed or sector-mandated lenders: cost of funds and policy
allocation move them, not retail credit demand. That is why they were split out
of the retail NBFCs, and it is also why two comparisons that worked in the
housing batch do not work here — see choice 3.

Deliberate choices, recorded so batch 4 does not re-litigate them:

1. **Every row is `medium`.** All 8 carry the cluster-wide balance-sheet-lender
   blocker, so medium is the ceiling (VERDICT_WRITING §5). Three carry a second,
   named blocker — HUDCO (operating margin stepped -8.2pp in one year), IFCI
   (-14.5pp), TFCILTD (a one-time other-income gain of ₹32.7cr pre-tax,
   ₹25.5cr after tax) — and each row states its own. None is data-blocked: all
   8 scored `full` with no suppressed pillars and no stub annual rows.

2. **PFS's operating margin is 105.40% now against 107.98% prior.** A margin
   above 100% is not corruption: for a lender `sales` is interest income while
   operating profit absorbs other income, so the ratio can exceed 1. But it
   cannot be read as a margin, and the scorecard's one-year margin step — the
   only earnings-quality test that IS applied to this cluster — is therefore
   meaningless for PFS. The row says so with both values, per Deb's standing
   instruction to name the untrustworthy field AND its value. The verdict does
   not rest on it: the loan book is shrinking 13.41% a year and quarterly
   profit fell 70.55%, and those are intact.

3. **Four own-history PE bands are refused, and the reason is different from
   the housing batch.** PFC 1.70x, RECLTD 1.82x, HUDCO 2.34x and TFCILTD 0.67x
   lows. In `large_diversified` a sub-4x low was always a split-adjustment
   artefact. Here it is genuinely ambiguous — PSU financiers did trade at 2-3x
   earnings in the 2020 de-rating — and nothing in the pack distinguishes a real
   2020 price from an unadjusted split. Unverifiable is unverifiable, so those
   four are not quoted at all, including their averages, which inherit the same
   contamination. IRFC (4.60-29.01, avg 14.52) and PFS (4.61-45.29, avg 11.73)
   are quoted. IREDA has no band and that is a stated blocker. IFCI has one
   (8.65-95.23) and it is refused for a different reason: the earnings base
   under it includes years of heavy losses, so the multiple is meaningless.

4. **The spine of this batch is PFC and RECLTD against IRFC.** PFC at 4.03x
   earnings and 19.52% ROE versus IRFC at 14.01x and 12.58% — three and a half
   times the multiple for a lower return and a loan book growing 1.70% a year.
   Everything else in the segment is read against that pair.

5. **`roe_excess_13_Ny` is percentage points, not a pass rate.** IFCI's
   -0.258451 is -25.85pp against the 13% hurdle, consistent with its
   `roe_5y` of -12.85%. `np_growth_above_inflation_Ny` IS a pass rate,
   denominator N-1 (5y->4, 7y->6, 10y->9) — VERDICT_WRITING §3. IREDA is
   mature-tier and carries neither test, so its hurdle question is unanswered
   rather than passed, and the row says that rather than implying a pass.

6. **Nothing here is held or watchlisted.** Checked `app.portfolio_holding`
   and `app.user_watchlist`: zero rows for all 8.

7. **TFCILTD's price series carried a dropped 0.2 split factor** at 2025-09-19
   (observed ratio 0.9951, so the ETL treated the series as already
   vendor-adjusted rather than applying the factor). The series is therefore
   internally consistent and its returns are usable, but this is the one name
   in the segment whose +107% relative year rests on that judgement.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_psu_8.py
"""

import json

PACK = "/tmp/psu_pack.json"
OUT = "build/verdicts/psu-8-verdicts.json"
GENERATED_AT = "2026-10-13T18:00:00+00:00"
SOURCE_REPORT = "bfsi-nbfc infra_psu_lenders v1"
MODEL = "claude-opus-4-7"

PEERS = "the 8 state-backed and sector-mandated lenders in this peer set"
TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company on "
       "the platform, so the momentum pillar is computed on 95 of its 100 "
       "declared points.")

SPEC = {

# ----------------------------------------------------------------- accumulate

"PFC": {
 "confidence": "medium",
 "verdict": "ACCUMULATE — 19.52% on equity and a 5.83% dividend at 4.03x earnings and 0.79x book, on the thinnest capital of the 8",
 "points": [
  "<b>Not held, not on your watchlist.</b> Power Finance Corporation, ₹104,943cr, the Government of India's power and infrastructure lender (promoter stake 55.99%) and the largest of " + PEERS + ". Composite 64 inside bfsi_nbfc: quality 57, valuation 67, momentum 31.",
  "<b>The best hurdle record in the segment, on all three windows.</b> <code>roe_excess_13_5y</code> +6.40pp, <code>roe_excess_13_7y</code> +5.68pp and <code>roe_excess_13_10y</code> +4.47pp, with <code>roe_3y</code> 19.52%, <code>roe_5y</code> 19.40% and <code>roe_7y</code> 18.68% — second only to REC on each of the three ROE windows, and second to REC on each of the three excesses. Net profit beat inflation in 4 of the last 4 years, 6 of 6 and 8 of 9, the strongest inflation-beating record of the 8.",
  "<b>And the return is gearing, which is the whole PSU-lender bargain.</b> <code>roa_3y</code> is 1.98%, sixth of the 8, and <code>equity_to_assets</code> 10.14% is the thinnest capital base of the 8 — roughly 9.9x assets to equity. That is only tolerable because the funding is sovereign-adjacent; it is also why the market pays four times earnings and not ten. <code>loan_book_cagr_3y</code> 11.57%, <code>np_cagr_7y</code> 24.01%, <code>book_value_cagr_10y</code> 15.32%.",
  "<b>Growth has gone flat and the dividend is doing the work.</b> TTM sales +4.6%, operating profit +4.9%, net profit +7.1%, with the operating margin steady at 97.14% -> 97.40%; <code>sales_yoy_q</code> is -0.04% and <code>np_yoy_q</code> +2.1%, so the latest quarter is flat on both lines. Against that, <code>div_yield</code> 5.83% is the second-highest of the 8 behind REC's 6.45%. 4.03x earnings and 0.79x book; the own-history PE band is not quoted because its 1.70x low cannot be distinguished from a split-adjustment artefact. <code>ret_12m_rel</code> -15.4%, and the close held above its 200-day EMA on 49.6% of the last 252 sessions. " + TNS,
  "<i>Four times earnings with a 5.8% yield for a 19.5% ROE is the cheapest quality of the 8, and the reason is visible rather than hidden: a 9.9x-geared book whose asset allocation is a policy decision, not a credit decision. You are paid 5.8% a year to hold sovereign-directed lending risk at 0.79x book. Add on weakness; do not pretend the gearing is not there, and do not size it as though the loan book were underwritten commercially.</i>",
 ],
 "trigger": "loan_book_cagr_3y re-accelerating past 14% while roe_3y holds above 18% -> flat growth was the only objection and 4x earnings is indefensible on the downside. np_yoy_q turning negative for two quarters, or equity_to_assets falling under 10% -> a 9.9x-geared lender with no growth, and the 5.8% yield is the whole return.",
 "evidence": ["roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "roa_3y", "equity_to_assets", "pe_ttm", "pb", "div_yield", "loan_book_cagr_3y", "sales_yoy_q"],
},

"HUDCO": {
 "confidence": "medium",
 "verdict": "ACCUMULATE — 27.25% loan-book growth and the highest composite of the 8 at 7.60x earnings, but the operating margin stepped down 8.20pp in one year",
 "points": [
  "<b>Not held, not on your watchlist.</b> Housing and Urban Development Corporation, ₹32,339cr, financing housing and urban infrastructure, 75.00% Government of India. Composite 74 inside bfsi_nbfc — the highest of " + PEERS + " — on quality 61, valuation 57, momentum 44.",
  "<b>Start with the blocker, because it is the reason this is not a clean buy.</b> The pack flags an earnings-quality defect: the operating margin stepped down from <code>opm_prev</code> 99.86% to <code>opm_now</code> 91.66%, a fall of 8.20pp in a single year, and that one-year step is the only earnings-quality test this cluster does apply. It sits alongside <code>ttm_np_pct</code> of +52.98%, the highest of the 8 — profit grew by half while the spread compressed, which means the growth came from volume and mix, not from pricing.",
  "<b>The volume itself is real and it is the second-fastest here.</b> <code>loan_book_cagr_3y</code> 27.25% trails only IREDA's 45.76%, <code>np_cagr_5y</code> 23.82%, and the quarter confirms it: <code>sales_yoy_q</code> +26.55%, <code>np_yoy_q</code> +35.05%, TTM sales +25.9%. <code>roa_3y</code> 2.26% with <code>equity_to_assets</code> 14.98% gives <code>roe_3y</code> 15.39% at about 6.7x gearing — less stretched than PFC, REC or IRFC.",
  "<b>Priced in the cheap half, with a real dividend.</b> 7.60x earnings and 1.47x book, <code>div_yield</code> 3.75%, <code>p_aum</code> 0.20x. The own-history band is not quoted: its 2.34x low has the same ambiguity as PFC's and REC's. Against the hurdle: <code>roe_excess_13_5y</code> +0.81pp and <code>roe_excess_13_7y</code> +0.55pp clear it, <code>roe_excess_13_10y</code> -0.50pp does not — so the 13% clearance is recent, not structural. Net profit beat inflation in 3 of the last 4 years, 4 of 6 and 7 of 9. <code>ret_12m_rel</code> -26.6%. " + TNS,
  "<i>The honest read: this is the best growth-to-price combination of the eight, and the 8.20pp margin step is exactly the kind of thing that precedes a bad year at a lender growing its book 27% annually. Buy it for the growth and the 3.75% yield, and treat the next margin print as the decision point rather than the next profit print — profit is the lagging number here, as +53% on a compressing spread already shows.</i>",
 ],
 "trigger": "opm_now stabilising above 91% while loan_book_cagr_3y stays above 20% -> the step was a one-year mix effect and 7.6x on 27% growth is too cheap. A second consecutive margin step down, or np_yoy_q falling under 15% -> the spread is structurally compressing and 27% book growth becomes the risk rather than the thesis.",
 "evidence": ["opm_now", "opm_prev", "ttm_np_pct", "loan_book_cagr_3y", "roa_3y", "roe_3y", "equity_to_assets", "pe_ttm", "pb", "div_yield", "np_yoy_q"],
},

# ----------------------------------------------------------------------- hold

"RECLTD": {
 "confidence": "medium",
 "verdict": "HOLD — the highest ROE and the highest dividend of the 8, but TTM net profit is down 5.06% and the quarter is negative on both lines",
 "points": [
  "<b>Not held, not on your watchlist.</b> REC Limited, ₹75,771cr, long-term lending to power and infrastructure, 52.63% Government of India. Composite 62 inside bfsi_nbfc: quality 58, valuation 64, momentum 30.",
  "<b>On the long windows it is the best lender in the segment.</b> <code>roe_3y</code> 20.04%, <code>roe_5y</code> 19.78% and <code>roe_7y</code> 18.87% are each the highest of " + PEERS + ", and <code>roe_excess_13_5y</code> +6.78pp, <code>roe_excess_13_7y</code> +5.87pp and <code>roe_excess_13_10y</code> +5.11pp are each the highest too. <code>roa_3y</code> 2.57% is the best of the four large PSU lenders, on <code>equity_to_assets</code> 12.84% — about 7.8x gearing, less than PFC's 9.9x.",
  "<b>But it is the only one of the four large lenders whose trailing profit is shrinking.</b> <code>ttm_np_pct</code> is -5.06% on sales +2.0% and operating profit +0.1%, with the operating margin stepping 97.14% -> 95.26%; <code>np_yoy_q</code> -6.11% and <code>sales_yoy_q</code> -2.05% say the latest quarter is worse, not better. Net profit beat inflation in 3 of the last 4 years, 5 of 6 and 6 of 9 — PFC's record is cleaner on every window.",
  "<b>What you are paid to wait.</b> <code>div_yield</code> 6.45% is the highest of the 8, at 5.01x earnings and 0.90x book, <code>p_aum</code> 0.12x. The own-history band is refused — a 1.82x low is indistinguishable from a split artefact. <code>loan_book_cagr_3y</code> 11.20% and <code>book_value_cagr_10y</code> 10.76%, slower than PFC's 15.32% and IRFC's 18.83%. <code>ret_12m_rel</code> -17.4%, with the close above its 200-day EMA on 17.9% of the last 252 sessions. " + TNS,
  "<i>Hold rather than buy, and the comparison is internal: PFC offers the same business at 4.03x against this 5.01x, with profit still growing where REC's is falling 5%. The 6.45% yield is the best in the segment and it is the reason not to sell. If you want PSU lending exposure, the case for owning both rather than REC alone is weak — the two books overlap almost entirely.</i>",
 ],
 "trigger": "ttm_np_pct returning to positive while roe_3y holds 20% -> the shrinkage was a one-year provision effect and 5x earnings with a 6.45% yield is cheap. np_yoy_q staying negative with the margin stepping down again -> the ROE record is history and the dividend is being paid out of a shrinking book.",
 "evidence": ["roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "roa_3y", "equity_to_assets", "ttm_np_pct", "np_yoy_q", "div_yield", "pe_ttm", "pb", "book_value_cagr_10y"],
},

"IREDA": {
 "confidence": "medium",
 "verdict": "HOLD — a 45.76% three-year loan-book CAGR is the headline and the risk; at 2.26x book with no own-history band and no hurdle record to check it against",
 "points": [
  "<b>Not held, not on your watchlist.</b> Indian Renewable Energy Development Agency, ₹31,182cr, lending to renewable energy and energy-efficiency projects, 71.76% government-held. Composite 41 inside bfsi_nbfc: quality 68 — the highest of " + PEERS + " — valuation 28, momentum 36.",
  "<b>Nothing in this segment grows like this, and that is not a compliment.</b> <code>loan_book_cagr_3y</code> is 45.76%, about 1.7 times HUDCO's 27.25% and the highest of the 8 by a wide margin. A lender tripling its book in three years has not yet seen those loans season; <code>np_cagr_7y</code> 29.07% and TTM net profit +25.9% are what that growth looks like before any of it has been tested by a cycle.",
  "<b>The returns are good and unremarkable for the price.</b> <code>roa_3y</code> 2.07% with <code>equity_to_assets</code> 13.91% produces <code>roe_3y</code> 14.92% at about 7.2x gearing — below PFC's 19.52% and REC's 20.04% while costing far more. TTM sales +19.9%, operating profit +18.4%, operating margin 88.20% -> 87.09%; <code>np_yoy_q</code> +37.12% and <code>sales_yoy_q</code> +15.50%.",
  "<b>Two checks do not exist for this company, and both matter here.</b> It is mature-tier with eight usable annual years, so there is no <code>roe_excess_13_5y</code> and no <code>np_growth_above_inflation_5y</code> — the 13% hurdle question is unanswered, not passed — and the pack carries an explicit blocker for insufficient usable history to derive a PE band. So 18.76x earnings and 2.26x book, the third-highest multiple and second-highest price-to-book of the 8, have nothing historical to sit against. <code>p_aum</code> 0.34x, <code>div_yield</code> 1.22%. <code>ret_12m_rel</code> -28.4% and the close was above its 200-day EMA on 1.6% of the last 252 sessions, the second-lowest of the 8. " + TNS,
  "<i>The uncomfortable part is that the growth and the price are the same fact: you pay 2.26x book and 18.8x earnings for a 14.9% ROE because the book is compounding at 46%, and the first credit cycle in renewables lending will decide whether that was underwriting or origination. There is no own history to check and no hurdle record to lean on. Hold it on a watchlist rather than in the portfolio until at least one seasoned cohort is visible.</i>",
 ],
 "trigger": "loan_book_cagr_3y moderating toward 30% while roa_3y holds above 2% -> growth is being controlled and the premium is earned. roa_3y falling under 1.7% while the book keeps compounding above 40% -> the growth was bought with credit risk, which is the standard way a policy-mandated lender fails.",
 "evidence": ["loan_book_cagr_3y", "roa_3y", "roe_3y", "equity_to_assets", "np_cagr_7y", "pe_ttm", "pb", "p_aum", "pct_above_200ema_252d", "np_yoy_q"],
},

# ---------------------------------------------------------------------- avoid

"IRFC": {
 "confidence": "medium",
 "verdict": "AVOID — 14.01x earnings and 1.77x book for a 12.58% ROE on a loan book growing 1.70% a year, against PFC at 4.03x and 19.52%",
 "points": [
  "<b>Not held, not on your watchlist.</b> Indian Railway Finance Corporation, ₹100,706cr, the Ministry of Railways' rolling-stock financier (promoter stake 82.90%), with 5,086,488 shareholders — the widest retail register of " + PEERS + " by a factor of two. Composite 20 inside bfsi_nbfc, the second-lowest of the 8: quality 45, valuation 45, momentum 31.",
  "<b>The comparison inside its own segment is the verdict.</b> 14.01x earnings and 1.77x book against PFC's 4.03x and 0.79x — three and a half times the multiple — for <code>roe_3y</code> 12.58% against PFC's 19.52%, and <code>roa_3y</code> 1.34%, the second-lowest of the 8. <code>equity_to_assets</code> 10.63% is nearly as thin as PFC's 10.14%, so it is not buying safety with the premium either.",
  "<b>The book has stopped growing almost entirely.</b> <code>np_cagr_5y</code> is 3.58%, the lowest of the 8, and <code>loan_book_cagr_3y</code> 1.70% is the slowest of the seven books here that are still growing. Net profit beat inflation in 1 of the last 4 years, 3 of 6 and 6 of 9 — the weakest four-year record here. Against the hurdle, <code>roe_excess_13_5y</code> +0.31pp barely clears while <code>roe_excess_13_7y</code> -0.23pp and <code>roe_excess_13_10y</code> -0.91pp do not.",
  "<b>A cost-plus lender priced as a growth asset.</b> <code>opm_now</code> 98.91% against <code>opm_prev</code> 99.38% is the highest readable margin of the 8 — only PFS's unreadable 105.40% is above it — and reflects a pure sovereign-spread structure, not pricing power. TTM sales +4.9%, operating profit +4.4%, net profit +7.8%, and the quarter is better than the year (<code>sales_yoy_q</code> +19.46%, <code>np_yoy_q</code> +10.40%). It trades at 14.01x against an own-history band of 4.60x to 29.01x averaging 14.52x over six years — essentially on its own average, so there is no valuation support below. <code>div_yield</code> 2.73%, <code>ret_12m_rel</code> -37.0%, the worst of the 8, and the close was above its 200-day EMA on 2.0% of the last 252 sessions. " + TNS,
  "<i>The railway-financing mandate is as safe as Indian credit gets, and that is precisely why it should not cost 14x earnings: a cost-plus lender earning a fixed spread on government-directed assets is a bond with equity volatility. You can own the identical risk in PFC at a third of the multiple and a higher return. Avoid — not because it is a bad institution, but because the price assumes growth that a 1.70% book CAGR says is not coming.</i>",
 ],
 "trigger": "loan_book_cagr_3y crossing 10% with roe_3y moving above 15% -> the mandate is expanding again and 14x can be grown into. pe_ttm holding above 12x while the book stays flat and ret_12m_rel keeps lagging -> the de-rating toward the PSU-lender norm of 4-6x earnings has further to run.",
 "evidence": ["pe_ttm", "pb", "roe_3y", "roa_3y", "equity_to_assets", "loan_book_cagr_3y", "np_cagr_5y", "opm_now", "div_yield", "ret_12m_rel", "shareholders"],
},

"TFCILTD": {
 "confidence": "medium",
 "verdict": "AVOID — up 107.30% relative in a year to 49.98x earnings and 4.89x book, on an 8.76% ROE and a profit figure the pack flags as containing a one-time gain",
 "points": [
  "<b>Not held, not on your watchlist.</b> Tourism Finance Corporation of India, ₹6,426cr, rupee loans, leasing and guarantees. Composite 33 inside bfsi_nbfc: quality 51, valuation 11 — the lowest of " + PEERS + " — momentum 81, the highest of the 8.",
  "<b>The momentum is extraordinary and it is the entire story.</b> <code>ret_12m_rel</code> +107.30%, <code>ret_6m_rel</code> +121.56% and <code>ret_3m_rel</code> +107.73% are each the best of the 8 by more than 85 percentage points, and the close finished above its 200-day EMA on 99.60% of the last 252 sessions. Note one data caveat specific to this name: a 0.2 split factor was dropped from its price series at 2025-09-19 because no matching step was observed, so these returns rest on the series already being vendor-adjusted.",
  "<b>The earnings underneath do not support it, and the pack says why.</b> A stated blocker: profit includes a one-time other-income gain of ₹32.7cr pre-tax, ₹25.5cr after tax. Against that, <code>pb</code> 4.89x is the highest of the 8 and <code>pe_ttm</code> 49.98x the second-highest — more than twelve times PFC's earnings multiple — and <code>p_aum</code> 2.99x means the market pays three times the loan book. <code>roe_3y</code> 8.76%, <code>roe_5y</code> 8.81% and <code>roe_7y</code> 9.28% have never been near the 13% hurdle: <code>roe_excess_13_5y</code> -4.19pp, <code>roe_excess_13_7y</code> -3.72pp, <code>roe_excess_13_10y</code> -2.92pp.",
  "<b>And it is barely lending.</b> <code>loan_book_cagr_3y</code> 5.66% with <code>equity_to_assets</code> 54.71% — the highest of the 8, so <code>roa_3y</code> 4.79% converts into only an 8.76% ROE because the balance sheet is half equity and under-deployed. Net profit beat inflation in 2 of the last 4 years, 2 of 6 and 4 of 9, the weakest record of the 8 on the seven- and ten-year windows. Promoters hold just 3.85% and there are 74,382 shareholders, the fewest of the 8. <code>div_yield</code> 0.43%. " + TNS,
  "<i>A 49.98x multiple on a 8.76% ROE, with a flagged one-time gain inside the earnings and a promoter holding 3.85%, after a 107% relative run — that is a re-rating in search of a reason, and the under-deployed balance sheet means there is no engine to grow into it. Avoid. If you want the asset-rich angle, note that half the balance sheet being equity is also what makes the ROE permanently mediocre.</i>",
 ],
 "trigger": "loan_book_cagr_3y moving above 20% as the equity base gets deployed, with roe_3y crossing 13% -> the balance sheet starts working and the multiple has something to grow into. np_yoy_q turning negative once the one-time gain laps, or ret_3m_rel rolling over -> a 50x multiple with nothing underneath it unwinds faster than it built.",
 "evidence": ["ret_12m_rel", "ret_6m_rel", "pct_above_200ema_252d", "pe_ttm", "pb", "p_aum", "roe_3y", "roe_excess_13_10y", "roa_3y", "equity_to_assets", "loan_book_cagr_3y", "promoter_pct"],
},

"PFS": {
 "confidence": "medium",
 "verdict": "AVOID — a loan book shrinking 13.41% a year and quarterly profit down 70.55%, and the one earnings-quality test this cluster applies cannot be read for it",
 "points": [
  "<b>Not held, not on your watchlist.</b> PTC India Financial Services, ₹1,850cr, a subsidiary of PTC India. Composite 32 inside bfsi_nbfc: quality 44, valuation 72, momentum 22 — the lowest momentum of " + PEERS + ".",
  "<b>Name the untrustworthy figure first: the operating margin.</b> <code>opm_now</code> is 105.40% and <code>opm_prev</code> 107.98%. A margin above 100% is not a corrupted number for a lender — <code>sales</code> is interest income while operating profit absorbs other income — but it cannot be read as a margin, and the one-year margin step is the ONLY earnings-quality test applied to this cluster. For this company that test is unusable, so the quality pillar's 44 should not be leaned on.",
  "<b>What is intact is bad enough to decide on.</b> <code>loan_book_cagr_3y</code> is -13.41% — the only shrinking book of " + PEERS + " — <code>ttm_sales_pct</code> -22.8% and <code>ttm_op_pct</code> -24.6% are each the worst of the 8 and <code>ttm_np_pct</code> -27.9% the second-worst, and the latest quarter is worse again: <code>np_yoy_q</code> -70.55% and <code>sales_yoy_q</code> -27.20%. <code>book_value_cagr_10y</code> 2.72% is the lowest of the seven here with a ten-year record.",
  "<b>Cheap, and correctly so.</b> 0.60x book is the cheapest of the 8 and <code>pe_ttm</code> 10.79x is mid-pack on earnings that are falling 28%. <code>roe_3y</code> 8.19%, <code>roe_5y</code> 7.50% and <code>roe_7y</code> 6.28% are each below the 13% hurdle by <code>roe_excess_13_5y</code> -5.50pp, <code>roe_excess_13_7y</code> -6.72pp and <code>roe_excess_13_10y</code> -6.81pp, on <code>equity_to_assets</code> 49.84% — so like TFCILTD, half the balance sheet is equity and it still cannot earn. Its own-history band is 4.61x to 45.29x averaging 11.73x over nine years. No dividend, and the close was above its 200-day EMA on 0.4% of the last 252 sessions, the lowest of the 8. " + TNS,
  "<i>This is a lender in run-off: the book is contracting, the revenue line is down 23%, and the quarter's profit fell 70%. 0.60x book sounds like a floor until you notice that a shrinking book at 8% ROE has no terminal value worth discounting. Avoid — and note that the one test which would have told you about earnings quality is the one number here that cannot be read.</i>",
 ],
 "trigger": "loan_book_cagr_3y returning to positive with np_yoy_q recovering above zero -> the contraction was deliberate de-risking and 0.60x book on a 50%-equity balance sheet is an asset play. The book shrinking for another two quarters -> this is a liquidation at 0.6x book with no dividend, and the discount is the market pricing the run-off correctly.",
 "evidence": ["loan_book_cagr_3y", "ttm_sales_pct", "ttm_np_pct", "np_yoy_q", "roe_3y", "roe_excess_13_10y", "equity_to_assets", "pb", "pe_ttm", "book_value_cagr_10y", "opm_now", "opm_prev"],
},

"IFCI": {
 "confidence": "medium",
 "verdict": "AVOID — 187.75x earnings and 1.96x book for a 2.09% three-year ROE, built on five- and seven-year ROEs of -12.85% and -17.22%",
 "points": [
  "<b>Not held, not on your watchlist.</b> IFCI Limited, ₹17,551cr, financial assistance and advisory as an NBFC, 72.57% government-held. Composite 8 inside bfsi_nbfc — the lowest of " + PEERS + " — on quality 27, valuation 33, momentum 46.",
  "<b>The multiple is the finding.</b> <code>pe_ttm</code> 187.75x is the highest of the 8 by a factor of nearly four over TFCILTD's 49.98x, on <code>roe_3y</code> 2.09% and <code>roa_3y</code> 0.63%, both the lowest of the 8. <code>p_aum</code> 1.75x means the market pays nearly twice the loan book for it. Its own-history PE band is not quoted: the earnings base beneath it contains years of heavy losses, which makes any historical multiple meaningless rather than merely wide.",
  "<b>The losses are the record, not an episode.</b> <code>roe_5y</code> is -12.85% and <code>roe_7y</code> -17.22%, so <code>roe_excess_13_5y</code> -25.85pp, <code>roe_excess_13_7y</code> -30.22pp and <code>roe_excess_13_10y</code> -25.87pp — each the worst of the 8 by more than 19 percentage points. <code>np_consistency_10y</code> 0.75 is the only reading below 1.4 in the segment. Net profit beat inflation in 3 of the last 4 years, 3 of 6 and 5 of 9, which is the recovery, not the history.",
  "<b>And the recovery is already reversing.</b> A second stated blocker: the operating margin stepped down 14.5pp in one year, from <code>opm_prev</code> 63.19% to <code>opm_now</code> 48.64% — the largest step in the segment and the lowest margin in it. <code>ttm_op_pct</code> -19.3% is the second-worst of the 8 and <code>ttm_np_pct</code> -45.3% the worst, with <code>np_yoy_q</code> -16.10% and <code>sales_yoy_q</code> -19.68%. Yet <code>ret_12m_rel</code> is +17.37%, the second-best of the 8, and the close held above its 200-day EMA on 70.6% of the last 252 sessions. No dividend. " + TNS,
  "<i>A stock up 17% relative over a year while its operating margin falls 14.5 points and trailing profit falls 45% is being bought for the government stake and the asset-restructuring story, not for anything in this pack. At 187.75x earnings on a 2.09% ROE there is no price support beneath it if that story stalls. Avoid — this is the clearest case in the segment, and the 1.96x book is not cheap for a balance sheet that lost money for most of the last seven years.</i>",
 ],
 "trigger": "roe_3y crossing 10% with the operating margin recovering above 60% -> the restructuring is real and the earnings base is being rebuilt. opm_now falling under 45%, or np_yoy_q staying negative -> the 2.09% ROE was the peak of the recovery and 187x earnings has nothing underneath it.",
 "evidence": ["pe_ttm", "pb", "p_aum", "roe_3y", "roe_5y", "roe_7y", "roe_excess_13_7y", "roa_3y", "opm_now", "opm_prev", "ttm_np_pct", "ret_12m_rel"],
},

}

DERIVED_KEYS = {"pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
                "delivery_pct", "pledge_pct"}

LABELS = ("BUY", "ACCUMULATE", "HOLD", "AVOID", "REDUCE", "SELL", "SPECULATIVE")

# Bands whose low is below 4x are refused for this segment (see docstring
# choice 3). Quoting one is a bug, so the guard checks the prose.
BAND_QUOTABLE = {"IRFC", "PFS"}


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}

    if set(SPEC) != set(rows):
        raise SystemExit(f"spec/pack mismatch: "
                         f"spec-only={sorted(set(SPEC) - set(rows))} "
                         f"pack-only={sorted(set(rows) - set(SPEC))}")

    import importlib.util
    spec_mod = importlib.util.spec_from_file_location(
        "bfsi_segments", "build/verdicts/bfsi_segments.py")
    seg = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(seg)
    if set(seg.SEGMENTS["infra_psu_lenders"]) != set(rows):
        raise SystemExit("pack is not the infra_psu_lenders segment — every "
                         "'of the 8' superlative in this file is scoped wrong")

    out = []
    for sym, s in SPEC.items():
        row = rows[sym]
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        blockers = row.get("blockers") or []
        points, verdict, trig = s["points"], s["verdict"], s["trigger"]
        conf = s["confidence"]

        if len(points) != 5:
            raise SystemExit(f"{sym}: {len(points)} points, a writable row takes 5")
        if verdict.split(" —")[0] not in LABELS:
            raise SystemExit(f"{sym}: label must open with one of {LABELS}, "
                             f"got {verdict[:20]!r}")
        if len(verdict.split("—", 1)[1].strip()) < 30:
            raise SystemExit(f"{sym}: headline says nothing after the label")

        if not any("balance-sheet lender" in b for b in blockers):
            raise SystemExit(f"{sym}: lost the cluster-wide lender blocker — "
                             f"the confidence ceiling needs re-deciding")
        if conf != "medium":
            raise SystemExit(f"{sym}: {conf} confidence, but this segment is "
                             f"medium by construction")

        if not points[0].startswith("<b>"):
            raise SystemExit(f"{sym}: point one has no <b> lead")
        if not points[-1].startswith("<i>"):
            raise SystemExit(f"{sym}: the last point is not italicised")
        for i, p in enumerate(points[:-1]):
            if not p.startswith("<b>"):
                raise SystemExit(f"{sym}: point {i+1} has no <b> lead sentence")
        if "Not held" not in points[0]:
            raise SystemExit(f"{sym}: point one does not state the holding status")

        if sum(p.count("<code>") for p in points) < 4:
            raise SystemExit(f"{sym}: fewer than 4 <code> field names across the row")

        body = " ".join(points)
        for word in ("highest", "lowest", "cheapest", "best", "worst", "fastest",
                     "slowest", "richest"):
            if word in body.lower() and "of the 8" not in body \
                    and "in the set" not in body and "in this segment" not in body \
                    and "of " + PEERS not in body:
                raise SystemExit(f"{sym}: uses '{word}' with no peer set named")

        if trig.count("->") < 2:
            raise SystemExit(f"{sym}: trigger is one-sided — a wish, not a trigger")

        if "tech_net_score_scaled</code> is" in body and "NULL" not in body:
            raise SystemExit(f"{sym}: tech_net_score_scaled mentioned without "
                             f"saying it is NULL")

        # Choice 3: only IRFC and PFS have a band whose low survives scrutiny.
        if "own-history band of" in body and sym not in BAND_QUOTABLE:
            raise SystemExit(f"{sym}: quotes an own-history band, but its low "
                             f"({(row.get('pe_band') or {}).get('lo')}) is not "
                             f"distinguishable from a split artefact")

        # Each row carrying a SECOND blocker has to name it, with its value.
        extra = [b for b in blockers if "balance-sheet lender" not in b]
        if extra and sym == "HUDCO" and "8.20pp" not in body:
            raise SystemExit("HUDCO: the margin-step blocker is not named with its value")
        if extra and sym == "IFCI" and "14.5pp" not in body:
            raise SystemExit("IFCI: the margin-step blocker is not named with its value")
        if extra and sym == "TFCILTD" and "32.7cr" not in body:
            raise SystemExit("TFCILTD: the one-time-gain blocker is not named with its value")

        # Deb's standing instruction, applied to the one impossible figure here.
        if sym == "PFS" and ("105.40" not in body or "107.98" not in body):
            raise SystemExit("PFS: the >100% operating margin must be named with "
                             "both values — it is the untrustworthy field in this row")

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

        scores = row.get("scores") or {}
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
        print(f"   {r['symbol']:<10} {r['confidence']:<6} {r['verdict'][:88]}")


if __name__ == "__main__":
    main()
