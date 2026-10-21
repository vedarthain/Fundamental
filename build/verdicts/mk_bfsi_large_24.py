"""bfsi_nbfc batch 1 — the 24 `large_diversified` names, written as verdicts.

Peer set: `build/verdicts/bfsi_segments.py` -> SEGMENTS["large_diversified"].
Every superlative in this file is scoped to those 24 and says so in the prose,
because "cheapest of the cluster" across all 185 bfsi_nbfc names puts a gold
lender, an AMC and a dormant holding company in the same sentence.

Deliberate choices, recorded so batch 2 does not re-litigate them:

1. **Nothing here can be `high` confidence, and that is not a hedge.** All 24
   carry the cluster-wide blocker that the cash-conversion and
   net-profit-vs-operating-profit earnings-quality tests are not applied to a
   balance-sheet lender. VERDICT_WRITING §5 says high confidence requires zero
   blockers. So the ceiling is `medium`, by construction, for the whole
   cluster — and `low` where a *second* defect removes the deciding number.

2. **`tech_net_score_scaled` is NULL for all 3,061 scored symbols** on the
   platform, in every cluster, while being declared as a 5-point momentum
   component. Every momentum percentile here is therefore renormalised onto
   95 of 100 points. It is named once per row rather than ignored, because a
   pillar scored on partial weight must be read as direction only.

3. **ROA leads, ROE follows.** For a lender the two differ by gearing, and in
   this set gearing ranges from 1.1x (JIOFIN, 90.1% equity-to-assets) to 57x
   (CENTRUM, 1.74%). Quoting ROE without `equity_to_assets` beside it compares
   a conservatively funded book with a stretched one and calls them equal.

4. **The own-history PE band is quoted for exactly two names.** Nine of the
   bands carry a low below 4x (SHRIRAMFIN 1.16x, PAISALO 0.64x, RELIGARE
   1.52x, BAJFINANCE 2.53x, BAJAJFINSV 2.17x), which is a split-adjustment
   artefact, not a price anyone paid. ABCAPITAL (7.74–46.35) and SUNDARMFIN
   (14.79–32.02) are plausible and are used; the rest are left out rather than
   quoted with a caveat nobody reads.

5. **`roe_excess_13_Ny` is an excess in percentage points, not a pass rate.**
   RELIGARE's -1.6409 on the seven-year window is -164pp against the 13%
   hurdle, consistent with its roe_7y of -151%. It is NOT "1.6 of 7 years".
   `np_growth_above_inflation_Ny` IS a pass rate, denominator N-1 (5y->4,
   7y->6, 10y->9) — VERDICT_WRITING §3.

6. **Base effects get both levels.** IIFL's TTM net profit is +548.8% and
   POONAWALLA's TTM operating profit is +215.6%. Each is stated with the
   margin levels on both sides, because the percentage alone is a lie.

7. UGROCAP is the one data-blocked row: 13 of 29 metrics resolved, composite
   suppressed because the quality pillar did not resolve, and that pillar
   scored on **8 of its 100 declared points**. It takes three points and the
   `WATCH — no verdict:` label, per VERDICT_WRITING §6.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_bfsi_large_24.py
"""

import json

PACK = "build/verdicts/bfsi-large-24.json"
OUT = "build/verdicts/bfsi-large-24-verdicts.json"
GENERATED_AT = "2026-10-13T12:00:00+00:00"
SOURCE_REPORT = "bfsi-nbfc large_diversified v1"
MODEL = "claude-opus-4-7"

PEERS = "the 24 large diversified NBFCs in this peer set"
TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company on "
       "the platform, so the momentum pillar is computed on 95 of its 100 "
       "declared points.")

SPEC = {

# ---------------------------------------------------------------- held (4)

"ABCAPITAL": {
 "confidence": "medium",
 "verdict": "HOLD — an 11.6% three-year ROE built out of a 10.9% capital base: the return is gearing, not asset yield",
 "points": [
  "<b>Your ₹4,943 (13 shares at ₹357.65, now ₹380.25 — up 6.3%).</b> Aditya Birla Capital, ₹102,681cr, lending alongside asset management, insurance and broking under one holding company. Composite 54 inside bfsi_nbfc: quality 57, valuation 27, momentum 68.",
  "<b>The equity return is borrowed, not earned.</b> <code>roa_3y</code> is 1.27%, sixth-lowest of " + PEERS + ", and it becomes an 11.6% three-year ROE only because <code>equity_to_assets</code> is 10.92% — the third-thinnest capital base of the 24, behind Centrum at 1.74% and level with Bajaj Finserv and Edelweiss at 10.87%. Against the scorecard's 13% hurdle the five-year average ROE clears by 0.88pp and the seven-year misses by 0.87pp.",
  "<b>The book itself is compounding properly.</b> <code>loan_book_cagr_3y</code> 22.92%, <code>book_value_cagr_10y</code> 20.12%, and net profit beat inflation in 2 of the last 4 years, 4 of 6 and 6 of 9. TTM against prior TTM: sales +16.3%, operating profit +19.7%, net profit +16.8%, with operating margin moving 35.90% -> 36.95%.",
  "<b>Priced above its own history, and momentum is the reason.</b> 25.76x earnings against an own-history band of 7.74x to 46.35x averaging 19.81x over nine years, and 2.98x book. The 12-month relative return of +24.5% is second only to Paisalo among the 24, and the close sat above the 200-day EMA on 96.8% of the last 252 sessions. <code>div_yield</code> is NULL, and " + TNS,
  "<i>Up 6.3% on cost, and worth holding — but know what it is: a 1.3%-return-on-assets lender geared roughly nine times, where the equity return is a function of funding cost rather than of pricing power. Promoters 68.81%, FIIs 7.94%, DIIs 13.36%. The question is not growth — the book is growing fine — it is whether asset yield ever rises enough that the ROE would survive a thicker capital base.</i>",
 ],
 "trigger": "roa_3y moving above 1.8% while loan_book_cagr_3y holds above 20% -> the ROE stops depending on gearing and the premium to its own PE average is earned. roa_3y stuck near 1.3% while the +24.5% relative return unwinds -> a leveraged spread business at 2.98x book with nothing left defending the multiple.",
 "evidence": ["roa_3y", "roe_3y", "equity_to_assets", "pb", "pe_ttm", "loan_book_cagr_3y", "book_value_cagr_10y", "ret_12m_rel"],
},

"CHOLAFIN": {
 "confidence": "medium",
 "verdict": "HOLD — 17.55% on equity, second-best of the 24, earned on 2.14% of assets, at the second-highest price-to-book",
 "points": [
  "<b>Your ₹9,484 (6 shares at ₹1,725.50, now ₹1,580.70 — down 8.4%).</b> Cholamandalam Investment and Finance, ₹134,990cr, vehicle finance widened into home loans, loan-against-property and SME. Composite 70: quality 69, valuation 25, momentum 59.",
  "<b>The quality is real and it is not a leverage trick.</b> <code>roa_3y</code> 2.14% with <code>equity_to_assets</code> 12.21% gives a 17.55% three-year ROE — second-highest of " + PEERS + ", behind only Bajaj Finance at 17.58%. The five-year average clears the 13% hurdle by 4.90pp and the ten-year by 4.22pp; on the ten-year window only Bajaj Finance clears by more. Net profit beat inflation in 4 of the last 4 years, 6 of 6 and 8 of 9.",
  "<b>Fastest-growing book of the large lenders.</b> <code>loan_book_cagr_3y</code> 29.27%, third-highest of the 24 behind Poonawalla's 37.43% and Tata Capital's 28.91% — and unlike those two it is doing it on a ten-year book value CAGR of 24.31%, so the growth is not new. TTM sales +19.6%, operating profit +17.5%, net profit +29.1%, operating margin 69.85% -> 68.58%.",
  "<b>You are paying for all of it.</b> 4.43x book is the second-richest of the 24, behind only Bajaj Finance at 5.18x and ahead of Paisalo at 4.07x; 23.47x earnings; 0.57x of loan book. FIIs hold 24.46%, the second-highest foreign ownership in the set after Shriram's 54.75%, which is the crowding risk. <code>div_yield</code> is 0.13% — this is not an income holding. " + TNS,
  "<i>Down 8.4% on your cost and the business has not deteriorated: the de-rating is the multiple, not the book. The honest risk is that 4.4x book prices continued 29% growth at 17% ROE, and the vehicle-finance cycle has never delivered that for a decade uninterrupted. A quarter of credit-cost normalisation would hit the price harder than the earnings.</i>",
 ],
 "trigger": "roe_3y holding above 17% while loan_book_cagr_3y stays above 25% for another two quarters -> the 4.4x book is defensible and the drawdown was multiple compression, nothing more. Credit costs pushing roa_3y below 1.8%, or the 24.46% FII holding reversing -> the valuation has 40% of air in it and no yield underneath.",
 "evidence": ["roa_3y", "roe_3y", "equity_to_assets", "loan_book_cagr_3y", "book_value_cagr_10y", "pb", "pe_ttm", "fii_pct"],
},

"M&MFIN": {
 "confidence": "medium",
 "verdict": "HOLD — cheap for a structural reason: a 10.3% three-year ROE that has missed the 13% hurdle on every window measured",
 "points": [
  "<b>Your ₹18,377 (57 shares at ₹375.50, now ₹322.40 — down 14.1%), the largest loss of your four holdings in this set.</b> Mahindra & Mahindra Financial Services, ₹44,451cr, rural and semi-urban vehicle finance. Composite 64: quality 52, valuation 53, momentum 62.",
  "<b>The return on equity has never cleared its hurdle.</b> <code>roe_3y</code> is 10.31%, and <code>roe_excess_13_5y</code>, <code>roe_excess_13_7y</code> and <code>roe_excess_13_10y</code> are -3.24pp, -4.04pp and -3.17pp — the five-, seven- and ten-year averages all sit below 13%. <code>roa_3y</code> of 1.64% is tenth of " + PEERS + " and <code>equity_to_assets</code> is a middling 15.95%, so there is no gearing story hiding a better business underneath.",
  "<b>Growth is slow and the recent quarter is a recovery, not a trend.</b> <code>loan_book_cagr_3y</code> 14.72% is sixth-slowest of the 24. TTM sales +13.6%, operating profit +14.7%, net profit +41.9% — the profit figure is credit-cost normalisation, with operating margin moving 62.80% -> 63.43%, a step of less than one point. Ten-year book value CAGR 16.08%.",
  "<b>What you get for the low price.</b> 13.67x earnings and 1.67x book, both in the cheapest third of the 24, and <code>div_yield</code> 2.34% — the second-highest yield in the set behind JM Financial's 2.63%. Domestic institutions hold 31.48%, the highest DII stake of the 24. " + TNS,
  "<i>This is not mispriced, it is priced. A lender that earns 10% on equity through the cycle is worth less than book-value-plus, and 1.67x already assumes improvement. You are down 14% and collecting 2.3% a year to wait. The case for holding is the yield plus the rural-cycle option; the case against is that the same sub-hurdle ROE has now been true across three separate measurement windows.</i>",
 ],
 "trigger": "roe_3y crossing 13% with roa_3y above 2.0% -> the structural discount stops being structural and 1.67x book is too low. np_yoy_q turning negative again while loan_book_cagr_3y stays under 15% -> the 2.3% yield is all you are being paid, and the position is dead money.",
 "evidence": ["roe_3y", "roa_3y", "roe_excess_13_5y", "roe_excess_13_10y", "equity_to_assets", "pb", "pe_ttm", "div_yield", "loan_book_cagr_3y"],
},

"SUNDARMFIN": {
 "confidence": "medium",
 "verdict": "HOLD — one of only five of the 24 clearing the 13% hurdle on all five-, seven- and ten-year windows, at 22x and mid-band on its own history",
 "points": [
  "<b>Your ₹12,546 (3 shares at ₹4,606.10, now ₹4,182.00 — down 9.2%).</b> Sundaram Finance, ₹48,840cr, commercial-vehicle and asset finance, the conservative end of the TVS group. Composite 46: quality 57, valuation 32, momentum 48.",
  "<b>Dull and reliable is the whole thesis.</b> <code>roe_3y</code> 13.68% with <code>roe_excess_13_5y</code> +0.55pp, <code>roe_excess_13_7y</code> +0.53pp and <code>roe_excess_13_10y</code> +1.04pp — it is one of only five of " + PEERS + " clearing the 13% hurdle on all three windows — the others are Bajaj Finance, Chola, Shriram and IIFL — and the only one of those five whose excess is positive on every window yet never above 1.1pp, which is what a franchise with no leverage trick looks like. <code>equity_to_assets</code> 17.37%, comfortably above the 10.9% that Aditya Birla Capital and Bajaj Finserv run.",
  "<b>Growth is deliberately modest.</b> <code>loan_book_cagr_3y</code> 15.23% is eighth-slowest of the 24 and <code>np_cagr_5y</code> 15.09% is the fourth-slowest — but net profit beat inflation in 4 of the last 4 years, 5 of 6 and 7 of 9. Operating margin 78.75% is the highest in the set. TTM sales +13.7%, operating profit +12.7%, net profit +15.6%.",
  "<b>Full price, but inside its own range.</b> 22.00x earnings against an own-history band of 14.79x to 32.02x averaging 22.48x over ten years — the one name here whose PE band is both usable and says something, namely that the stock is sitting almost exactly on its decade average. 3.28x book, <code>div_yield</code> 0.90%, FIIs 18.58%. " + TNS,
  "<i>You are 9.2% underwater on a business that did nothing wrong. The multiple is at its own average, not below it, so there is no valuation support to catch a fall — the support is the 13%-plus ROE repeating. Hold it for that, not for a re-rating. The risk that matters is commercial-vehicle cyclicality meeting 3.3x book.</i>",
 ],
 "trigger": "loan_book_cagr_3y accelerating past 20% with roe_3y holding 13%-plus -> the growth discount against Chola closes and 3.3x book is cheap. roe_3y slipping under 13% for two consecutive windows -> the only thing distinguishing this from M&M Financial is gone, and it trades at twice M&M's book multiple.",
 "evidence": ["roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "roa_3y", "equity_to_assets", "pb", "pe_ttm", "opm_now", "loan_book_cagr_3y"],
},

# ------------------------------------------------------- the compounders

"BAJFINANCE": {
 "confidence": "medium",
 "verdict": "HOLD — second-best return on assets, best book-value compounding and the highest price-to-book of the 24, all at once",
 "points": [
  "<b>Not held.</b> Bajaj Finance, ₹590,407cr, the largest consumer and SME lender in the set and the benchmark the other 23 are measured against. Composite 75: quality 74, valuation 19, momentum 57.",
  "<b>Nothing else in the set earns like this.</b> <code>roa_3y</code> 3.60% is the highest of " + PEERS + " bar Paisalo's 3.97%, and it is earned on <code>equity_to_assets</code> of 20.51% — a thick capital base, so the 17.58% three-year ROE is asset yield rather than gearing. <code>roe_excess_13_5y</code> +4.99pp, <code>roe_excess_13_10y</code> +4.34pp: the widest spread over the 13% hurdle of any name in the set with an unbroken positive record, and the widest ten-year spread outright. Religare's +28.90pp five-year reading is higher only because it divides by a collapsed equity base.",
  "<b>Ten years of compounding, not three.</b> <code>book_value_cagr_10y</code> 31.64% is the highest of the 24 by nearly three points over Mas Financial's 29.81%, and net profit beat inflation in 4 of the last 4 years, 5 of 6 and 8 of 9. <code>loan_book_cagr_3y</code> 26.71%. TTM sales +17.8%, operating profit +17.0%, net profit +16.5%, operating margin 68.63% -> 68.14%.",
  "<b>The price is the entire argument against it.</b> 5.18x book is the highest of the 24 and 1.12x of loan book is second only to Paisalo's 1.18x and the distorted readings at Jio Financial and Religare. 29.08x earnings. The 12-month relative return is -9.8%, so the de-rating has started. FIIs 20.20%, <code>div_yield</code> 0.63%. " + TNS,
  "<i>There is no argument about the business and there has not been for a decade. The argument is arithmetic: 5.2x book on a 17.6% ROE prices in roughly a decade of that ROE continuing with the book still growing in the mid-twenties. That has been the right bet for ten years and it gets harder, not easier, at ₹590,000cr. Not a short; a name where the entry price does all the work.</i>",
 ],
 "trigger": "pb falling toward 3.5x with roa_3y still above 3% -> the best lender in the set at a price that no longer requires perfection. roa_3y dropping below 3% while loan_book_cagr_3y slows under 20% -> a 5.2x multiple on a decelerating compounder, which is the expensive way to be wrong.",
 "evidence": ["roa_3y", "roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "equity_to_assets", "book_value_cagr_10y", "loan_book_cagr_3y", "pb", "p_aum", "pe_ttm"],
},

"SHRIRAMFIN": {
 "confidence": "medium",
 "verdict": "HOLD — 3.11% on assets and the fastest five-year profit growth of the 24, with 54.75% of the register held by foreigners",
 "points": [
  "<b>Not held.</b> Shriram Finance, ₹222,363cr, used commercial vehicles, two-wheelers and small-business lending — the deep end of the credit curve, which is where the 73.97% operating margin comes from. Composite 60: quality 63, valuation 27, momentum 60.",
  "<b>Earns more on assets than everything here except Bajaj Finance and Paisalo.</b> <code>roa_3y</code> 3.11% with <code>equity_to_assets</code> 19.81% producing a 15.73% three-year ROE, and <code>roe_excess_13_5y</code> +1.28pp, <code>roe_excess_13_7y</code> +0.82pp, <code>roe_excess_13_10y</code> +1.27pp — above the hurdle on every window, though by far less than Bajaj Finance or Chola.",
  "<b>Profit growth leads the set; book growth does not.</b> <code>np_cagr_5y</code> 38.54% is the highest of " + PEERS + ", but <code>loan_book_cagr_3y</code> is 15.13%, seventh-slowest of the 24 — so the five-year profit figure is margin and merger arithmetic more than lending volume. Net profit beat inflation in 3 of 4 years, 4 of 6 and 5 of 9, which is a middling consistency record. TTM sales +14.2%, operating profit +17.2%, net profit +16.8%.",
  "<b>The ownership is the position risk.</b> FIIs hold 54.75% — more than double the next-highest foreign stake in the set (Chola, 24.46%) — while promoters hold only 20.30%. The 12-month relative return is +41.3%, second-best of the 24 behind Paisalo. 3.37x book, 19.65x earnings, 0.73x loan book, <code>div_yield</code> 0.91%. " + TNS,
  "<i>A genuinely good lender whose share register is a crowded foreign trade. The business risk is subprime vehicle credit; the price risk is that 54.75% FII ownership after a +41% relative year means the marginal seller is large and not domestic. Those are two separate risks and they can arrive on different days.</i>",
 ],
 "trigger": "loan_book_cagr_3y accelerating past 20% while roa_3y holds above 3% -> the profit growth gets a volume engine and 3.4x book is justified. fii_pct falling materially below 50% or roa_3y dropping under 2.5% -> a crowded trade unwinding into a credit-cycle turn, which is the combination that does real damage.",
 "evidence": ["roa_3y", "roe_3y", "roe_excess_13_5y", "np_cagr_5y", "loan_book_cagr_3y", "equity_to_assets", "pb", "pe_ttm", "fii_pct", "ret_12m_rel"],
},

"MASFIN": {
 "confidence": "medium",
 "verdict": "HOLD — second-best ten-year book compounding of the 24 at 12.6x earnings and 1.67x book, and almost nobody owns it",
 "points": [
  "<b>Not held.</b> MAS Financial Services, ₹4,951cr, MSME, two-wheeler and small housing finance distributed largely through partner NBFCs. Composite 75: quality 65, valuation 47, momentum 47.",
  "<b>Quietly one of the better records in the set.</b> <code>book_value_cagr_10y</code> 29.81% is second-highest of " + PEERS + " behind Bajaj Finance's 31.64%. <code>roa_3y</code> 2.63% is fifth-highest, on <code>equity_to_assets</code> of 20.56% — well capitalised, so the 12.82% three-year ROE is not leverage. Net profit beat inflation in 4 of 4 years, 5 of 6 and 8 of 9, a consistency record matched only by Bajaj Finance and Chola.",
  "<b>But it does not quite clear the hurdle.</b> <code>roe_excess_13_5y</code> is -0.27pp and <code>roe_excess_13_7y</code> +0.26pp — the five- and seven-year averages straddle 13% rather than beating it, and <code>roe_3y</code> of 12.82% is below both Sundaram's 13.68% and HDB's 14.66%. <code>loan_book_cagr_3y</code> 19.77%. TTM sales +23.1%, operating profit +18.3%, net profit +21.6%, operating margin 73.12% -> 70.25%.",
  "<b>Cheap and unowned.</b> 12.56x earnings is the fourth-lowest of the 24 and 1.67x book the sixth-lowest, on a ten-year compounding record better than most of the names trading at 3x. FIIs hold 3.69% — the third-lowest foreign stake in the set — promoters 66.66%, <code>div_yield</code> 0.73%. The 12-month relative return is -8.6%. " + TNS,
  "<i>The gap between the record and the multiple is the finding. At ₹4,951cr this is a small enough name that institutional neglect is a sufficient explanation, which also means there is no catalyst built into the price. A margin step down at 70.25% versus 73.12% a year ago is the one thing in the numbers that is moving the wrong way.</i>",
 ],
 "trigger": "roe_3y crossing 13% with opm_now recovering toward 73% -> a decade-long compounder clearing its hurdle at 12.6x, which the set does not otherwise offer. opm_now falling below 68% while loan_book_cagr_3y slows under 15% -> the partner-NBFC distribution model is being squeezed and cheap stays cheap.",
 "evidence": ["book_value_cagr_10y", "roa_3y", "roe_3y", "roe_excess_13_7y", "equity_to_assets", "pb", "pe_ttm", "loan_book_cagr_3y", "fii_pct"],
},

# ------------------------------------------------------- cheap and slow

"JMFINANCIL": {
 "confidence": "medium",
 "verdict": "HOLD — the only shrinking loan book of the large lenders, but at 1.11x book, 36.4% equity and the highest yield of the 24",
 "points": [
  "<b>Not held.</b> JM Financial, ₹11,809cr, investment banking and wealth management alongside a wholesale and retail lending book. Composite 39: quality 48, valuation 57, momentum 35.",
  "<b>The book is contracting.</b> <code>loan_book_cagr_3y</code> is -3.40%, the worst of " + PEERS + " — the only three negative readings in the set are this, Edelweiss at -0.65% and Sammaan Capital at -0.31%. TTM is negative on every line: sales -5.2%, operating profit -6.6%, net profit -5.8%, with operating margin 57.25% -> 56.45%. <code>np_yoy_q</code> is -35.7%.",
  "<b>And yet it is one of the better-capitalised, better-earning names here.</b> <code>roa_3y</code> 3.11% is joint-second of the 24 with Shriram, and <code>equity_to_assets</code> 36.37% is the second-highest after Jio Financial's 90.15% — so the 8.18% ROE is low precisely because the balance sheet is unlevered, not because the assets are bad. <code>roe_excess_13_5y</code> -4.61pp.",
  "<b>Priced as a wind-down.</b> 1.11x book is the fourth-lowest of the 24 and 12.91x earnings the fifth-lowest, with <code>div_yield</code> 2.63% — the highest in the set. Own-history PE band 8.34x to 17.96x averaging 12.59x over ten years, so the current 12.91x is mid-band. The 12-month relative return is -26.3%, fourth-worst of the 24. FIIs 16.95%, promoters 57.03%. " + TNS,
  "<i>A deliberately deleveraging balance sheet is not the same thing as a deteriorating one, and the 3.11% return on assets says the remaining book is fine. What you are buying at 1.11x is optionality on the fee businesses plus surplus capital, paid 2.6% a year to wait. What you are not buying is growth, and the three-year loan-book CAGR says so without ambiguity.</i>",
 ],
 "trigger": "loan_book_cagr_3y turning positive with roa_3y holding above 3% -> surplus capital gets redeployed and 1.11x book on a 36% equity base is too cheap. Another four quarters of negative TTM sales -> the lending business is being run off and the stock is a fee business wearing an NBFC's balance sheet.",
 "evidence": ["loan_book_cagr_3y", "roa_3y", "roe_3y", "equity_to_assets", "pb", "pe_ttm", "div_yield", "ret_12m_rel"],
},

"IIFL": {
 "confidence": "medium",
 "verdict": "HOLD — 11.85x earnings and strong momentum, but the +548.8% TTM profit is a base effect and the margin step is not an operating trend",
 "points": [
  "<b>Not held.</b> IIFL Finance, ₹24,917cr, gold loans, home loans, microfinance and digital lending. Composite 77: quality 55, valuation 47, momentum 77. Second-highest composite of " + PEERS + " after Northern Arc's 86.",
  "<b>Read the TTM figure with both levels or not at all.</b> TTM net profit is +548.8% and TTM operating profit +61.0% — against a prior year suppressed by the gold-loan business being barred from fresh disbursement. The margin moved 55.01% -> 65.09%, a +10.1pp step in one year, which the pack flags as a mix change or a one-off rather than an operating trend. <code>np_yoy_q</code> is +189.3% on the same base. Ask what the margin is without the recovery before using this earnings base.",
  "<b>The multi-year record is ordinary.</b> <code>roa_3y</code> 1.75%, eleventh of the 24. <code>roe_3y</code> 10.52% on <code>equity_to_assets</code> of 17.01%, with <code>roe_excess_13_5y</code> +0.32pp and <code>roe_excess_13_10y</code> +1.19pp — barely above the hurdle. <code>np_cagr_5y</code> 8.74% is the lowest of the 24. <code>loan_book_cagr_3y</code> 18.85%.",
  "<b>Cheap on a number that may not be the run rate.</b> 11.85x earnings is the third-lowest of the 24 and 1.79x book the ninth-lowest — but the E in that ratio is the recovered year. 0.31x of loan book. The 12-month relative return is +19.1%, fourth-best of the set, and the close was above the 200-day EMA on 69.8% of the last 252 sessions. FIIs 23.86%, promoters 24.84%. " + TNS,
  "<i>The cheapness and the recovery are the same fact, which is the trap. If 65% operating margin holds, 11.85x is genuinely low; if it reverts toward 55%, the multiple is nearer 16x on a business with a 8.7% five-year profit CAGR and a regulatory interruption in living memory. One more clean year settles it; nothing available today does.</i>",
 ],
 "trigger": "opm_now holding above 63% for four more quarters with roa_3y above 2% -> the margin step was structural and 11.85x on a repaired gold-loan franchise is the cheapest quality in the set. opm_now reverting under 57%, or any fresh regulatory restriction -> the earnings base is the peak and the valuation percentile of 47 is measuring the wrong year.",
 "evidence": ["pe_ttm", "pb", "opm_now", "opm_prev", "roa_3y", "roe_3y", "np_cagr_5y", "loan_book_cagr_3y", "ret_12m_rel"],
},

"LTF": {
 "confidence": "medium",
 "verdict": "HOLD — the slowest book growth of the healthy lenders at 10.2%, and a sub-13% ROE on every window, at 2.37x book",
 "points": [
  "<b>Not held.</b> L&T Finance, ₹66,255cr, retail lending — two-wheeler, farm equipment, micro and personal loans — after exiting the wholesale book. Composite 43: quality 51, valuation 38, momentum 54.",
  "<b>Growth is the problem, not credit.</b> <code>loan_book_cagr_3y</code> is 10.17%, the slowest of " + PEERS + " among the names whose books are actually growing — only JM Financial, Edelweiss and Sammaan Capital are lower, and all three are contracting. The retail pivot shows in the ten-year book value CAGR of 15.10%, middling for the set.",
  "<b>Returns sit below the hurdle on every window.</b> <code>roe_3y</code> 10.30% with <code>roe_excess_13_5y</code> -4.24pp, <code>roe_excess_13_7y</code> -4.35pp and <code>roe_excess_13_10y</code> -2.87pp. <code>roa_3y</code> of 2.18% is respectable — fourteenth of 24 — so the gap is partly <code>equity_to_assets</code> at 21.25%, a conservative capital base that caps the equity return.",
  "<b>Not cheap enough to compensate.</b> 20.82x earnings and 2.37x book put it in the upper half of the set on both, against a sub-13% ROE and 10% book growth. <code>div_yield</code> 1.04%. TTM sales +15.2%, operating profit +16.6%, net profit +19.7%, operating margin 60.54% -> 61.23%. Promoters 65.96%, FIIs 7.71%. " + TNS,
  "<i>The retail transition is real and the asset returns have improved, but 2.37x book asks for a 13%-plus ROE and three measurement windows say it has not been delivered. Net profit beat inflation in 4 of 4 years, 5 of 6 and 7 of 9, so the direction is right — the level is not there yet, and the price already assumes it arrives.</i>",
 ],
 "trigger": "roe_3y crossing 13% with loan_book_cagr_3y accelerating past 15% -> the retail pivot has worked and 2.4x book is reasonable. loan_book_cagr_3y staying near 10% for another year -> a sub-hurdle lender growing at nominal GDP, which belongs nearer 1.5x book.",
 "evidence": ["loan_book_cagr_3y", "roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "roa_3y", "equity_to_assets", "pb", "pe_ttm", "div_yield"],
},

"BAJAJFINSV": {
 "confidence": "medium",
 "verdict": "HOLD — a holding company at 3.56x book and 27.4x earnings whose ROE misses the hurdle on all three windows",
 "points": [
  "<b>Not held.</b> Bajaj Finserv, ₹277,573cr, the holding company for Bajaj Finance, Bajaj Allianz general and life insurance, and the asset-management venture. Composite 30: quality 58, valuation 20, momentum 46.",
  "<b>Thinly capitalised at the consolidated level, and the return still misses.</b> <code>equity_to_assets</code> is 10.87%, joint second-thinnest of " + PEERS + " with Edelweiss and behind only Centrum's 1.74%. Even so, <code>roe_3y</code> is 12.78% and <code>roe_excess_13_5y</code>, <code>_7y</code> and <code>_10y</code> are -0.30pp, -0.61pp and -0.28pp — just short of the hurdle on every window. <code>roa_3y</code> 1.39%, eighth-lowest of the 24.",
  "<b>The underlying book grows; the profit does not keep up.</b> <code>loan_book_cagr_3y</code> 23.22% and <code>book_value_cagr_10y</code> 19.11% are both top-third. But TTM sales +14.7% and operating profit +15.2% translate into net profit of only +6.5%, with operating margin flat at 37.61% -> 37.79%. Net profit beat inflation in 4 of 4 years, 5 of 6 and 7 of 9.",
  "<b>You pay a premium for the wrapper.</b> 3.56x book is the fifth-highest of the 24 and 27.36x earnings the eighth-highest, for an entity whose principal asset is a listed subsidiary you can buy directly at 5.18x book and a 17.58% ROE. The 12-month relative return is -16.2%, seventh-worst of the set. <code>div_yield</code> 0.09%, the lowest in the set. " + TNS,
  "<i>The uncomfortable comparison is internal: Bajaj Finance earns 3.60% on assets and 17.58% on equity; the holding company that owns most of it earns 1.39% and 12.78%. The insurance businesses are diluting the lender's returns, not adding to them, and the structure costs you a layer of tax and governance. Owning the parent is a bet on the insurance arms specifically.</i>",
 ],
 "trigger": "roe_3y crossing 13% on insurance profitability, with TTM net profit growth catching up to the 15% operating-profit growth -> the conglomerate discount is wrong and the parent is the better instrument. TTM net profit growth staying in single digits while the subsidiary compounds at 16%-plus -> own the subsidiary.",
 "evidence": ["roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "roa_3y", "equity_to_assets", "pb", "pe_ttm", "loan_book_cagr_3y", "div_yield"],
},

# -------------------------------------------- recent listings, thin history

"HDBFS": {
 "confidence": "medium",
 "verdict": "HOLD — a 14.66% ROE and 2.24% on assets at 18.6x, with no trend reading at all: 330 price bars against the 450 the metric needs",
 "points": [
  "<b>Not held.</b> HDB Financial Services, ₹51,360cr, HDFC Bank's secured and unsecured lending subsidiary, listed recently. Composite 27: quality 56, valuation 21, momentum 42.",
  "<b>The momentum 42 is partly an absence, not a reading.</b> There are 330 price bars and <code>pct_above_200ema_252d</code> needs roughly 450 — a 252-session window in which every session already carries a 200-day EMA — so that field is NULL. There is also no own-history PE band, because the usable annual history is too short. Short listing history, not a weak trend; do not read the percentile as a verdict on price action. " + TNS,
  "<b>The operating record is one of the better ones here.</b> <code>roa_3y</code> 2.24% is fifteenth of " + PEERS + " but <code>roe_3y</code> of 14.66% is fourth-highest, on <code>equity_to_assets</code> of 15.37%. <code>loan_book_cagr_3y</code> 20.86% and <code>np_cagr_5y</code> 25.93%. TTM sales +12.0%, operating profit +10.7%, net profit +27.7%, operating margin 57.53% -> 56.90%.",
  "<b>Priced below the premium lenders, above the cheap ones.</b> 18.60x earnings and 2.49x book sit squarely mid-set, and 0.43x of loan book is in the cheaper half. <code>earnings_yield_trend</code> is NULL, so the valuation pillar is working without its trend component. The parent holds 74.12%, FIIs just 3.55% — the second-lowest foreign stake of the 24. The 12-month relative return is -17.5%. " + TNS,
  "<i>A clean, bank-parented lender whose numbers do not need excuses — the caution is that the price history is too short for the platform to say anything about trend, and the free float is small with the parent at 74%. At 2.5x book for a 14.7% ROE it is neither the bargain nor the premium of this set; it is what the middle looks like.</i>",
 ],
 "trigger": "Price history passing ~450 bars so pct_above_200ema_252d resolves, with roe_3y holding above 14% -> the momentum pillar becomes a real reading and the composite of 27 is revisable upward. roa_3y falling below 2% as the unsecured book seasons -> a 2.5x book multiple on a lender whose parent sets its funding cost.",
 "evidence": ["roa_3y", "roe_3y", "equity_to_assets", "loan_book_cagr_3y", "np_cagr_5y", "pb", "pe_ttm", "p_aum", "promoter_pct"],
},

"TATACAP": {
 "confidence": "low",
 "verdict": "HOLD — 28.9% book growth and 11.7% ROE, but no 200-EMA reading at 260 bars and no own-history PE band to anchor the 25x",
 "points": [
  "<b>Not held.</b> Tata Capital, ₹135,539cr, the Tata group's diversified lending arm, recently listed. Composite 35: quality 46, valuation 47, momentum 52.",
  "<b>Two of the usual anchors do not exist yet.</b> <code>pct_above_200ema_252d</code> is NULL because there are 260 price bars against the ~450 the metric requires, and there is no own-history PE band because the usable annual history is too short. <code>earnings_yield_trend</code> is NULL too. So the 25.08x earnings has nothing historical to be compared against, and the momentum 52 is reading a stub. " + TNS,
  "<b>Growing fast on a thin capital base.</b> <code>loan_book_cagr_3y</code> 28.91% is second-highest of " + PEERS + " after Poonawalla's 37.43%, and <code>book_value_cagr_3y</code> is 39.94%. But <code>equity_to_assets</code> is 14.12%, sixth-thinnest of the 24, and <code>roa_3y</code> of 1.64% is tenth — so the 11.70% ROE is a modest asset return amplified by gearing.",
  "<b>Priced like an established compounder without the record to show.</b> 25.08x earnings is the tenth-highest of the 24 and 2.96x book the tenth-highest, against a three-year ROE that eight names in this set beat. Promoters hold 85.41%, the highest in the set, leaving a thin float; FIIs 3.57%. TTM sales +11.1%, operating profit +12.4%, net profit +28.9%, operating margin 73.24% -> 74.08%.",
  "<i>Confidence is low here and the reason is specific: the two fields that would tell you whether 25x is high or low for this stock — the own-history PE band and the 252-session trend reading — do not exist, and the three-year ROE on offer is below the set median. A fast-growing book at 2.96x book is a reasonable thing to own; it is not yet a thing this platform can price.</i>",
 ],
 "trigger": "Four more quarters of history, so the PE band and pct_above_200ema_252d resolve, with roa_3y rising above 2% -> the valuation becomes checkable and the growth rate starts earning the multiple. loan_book_cagr_3y slowing under 20% while roa_3y stays near 1.6% -> a geared, average-return lender at 3x book and 25x earnings.",
 "evidence": ["loan_book_cagr_3y", "book_value_cagr_3y", "roa_3y", "roe_3y", "equity_to_assets", "pb", "pe_ttm", "promoter_pct"],
},

"FEDFINA": {
 "confidence": "medium",
 "verdict": "HOLD — 1.92x book and 14.7x earnings on a 23% book CAGR, with no own-history PE band and the valuation pillar on 75 of 100 points",
 "points": [
  "<b>Not held.</b> Fedbank Financial Services, ₹5,618cr, gold loans, loan-against-property and small-business lending, majority owned by Federal Bank. Composite 59: quality 56, valuation 40, momentum 65.",
  "<b>What is missing from the valuation read.</b> There is no own-history PE band — the usable annual history is too short — and both <code>earnings_yield_trend</code> and <code>div_yield</code> are NULL, so the valuation pillar scored on 75 of its 100 declared points, renormalised around the components that did resolve. The 40 is direction, not a measurement. " + TNS,
  "<b>Solid, unspectacular lending economics.</b> <code>roa_3y</code> 1.98% on <code>equity_to_assets</code> of 18.96% gives a 10.47% three-year ROE — below the 13% hurdle, eleventh of " + PEERS + ". <code>loan_book_cagr_3y</code> 22.99% and <code>np_cagr_5y</code> 35.00%, the second-fastest profit growth in the set behind Shriram's 38.54%. TTM sales +13.4%, operating profit +23.1%, net profit +66.5%, operating margin 58.20% -> 63.18%.",
  "<b>Cheap on both multiples.</b> 14.67x earnings is the seventh-lowest of the 24 and 1.92x book the tenth-lowest, at 0.35x of loan book. Promoters 60.67%, FIIs 9.30%. The 12-month relative return is -0.8% — the stock has tracked the market, which for a small secured lender in a de-rating sector is itself a result.",
  "<i>The combination on offer is a 23% book CAGR and a 35% five-year profit CAGR at 1.9x book, against a 10.5% ROE that does not clear its hurdle. That is the trade: growth and price, not returns. The honest caveat is that the valuation percentile was built on three-quarters of its intended inputs, so treat 40 as a direction.</i>",
 ],
 "trigger": "roa_3y rising above 2.3% while loan_book_cagr_3y holds above 20% -> a 13%-plus ROE at 1.9x book, which nothing else in the set offers. Gold-loan regulation tightening, or opm_now falling back toward 58% -> the margin expansion was a cycle and the 10.5% ROE is the real number.",
 "evidence": ["roa_3y", "roe_3y", "equity_to_assets", "loan_book_cagr_3y", "np_cagr_5y", "pb", "pe_ttm", "p_aum", "opm_now", "opm_prev"],
},

"NORTHARC": {
 "confidence": "medium",
 "verdict": "HOLD — the highest composite of the 24 at 86, built with promoter_pct NULL, no PE band and the valuation pillar on 75 of 100 points",
 "points": [
  "<b>Not held.</b> Northern Arc Capital, ₹4,671cr, a platform lender to financial institutions, direct-to-customer and co-lending partnerships. Composite 86 — the highest of " + PEERS + " — on quality 59, valuation 63, momentum 67.",
  "<b>Read the 86 with its gaps attached.</b> <code>promoter_pct</code> is NULL, so there is no ownership read at all. There is no own-history PE band. <code>earnings_yield_trend</code> and <code>div_yield</code> are both NULL, so the valuation pillar scored on 75 of its 100 declared points and the 63 is renormalised around what resolved. " + TNS,
  "<b>The underlying numbers are genuinely good, just young.</b> <code>roa_3y</code> 2.43% is the seventh-highest of the 24 and <code>equity_to_assets</code> of 22.50% is the seventh-thickest capital base in the set, so the 11.04% ROE is conservative funding rather than weak assets. <code>loan_book_cagr_3y</code> 21.35%, <code>np_cagr_5y</code> 23.86%. TTM sales +21.1%, operating profit +26.5%, net profit +50.4%, operating margin 51.02% -> 53.28%.",
  "<b>Cheapest credible multiple in the set.</b> 10.63x earnings is the lowest of the 24 after UGRO Capital's unscoreable 5.80x, and 1.20x book is the fifth-lowest. 0.34x of loan book. The 12-month relative return is +9.85%, fifth-best of the set, and the close was above the 200-day EMA on 82.5% of the last 252 sessions. FIIs 8.64%.",
  "<i>A 2.4%-on-assets lender growing its book at 21% with a 22.5% equity cushion, at 10.6x and 1.2x book, is the best risk-adjusted combination of numbers in this batch. Two things hold the confidence at medium rather than higher: lending to other lenders concentrates credit risk in a way the ratios do not show, and the platform has no ownership data on it whatsoever.</i>",
 ],
 "trigger": "promoter_pct resolving alongside two more years of annual history, with roa_3y still above 2.3% -> the composite of 86 is confirmed rather than inferred and the 10.6x is a genuine mispricing. roa_3y falling below 1.8% as the partner-NBFC book seasons -> wholesale credit risk arriving all at once, which is how platform lenders fail.",
 "evidence": ["roa_3y", "roe_3y", "equity_to_assets", "loan_book_cagr_3y", "np_cagr_5y", "pb", "pe_ttm", "p_aum", "ret_12m_rel"],
},

"JIOFIN": {
 "confidence": "low",
 "verdict": "AVOID — 90.15% equity-to-assets and a 1.21% ROE: this is a capitalised shell priced at 4.69x loan book, the dearest of the 24",
 "points": [
  "<b>Not held.</b> Jio Financial Services, ₹140,317cr, the Reliance demerger — lending, insurance broking and a payments bank still being built. Composite 24: quality 34, valuation 59, momentum 53.",
  "<b>It is not yet a lender, and the balance sheet says so plainly.</b> <code>equity_to_assets</code> is 90.15%. Every other name in " + PEERS + " sits between 1.74% and 36.37%; the next-highest is JM Financial at 36.37%. A lending business is leverage applied to a spread, and there is essentially no leverage here — which is why <code>roa_3y</code> of 1.09% produces an ROE of just 1.21%, the fourth-lowest of the 24 and below every name that is not actually loss-making.",
  "<b>The valuation percentile of 59 is measuring the wrong thing.</b> <code>p_aum</code> is 4.69x — the most expensive price-to-loan-book in the set by a factor of nearly two over Religare's 2.45x and four over Bajaj Finance's 1.12x — and <code>pe_ttm</code> is 67.90x, the second-highest here. The 59 comes from <code>pb</code> of 1.05x, which is low only because the company is almost entirely equity: you are paying roughly book value for a pile of capital that currently earns 1.2%.",
  "<b>Nothing historical to check it against.</b> There is no own-history PE band — the usable annual history is too short — and <code>earnings_yield_trend</code> is NULL. TTM sales +119.2% and operating profit +95.4% off a near-zero base, net profit +27.2% — and the operating margin stepped down 74.25% -> 66.16%, a -8.1pp move the pack flags as a mix change rather than a trend. The 12-month relative return is -29.9%, third-worst of the 24. 4.97 million shareholders, the largest register in the set by five times. " + TNS,
  "<i>The bull case is entirely about what the capital gets deployed into, and none of it is in the numbers yet. Until the book levers up, the only measurable facts are a 1.2% return on equity and the dearest price-to-loan-book of the 24. That is not a valuation the data supports; it is a bet on a management plan, and this platform has no way to score one.</i>",
 ],
 "trigger": "equity_to_assets falling toward 30% with roa_3y holding above 1.5% -> capital is actually being deployed into a spread business and the whole read changes. equity_to_assets still above 70% a year from now with roe_3y under 3% -> ₹140,000cr of market value for an undeployed balance sheet, and the 4.69x price-to-loan-book is the measure of that.",
 "evidence": ["equity_to_assets", "roa_3y", "roe_3y", "p_aum", "pe_ttm", "pb", "loan_book_cagr_3y", "ret_12m_rel", "shareholders"],
},

# -------------------------------------------- growth with a margin question

"POONAWALLA": {
 "confidence": "low",
 "verdict": "AVOID — fastest book growth of the 24 at 37.4%, but the margin jumped 30.0% to 54.9% in one year and ttm_np_pct is NULL",
 "points": [
  "<b>Not held.</b> Poonawalla Fincorp, ₹38,165cr, consumer and MSME lending rebuilt after the Cyrus Poonawalla group took control. Composite 47: quality 55, valuation 21, momentum 69.",
  "<b>The earnings base is not an operating trend.</b> Operating margin stepped from 29.99% to 54.88% in one year, a +24.9pp move — the largest in " + PEERS + " — and TTM operating profit is +215.6% on TTM sales of +72.5%. A move that size is a mix change, an acquisition or a one-off, not operating leverage. <code>ttm_np_pct</code> is NULL, so there is no this-year-versus-last-year net profit comparison at all, and <code>np_yoy_q</code> of +391.5% is measured off the suppressed prior year.",
  "<b>Growth is real; returns are not there yet.</b> <code>loan_book_cagr_3y</code> 37.43% is the highest of the 24 by eight points over Tata Capital. But <code>roe_3y</code> is 8.21%, seventh-lowest, and <code>roe_excess_13_5y</code>, <code>_7y</code> and <code>_10y</code> are -4.84pp, -10.67pp and -8.97pp — a long record of missing the hurdle badly. <code>np_cagr_5y</code> of 9.63% is the second-lowest in the set.",
  "<b>And it is expensive on every measure that works.</b> 48.50x earnings is the third-highest of the 24 behind Religare and Jio Financial; 3.69x book is the fourth-highest; 0.67x of loan book. <code>div_yield</code> is NULL. The 12-month relative return is -14.6%. Promoters 59.02%, FIIs 10.96%. " + TNS,
  "<i>The uncomfortable version: the only numbers justifying 48x and 3.7x book are the ones the pack flags as untrustworthy — a 25-point margin step and a profit growth rate with no denominator. The durable figures, a 8.2% ROE and a decade of missing the 13% hurdle, argue the other way. Fast book growth at low returns is how NBFCs get into trouble, not out of it.</i>",
 ],
 "trigger": "opm_now holding above 50% for four more quarters while roe_3y climbs past 13% -> the margin step was structural and the growth is finally being earned. opm_now reverting toward 35% or loan_book_cagr_3y staying above 35% while roe_3y stays under 10% -> a book being bought with price, at 48x earnings.",
 "evidence": ["loan_book_cagr_3y", "opm_now", "opm_prev", "roe_3y", "roe_excess_13_7y", "np_cagr_5y", "pe_ttm", "pb", "roa_3y"],
},

"PAISALO": {
 "confidence": "medium",
 "verdict": "HOLD — best return on assets of the 24 at 3.97%, after a +116% relative year that puts it at 4.07x book and 1.18x loan book",
 "points": [
  "<b>Not held.</b> Paisalo Digital, ₹7,304cr, small-ticket income-generation loans distributed through bank business-correspondent partnerships. Composite 69: quality 67, valuation 15, momentum 77.",
  "<b>The best asset return in the set, on a thick capital base.</b> <code>roa_3y</code> 3.97% is the highest of " + PEERS + ", ahead of Bajaj Finance's 3.60%, and <code>equity_to_assets</code> is 29.97% — the third-highest, so there is no gearing in the number. That conservatism is why the 13.24% ROE is only eighteenth-highest despite the best asset yield: the equity base is nearly three times Aditya Birla Capital's as a share of assets.",
  "<b>Growth is steady rather than spectacular.</b> <code>loan_book_cagr_3y</code> 23.38%, <code>np_cagr_5y</code> 31.53%, <code>book_value_cagr_10y</code> 13.72%. Net profit beat inflation in 4 of 4 years, 6 of 6 and 7 of 9 — one of only three names in the set with a perfect six-year record. <code>roe_excess_13_5y</code> is -1.89pp, so the long-run average still sits just under the hurdle. TTM sales +22.7%, operating profit +20.3%, net profit +22.1%, operating margin 77.38% -> 75.90%.",
  "<b>The price has already moved, hard.</b> The 12-month relative return is +116.4% and the six-month +115.5% — both the highest of the 24 by a wide margin over Shriram's +41.3%. That has taken it to 4.07x book, third-highest in the set behind Bajaj Finance and Chola, and 1.18x of loan book, the highest of all 24. Valuation percentile 15. <code>div_yield</code> 0.13%. Promoters 46.71%, FIIs 6.79%. " + TNS,
  "<i>A genuinely well-run small lender whose price doubled relative to the market in a year. The business case holds at any price; the position case does not. At 1.18x loan book you are paying more per rupee lent than for Bajaj Finance, for a ₹7,300cr company with business-correspondent concentration risk. The quality is why this is not an AVOID; the entry price is why it is not a buy.</i>",
 ],
 "trigger": "A 25-30% drawdown taking pb back toward 3x with roa_3y holding near 4% -> the best asset returns in the set at a price that is not a momentum artefact. ret_12m_rel giving back most of the +116% while roa_3y slips under 3.5% -> the re-rating was the whole return, and 1.18x loan book has a long way to fall.",
 "evidence": ["roa_3y", "roe_3y", "equity_to_assets", "loan_book_cagr_3y", "np_cagr_5y", "pb", "p_aum", "pe_ttm", "ret_12m_rel", "ret_6m_rel"],
},

"EDELWEISS": {
 "confidence": "medium",
 "verdict": "AVOID — a loan book shrinking 0.65% a year and 0.73% ten-year book compounding, up 23.7% relative, at 31.1x earnings",
 "points": [
  "<b>Not held.</b> Edelweiss Financial Services, ₹13,053cr, asset reconstruction, alternative asset management, insurance and a residual lending book. Composite 14: quality 31, valuation 29, momentum 67.",
  "<b>Ten years of book value have gone essentially nowhere.</b> <code>book_value_cagr_10y</code> is 0.73% — third-lowest of " + PEERS + ", ahead of only Centrum at -0.16% and Religare at 0.72%. <code>loan_book_cagr_3y</code> is -0.65%, one of three contracting books in the set. <code>roe_7y</code> is 1.24% and <code>roe_excess_13_7y</code> is -11.81pp: over seven years this has destroyed value against its cost of equity, not compounded it.",
  "<b>The recent profit is below the operating line.</b> TTM operating profit is -10.5% while TTM net profit is +48.0%, and the operating margin stepped down from 35.08% to 27.55%, a -7.5pp move the pack flags as a mix change or a one-off rather than a trend. <code>np_yoy_q</code> of +83.0% sits on the same base. The operating business shrank; the reported profit grew.",
  "<b>Momentum 67 against quality 31 is the whole position.</b> The 12-month relative return is +23.7%, third-best of the 24, <code>ema_stack_bull</code> is 1 and the close was above the 200-day EMA on 80.6% of the last 252 sessions. That has taken it to 31.10x earnings — the fourth-highest of the set — and 2.82x book, for a business with a 9.89% three-year ROE and a shrinking book. <code>np_cagr_7y</code> is NULL. " + TNS,
  "<i>Price and fundamentals are moving in opposite directions and the price is winning. The operating margin fell 7.5 points, the loan book is contracting, book value has compounded at 0.73% for a decade, and the stock is up 23.7% relative at 31x. Every one of those facts is independently checkable and none of them supports the multiple.</i>",
 ],
 "trigger": "loan_book_cagr_3y turning positive with opm_now recovering above 33% and roe_3y above 12% -> the restructuring has worked and the momentum was early. Another year of negative TTM operating profit while the price holds -> the 31x is being paid for a de-rating business, and the gap closes downward.",
 "evidence": ["book_value_cagr_10y", "loan_book_cagr_3y", "roe_7y", "roe_excess_13_7y", "opm_now", "opm_prev", "pe_ttm", "pb", "ret_12m_rel", "ema_stack_bull"],
},

# ------------------------------------------------------- the damaged names

"PIRAMALFIN": {
 "confidence": "low",
 "verdict": "AVOID — a negative return on assets and a -23.75pp five-year ROE shortfall, at 28.3x earnings, with no 200-EMA reading at 241 bars",
 "points": [
  "<b>Not held.</b> Piramal Finance, ₹47,877cr, wholesale-to-retail transition lender after the DHFL acquisition. Composite 18: quality 33, valuation 41, momentum 62.",
  "<b>It loses money on its assets.</b> <code>roa_3y</code> is -0.38% and <code>roe_3y</code> is -2.04% — third-worst of " + PEERS + " on both, behind only Sammaan Capital and Centrum. <code>roe_excess_13_5y</code> and <code>roe_excess_13_7y</code> are both -23.75pp and the ten-year is -14.95pp: five, seven and ten years of destroying equity value against a 13% hurdle. Net profit beat inflation in only 4 of the last 9 years.",
  "<b>The momentum pillar is reading a stub.</b> There are 241 price bars against the ~450 <code>pct_above_200ema_252d</code> requires, so that field is NULL, as are <code>ret_12m_rel</code> and <code>np_cagr_7y</code>. The momentum pillar scored on 65 of its 100 declared points, renormalised around the components that survived. The 62 is a partial reading, not a trend. " + TNS,
  "<b>And it is not cheap.</b> 28.31x earnings is the seventh-highest of the 24, on a three-year loss record. 1.70x book and 0.49x of loan book look moderate, but the book itself is the thing in question. <code>loan_book_cagr_3y</code> 21.09% and TTM net profit +191.3% — the latter measured off a prior year that was barely positive, with operating margin 55.39% -> 58.84%. <code>equity_to_assets</code> 25.54%.",
  "<i>The retail transition may well work; the data cannot yet say that it has. What it does say is three measurement windows of negative excess return, a negative return on assets, and a 28x multiple on earnings that have only just turned. Confidence is low because the momentum pillar is incomplete and <code>ret_12m_rel</code> is NULL, but nothing missing would change the direction.</i>",
 ],
 "trigger": "roa_3y turning positive and above 1.5% with roe_3y clearing 10% -> the retail book is earning and the past is genuinely past. roa_3y still negative four quarters from now -> the wholesale legacy is not finished running off, and 28x earnings is being paid for the wrong year.",
 "evidence": ["roa_3y", "roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "pe_ttm", "pb", "loan_book_cagr_3y", "equity_to_assets"],
},

"SAMMAANCAP": {
 "confidence": "low",
 "verdict": "AVOID — the worst return on assets of the 24 at -3.51%, a shrinking book, and pe_ttm NULL because there are no earnings to divide by",
 "points": [
  "<b>Not held.</b> Sammaan Capital, ₹15,388cr, the renamed Indiabulls Housing Finance, running down a wholesale book while attempting a retail rebuild. Composite 4 — the lowest of " + PEERS + ". Quality 14, valuation 59, momentum 28.",
  "<b>Nothing here earns.</b> <code>roa_3y</code> is -3.51%, the worst in the set by nearly three points over Centrum's -0.68%, and <code>roe_3y</code> is -13.26%. <code>roe_excess_13_5y</code> -18.24pp, <code>_7y</code> -13.66pp, <code>_10y</code> -5.87pp. Net profit beat inflation in 1 of the last 4 years, 1 of 6 and 2 of 9 — the worst consistency record of the 24 alongside Religare.",
  "<b>The valuation percentile of 59 is an artefact of the missing data.</b> <code>pe_ttm</code> is NULL and <code>ttm_np_pct</code> is NULL, so the valuation pillar scored on 60 of its 100 declared points, renormalised around <code>pe_ttm</code> (30pts) and <code>div_yield</code> (10pts) being absent. What remains is <code>pb</code> of 0.81x — the second-lowest of the 24 — which reads as cheap only if you believe the book. With a -3.51% return on assets, the book is being written down, which is exactly what a sub-1x multiple is telling you. <code>div_yield</code> is NULL.",
  "<b>Shrinking, not stabilising.</b> <code>loan_book_cagr_3y</code> is -0.31%, TTM sales -17.1%, and the operating margin moved 26.60% -> 45.47%, a +18.9pp step the pack flags as a one-off rather than a trend. <code>book_value_cagr_10y</code> 5.12%. The 12-month relative return is -20.1%. <code>equity_to_assets</code> 27.92%. " + TNS,
  "<i>0.81x book is not a margin of safety when the asset side is producing a -3.5% return — it is the market's estimate of how much of the book is real. The one encouraging number, a 19-point operating margin jump, is explicitly flagged as a one-off. There is no earnings multiple here because there are no dependable earnings.</i>",
 ],
 "trigger": "roa_3y turning positive with pe_ttm resolving on four clean quarters -> the run-off is complete and 0.81x book on a stabilised lender is a genuine discount. loan_book_cagr_3y staying negative while roa_3y stays under -2% -> the book is still shrinking faster than it is being repaired, and sub-1x book has further to go.",
 "evidence": ["roa_3y", "roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "pb", "loan_book_cagr_3y", "book_value_cagr_10y", "equity_to_assets", "opm_now", "opm_prev"],
},

"CENTRUM": {
 "confidence": "low",
 "verdict": "AVOID — 1.74% equity-to-assets, a -44.68% three-year ROE, and pe_ttm NULL because the TTM has no net profit to divide by",
 "points": [
  "<b>Not held.</b> Centrum Capital, ₹969cr — the smallest name in " + PEERS + " by a factor of five — investment banking, broking and affordable housing finance alongside the Unity Small Finance Bank venture. Composite 5: quality 20, valuation 55, momentum 18.",
  "<b>The capital base is the finding.</b> <code>equity_to_assets</code> is 1.74%. The next-thinnest in the set is Bajaj Finserv at 10.87% — six times thicker — and the set median is around 20%. At 1.74%, roughly 57 rupees of assets sit on every rupee of equity, so a 1.7% impairment of the asset side wipes out the equity entirely. That is not a capital structure a lender survives a credit cycle with.",
  "<b>And the assets are losing money.</b> <code>roa_3y</code> is -0.68% and <code>roe_3y</code> is -44.68% — the worst equity return of the 24 by a factor of three over Sammaan Capital's -13.26%. <code>roe_excess_13_5y</code> -50.09pp, <code>_7y</code> -40.32pp, <code>_10y</code> -28.37pp. <code>book_value_cagr_10y</code> is -0.16%, the only negative ten-year book compounding in the set.",
  "<b>What the valuation 55 is actually built on.</b> <code>pe_ttm</code> is NULL, <code>ttm_np_pct</code> is NULL, <code>np_cagr_5y</code> and <code>np_cagr_7y</code> are NULL and <code>div_yield</code> is NULL, so the valuation pillar scored on 60 of its 100 declared points. What remains is <code>pb</code> of 3.11x and <code>p_aum</code> of 0.06x. TTM sales +0.5%, TTM operating profit -26.6%, with the margin stepping 35.62% -> 26.01%. <code>np_yoy_q</code> is -563.5%. " + TNS,
  "<i>Three independent facts each sufficient on their own: 57x gearing, a -44.7% three-year return on equity, and no earnings multiple because there are no earnings. The valuation percentile of 55 exists only because the fields that would have scored it badly are missing. This is the clearest avoid in the batch and the data is not ambiguous about it.</i>",
 ],
 "trigger": "equity_to_assets rising above 10% on a capital raise, with roa_3y turning positive -> the solvency question is answered and the business can be assessed on its merits. Any further decline in equity_to_assets, or a fourth year of negative roe_3y -> the equity is an option on a recapitalisation, not a stake in a lender.",
 "evidence": ["equity_to_assets", "roa_3y", "roe_3y", "roe_excess_13_5y", "roe_excess_13_10y", "book_value_cagr_10y", "pb", "p_aum", "opm_now", "opm_prev"],
},

"RELIGARE": {
 "confidence": "low",
 "verdict": "AVOID — a 0.73% operating margin against 3.55% a year ago, a -164pp seven-year ROE shortfall, and 156.25x earnings",
 "points": [
  "<b>Not held.</b> Religare Enterprises, ₹7,742cr, a holding company over Care Health Insurance, Religare Finvest and a broking arm, after years of promoter litigation and a contested open offer. Composite 9: quality 34, valuation 27, momentum 40.",
  "<b>The operating business has essentially stopped earning.</b> <code>opm_now</code> is 0.73% against <code>opm_prev</code> of 3.55% — the lowest operating margin of " + PEERS + " by a factor of 35 over Centrum's 26.01%. TTM operating profit is -75.4% and TTM net profit -57.7%, with <code>np_yoy_q</code> at -356.2%. These are not percentages around a healthy base; the base is near zero.",
  "<b>Seven and ten years of destroyed equity.</b> <code>roe_7y</code> is -151.1% and <code>roe_excess_13_7y</code> is -164.09pp; the ten-year excess is -134.66pp. The 5-year reading of +28.90pp is the mirror image of the same damage — a recovery year dividing by a collapsed equity base, not a profitable one. Net profit beat inflation in 1 of the last 4 years, 2 of 6 and 3 of 9, the weakest record in the set. <code>book_value_cagr_10y</code> 0.72%.",
  "<b>The multiples are meaningless or alarming, in that order.</b> 156.25x earnings is by far the highest of the 24 — the next is Jio Financial at 67.90x. <code>p_aum</code> of 2.45x is the second-highest in the set after Jio's 4.69x. 2.66x book. <code>np_cagr_5y</code>, <code>np_cagr_7y</code> and <code>div_yield</code> are all NULL. Promoters hold 30.55%, FIIs 9.64%. " + TNS,
  "<i>There is no reading of this data that supports ownership. A 0.73% operating margin means the lending and broking operations are consuming what the insurance arm earns; 156x is what a trivial profit on a ₹7,742cr market value looks like; and the seven-year record is -151% on equity. The only live question is the value of the Care Health stake, and that is a legal and corporate-action question, not one this scorecard can answer.</i>",
 ],
 "trigger": "opm_now recovering above 10% with roe_3y holding above 8% for four quarters -> the operating businesses are viable and the holding-company discount becomes the actual question. opm_now staying below 3% for another year -> the operating entities are a drag on the one valuable asset, and the 156x is the arithmetic of that.",
 "evidence": ["opm_now", "opm_prev", "roe_7y", "roe_excess_13_7y", "roe_excess_13_10y", "pe_ttm", "p_aum", "pb", "book_value_cagr_10y", "roa_3y"],
},

# ---------------------------------------------------------- data-blocked (1)

"UGROCAP": {
 "kind": "NOVERDICT",
 "confidence": "low",
 "verdict": "WATCH — no verdict: the quality pillar scored on 8 of its 100 declared points, so there is no composite at all",
 "points": [
  "<b>Not held.</b> UGRO Capital, ₹1,279cr, MSME lending. There is <b>no composite rank</b>: the quality pillar did not resolve, so the composite is suppressed by design rather than low. The quality percentile that does exist was computed on <b>8 of the pillar's 100 declared points</b> — every substantive input is NULL: <code>roa_3y</code>, <code>roe_3y</code>, <code>loan_book_cagr_3y</code>, <code>book_value_cagr_3y</code>, <code>np_cagr_3y</code> and <code>np_consistency_3y</code>. There is also no company overview, so the qualitative read is financials-only.",
  "<b>What specifically cannot be trusted.</b> Only 3 usable quarters exist, so <code>ttm_sales_pct</code>, <code>ttm_op_pct</code> and <code>ttm_np_pct</code> are all NULL — there is no this-year-versus-last-year comparison — and <code>sales_yoy_q</code>, <code>np_yoy_q</code>, <code>opm_now</code> and <code>opm_prev</code> are NULL with them, so no margin can be read at any horizon. <code>earnings_yield_trend</code> and <code>div_yield</code> are NULL, putting the valuation pillar on 75 of its 100 points; <code>tech_net_score_scaled</code> is NULL, putting momentum on 60 of its 100. There is no own-history PE band. 13 of 29 cluster metrics resolved.",
  "<i>What is legible, stated without a conclusion: <code>pb</code> 0.44x and <code>pe_ttm</code> 5.80x, both the lowest of " + PEERS + " — against a book nothing here can verify. <code>equity_to_assets</code> 20.65%, mid-set. <code>p_aum</code> 0.10x. <code>promoter_pct</code> 2.88%, by far the lowest promoter holding of the 24 and a fact worth understanding before anything else; FIIs 5.45%, DIIs 1.85%, 38,742 shareholders. The 12-month relative return is -54.6%, the worst of the 24. No verdict until there are four usable quarters and a resolved quality pillar.</i>",
 ],
 "trigger": "Four usable quarters so the quality pillar resolves and a composite exists -> re-read, and 0.44x book either is or is not the discount it looks like. The quality pillar still unresolved next snapshot while ret_12m_rel stays below -40% -> the absence of data on a falling small-cap lender is itself the finding, and the 2.88% promoter stake is the thing to explain.",
 "evidence": ["pb", "pe_ttm", "equity_to_assets", "p_aum", "promoter_pct", "fii_pct", "ret_12m_rel", "shareholders"],
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

    # The peer set the prose keeps claiming superlatives against has to BE the
    # pack, or every "of the 24" in this file is measured over the wrong pool.
    import importlib.util
    spec_mod = importlib.util.spec_from_file_location(
        "bfsi_segments", "build/verdicts/bfsi_segments.py")
    seg = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(seg)
    if set(seg.SEGMENTS["large_diversified"]) != set(rows):
        raise SystemExit("pack is not the large_diversified segment — every "
                         "'of the 24' superlative in this file is scoped wrong")

    out = []
    for sym, s in SPEC.items():
        row = rows[sym]
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        blockers = row.get("blockers") or []
        points, verdict, trig = s["points"], s["verdict"], s["trigger"]
        conf = s["confidence"]
        kind = s.get("kind", "VERDICT")

        # --- guards. Each one has to be able to fail; see CLAUDE.md §5.
        want = 3 if kind == "NOVERDICT" else 5
        if len(points) != want:
            raise SystemExit(f"{sym}: {len(points)} points, kind={kind} takes {want}")

        if kind == "NOVERDICT":
            if not verdict.startswith("WATCH — no verdict:"):
                raise SystemExit(f"{sym}: blocked row needs the 'WATCH — no verdict:' label")
            if len(verdict.split(":", 1)[1].strip()) < 20:
                raise SystemExit(f"{sym}: the label names no specific defect")
            if conf != "low":
                raise SystemExit(f"{sym}: a no-verdict row cannot be {conf} confidence")
        else:
            if not verdict.split(" —")[0] in ("BUY", "HOLD", "AVOID"):
                raise SystemExit(f"{sym}: label must open BUY/HOLD/AVOID, got {verdict[:20]!r}")
            if len(verdict.split("—", 1)[1].strip()) < 30:
                raise SystemExit(f"{sym}: the label asserts a call but gives no reason")

        # confidence vs blockers — VERDICT_WRITING §5
        if conf == "high" and blockers:
            raise SystemExit(f"{sym}: high confidence with {len(blockers)} blocker(s)")
        if conf == "medium" and not blockers:
            raise SystemExit(f"{sym}: medium confidence is a hedge with no blocker to justify it")

        # house style
        if "Not held" not in points[0] and "Your ₹" not in points[0]:
            raise SystemExit(f"{sym}: point one does not state the holding")
        if not points[0].startswith("<b>"):
            raise SystemExit(f"{sym}: point one has no <b> lead")
        if not points[-1].startswith("<i>"):
            raise SystemExit(f"{sym}: the last point is not italicised")
        for i, p in enumerate(points[:-1]):
            if not p.startswith("<b>"):
                raise SystemExit(f"{sym}: point {i+1} has no <b> lead sentence")

        # Deb's standing instruction: name the field, not just the defect.
        if sum(p.count("<code>") for p in points) < 4:
            raise SystemExit(f"{sym}: fewer than 4 <code> field names across the row — "
                             f"the prose is asserting rather than citing")

        # Every superlative has to be scoped. An unscoped "lowest" is a claim
        # about 185 names, not 24.
        body = " ".join(points)
        for word in ("highest", "lowest", "cheapest", "best", "worst", "fastest", "slowest"):
            if word in body.lower() and "of the 24" not in body and "in the set" not in body \
                    and "in this set" not in body and "of " + PEERS not in body:
                raise SystemExit(f"{sym}: uses '{word}' with no peer set named")

        if trig.count("->") < 2:
            raise SystemExit(f"{sym}: trigger is one-sided — a wish, not a trigger")

        # tech_net_score_scaled is NULL platform-wide; VERDICT_WRITING §3 says
        # never quote it as a value. Naming it as absent is required; quoting a
        # number for it would be fabrication.
        if "tech_net_score_scaled</code> is" in body and "NULL" not in body:
            raise SystemExit(f"{sym}: tech_net_score_scaled mentioned without saying it is NULL")

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
        print(f"   {r['symbol']:<12} {r['confidence']:<6} {r['verdict'][:92]}")


if __name__ == "__main__":
    main()
