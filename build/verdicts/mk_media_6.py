#!/usr/bin/env python3
"""media_entertainment — the six tracked names, veteran tier, one cohort.

Run:  etl/.venv/bin/python build/verdicts/mk_media_6.py
Then: scripts/verdict-check.py /tmp/media6.json build/verdicts/media-6-verdicts.json
      scripts/verdict-ranks-check.py --verdicts build/verdicts/media-6-verdicts.json \
          --pack /tmp/media6.json

THE SHAPE OF THIS CLUSTER

Six names, all veteran, all `full`, one bucket of 47. Two are held (DBCORP,
PVRINOX); four are watchlist-only. The cohort is a print publisher, a second
print publisher, a mobile-gaming holding company, a visual-effects contractor,
a cinema chain and a music-rights library — six different businesses sharing a
sector label, which is why nearly every cross-row comparison in this file is
refused rather than made.

CHOICE 1 — the thin-reading ban, and it is the defining constraint here.
`peg` is read by 9 of the 47 and `div_yield` by 12. A rank out of 9 is not a
rank; it is a statement about which rows happened to have a denominator. Both
keys are banned from the prose outright — not caveated — and guard 20
recomputes their reading counts, so if a future snapshot fills them in the
guard fires and tells me to lift the ban rather than leaving a stale one.
DENOM_FLOOR is then 19, the next thinnest reading this batch anchors on.

CHOICE 2 — `pe_ttm` is read by 19 of 47, so every PE rank carries PETHIN in
the same point. Twenty-eight rows in this cohort have no usable trailing
earnings at all. "Cheapest in the cluster on earnings" would be a claim about
a minority of the bucket, and three of the six rows here are in that minority
for a reason: they did not earn anything.

CHOICE 3 — the band ban, carried from realty, now three-valued. hi/lo above
5.0x and the band records an earnings denominator going near zero rather than
a price range: HMVL 2.41-79.52x (33x), SAREGAMA 0.74-57.96x (78x), PVRINOX
27.00-218.64x (8.1x). PFOCUS has no band at all — the pack's own blocker says
the annual history cannot support one — and that is a different sentence, not
the same one. DBCORP (3.7x over ten readings) and NAZARA (4.2x over six) must
state theirs and state it correctly; the ban is two-sided so it cannot quietly
become "nobody quotes a band".

CHOICE 4 — earnings made below the operating line. This is the batch's spine
and it is not a metric in the pack. HMVL's net profit exceeded its operating
profit in seven years across the ten-year record, and NAZARA's did in three,
including FY2026, where operating profit is minus ₹28.11cr and net profit is
₹95.85cr. No ratio in `cluster_metrics` says this. Guard 23 recomputes the
count from the annual rows, so the claim cannot go stale.

CHOICE 5 — the cash instrument, carried from realty for the same reason. The
pack's `cfo_op_prior_mean` divides operating cash by one year of operating
profit, so where operating profit passes near zero the ratio explodes. HMVL's
stated prior mean of 8.656 is dominated by the one year in its window where
₹203.38cr of operating cash arrived against ₹7.12cr of operating profit, a
ratio of 28.6 — and guard 27 recomputes that it is in fact the largest such
ratio in the row, so the refusal cannot go stale. That flag is refused as
an artefact. SAREGAMA's is not: operating cash went ₹331.20cr to ₹100.01cr
while operating profit rose to ₹336.75cr, and the word deterioration is earned
on the record.

CHOICE 6 — PFOCUS gets `WATCH — no verdict`. 266.32x trailing earnings at
second of 19, 10.46x book at third of 37, the most levered balance sheet in
the cohort at first of 34, net profit negative in seven years across the
ten-year record, no own-history PE band, and `cfo_pat_3y`, `np_cagr_5y` and
`ttm_np_pct` all NULL. A verdict on that row would be a verdict on the
scorer.

CHOICE 7 — the margin step. Four of the six rows have one, in both
directions: HMVL +10.3 points, NAZARA -11.2, PFOCUS +5.0, SAREGAMA +11.9.
Every TTM growth figure on those rows is computed against the year before the
step, so STEP sits in the SAME point as the figure.

CHOICE 8 — PVRINOX's `rev_cagr_5y` 49.53% at third of 44 starts from FY2021,
when the cinemas were shut and sales were ₹280.01cr. The rank is arithmetic,
not a growth record, and COVID says so wherever the figure appears.

CHOICE 9 — pillar renormalisation. NAZARA's valuation percentile is computed
on 35 of its 100 declared points, HMVL's on 90, and the quality percentiles of
PFOCUS and PVRINOX on 80.2. Momentum is 95 everywhere, which makes it uniform
and so a single MOM95 sentence per row; the others are not uniform and sit in
the same point as the figure, banned from headline and trigger.

CHOICE 10 — `ema_stack_bull` is banned. It is 1.000 on three rows and 0.000 on
three, tied first in a ten-way tie and tied eleventh in a thirty-seven-way
tie. Either reading spans most of the cohort.

CHOICE 11 — DBCORP's TTM window ends 2026-09-30 where the other five end
2026-06-30, so its TTM figures are one quarter ahead of the batch and WINDOW
says so on that row only.

CHOICE 12 — delivery is banned outright. Five rows hold 13 distinct sessions,
which is one print repeated, and HMVL holds none at all.
"""
import json
import re

PACK = "/tmp/media6.json"
OUT = "build/verdicts/media-6-verdicts.json"
SOURCE_REPORT = "media entertainment — 6 tracked names"
MODEL = "claude-opus-4-7"
SNAPSHOT = "2026-10-21"
PRICE_ASOF = "2026-10-21"

HELD = {"DBCORP", "PVRINOX"}
EMIT = {"DBCORP", "HMVL", "NAZARA", "PFOCUS", "PVRINOX", "SAREGAMA"}

VET = ("Peered against 47 veteran-tier peers inside "
       "<code>media_entertainment</code> — the scorer's bucket is (cluster, "
       "maturity tier), this one clears the 10-peer floor several times over, "
       "and the row is badged <code>full</code>. Every denominator below is "
       "the metric's own reading count, not 47, and nothing read by fewer "
       "than 19 of them is ranked here at all. ")
TIER_SENTENCE = {"veteran": VET}

# CHOICE 2. Required in the same point as any pe_ttm rank.
PETHIN = ("Only nineteen rows in this cohort carry usable trailing earnings at "
          "all; the rest have no positive base to divide by — so a cheap or a "
          "dear position on this metric is a statement about a minority of the "
          "bucket and not about the cluster. ")

MOM95 = ("<code>tech_net_score_scaled</code> is NULL for all 3,178 rows in "
         "this snapshot and carries 5 of momentum's 100 points, so every "
         "momentum percentile on this platform is scored on 95 points out of "
         "a declared 100. It is uniform, so it changes no ranking — but the "
         "pillar is narrower than the scorecard claims, here and everywhere.")

# CHOICE 5, the instrument.
CASH = ("The pack's cash flag divides one year of operating cash by one year "
        "of operating profit, and in this cluster operating profit passes "
        "near zero often enough that the ratio says more about its "
        "denominator than about collection. The claim below is therefore made "
        "on the ten annual cash rows in the pack and not on the ratio. ")

DETERIORATION = ("This row is among the rows in this batch where the word "
                 "deterioration is earned on the record and not just on the "
                 "ratio. ")

# CHOICE 5, the refusal. HMVL only.
ARTEFACT = ("The flag on this row should be ignored, and it is worth saying "
            "precisely why rather than quietly dropping it. Its stated "
            "prior-years mean of 8.656 is dominated by one year in the middle "
            "of the window where ₹203.38cr of operating cash arrived against "
            "₹7.12cr of operating profit — a ratio of 28.6 that records an "
            "operating profit near zero and not an exceptional collection "
            "year, and no mean containing it describes a level anything can "
            "fall from. Measured on the cash rows instead there is no "
            "negative operating cash year in the ten-year window at all. ")

# CHOICE 3, two refusals and one requirement.
BANDWIDE = ("Its own earnings band is too wide to price the row — the high is "
            "more than five times the low, which records an earnings "
            "denominator passing near zero in some year rather than a range a "
            "price can sit inside — so no band figure is quoted here. ")
NOBAND = ("The pack carries no own-history earnings band for this row at all: "
          "its own blocker says the annual history cannot support one, which "
          "is itself the finding, because the years it cannot use are the "
          "loss-making ones. ")

# CHOICE 7.
STEP = ("The twelve-month figures on this row are computed against the year "
        "before a one-year margin step, which the pack flags as a mix change, "
        "an acquisition or a one-off rather than a trend. ")

# CHOICE 4, the spine.
BELOW = ("The earnings here are made below the operating line, which is a "
         "statement about where the profit comes from rather than about how "
         "much of it there is: other income, a revaluation, an associate's "
         "result or a tax entry, none of which the operating margin can see. ")

# CHOICE 8. PVRINOX only.
COVID = ("Its five-year growth window starts in FY2021, when the cinemas were "
         "closed and sales were ₹280.01cr against ₹6,646.20cr now, so the "
         "compound rate is arithmetic off a shut year and not a growth "
         "record. ")

# CHOICE 11. DBCORP only.
WINDOW = ("Its twelve-month window ends 2026-09-30 where the other five rows "
          "here end 2026-06-30, so the TTM figures on this row are one "
          "quarter ahead of the batch and are not comparable across it. ")

# CHOICE 6. PFOCUS only.
NOVERDICT = ("There is no verdict on this row, and that is the finding. The "
             "price is 266.32x trailing earnings on a trailing year that is "
             "the third profitable one in ten, the pack cannot build an "
             "own-history earnings band for it, and three of the inputs a "
             "quality percentile would normally rest on are NULL. What "
             "follows is what can be said; a recommendation is not among it. ")

# Metrics NULL for >=95% of the universe in this snapshot.
DEAD = ("roe_latest", "p_premium",
        "book_value_cagr_3y", "cfo_pat_latest", "roce_latest",
        "op_margin_latest", "book_value_cagr_5y", "np_cagr_7y",
        "roe_excess_13_10y", "roe_excess_13_7y", "roe_excess_13_5y",
        "book_value_cagr_10y", "p_aum")

# CHOICE 1 and the realty lesson: plain-English phrases naming columns THIS
# cluster does not carry. Guard 10 cannot see them because they are not tags.
BANNED_PHRASES = ("inventory day", "receivable day", "collection cycle",
                  "asset turnover", "capex intensity", "interest coverage",
                  "cash from sales", "net debt to ebitda", "net debt/ebitda",
                  "price-to-aum", "loan book", "three-year return on equity")
PHRASE_EXEMPT = (ARTEFACT,)

# CHOICE 10.
EMAFLAT = "ema_stack_bull"

# CHOICE 1. Banned outright; guard 20 verifies they are still thin.
THIN = {"peg": 9, "div_yield": 12}
THIN_FLOOR = 19

CODE_ALLOW = {"media_entertainment", "full", "tech_net_score_scaled"}

# CHOICE 5. Per row: negative-operating-cash years out of ten, the latest
# ratio as a level, and whether "deterioration" is earned — None if it is,
# otherwise the reason it is refused.
CASHYRS = {
    "DBCORP":   (0, 0.746, None),
    "HMVL":     (0, 0.645, "artefact"),
    "NAZARA":   (1, 0.569, None),
    "PFOCUS":   (1, 0.719, None),
    "PVRINOX":  (1, 1.031, None),
    "SAREGAMA": (3, 0.297, None),
}
# Rows the pack raises a cash-conversion flag on.
CASH_FLAGGED = {"HMVL", "SAREGAMA"}

# CHOICE 3. hi/lo above this and the band may not price the row.
BAND_RATIO_MAX = 5.0
BAND_REASON = {"HMVL": "wide", "PVRINOX": "wide", "SAREGAMA": "wide",
               "PFOCUS": "absent"}

# CHOICE 7. (prev, now, step points) as the pack states them.
MARGINSTEP = {
    "HMVL": (2.8, 13.1, 10.30),
    "NAZARA": (6.0, -5.1, -11.17),
    "PFOCUS": (25.1, 30.1, 5.00),
    "SAREGAMA": (23.9, 35.9, 11.93),
}
TTM_FIELDS = ("ttm_sales_pct", "ttm_op_pct", "ttm_np_pct")

# CHOICE 4. Years in which net profit exceeded operating profit, out of ten.
BELOWLINE = {"HMVL": 7, "NAZARA": 3}

# CHOICE 9. Pillars scored on part of their declared weight.
PILLAR_WEIGHT = {
    "HMVL": [("valuation", "90 of its 100 declared points")],
    "NAZARA": [("valuation", "35 of its 100 declared points")],
    "PFOCUS": [("quality", "80.2 of its 100 declared points")],
    "PVRINOX": [("quality", "80.2 of its 100 declared points")],
}

STATUS = {s: "full" for s in EMIT}

MOM95_SYMS = EMIT
COVID_SYM = "PVRINOX"
WINDOW_SYM = "DBCORP"
NOVERDICT_SYM = "PFOCUS"

# CHOICE 1. peg (9) and div_yield (12) are banned, so 19 is the thinnest
# reading this batch anchors on and nothing below it can be a real rank here.
DENOM_FLOOR = 19

_ORDINAL = (r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|"
            r"tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|"
            r"\d+(?:st|nd|rd|th)")
DENOM_RX = re.compile(rf"\b(?:{_ORDINAL})\s+of\s+(?:the\s+)?(\d+)(?!\.\d)\b")
_CODE_RX = re.compile(r"<code>([a-z0-9_-]+)</code>")
_YEAR_WORD = {"four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10}
NEGWORD = {0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
           6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}
NOZERO_PHRASE = "no negative operating cash year"
WINDOW_BATCH = ["2025-09-30", "2026-06-30"]
WINDOW_HELD = ["2025-12-31", "2026-09-30"]

SPEC: dict[str, dict] = {
"DBCORP": {
 "confidence": "medium",
 "verdict": "HOLD — composite 72, 14th of 46, on operating profit that fell from ₹622.76cr to ₹489.62cr across three years with no negative operating cash year across the ten-year record, at 8.72x against an own ten-year band averaging 11.75x",
 "points": [
  "<b>Held — DBCORP is in your portfolio.</b> D.B.Corp, ₹2,852cr and ninth of 47 by market cap in this bucket — a diversified Indian-language media group: print publications, Indian-language radio channels and digital portals, listed on both exchanges; <code>promoter_pct</code> is 74.5%, seventh of 47, up from 72.36% in September 2024. " + VET + "Composite 72 is 14th of 46 and quality 68 is tied third of 46; valuation is 68 at 12th of 47 and momentum 19 at 41st of 47. " + WINDOW,
  "<b><code>roce_3y</code> 20.76% at fifth of 43 is the highest three-year return on capital in this batch, and the cash record underneath it has no negative year in it.</b> <code>roce_5y</code> 16.81% is seventh of 44, with SAREGAMA the only row here reading higher on the five-year window. <code>op_margin_3y</code> 23.35% is sixth of 46, with <code>opm_now</code> 19.73% at eighth of 44 against <code>opm_prev</code> 21.51% at seventh of 44 — the margin is slipping rather than stepping, and the pack raises no earnings-quality flag on this row at all. There is no negative operating cash year across the ten-year record in the pack, which is true of two rows here and of this one without a caveat, and FY2026 collected 0.746 of operating profit against a prior-years mean of 0.914. <code>cfo_pat_3y</code> 1.192 is 14th of 24, <code>wc_days</code> 26.96 is 18th of 45 and <code>debt_equity</code> 0.108 is 19th of 34. <code>roe_avg_above_threshold_10y</code> 0.500 is tied third of 47 in a two-way tie spanning positions 3 to 4, <code>roe_avg_above_threshold_7y</code> 0.429 is fourth of 47 and <code>roe_avg_above_threshold_5y</code> 0.400 is tied third of 47 in a two-way tie spanning positions 3 to 4 — the average return on equity cleared the bar in five separate years across the ten-year window, and twice across the most recent five.",
  "<b>Three consecutive years of falling profit on flat sales, which is the whole of the momentum reading.</b> Operating profit went ₹622.76cr, ₹546.13cr and ₹489.62cr across the last three years in the pack while sales went ₹2,402.09cr, ₹2,339.11cr and ₹2,355.52cr — the revenue line is flat and the profit line has lost a fifth of itself on top of it. Net profit followed, ₹425.52cr to ₹370.98cr to ₹332.0cr, and so did operating cash, ₹578.65cr to ₹414.32cr to ₹365.21cr: this is not an accounting gap but a business earning less and collecting less in step. <code>rev_cagr_5y</code> 7.43% is 18th of 44 and <code>np_cagr_5y</code> 23.53% is seventh of 21, though the five-year profit rate is measured from a print-advertising trough of ₹307.03cr of operating profit. <code>np_growth_above_inflation_10y</code> 0.222 is tied 44th of 47 in a four-way tie spanning positions 44 to 47 — across the ten-year window profit beat inflation twice, the weakest long record on any row in this batch — and it sits directly against <code>np_consistency_10y</code> 1.745 at third of 45, which measures steadiness and not direction.",
  "<b>A quarter below its own decade, and the chart has already charged for the decline.</b> <code>pe_ttm</code> 8.72x is 13th of 19 and the own ten-year band runs 5.06-18.71x with an average of 11.75x — twenty-six per cent below its own mean, on a band narrow enough to price the row at all, which is true of two rows here. " + PETHIN + "<code>pb</code> 1.174 is 16th of 37, <code>ev_ebitda_ttm</code> 4.037x is 22nd of 28, <code>ev_sales_ttm</code> 0.946 is 27th of 44 and <code>fcf_yield</code> 15.49% is 17th of 46. The twelve months behind it are flat to negative on every line: <code>ttm_sales_pct</code> +0.09% is 26th of 44, <code>ttm_op_pct</code> -8.19% is 19th of 31 and <code>ttm_np_pct</code> -5.16% is ninth of 23, with <code>sales_yoy_q</code> -5.47% at 35th of 44 and <code>np_yoy_q</code> -26.58% at 30th of 47. The chart agrees: <code>ret_12m_rel</code> -32.27% is 33rd of 45, <code>ret_6m_rel</code> -20.37% is 39th of 46, <code>ret_3m_rel</code> -15.60% is 41st of 47 and the close held above its 200-day EMA on 1.98% of the last 252 sessions at 33rd of 45 — effectively the whole year underneath it. Ownership runs the other way: <code>promoter_pct</code> 74.5% is seventh of 47 and has risen from 72.34% in December 2024 without a single fall since, while <code>fii_pct</code> 11.85% at sixth of 41 has fallen from 13.44% across the same stretch; <code>dii_pct</code> 4.24% is tenth of 33 and <code>shareholders</code> 41,178 is 21st of 47 on a public float of 9.41%. " + MOM95,
  "<i>DBCORP is the row in this batch where the operating evidence is real and the direction is wrong. <code>roce_3y</code> 20.76% at fifth of 43, <code>op_margin_3y</code> 23.35% at sixth of 46, <code>roe_avg_above_threshold_10y</code> 0.500 at tied third of 47, no negative operating cash year across the ten-year record, and no earnings-quality flag — this is the only row here whose quality percentile needs no caveat underneath it. Against that: operating profit has fallen three years running, from ₹622.76cr to ₹489.62cr, on sales that did not move, and operating cash fell with it from ₹578.65cr to ₹365.21cr. The price has already taken the view — trailing earnings at 8.72x against an own ten-year average of 11.75x, <code>pb</code> 1.174 at 16th of 37 — and the promoter has been buying into it while foreign holders sell. Holding this is a judgement about whether Hindi-belt print advertising has a floor, which no number in the pack can settle. Confidence is medium, and the twelve-month figures on this row end a quarter later than the rest of the batch.</i>",
 ],
 "trigger": "ttm_op_pct returning to growth with opm_now holding above 20% -> the three-year profit decline had a floor, and 8.72x against an own ten-year average of 11.75x was the discount for sitting through it. Operating profit falling a fourth year with cash_from_operating under ₹350cr -> the print base is structurally shrinking and a return on capital of 20.76% was the last reading of an old business.",
 "evidence": ["roce_3y", "roce_5y", "op_margin_3y", "opm_now", "opm_prev", "cfo_pat_3y", "wc_days", "debt_equity", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_5y", "rev_cagr_5y", "np_cagr_5y", "np_growth_above_inflation_10y", "np_consistency_10y", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "fcf_yield", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "promoter_pct", "fii_pct", "dii_pct", "shareholders"],
},

"PVRINOX": {
 "confidence": "medium",
 "verdict": "HOLD — composite 93, fourth of 46, on the first profitable year after five consecutive loss-making ones, at 31.39x with no own earnings band narrow enough to price it",
 "points": [
  "<b>Held — PVRINOX is in your portfolio.</b> PVR INOX, ₹13,958cr and fourth of 47 by market cap in this bucket — the merged PVR and INOX multiplex chain, which is a property and occupancy business selling tickets, food and screen advertising; <code>promoter_pct</code> is 27.53%, 41st of 47, and unchanged at that level through every period in the series since March 2025. " + VET + "Composite 93 is fourth of 46 and momentum 74 is tied third of 47; valuation is 48 at tied 24th of 47. " + BANDWIDE,
  "<b>Quality 68 at tied third of 46, and it is scored on 80.2 of its 100 declared points.</b> The missing 19.8 are a three-year cash-to-profit ratio worth 10.8 points and a five-year profit growth rate worth 9, both NULL for this row, and both for the same reason: five of the last six years lost money, so neither can be computed through them. The series is the row — net profit ran minus ₹747.79cr, minus ₹488.24cr, minus ₹335.1cr, minus ₹32.0cr and minus ₹279.6cr across the five years to FY2025, then ₹334.1cr in FY2026. That is the first profitable year in six, and it is the single fact a held position here turns on. The operating recovery is older than the profit: <code>op_margin_3y</code> 29.50% is fourth of 46, <code>opm_now</code> 32.40% is fourth of 44 against <code>opm_prev</code> 28.24% at fourth of 44, and <code>op_margin_trend_7y</code> 0.1129 is third of 46. Operating cash was negative in one year across the ten-year record — the shut year, at minus ₹412.68cr — and FY2026 collected 1.031 of operating profit against a prior-years mean of 1.191 — cash arriving ahead of the reported profit, which is the right order for a recovery.",
  "<b>What six years of losses leaves behind is a return record with nothing in it.</b> <code>roe_avg_above_threshold_10y</code> 0.000 is tied 19th of 47 in a 29-way tie spanning positions 19 to 47, <code>roe_avg_above_threshold_7y</code> 0.000 is tied 12th of 47 in a 36-way tie spanning positions 12 to 47 and <code>roe_avg_above_threshold_5y</code> 0.000 is tied tenth of 47 in a 38-way tie spanning positions 10 to 47 — on all three readings the average return on equity cleared the bar in no year, the ties are wide enough that the ranks say nothing, and the readings say everything. <code>roce_3y</code> 5.20% is 18th of 43, <code>roce_5y</code> 3.03% is 23rd of 44 and <code>np_consistency_10y</code> 0.756 is 28th of 45. The growth ranks look much better than that and should not be read as a growth record: " + COVID + "<code>rev_cagr_5y</code> 49.53% is third of 44, <code>np_growth_above_inflation_5y</code> 0.750 is tied third of 47 in an eight-way tie spanning positions 3 to 10, <code>np_growth_above_inflation_10y</code> 0.667 is tied third of 47 in a four-way tie spanning positions 3 to 6 and <code>np_growth_above_inflation_7y</code> 0.667 is tied fifth of 47 in an eight-way tie spanning positions 5 to 12. <code>debt_equity</code> 0.919 is fifth of 34, the second most levered row in this batch, and a multiplex chain's lease obligations sit underneath that number rather than inside it.",
  "<b>The price has run with the recovery, and domestic institutions own more of this than the promoter does.</b> <code>pe_ttm</code> 31.39x is seventh of 19, divided into a trailing year that is the first profitable one in six. " + PETHIN + "<code>pb</code> 1.892 is 11th of 37, <code>ev_ebitda_ttm</code> 6.236x is 15th of 28, <code>ev_sales_ttm</code> 3.178 is 12th of 44 and <code>fcf_yield</code> 17.09% is 16th of 46 — on the asset and cash-flow measures it is mid-pack, and only the earnings multiple is demanding. The twelve months behind it grew: <code>ttm_sales_pct</code> +13.68% is tenth of 44 and <code>ttm_op_pct</code> +30.42% is 12th of 31, with no trailing net figure in the pack at all because the comparison year has no positive base to grow from. The quarter held, with <code>sales_yoy_q</code> +11.91% at 18th of 44 and <code>np_yoy_q</code> +204.63% at seventh of 47. The chart leads the cohort: <code>ret_3m_rel</code> +45.29% is second of 47, <code>ret_6m_rel</code> +43.06% is fourth of 46, <code>ret_12m_rel</code> +19.37% is fifth of 45 and the close held above its 200-day EMA on 34.92% of the last 252 sessions at ninth of 45. Ownership is the structural oddity: <code>dii_pct</code> 35.72% is first of 33 and <code>fii_pct</code> 18.08% is fourth of 41 against <code>promoter_pct</code> 27.53% at 41st of 47, so institutions hold roughly twice what the promoter does — and the domestic holding has drifted down from 40.03% eighteen months ago while <code>shareholders</code> 236,922, sixth of 47, has fallen from 263,443 on a public float of 18.67%. " + MOM95,
  "<i>PVRINOX is a recovery that has reached the profit line exactly once. ₹334.1cr of net profit in FY2026 after five consecutive loss years, <code>op_margin_3y</code> 29.50% at fourth of 46, <code>op_margin_trend_7y</code> 0.1129 at third of 46 and ₹2,160.3cr of operating cash collecting 1.031 of operating profit — the operations are working and the cash is arriving ahead of the earnings, which is the right order. The reasons to hold rather than add are all on the other side of the same fact. <code>roe_avg_above_threshold_10y</code>, <code>roe_avg_above_threshold_7y</code> and <code>roe_avg_above_threshold_5y</code> are 0.000 on all three readings, so there is no decade of adequate returns to extrapolate; <code>debt_equity</code> 0.919 at fifth of 34 says the balance sheet carries the screens; a five-year compound revenue rate of 49.53% is arithmetic off a shut year; and its own earnings band spans 8.1 times from low to high, so it cannot adjudicate 31.39x. A second profitable year would convert most of this file. Confidence is medium.</i>",
 ],
 "trigger": "A second consecutive profitable year with opm_now holding above 32% -> the FY2026 profit was the operating recovery arriving rather than a one-off, and 31.39x on a single year of earnings was the price of being early. Net profit returning to a loss with dii_pct falling further from 35.72% -> the domestic institutions that own more of this than the promoter become the marginal seller on a row with no own earnings band to fall back to.",
 "evidence": ["op_margin_3y", "opm_now", "opm_prev", "op_margin_trend_7y", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_5y", "roce_3y", "roce_5y", "np_consistency_10y", "rev_cagr_5y", "np_growth_above_inflation_5y", "np_growth_above_inflation_10y", "np_growth_above_inflation_7y", "debt_equity", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "fcf_yield", "ttm_sales_pct", "ttm_op_pct", "sales_yoy_q", "np_yoy_q", "ret_3m_rel", "ret_6m_rel", "ret_12m_rel", "pct_above_200ema_252d", "dii_pct", "fii_pct", "promoter_pct", "shareholders", "wc_days"],
},

"HMVL": {
 "confidence": "low",
 "verdict": "WATCH — composite 98, second of 46, where the earnings are made below the operating line in seven separate years across the ten-year record and the pack's own cash flag is an artefact of a ₹7.12cr denominator",
 "points": [
  "<b>Not held — HMVL is on your watchlist.</b> Hindustan Media Ventures, ₹559.9cr by market cap in this bucket — the Hindi-language print arm of the HT group, publishing a daily newspaper across the Hindi belt; <code>promoter_pct</code> is 74.4%, eighth of 47, and unchanged across all nine periods in the shareholding series. " + VET + "Composite 98 is second of 46 — the loudest percentile in this batch — while quality 56 is 19th of 46 and momentum 64 is tied eighth of 47; valuation 72 is 11th of 47 but is scored on 90 of its 100 declared points, the missing 10 being dividend yield, which is NULL for this row. " + BANDWIDE,
  "<b>A composite of 98 built on one year of margin arithmetic.</b> " + STEP + "<code>opm_prev</code> 2.82% is 24th of 44 and <code>opm_now</code> 13.12% is 14th of 44 — ten and a third points of operating margin added in a single year, off a base so low that everything computed against it is arithmetic rather than information. That is the whole of <code>ttm_op_pct</code> +415.46% at third of 31, against <code>ttm_sales_pct</code> of only +10.79% at 15th of 44 and <code>ttm_np_pct</code> +2.42% at eighth of 23: the sales line moved in double digits, the net line in single digits, and the operating line quintupled. <code>sales_yoy_q</code> +19.79% is 15th of 44 and <code>np_yoy_q</code> +399.71% is fourth of 47 — the same effect one quarter at a time. <code>op_margin_3y</code> 4.55% at 25th of 46 is the figure to trust over <code>opm_now</code>, because it averages three years instead of reading the year of the step, and it puts this row in the bottom half of the cohort on margin.",
  "<b>And the earnings are not made by the operations, which is a ten-year pattern rather than one odd year.</b> " + BELOW + "Net profit exceeded operating profit in seven separate years across the ten-year record in the pack. The clearest of them is the year of an operating loss of ₹73.48cr that still reported ₹9.95cr of net profit; operating profit itself was negative twice in the window, at minus ₹86.99cr and minus ₹73.48cr. The capital returns say the same thing from the other side: <code>roce_3y</code> 3.59% is 23rd of 43, <code>roce_5y</code> 2.31% is 25th of 44 and <code>op_margin_trend_7y</code> 0.00402 is 20th of 46. <code>roe_avg_above_threshold_5y</code> 0.000 is tied tenth of 47 in a 38-way tie spanning positions 10 to 47 and <code>roe_avg_above_threshold_7y</code> 0.000 is tied 12th of 47 in a 36-way tie spanning positions 12 to 47 — no year in either window where the average return on equity cleared the bar — while <code>roe_avg_above_threshold_10y</code> 0.100 is tied tenth of 47 in a nine-way tie spanning positions 10 to 18, which is one year out of ten. <code>np_growth_above_inflation_10y</code> 0.333 is tied 39th of 47 in a five-way tie spanning positions 39 to 43.",
  "<b>The pack flags its cash, and the flag is measuring its own denominator.</b> " + CASH + ARTEFACT + "<code>cfo_pat_3y</code> 1.206 is 13th of 24 and <code>wc_days</code> -313.998 is 40th of 45 — a deeply negative working-capital cycle, which for a publisher is subscription and advertising money collected before the paper is printed, and it is why the cash line holds up while the profit line does not. <code>debt_equity</code> 0.053 is 23rd of 34 and <code>np_consistency_10y</code> 1.444 is 11th of 45. On price, <code>pb</code> 0.353 at 34th of 37 is the lowest price-to-book in this batch — the market pays roughly a third of stated book — and <code>pe_ttm</code> 6.25x is 18th of 19. " + PETHIN + "<code>ev_ebitda_ttm</code> 5.173x is 18th of 28, <code>ev_sales_ttm</code> 0.792 is 30th of 44 and <code>fcf_yield</code> 6.24% is 26th of 46. The chart has partly noticed: <code>ret_6m_rel</code> +20.07% is sixth of 46, <code>ret_12m_rel</code> +4.80% is tenth of 45, <code>ret_3m_rel</code> -7.61% is 34th of 47 and the close held above its 200-day EMA on 30.16% of the last 252 sessions at 12th of 45. Ownership does not move at all: <code>promoter_pct</code> 74.4% is flat across the whole series, <code>fii_pct</code> 0.1% is 29th of 41, and <code>shareholders</code> 16,498 is 34th of 47, down from 18,998 in September 2024, on a public float of 25.22%. " + MOM95,
  "<i>HMVL carries the highest composite in this batch at second of 46 and the least support for it. The margin it is scored on moved from 2.82% to 13.12% in one year, so the twelve-month operating gain of +415.46% is arithmetic off a near-zero base; <code>op_margin_3y</code> 4.55% at 25th of 46 is what three years of it look like. Underneath, net profit exceeded operating profit in seven separate years across the ten-year record, <code>roce_5y</code> 2.31% is 25th of 44, and the return-on-equity threshold is 0.000 across both the five- and seven-year windows. The pack's cash flag on this row is the one thing that should be ignored: its prior-years mean of 8.656 is dominated by a year with ₹7.12cr of operating profit underneath it, and operating cash has in fact been positive in every year of the window. So the genuine case is an asset case — <code>pb</code> 0.353 at 34th of 37 on a flat 74.4% promoter holding — and not the earnings case the composite is reading. Confidence is low.</i>",
 ],
 "trigger": "opm_now holding near 13% for a second full year with net profit sitting below operating profit -> the step was a real mix change and 0.353 times book was the price of waiting for proof. opm_now reverting toward 3% with roce_5y still under 3% -> the composite of 98 was reading one year of margin arithmetic on a print business that earns below its own operating line.",
 "evidence": ["opm_prev", "opm_now", "ttm_op_pct", "ttm_sales_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "op_margin_3y", "roce_3y", "roce_5y", "op_margin_trend_7y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "np_growth_above_inflation_10y", "cfo_pat_3y", "wc_days", "debt_equity", "np_consistency_10y", "pb", "pe_ttm", "ev_ebitda_ttm", "ev_sales_ttm", "fcf_yield", "ret_6m_rel", "ret_12m_rel", "ret_3m_rel", "pct_above_200ema_252d", "promoter_pct", "fii_pct", "shareholders"],
},

"NAZARA": {
 "confidence": "low",
 "verdict": "WATCH — quality 65, seventh of 46, on the only long profit-growth record at the top of all three windows in this cohort, against an operating loss of ₹28.11cr in the latest year",
 "points": [
  "<b>Not held — NAZARA is on your watchlist.</b> Nazara Technologies, ₹16,457cr and third of 47 by market cap in this bucket — a mobile-gaming, esports and ad-tech group assembled by acquisition rather than grown, which is why its sales line quadrupled over the window; <code>promoter_pct</code> is 33.98%, 38th of 47, after a jump from 8.3% to 35.45% in the September 2025 quarter. " + VET + "Quality 65 is seventh of 46, composite 43 is 27th of 46 and momentum 58 is 13th of 47; valuation 15 is 44th of 47 but is scored on 35 of its 100 declared points, the missing 65 being a trailing earnings multiple, an enterprise-value-to-EBITDA multiple, dividend yield and a growth-adjusted earnings multiple, all four NULL for this row.",
  "<b><code>np_growth_above_inflation_7y</code> 1.000 at tied first of 47 in a two-way tie spanning positions 1 to 2 is the best long profit-growth record in this cohort, and the year it ends in carries a loss at the operating line.</b> <code>np_growth_above_inflation_5y</code> 1.000 is tied first of 47 in a two-way tie spanning positions 1 to 2, <code>np_growth_above_inflation_7y</code> 1.000 is tied first of 47 in a two-way tie spanning positions 1 to 2 and <code>np_growth_above_inflation_10y</code> 0.778 is tied first of 47 in a two-way tie spanning positions 1 to 2 — on all three windows this row sits on the cohort's top line, which no other row in this batch does on even one of them. Then the latest year: an operating loss of ₹28.11cr on sales of ₹1,828.98cr, against a net profit of ₹95.85cr. " + BELOW + "Net profit has exceeded operating profit in three separate years across the ten-year record, by ₹2.11cr, ₹5.2cr and now ₹123.96cr. <code>np_cagr_5y</code> 35.54% is fifth of 21 and <code>rev_cagr_5y</code> 30.97% is fifth of 44, so the growth is not in dispute — it is where the growth stops that is.",
  "<b>Underneath the growth ranks, every return reading is mid-pack at best.</b> <code>roce_3y</code> 3.18% is 24th of 43, <code>roce_5y</code> 4.89% is 19th of 44, <code>op_margin_3y</code> 4.74% is 24th of 46 and <code>op_margin_trend_7y</code> -0.00136 is 24th of 46 — the middle of the cohort on all four, on a row whose profit-growth ranks are first. <code>roe_avg_above_threshold_10y</code> 0.100 is tied tenth of 47 in a nine-way tie spanning positions 10 to 18, while <code>roe_avg_above_threshold_5y</code> 0.000 is tied tenth of 47 in a 38-way tie spanning positions 10 to 47 and <code>roe_avg_above_threshold_7y</code> 0.000 is tied 12th of 47 in a 36-way tie spanning positions 12 to 47: one adequate year in ten, and none in the last seven. The cash lines are the better half of the row — operating cash was negative in one year across the ten-year record and the latest year brought in ₹148.63cr against ₹65.5cr the year before, with <code>cfo_pat_3y</code> 1.340 at 12th of 24 — but the pack's own collection ratio of 0.569 is dated to the prior year rather than the latest one, because the latest operating profit is negative and the ratio cannot be formed at all. <code>debt_equity</code> 0.062 is 20th of 34, <code>wc_days</code> -54.75 is 27th of 45 and <code>np_consistency_10y</code> 1.450 is tenth of 45.",
  "<b>Every twelve-month figure here is a sign change, and the price is paying for the chart.</b> " + STEP + "<code>opm_prev</code> 6.03% is 21st of 44 and <code>opm_now</code> -5.14% is 33rd of 44 — eleven points of operating margin lost in one year, through zero, which is the whole of <code>ttm_op_pct</code> -180.04% at 27th of 31 and <code>ttm_np_pct</code> -141.26% at 19th of 23 while <code>ttm_sales_pct</code> is only -6.07% at 28th of 44. <code>sales_yoy_q</code> -14.03% is 39th of 44 and <code>np_yoy_q</code> -216.88% is 41st of 47. The pack can form no trailing earnings multiple for this row at all, which is what a valuation percentile of 15 on a third of its weight means in practice; its own six-year band runs 21.69-90.07x with an average of 40.97x, narrow enough to price the row and with nothing current to price against it. <code>pb</code> 4.738 is sixth of 37, <code>ev_sales_ttm</code> 9.931 is fifth of 44 and <code>fcf_yield</code> -1.19% is 38th of 46. The chart reads the other way on every window: <code>ret_12m_rel</code> +55.96% is second of 45, <code>ret_6m_rel</code> +52.60% is second of 46, <code>ret_3m_rel</code> +38.98% is third of 47 and the close held above its 200-day EMA on 62.30% of the last 252 sessions at second of 45. Ownership moved as much as the margin did: <code>fii_pct</code> 15.51% is fifth of 41 and rising, <code>dii_pct</code> 2.47% is 15th of 33 against 12.44% eighteen months ago, and <code>shareholders</code> 100,544 is ninth of 47, down from 144,688, on a public float of 48.04%.  " + MOM95,
  "<i>NAZARA is the row where the long record and the current year point in opposite directions and both are correct. <code>np_growth_above_inflation_5y</code>, <code>np_growth_above_inflation_7y</code> and <code>np_growth_above_inflation_10y</code> read 1.000, 1.000 and 0.778 across the three windows, with <code>np_cagr_5y</code> 35.54% at fifth of 21 and <code>rev_cagr_5y</code> 30.97% at fifth of 44 — a sales line that went from ₹190.16cr to ₹1,828.98cr. The latest year turned that into an operating loss of ₹28.11cr and a net profit of ₹95.85cr made below the operating line, with <code>roce_3y</code> 3.18% at 24th of 43 and the return-on-equity threshold at 0.000 across both the five- and seven-year windows. An acquisition-assembled group whose margin has just gone through zero is not valuable because it grew; it is a question about what it bought. The chart disagrees with all of this — <code>ret_12m_rel</code> +55.96% at second of 45 and <code>pct_above_200ema_252d</code> 62.30% at second of 45 — and the pack cannot even compute an earnings multiple to argue with. Confidence is low.</i>",
 ],
 "trigger": "opm_now returning above zero with ttm_sales_pct back in growth -> the operating loss was integration cost on acquired studios, and the profit-growth record was the right thing to read. Operating profit negative a second year with dii_pct falling further from 2.47% -> the earnings are being made below the operating line on a row priced at 9.93 times sales, and the domestic institutions that already left were early.",
 "evidence": ["np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "np_cagr_5y", "rev_cagr_5y", "roce_3y", "roce_5y", "op_margin_3y", "op_margin_trend_7y", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "cfo_pat_3y", "debt_equity", "wc_days", "np_consistency_10y", "opm_prev", "opm_now", "ttm_op_pct", "ttm_np_pct", "ttm_sales_pct", "sales_yoy_q", "np_yoy_q", "pb", "ev_sales_ttm", "fcf_yield", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "fii_pct", "dii_pct", "promoter_pct", "shareholders"],
},

"SAREGAMA": {
 "confidence": "medium",
 "verdict": "WATCH — quality 73, second of 46, on operating profit that rose in every year of the ten-year record while operating cash fell from ₹331.20cr to ₹100.01cr",
 "points": [
  "<b>Not held — SAREGAMA is on your watchlist.</b> Saregama India, ₹9,840cr and fifth of 47 by market cap in this bucket — a recorded-music rights library with film, television and digital content built around it, which is an annuity on a back catalogue plus a content-spend decision each year; <code>promoter_pct</code> is 60.84%, 23rd of 47, up from 59.22% two years ago. " + VET + "Quality 73 is second of 46, composite 63 is 18th of 46 and momentum 72 is tied fifth of 47; valuation is 20 at 41st of 47. " + BANDWIDE,
  "<b>A library's economics: <code>op_margin_3y</code> 29.63% is third of 46.</b> <code>opm_now</code> 35.87% is third of 44, with <code>roce_3y</code> 17.58% at seventh of 43 and <code>roce_5y</code> 17.36% at sixth of 44 — the return on capital employed holds in double digits across both windows. <code>op_margin_trend_7y</code> 0.0188 is tenth of 46, <code>np_consistency_10y</code> 1.613 is sixth of 45, <code>debt_equity</code> 0.043 is 25th of 34 and <code>wc_days</code> -49.47 is 26th of 45. Operating profit rose in every year of the ten-year record in the pack, from ₹9.44cr to ₹336.75cr, and that unbroken line is what the quality percentile is reading. The long profit record is good rather than exceptional: <code>np_growth_above_inflation_10y</code> 0.667 is tied third of 47 in a four-way tie spanning positions 3 to 6, <code>np_growth_above_inflation_7y</code> 0.667 is tied fifth of 47 in an eight-way tie spanning positions 5 to 12 and <code>np_growth_above_inflation_5y</code> 0.500 is tied 11th of 47 in a 17-way tie spanning positions 11 to 27, with <code>np_cagr_5y</code> 7.93% at ninth of 21 and <code>rev_cagr_5y</code> 14.33% at tenth of 44.",
  "<b>And the cash stopped following the profit in the year the profit was largest.</b> " + CASH + DETERIORATION + "The series is the argument rather than the ratio: operating cash ran ₹93.43cr, ₹93.25cr, ₹331.20cr and ₹100.01cr across the last four years while operating profit ran ₹220.98cr, ₹249.24cr, ₹276.99cr and ₹336.75cr — profit higher in every one of those years and cash back to where it stood three years earlier. The latest year collected 0.297 of operating profit against a prior-years mean of 0.617, which is the pack's second cash flag on this row and the one that is earned. Operating cash was negative in three years across the ten-year record, all three at the start of the window when sales were a fifth of their current level, so the count is history and the direction is current. <code>cfo_pat_3y</code> 0.859 is 19th of 24 and <code>fcf_yield</code> -0.56% is 37th of 46 — a negative free-cash yield on a 35.87% operating margin, which is where the content and catalogue spend goes. <code>roe_avg_above_threshold_7y</code> 0.143 is tied seventh of 47 in a five-way tie spanning positions 7 to 11, <code>roe_avg_above_threshold_10y</code> 0.100 is tied tenth of 47 in a nine-way tie spanning positions 10 to 18 and <code>roe_avg_above_threshold_5y</code> 0.000 is tied tenth of 47 in a 38-way tie spanning positions 10 to 47: one adequate year in ten and none in the last five, on the row with the second-highest quality percentile here.",
  "<b>Sales fell while every profit line rose, and the price pays for the profit lines.</b> " + STEP + "<code>opm_prev</code> 23.94% is sixth of 44 against <code>opm_now</code> 35.87% at third of 44 — twelve points of operating margin in one year — and every twelve-month figure sits on that base: <code>ttm_sales_pct</code> -11.20% is 32nd of 44 while <code>ttm_op_pct</code> +33.03% is ninth of 31 and <code>ttm_np_pct</code> +8.81% is seventh of 23. The annual rows say the same: sales fell from ₹1,171.36cr to ₹984.62cr while operating profit rose from ₹276.99cr to ₹336.75cr. The quarter went the other way, with <code>sales_yoy_q</code> +27.48% at 11th of 44 and <code>np_yoy_q</code> +40.64% at 17th of 47. On price it is the second most demanding row in this batch: <code>pe_ttm</code> 44.33x is fourth of 19. " + PETHIN + "<code>pb</code> 5.813 is fourth of 37, <code>ev_ebitda_ttm</code> 21.452x is seventh of 28 and <code>ev_sales_ttm</code> 9.375 is sixth of 44. The chart is strong across every window: <code>ret_6m_rel</code> +46.64% is third of 46, <code>ret_12m_rel</code> +18.56% is sixth of 45, <code>ret_3m_rel</code> +10.49% is 11th of 47 and the close held above its 200-day EMA on 45.24% of the last 252 sessions at fourth of 45. Ownership is splitting cleanly: <code>fii_pct</code> 11.5% is seventh of 41, down from 17.22% two years ago, while <code>dii_pct</code> 8.6% is fifth of 33, up from 3.22% over the same stretch; <code>shareholders</code> 71,163 is 15th of 47 on a public float of 18.63%. " + MOM95,
  "<i>SAREGAMA is the best operating record in this batch with the one fact that spoils it. Operating profit rose in all ten years of the record, <code>op_margin_3y</code> 29.63% is third of 46, <code>roce_3y</code> 17.58% is seventh of 43 and <code>np_consistency_10y</code> 1.613 is sixth of 45 — a library business behaving like one. Then operating cash fell from ₹331.20cr to ₹100.01cr in the year operating profit reached ₹336.75cr, collecting 0.297 against a prior mean of 0.617, with <code>cfo_pat_3y</code> 0.859 at 19th of 24 and <code>fcf_yield</code> -0.56% at 37th of 46. On a rights business that gap is a question about what is being capitalised into the catalogue and what is being recognised out of it, and the annual sales line falling from ₹1,171.36cr to ₹984.62cr while the margin stepped twelve points makes the question sharper rather than softer. At 44.33x trailing earnings and <code>pb</code> 5.813 at fourth of 37 the price assumes the answer is benign. Confidence is medium: the record earns the benefit of the doubt, the multiple does not leave room for it.</i>",
 ],
 "trigger": "cash_from_operating recovering above ₹250cr with opm_now holding near 36% -> the collection gap was catalogue-acquisition timing, and the unbroken ten-year operating profit record was the thing to trust. Operating cash under ₹150cr a second year with ttm_sales_pct still negative -> profit is being reported faster than it is collected on a row at 44.33x earnings and 5.81 times book.",
 "evidence": ["op_margin_3y", "opm_now", "roce_3y", "roce_5y", "op_margin_trend_7y", "np_consistency_10y", "debt_equity", "wc_days", "np_growth_above_inflation_10y", "np_growth_above_inflation_7y", "np_growth_above_inflation_5y", "np_cagr_5y", "rev_cagr_5y", "cfo_pat_3y", "fcf_yield", "roe_avg_above_threshold_7y", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_5y", "opm_prev", "ttm_sales_pct", "ttm_op_pct", "ttm_np_pct", "sales_yoy_q", "np_yoy_q", "pe_ttm", "pb", "ev_ebitda_ttm", "ev_sales_ttm", "ret_6m_rel", "ret_12m_rel", "ret_3m_rel", "pct_above_200ema_252d", "fii_pct", "dii_pct", "promoter_pct", "shareholders"],
},

"PFOCUS": {
 "confidence": "low",
 "verdict": "WATCH — no verdict. Composite 37 at 30th of 46, on net profit negative in seven separate years across the ten-year record, 266.32x trailing earnings, the most levered balance sheet in the cohort, and no own earnings band at all",
 "points": [
  "<b>Not held — PFOCUS is on your watchlist.</b> Prime Focus, ₹21,849cr and second of 47 by market cap in this bucket — a visual-effects and post-production group selling creative services to studios on project contracts. " + NOVERDICT + "<code>promoter_pct</code> is 60.73%, 24th of 47, down from 69.86% eighteen months ago. " + VET + "Composite 37 is 30th of 46 and momentum 56 is 14th of 47; valuation 19 is tied 42nd of 47. " + NOBAND,
  "<b>Net profit has been negative in seven separate years across the ten-year record, and positive in three.</b> The series runs ₹83.3cr, minus ₹53.18cr, minus ₹22.71cr, minus ₹131.5cr, minus ₹43.4cr, minus ₹171.57cr, ₹147.29cr, minus ₹404.54cr, minus ₹377.11cr and ₹218.74cr — the two deepest losses are the two years immediately before the latest one, and the latest one is the third profitable year in the window. <code>np_consistency_10y</code> 0.580 is 42nd of 45. Quality 61 is 11th of 46 and is scored on 80.2 of its 100 declared points, the missing 19.8 being a three-year cash-to-profit ratio worth 10.8 points and a five-year profit growth rate worth 9, both NULL for this row because the loss years cannot carry either. Against all of that, <code>roe_avg_above_threshold_10y</code> 0.200 is tied eighth of 47 in a two-way tie spanning positions 8 to 9, <code>roe_avg_above_threshold_5y</code> 0.200 is tied fifth of 47 in a five-way tie spanning positions 5 to 9 and <code>roe_avg_above_threshold_7y</code> 0.143 is tied seventh of 47 in a five-way tie spanning positions 7 to 11, and <code>np_growth_above_inflation_5y</code> 0.750 is tied third of 47 in an eight-way tie spanning positions 3 to 10 with <code>np_growth_above_inflation_7y</code> 0.667 tied fifth of 47 in an eight-way tie spanning positions 5 to 12 and <code>np_growth_above_inflation_10y</code> 0.556 tied seventh of 47 in a 13-way tie spanning positions 7 to 19. Those are respectable ranks on a row that lost money in seven separate years of the record, and no percentile can hold both facts at once.",
  "<b>The operating line is the strongest it has ever been, and it is not what the price divides by.</b> <code>op_margin_3y</code> 19.57% is ninth of 46, <code>opm_now</code> 30.09% is fifth of 44 and <code>op_margin_trend_7y</code> 0.0107 is 13th of 46; the latest year turned ₹4,675.81cr of sales into ₹1,423.93cr of operating profit and ₹1,024.06cr of operating cash, the largest of each across the ten rows, with operating cash negative in one year across the ten-year record. But <code>roce_3y</code> 4.20% is 21st of 43 and <code>roce_5y</code> 6.61% is 14th of 44: the capital base is large enough that a record operating profit still earns four per cent on it. <code>debt_equity</code> 2.737 is first of 34 — the most levered row in this cohort by a wide margin — and the distance between ₹1,423.93cr of operating profit and ₹218.74cr of net profit is most of what servicing it costs. <code>wc_days</code> -183.88 is 38th of 45 and <code>ev_sales_ttm</code> 5.463 is eighth of 44.",
  "<b>The most expensive earnings in the cohort on a year the pack cannot put a band around, and a register that turned over in one quarter.</b> <code>pe_ttm</code> 266.32x is second of 19. " + PETHIN + "<code>pb</code> 10.461 is third of 37, <code>ev_ebitda_ttm</code> 12.573x is eighth of 28 and <code>fcf_yield</code> -0.05% is 36th of 46. " + STEP + "<code>ttm_sales_pct</code> +29.17% is fifth of 44 and <code>ttm_op_pct</code> +54.91% is sixth of 31, with no trailing net figure in the pack at all; <code>sales_yoy_q</code> +23.81% is 12th of 44 and <code>np_yoy_q</code> -166.82% is 39th of 47, so the quarter and the year disagree on the bottom line. The chart leads the cohort outright: <code>ret_12m_rel</code> +68.71% is first of 45 and the close held above its 200-day EMA on 88.49% of the last 252 sessions at first of 45, while <code>ret_6m_rel</code> -3.48% is 21st of 46 and <code>ret_3m_rel</code> +6.75% is 15th of 47 — the move is a year old, not a quarter old. Ownership is the last discontinuity: the series shows <code>promoter_pct</code> at 69.86% with <code>fii_pct</code> at 11.24% and the public holding at 18.91% in March 2025, and 60.81%, 4.01% and 34.10% by September 2025, while <code>shareholders</code> went from 12,430 to 23,853 in the same two quarters and stands at 26,384, 27th of 47. <code>dii_pct</code> 1.07% is 18th of 33. " + MOM95,
  "<i>PFOCUS is the clearest no-verdict case in this batch. The strongest facts are real: ₹1,423.93cr of operating profit and ₹1,024.06cr of operating cash in the latest year, both records, with <code>op_margin_3y</code> 19.57% at ninth of 46 and <code>ret_12m_rel</code> +68.71% at first of 45. The reasons not to turn that into a recommendation are structural. Net profit was negative in seven separate years across the ten-year record and <code>np_consistency_10y</code> 0.580 sits at 42nd of 45. <code>debt_equity</code> 2.737 at first of 34 is the most levered balance sheet in the cohort. 266.32x trailing earnings divides the price by the third profitable year in ten, <code>pb</code> 10.461 is third of 37, and the pack will not build an own-history earnings band for the row because the years it would need are loss-making. The quality percentile is missing two of its inputs, a fifth of the promoter holding changed hands in one quarter, and the register doubled behind it. Every one of those is a reason to keep watching and none of them is a reason to act. Confidence is low.</i>",
 ],
 "trigger": "A second consecutive profitable year with debt_equity falling below 2.0 -> there would be an earnings base and a balance sheet to value, and a verdict could be written on this row. Net profit returning to a loss with ret_12m_rel giving back the year -> 266.32x was pricing the third profitable year in ten as if it were the first of many, and the no-verdict label stays.",
 "evidence": ["np_consistency_10y", "roe_avg_above_threshold_10y", "roe_avg_above_threshold_5y", "roe_avg_above_threshold_7y", "np_growth_above_inflation_5y", "np_growth_above_inflation_7y", "np_growth_above_inflation_10y", "op_margin_3y", "opm_now", "opm_prev", "op_margin_trend_7y", "roce_3y", "roce_5y", "debt_equity", "wc_days", "ev_sales_ttm", "pe_ttm", "pb", "ev_ebitda_ttm", "fcf_yield", "ttm_sales_pct", "ttm_op_pct", "sales_yoy_q", "np_yoy_q", "ret_12m_rel", "ret_6m_rel", "ret_3m_rel", "pct_above_200ema_252d", "promoter_pct", "fii_pct", "dii_pct", "shareholders", "rev_cagr_5y"],
},

}


def guards(spec: dict, pack: dict) -> list[str]:
    """Checks that can fail. Each one has a wrong input it would reject.

    Pass 1 (`verdict-check.py`) traces numeric tokens to the pack; pass 2
    (`verdict-ranks-check.py`) asserts every rank and denominator. These cover
    the third category — structural claims neither pass can see. The four this
    batch forced into existence are 20 (a metric read by 9 of 47 is banned, and
    the ban is verified against the live reading count in both directions), 22
    (a trailing-earnings rank read by 19 of 47 carries its caveat in the same
    point), 23 (the count of years where net profit exceeded operating profit,
    which is not a metric in the pack) and 27 (the cash flag refused on HMVL is
    refused because of a specific denominator, recomputed here).
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
        joined = " ".join(pts)
        live = (p.get("metrics") or {}).get("cluster_metrics") or {}
        mranks = pr.get("metrics") or {}

        # 1. Shape.
        if len(pts) != 5:
            errs.append(f"{sym}: {len(pts)} points, expected 5")
        if not pts[-1].startswith("<i>"):
            errs.append(f"{sym}: last point is not the italic summary")

        # 2. One cohort, but the stated count still has to match the bucket the
        #    scorer actually used rather than the cluster size.
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

        # 3. Every row here is `full`, which is exactly why the guard stays —
        #    the next cluster will not be.
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

        # 5. Dead metrics may not be argued from.
        for pt in pts:
            for d in DEAD:
                if d in pt:
                    errs.append(f"{sym}: prose names dead metric '{d}'")
            if "tech_net_score_scaled" in pt and MOM95 not in pt:
                errs.append(f"{sym}: names tech_net_score_scaled outside MOM95")
        for d in DEAD + ("tech_net_score_scaled",):
            if d in v["trigger"] or d in v["verdict"]:
                errs.append(f"{sym}: verdict/trigger names dead '{d}'")

        # 6. CHOICE 12. Five rows hold 13 distinct sessions — one print
        #    repeated — and HMVL holds none at all. Banned outright.
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

        # 8. Every evidence key must resolve non-NULL in THIS row's own
        #    cluster_metrics or verdict-load.py rejects the whole row. Here
        #    cfo_pat_3y, np_cagr_5y, pe_ttm, ev_ebitda_ttm, ttm_np_pct, dii_pct
        #    and div_yield are each NULL on some row and live on others.
        for k in v["evidence"]:
            if k not in live:
                errs.append(f"{sym}: evidence key '{k}' not in cluster_metrics "
                            f"(tier={tier})")
            elif live[k] is None:
                errs.append(f"{sym}: evidence key '{k}' is NULL in the pack")
            if k in THIN:
                errs.append(f"{sym}: evidence carries '{k}', a reading banned "
                            f"from this batch for thinness")

        # 9. CHOICE 3, three-valued. A band whose high is more than
        #    BAND_RATIO_MAX times its low does not locate a price — it records
        #    an earnings denominator going near zero in some year. A row with no
        #    band at all is a different sentence, not the same one. The two rows
        #    with a usable band must state it and state it correctly, so the ban
        #    cannot quietly become "nobody quotes a band".
        band = p.get("pe_band") or {}
        lo, hi, avg = band.get("lo"), band.get("hi"), band.get("avg")
        if not band or not lo:
            state = "absent"
        elif (hi / lo) > BAND_RATIO_MAX:
            state = "wide"
        else:
            state = None
        if BAND_REASON.get(sym) != state:
            errs.append(f"{sym}: BAND_REASON says {BAND_REASON.get(sym)!r}, "
                        f"the pack's band is {lo}-{hi} (n={band.get('n')}) "
                        f"which reads {state!r}")
        if state:
            need = NOBAND if state == "absent" else BANDWIDE
            other = BANDWIDE if state == "absent" else NOBAND
            if need not in p0:
                errs.append(f"{sym}: band is {state} and point one does not "
                            f"carry the sentence saying so")
            if other in joined:
                errs.append(f"{sym}: band is {state} but the prose carries the "
                            f"other refusal")
            for pt in allprose:
                if re.search(r"own \w+-year band", pt):
                    errs.append(f"{sym}: quotes its own band, which is "
                                f"{state} and cannot price the row")
                for fig in (lo, hi, avg):
                    if fig is not None and f"{fig:.2f}x" in pt:
                        errs.append(f"{sym}: states band figure {fig:.2f}x on "
                                    f"a row whose band is banned")
        else:
            for text in (BANDWIDE, NOBAND):
                if text in joined:
                    errs.append(f"{sym}: refuses its band, which is {lo}-{hi} "
                                f"and inside the {BAND_RATIO_MAX}x limit")
            got = 0
            for pt in allprose:
                for yr, blo, bhi, bavg in re.findall(
                        r"own (\w+)-year band runs ([\d.]+)-([\d.]+)x"
                        r" with an average of ([\d.]+)x", pt):
                    got += 1
                    if _YEAR_WORD.get(yr.lower()) != band.get("n"):
                        errs.append(f"{sym}: says {yr}-year band, pack "
                                    f"n={band.get('n')}")
                    if (abs(float(blo) - lo) > 0.005
                            or abs(float(bhi) - hi) > 0.005):
                        errs.append(f"{sym}: band {blo}-{bhi} vs pack "
                                    f"{lo}-{hi}")
                    if abs(float(bavg) - avg) > 0.005:
                        errs.append(f"{sym}: band average {bavg} vs pack {avg}")
            for pt in allprose:
                for bavg in re.findall(
                        r"own \w+-year band averag\w+(?: of|) ([\d.]+)x", pt):
                    if abs(float(bavg) - avg) > 0.005:
                        errs.append(f"{sym}: restates the band average as "
                                    f"{bavg}x, pack says {avg}")
            if not got:
                errs.append(f"{sym}: band is usable ({lo}-{hi}x, n="
                            f"{band.get('n')}) but no point states it")

        # 10. Every <code> key in prose must exist and be non-NULL in THIS
        #     row's cluster_metrics. Guard 18 is the half this cannot see.
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

        # 11. CHOICE 5. The pack's cash flag is a one-year ratio with a lumpy
        #     denominator, so the claim is made on the count of negative
        #     operating-cash years in the annual rows and the count is
        #     recomputed here — a rerun that changes a year fails the build
        #     rather than leaving the prose stale. One row may not use the word
        #     "deterioration", and CASHYRS stores the reason rather than a
        #     boolean so a second refusal cannot borrow the first one's excuse.
        annual = p.get("annual") or []
        yrs = [r for r in annual if r.get("cash_from_operating") is not None]
        if len(yrs) != 10:
            errs.append(f"{sym}: pack has {len(yrs)} annual cash rows, not 10 "
                        f"— every count in the prose is stated out of ten")
        neg = sum(1 for r in yrs if r["cash_from_operating"] < 0)
        want_neg, want_ratio, refused = CASHYRS[sym]
        if neg != want_neg:
            errs.append(f"{sym}: CASHYRS says {want_neg} negative "
                        f"operating-cash years, the annual rows say {neg}")
        phrase = (NOZERO_PHRASE if not neg
                  else f"negative in {NEGWORD[neg]} year")
        if phrase not in joined:
            errs.append(f"{sym}: no point states the cash count ('{phrase}')")
        eq = p.get("earnings_quality") or {}
        gotr = eq.get("cfo_op_latest")
        if gotr is None or abs(float(gotr) - want_ratio) > 0.0005:
            errs.append(f"{sym}: CASHYRS says cfo_op_latest={want_ratio}, pack "
                        f"says {gotr}")
        cashflags = [f for f in (eq.get("flags") or [])
                     if "cash conversion" in f]
        if sym in CASH_FLAGGED:
            if not cashflags:
                errs.append(f"{sym}: in CASH_FLAGGED but the pack now carries "
                            f"no cash-conversion flag")
            if CASH not in joined:
                errs.append(f"{sym}: flagged on cash but carries no CASH "
                            f"sentence")
        else:
            if cashflags:
                errs.append(f"{sym}: pack carries {len(cashflags)} "
                            f"cash-conversion flag(s) but is not in "
                            f"CASH_FLAGGED")
            if CASH in joined:
                errs.append(f"{sym}: carries the CASH sentence with no flag")
        said = [i + 1 for i, pt in enumerate(pts)
                if re.search(r"deteriorat", pt, re.I)]
        if refused:
            if said:
                errs.append(f"{sym}: point(s) {said} call the cash number a "
                            f"deterioration, refused here as '{refused}'")
            if DETERIORATION in joined:
                errs.append(f"{sym}: carries DETERIORATION, refused here as "
                            f"'{refused}'")
            if ARTEFACT not in joined:
                errs.append(f"{sym}: refused as '{refused}' but carries no "
                            f"sentence saying why")
        else:
            if sym in CASH_FLAGGED and DETERIORATION not in joined:
                errs.append(f"{sym}: flagged, not refused, but carries no "
                            f"DETERIORATION sentence")
            if sym not in CASH_FLAGGED and DETERIORATION in joined:
                errs.append(f"{sym}: carries DETERIORATION with no cash flag "
                            f"to earn it")
            if ARTEFACT in joined:
                errs.append(f"{sym}: carries the artefact refusal but is not "
                            f"refused")

        # 12. CHOICE 11. One row's TTM window is a quarter ahead of the rest of
        #     the batch, so its TTM figures are not comparable across rows.
        win = (p.get("ttm_vs_prior") or {}).get("window")
        if sym == WINDOW_SYM:
            if WINDOW not in p0:
                errs.append(f"{sym}: point one does not carry WINDOW")
            if win != WINDOW_HELD:
                errs.append(f"{sym}: WINDOW says {WINDOW_HELD}, pack says "
                            f"{win}")
        else:
            if WINDOW in joined:
                errs.append(f"{sym}: carries WINDOW but its window is {win}")
            if win is not None and win != WINDOW_BATCH:
                errs.append(f"{sym}: window {win} differs from the batch "
                            f"{WINDOW_BATCH} and no point says so")

        # 13. CHOICE 7. Four rows' TTM growth is computed against the year
        #     before a one-year margin step, so a point quoting a TTM figure on
        #     those rows must carry STEP in the SAME point — a caveat in a
        #     different point is a caveat the reader does not reach.
        if sym in MARGINSTEP:
            prev, now, step = MARGINSTEP[sym]
            tv = p.get("ttm_vs_prior") or {}
            for field, wanted in (("opm_prev", prev), ("opm_now", now)):
                if tv.get(field) != wanted:
                    errs.append(f"{sym}: MARGINSTEP says {field}={wanted}, "
                                f"pack says {tv.get(field)}")
            gotstep = round((eq.get("opm_step") or 0) * 100, 2)
            if abs(gotstep - step) > 0.005:
                errs.append(f"{sym}: MARGINSTEP says a {step} point step, pack "
                            f"says {gotstep}")
            for i, pt in enumerate(pts):
                if any(f"<code>{f}</code>" in pt for f in TTM_FIELDS) \
                        and STEP not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes a TTM growth "
                                f"figure computed on a stepped base without "
                                f"STEP in the same point")
        elif STEP in joined:
            errs.append(f"{sym}: carries STEP but the pack flags no margin "
                        f"step on this row")

        # 14. CHOICE 1. With peg and div_yield banned, the thinnest reading
        #     this batch anchors on is 19, so a denominator under 19 cannot be a
        #     real rank here — it is fabricated, or carried in from the previous
        #     cluster, which is the failure a batch is most likely to import.
        for pt in allprose:
            for d in DENOM_RX.findall(re.sub(r"</?[a-z]+>", "", pt)):
                if int(d) < DENOM_FLOOR:
                    errs.append(f"{sym}: states a denominator of {d}; nothing "
                                f"ranked in this batch is read by fewer than "
                                f"{DENOM_FLOOR} peers")

        # 15. CHOICE 6. The label is the finding, so the headline must carry
        #     it, point one must carry the explanation, and no other row may
        #     use it.
        if NOVERDICT in p0:
            if sym != NOVERDICT_SYM:
                errs.append(f"{sym}: carries NOVERDICT but NOVERDICT_SYM is "
                            f"{NOVERDICT_SYM}")
            if not v["verdict"].startswith("WATCH — no verdict"):
                errs.append(f"{sym}: carries NOVERDICT but the headline does "
                            f"not say so")
        else:
            if sym == NOVERDICT_SYM:
                errs.append(f"{sym}: is NOVERDICT_SYM but point one carries no "
                            f"explanation")
            if "no verdict" in v["verdict"]:
                errs.append(f"{sym}: headline says 'no verdict' but point one "
                            f"carries no explanation")

        # 16. MOM95 exactly once per row.
        if sym in MOM95_SYMS:
            got = sum(MOM95 in pt for pt in pts)
            if got != 1:
                errs.append(f"{sym}: MOM95 appears {got}x in the points, "
                            f"expected exactly 1")

        # 17. CHOICE 10. ema_stack_bull is 1.000 on three rows and 0.000 on
        #     three, tied first in a ten-way tie and tied 11th in a 37-way one.
        #     Either reading spans most of the cohort. Banned, not caveated.
        for pt in allprose:
            if EMAFLAT in pt:
                errs.append(f"{sym}: names {EMAFLAT}, which is tied across at "
                            f"least ten names on either reading")

        # 18. The half guard 10 cannot see. These phrases resolve, in the ranks
        #     checker's own vocabulary, to columns this cluster does not carry —
        #     so a sentence lifted from realty or bfsi reads perfectly and
        #     attributes its rank to nothing.
        scrub = joined + " " + v["trigger"] + " " + v["verdict"]
        for ex in PHRASE_EXEMPT:
            scrub = scrub.replace(ex, " ")
        low = scrub.lower()
        for ph in BANNED_PHRASES:
            if ph in low:
                errs.append(f"{sym}: prose says '{ph}', which names a column "
                            f"media_entertainment does not carry")

        # 19. No figure for a metric that is NULL on this row. HMVL has no
        #     dii_pct at all, and a DII sentence there would be unanchored.
        for key, word in (("promoter_pct", r"promoter"),
                          ("dii_pct", r"domestic institution|\bDII\b")):
            if live.get(key) is None and any(
                    re.search(word, pt) for pt in allprose):
                errs.append(f"{sym}: names {key} in the prose but it is NULL "
                            f"in the pack")

        # 20. CHOICE 1, and the defining constraint of this batch. peg is read
        #     by 9 of the 47 and div_yield by 12. A rank out of 9 is not a rank;
        #     it is a statement about which rows happened to have a denominator.
        #     Both are banned outright — and the ban is verified against the
        #     live reading count, so a future snapshot that fills them in fails
        #     the build and tells me to lift the ban rather than leaving a stale
        #     one in place.
        for k, wantof in THIN.items():
            gotof = (mranks.get(k) or {}).get("of")
            if gotof is not None and gotof != wantof:
                errs.append(f"{sym}: THIN says {k} is read by {wantof} peers, "
                            f"the pack says {gotof} — re-decide the ban")
            if wantof >= THIN_FLOOR:
                errs.append(f"{sym}: THIN bans {k} at {wantof} readings, which "
                            f"is no longer below the {THIN_FLOOR} floor")
        for pt in allprose:
            for k in THIN:
                if f"<code>{k}</code>" in pt:
                    errs.append(f"{sym}: names <code>{k}</code>, read by "
                                f"{THIN[k]} of {n} and banned here")
            if "dividend yield of" in pt or re.search(r"\bPEG\b", pt):
                errs.append(f"{sym}: quotes a thin reading in English")

        # 21. CHOICE 9. A pillar percentile computed on part of its declared
        #     weight may be quoted only alongside what is missing underneath it.
        #     Unlike MOM95 this is NOT uniform, so the renormalisation sits in
        #     the SAME point and the figure is banned from headline and trigger.
        for pillar, phr in PILLAR_WEIGHT.get(sym, []):
            rx = re.compile(rf"\b{pillar}\s+(?:of\s+)?\d+", re.I)
            for i, pt in enumerate(pts):
                m = rx.search(pt)
                if m and phr not in pt:
                    errs.append(f"{sym}: point {i + 1} quotes "
                                f"'{m.group(0)}' without naming the "
                                f"renormalisation ('{phr}')")
            for where, text in (("verdict", v["verdict"]),
                                ("trigger", v["trigger"])):
                m = rx.search(text)
                if m:
                    errs.append(f"{sym}: {where} quotes '{m.group(0)}', a "
                                f"pillar scored on part of its weight, with "
                                f"no room for the caveat")

        # 22. CHOICE 2. pe_ttm is read by 19 of the 47, so a trailing-earnings
        #     rank is a claim about a minority of the bucket. It is allowed, but
        #     only with PETHIN in the SAME point.
        peof = (mranks.get("pe_ttm") or {}).get("of")
        if peof is not None and peof != 19:
            errs.append(f"{sym}: pe_ttm is read by {peof} peers, PETHIN says "
                        f"19 — rewrite the caveat")
        for i, pt in enumerate(pts):
            if "<code>pe_ttm</code>" in pt and PETHIN not in pt:
                errs.append(f"{sym}: point {i + 1} ranks pe_ttm without PETHIN "
                            f"in the same point")
        if PETHIN in joined and "<code>pe_ttm</code>" not in joined:
            errs.append(f"{sym}: carries PETHIN but ranks no trailing-earnings "
                        f"multiple")

        # 23. CHOICE 4, the spine, and no metric in the pack says it. The count
        #     of years where net profit exceeded operating profit is recomputed
        #     from the annual rows, so the claim cannot go stale.
        bl = sum(1 for r in annual
                 if r.get("net_profit") is not None
                 and r.get("operating_profit") is not None
                 and r["net_profit"] > r["operating_profit"])
        if sym in BELOWLINE:
            if bl != BELOWLINE[sym]:
                errs.append(f"{sym}: BELOWLINE says {BELOWLINE[sym]} years "
                            f"with net profit above operating profit, the "
                            f"annual rows say {bl}")
            if BELOW not in joined:
                errs.append(f"{sym}: is a below-the-line row and carries no "
                            f"BELOW sentence")
            cnt = f"in {NEGWORD[bl]} separate years"
            if cnt not in joined:
                errs.append(f"{sym}: no point states the below-the-line count "
                            f"('{cnt}')")
        else:
            if BELOW in joined:
                errs.append(f"{sym}: carries BELOW but net profit exceeded "
                            f"operating profit in {bl} years, not enough to "
                            f"be the row's spine")

        # 24. CHOICE 8. One row's five-year growth window starts in the shut
        #     year, so the compound rate is arithmetic and COVID says so
        #     wherever the figure appears. The shut year is recomputed as the
        #     minimum sales row rather than asserted.
        sales = [r["sales"] for r in annual if r.get("sales") is not None]
        if sym == COVID_SYM:
            if sales and f"₹{min(sales):,.2f}cr" not in COVID:
                errs.append(f"{sym}: COVID quotes a trough that is not the "
                            f"minimum sales row ({min(sales)})")
            for i, pt in enumerate(pts):
                if "<code>rev_cagr_5y</code>" in pt and COVID not in pt:
                    errs.append(f"{sym}: point {i + 1} ranks rev_cagr_5y "
                                f"without COVID in the same point")
        elif COVID in joined:
            errs.append(f"{sym}: carries COVID, which belongs to {COVID_SYM}")

        # 27. CHOICE 5, the refusal. HMVL's flag is refused because one year in
        #     its window divides ₹203.38cr of operating cash by ₹7.12cr of
        #     operating profit. That has to be the LARGEST such ratio in the row
        #     or the refusal is about the wrong year.
        if refused == "artefact":
            ratios = [(r["cash_from_operating"] / r["operating_profit"], r)
                      for r in annual
                      if r.get("operating_profit")
                      and r.get("cash_from_operating") is not None]
            if not ratios:
                errs.append(f"{sym}: refused as an artefact but no annual row "
                            f"can form the ratio")
            else:
                top, row = max(ratios, key=lambda t: t[0])
                if f"{top:.1f}" not in ARTEFACT:
                    errs.append(f"{sym}: ARTEFACT states a ratio the annual "
                                f"rows do not produce; the largest is "
                                f"{top:.1f}")
                for fig in (row["cash_from_operating"],
                            row["operating_profit"]):
                    if f"₹{fig:,.2f}cr" not in ARTEFACT:
                        errs.append(f"{sym}: ARTEFACT does not name ₹{fig}cr, "
                                    f"a term of the ratio it refuses")
                pm = eq.get("cfo_op_prior_mean")
                if pm is None or f"{pm}" not in ARTEFACT:
                    errs.append(f"{sym}: ARTEFACT states a prior mean the pack "
                                f"does not carry ({pm})")

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
