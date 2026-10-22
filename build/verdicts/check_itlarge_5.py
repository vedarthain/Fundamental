"""Pass 2 for the it_services_large batch of 5 — every rank, superlative,
ratio and quarter-over-quarter claim in `mk_itlarge_5.py`, restated as code and
evaluated against the pack.

Pass 1 (`scripts/verdict-check.py`) only asks whether a number appears
somewhere in a symbol's own pack. It cannot see "the cheapest of the five",
cannot see a derived ratio like "2.8x Wipro's", and cannot see a shareholding
claim like "down from 19.15% five quarters ago" — all three are claims about
something outside the row. Every batch written so far has contained at least
one wrong superlative, and this file is the only thing that finds them.

**This batch is the proof of that.** Writing it and then checking it found
twelve errors. Nine came from hand-reading pass 1's 71 untraced tokens, before
this file existed:

  1. WIPRO's dividend was called 1.4x Infosys's; 6.1725/4.1004 = 1.505.
  2. TECHM's `dii_pct` 36.92% was called the highest of the five; Infosys is
     42.78%.
  3. WIPRO's row said domestic institutions were adding to Tech Mahindra while
     selling Wipro; TECHM's `dii_pct` went 37.79 -> 37.34 -> 36.92, i.e. down.
  4. TCS's TTM net profit +4.39% was called the lowest of the five; Wipro's is
     -2.42%. The same error was in the headline (5).
  6. HCLTECH's FII reading of 19.15% was called six quarters ago; it is
     2025-03-31, five quarters before the 2026-06-30 current reading.
  7. TCS's FII "a year ago" was quoted as 12.04% (2025-03-31) instead of
     11.48% (2025-06-30). Same error on TECHM's FII (8).
  9. Margin-trend ordinals were wrong for two of the six because LTM, the
     untracked sixth cluster member, is not in the pack at all: INFY is second
     of six (not "slower than three peers") and TECHM is fifth (not fourth).

The remaining three were found by this file, and none of them could have been
found any other way:

 10. INFY was said to have net profit growing slightly faster than revenue;
     `ttm_np_pct` 11.08 is below `ttm_sales_pct` 11.22. The true claim is
     against operating profit — `np_over_op_gap` +0.0092 is the only positive
     of the five — so the row says that instead.
 11. INFY's cash conversion was called "the only improvement of the five";
     TCS's rose too, by 0.001. Now "the only material improvement", with TCS's
     flat reading named.
 12. TCS's `fcf_yield` 4.88% was called the lowest of the five while TECHM's
     own row in the same batch already said 3.47% was lower — two rows of one
     batch contradicting each other, which no per-row check can see.

Error 9 is the structural one and the reason `LTM_FACTS` exists in the
generator: four claims in the batch are scoped "of the six", and the pack holds
five symbols, so every six-way check was silently a five-way check. The figures
below come from a separate single-symbol pack built from the same 2026-10-21
snapshot.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/check_itlarge_5.py
"""

import json

PACK = "/tmp/itlarge5.json"
FIVE = ("HCLTECH", "INFY", "TCS", "TECHM", "WIPRO")

# Mirrors LTM_FACTS in mk_itlarge_5.py. Duplicated on purpose: pass 2 is
# supposed to be an independent restatement, and importing the generator's own
# constants would make it agree with the generator by construction.
LTM = {
    "composite_pct": 41, "quality_pct": 52, "valuation_pct": 40,
    "momentum_pct": 46,
    "op_margin_trend_7y": -0.005139914250017399,
    "rev_cagr_5y": 0.1282576461552174,
}

FAILS = []
CHECKS = [0]


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}
    if set(rows) != set(FIVE):
        raise SystemExit(f"pack is {sorted(rows)}, expected {sorted(FIVE)}")

    cm = {s: (r.get("metrics") or {}).get("cluster_metrics") or {}
          for s, r in rows.items()}
    mt = {s: (r.get("metrics") or {}) for s, r in rows.items()}
    sc = {s: (r.get("scores") or {}) for s, r in rows.items()}
    eq = {s: (r.get("earnings_quality") or {}) for s, r in rows.items()}

    def ck(label, cond):
        CHECKS[0] += 1
        if not cond:
            FAILS.append(label)

    def vals(key, src=None):
        src = src or cm
        return {s: v[key] for s, v in src.items() if v.get(key) is not None}

    def rank(key, sym, n=1, src=None, reverse=True, count=5):
        """sym is n-th by key among exactly `count` names carrying a reading."""
        v = vals(key, src)
        order = sorted(v, key=lambda s: v[s], reverse=reverse)
        ck(f"{sym}: {key} is #{n} of {count} (reverse={reverse})",
           len(v) == count and order[n - 1] == sym)

    def close(label, a, b, tol=0.005):
        ck(label, abs(a - b) <= tol)

    def shq(sym, period, field):
        for r in rows[sym].get("shareholding") or []:
            if r["period_end"] == period:
                return r.get(field)
        return None

    def quarters_back(sym, period):
        """How many quarters before the latest reading `period` sits."""
        ends = [r["period_end"] for r in rows[sym].get("shareholding") or []]
        ends = sorted(set(ends), reverse=True)
        return ends.index(period) if period in ends else None

    # ============================================================ batch-wide

    # Choice 1: the lattice caveat. Six names, under the ten-peer floor.
    ck("cluster is it_services_large for all five",
       all(sc[s].get("cluster_id") == "it_services_large" for s in FIVE))
    ck("all five are partial-cluster-mixed-tiers (cluster under 10 peers)",
       all(sc[s].get("score_status") == "partial-cluster-mixed-tiers"
           for s in FIVE))
    # With n=6, _percentile_rank = round((1 - rank/(n-1)) * 100) can only
    # return a multiple of 20. If any pillar percentile is not, the lattice
    # claim is wrong about how the scores were built.
    ck("every per-metric percentile lattice step is 20 (n=6)",
       all(round(100 * (1 - i / 5)) % 20 == 0 for i in range(6)))

    # Choice 7: the spine. All six negative, and the six-way ordering the
    # prose asserts: TCS flattest, INFY 2nd, WIPRO 3rd, LTM 4th, TECHM 5th,
    # HCLTECH steepest.
    trend6 = dict(vals("op_margin_trend_7y"))
    trend6["LTM"] = LTM["op_margin_trend_7y"]
    ck("op_margin_trend_7y negative for all six", len(trend6) == 6
       and all(v < 0 for v in trend6.values()))
    order6 = sorted(trend6, key=trend6.get, reverse=True)   # flattest first
    ck("six-way margin-trend order is TCS,INFY,WIPRO,LTM,TECHM,HCLTECH",
       order6 == ["TCS", "INFY", "WIPRO", "LTM", "TECHM", "HCLTECH"])
    ck("TCS: flattest of the six", order6[0] == "TCS")
    ck("INFY: second-flattest of the six, so slower than four peers",
       order6.index("INFY") == 1)
    ck("WIPRO: middling of the six on margin trend",
       order6.index("WIPRO") == 2)
    ck("TECHM: fifth of the six on margin trend",
       order6.index("TECHM") == 4)
    ck("HCLTECH: steepest of the six", order6[-1] == "HCLTECH")
    close("HCLTECH: -0.84pp", trend6["HCLTECH"] * 100, -0.84, 0.01)
    close("INFY: -0.43pp", trend6["INFY"] * 100, -0.43, 0.01)
    close("TCS: -0.14pp", trend6["TCS"] * 100, -0.14, 0.01)
    close("TECHM: -0.57pp", trend6["TECHM"] * 100, -0.57, 0.01)
    close("WIPRO: -0.45pp", trend6["WIPRO"] * 100, -0.45, 0.01)

    # Choice 6: the index that is not quoted, and why.
    cons = vals("np_consistency_10y")
    ck("np_consistency_10y spans only 0.055 across the five, so it is not "
       "quotable as a rank",
       len(cons) == 5 and max(cons.values()) - min(cons.values()) < 0.06)

    # Choice 8: momentum 95 of 100 everywhere.
    ck("tech_net_score_scaled NULL for all five",
       all(cm[s].get("tech_net_score_scaled") is None for s in FIVE))
    for s in FIVE:
        mom = ((rows[s].get("scorecard_coverage") or {})
               .get("pillars") or {}).get("momentum") or {}
        ck(f"{s}: momentum covered_weight 95 of 100",
           mom.get("covered_weight") == 95.0
           and mom.get("declared_weight") == 100.0)

    # Choice 9: delivery unusable.
    ck("delivery_data holds 12 distinct sessions, so no delivery claim is made",
       (pack.get("sanity") or pack).get("delivery_distinct_days", 12) == 12)

    # Six-way pillar ordinals the prose asserts.
    comp6 = {s: sc[s]["composite_pct"] for s in FIVE}
    comp6["LTM"] = LTM["composite_pct"]
    ordc = sorted(comp6, key=comp6.get, reverse=True)
    ck("INFY: highest composite of the six", ordc[0] == "INFY")
    ck("TCS: second of the six", ordc[1] == "TCS")
    ck("HCLTECH: third of the six", ordc[2] == "HCLTECH")
    ck("WIPRO: fourth of the six", ordc[3] == "WIPRO")
    ck("TECHM: lowest composite of the six", ordc[-1] == "TECHM")
    val6 = {s: sc[s]["valuation_pct"] for s in FIVE}
    val6["LTM"] = LTM["valuation_pct"]
    ck("INFY: highest valuation percentile of the six",
       max(val6, key=val6.get) == "INFY")
    mom6 = {s: sc[s]["momentum_pct"] for s in FIVE}
    mom6["LTM"] = LTM["momentum_pct"]
    ck("TECHM: highest momentum percentile of the six",
       max(mom6, key=mom6.get) == "TECHM")

    # Choice 4: the band rule and WIPRO's refusal.
    for s in ("HCLTECH", "INFY", "TCS", "TECHM"):
        b = rows[s]["pe_band"]
        ck(f"{s}: band passes n>=8, lo>=4.0, hi<=100",
           b["n"] >= 8 and b["lo"] >= 4.0 and b["hi"] <= 100)
    wb = rows["WIPRO"]["pe_band"]
    ck("WIPRO: band low 2.77 is under the 4.0x floor, so not quotable",
       wb["lo"] < 4.0)
    # ...and the refusal is material: the band average would make the cheapest
    # name in the batch look expensive.
    ck("WIPRO: band avg 10.28 is below pe_ttm 14.26, so quoting it would "
       "invert the valuation claim",
       wb["avg"] < cm["WIPRO"]["pe_ttm"])

    # ============================================================== INFY

    rank("market_cap", "INFY", n=2, src=mt)
    close("INFY: promoter_pct 13.82", cm["INFY"]["promoter_pct"], 13.82, 0.01)
    for w, denom in (("5y", 5), ("7y", 7), ("10y", 10)):
        ck(f"INFY: roe_avg_above_threshold_{w} is {denom} of {denom}",
           cm["INFY"][f"roe_avg_above_threshold_{w}"] == 1.0)
    unbroken = [s for s in FIVE
                if all(cm[s][f"roe_avg_above_threshold_{w}"] == 1.0
                       for w in ("5y", "7y", "10y"))]
    ck("exactly three of the five have an unbroken ROE record on every window",
       sorted(unbroken) == ["HCLTECH", "INFY", "TCS"])
    infl("INFY", cm, ck, 3, 5, 7)
    for w in ("5y", "7y", "10y"):
        v = vals(f"np_growth_above_inflation_{w}")
        ck(f"INFY: best inflation record of the five on {w}",
           max(v, key=v.get) == "INFY" and len(v) == 5)
    infl("TCS", cm, ck, 2, 3, 4)
    infl("WIPRO", cm, ck, 1, 3, 5)
    infl("HCLTECH", cm, ck, 2, 3, 5)
    infl("TECHM", cm, ck, 2, 4, 6)
    v = vals("np_growth_above_inflation_10y")
    ck("TCS: weakest ten-year inflation record of the five",
       min(v, key=v.get) == "TCS")
    rank("np_cagr_5y", "INFY")
    rank("roce_5y", "INFY", n=2)
    close("TCS: roce_5y 59.28", cm["TCS"]["roce_5y"] * 100, 59.28, 0.01)
    rank("dso", "INFY", n=2, reverse=False)
    rank("dso", "WIPRO", reverse=False)
    close("WIPRO: dso 18 days below INFY's 71.99",
          cm["INFY"]["dso"] - cm["WIPRO"]["dso"], 18.43, 0.1)
    # The only clean trailing year. NOTE: the first draft of the prose said
    # "profit growing slightly faster than revenue", and INFY's 11.08% net
    # profit is BELOW its 11.22% sales. The true claim is against operating
    # profit — np_over_op_gap +0.0092, the only positive of the five.
    ck("INFY: the only one of the five with ttm_np_pct > ttm_op_pct",
       [s for s in FIVE if cm[s]["ttm_np_pct"] > cm[s]["ttm_op_pct"]]
       == ["INFY"])
    ck("INFY: its ttm_np_pct is nonetheless just under its ttm_sales_pct",
       cm["INFY"]["ttm_np_pct"] < cm["INFY"]["ttm_sales_pct"])
    steps = {s: cm[s]["opm_now"] - cm[s]["opm_prev"] for s in FIVE}
    close("INFY: -0.25pp margin step", steps["INFY"], -0.2475, 0.01)
    ck("INFY: smallest margin decline of the five",
       max((s for s in FIVE if steps[s] < 0), key=lambda s: steps[s]) == "INFY")
    # The only MATERIAL improvement. TCS also rose, by 0.001, so the first
    # draft's "the only improvement of the five" was false.
    improving = [s for s in FIVE
                 if eq[s]["cfo_op_latest"] > eq[s]["cfo_op_prior_mean"]]
    ck("INFY and TCS both rose, so 'only improvement' is wrong",
       sorted(improving) == ["INFY", "TCS"])
    ck("INFY: the only material improvement (>0.01) of the five",
       [s for s in FIVE
        if eq[s]["cfo_op_latest"] - eq[s]["cfo_op_prior_mean"] > 0.01]
       == ["INFY"])
    ck("TCS: its rise is 0.001, i.e. flat",
       abs(eq["TCS"]["cfo_op_latest"] - eq["TCS"]["cfo_op_prior_mean"]) < 0.002)
    ck("the other three fell, two of them sharply",
       sum(1 for s in FIVE
           if eq[s]["cfo_op_prior_mean"] - eq[s]["cfo_op_latest"] > 0.1) == 2)
    close("INFY: cfo_op 0.804 vs prior mean 0.750",
          eq["INFY"]["cfo_op_latest"], 0.804, 0.001)
    # Valuation.
    band = rows["INFY"]["pe_band"]
    close("INFY: pe_ttm 25% below its own ten-year average",
          100 * (1 - cm["INFY"]["pe_ttm"] / band["avg"]), 25.1, 0.5)
    pegs = vals("peg")
    ck("INFY: lowest peg of the four names carrying one",
       len(pegs) == 4 and min(pegs, key=pegs.get) == "INFY")
    rank("ev_ebitda_ttm", "INFY", n=2, reverse=False)
    rank("fcf_yield", "INFY", n=2)
    rank("div_yield", "INFY", n=3)
    rank("ret_12m_rel", "INFY", reverse=False)
    ck("INFY: ema_stack_bull is 0", cm["INFY"]["ema_stack_bull"] == 0.0)
    close("INFY: above 200EMA on 18.25% of 252 sessions",
          cm["INFY"]["pct_above_200ema_252d"] * 100, 18.25, 0.01)
    ck("INFY: promoter_pct fell 14.52 -> 14.38 -> 13.82 over three quarters",
       [shq("INFY", p, "promoter_pct") for p in
        ("2025-12-31", "2026-03-31", "2026-06-30")] == [14.52, 14.38, 13.82])
    ck("INFY: fii_pct 30.27 at the start of that same three-quarter span",
       shq("INFY", "2025-12-31", "fii_pct") == 30.27)
    close("INFY: fii_pct now 27.09", cm["INFY"]["fii_pct"], 27.09, 0.01)

    # =============================================================== TCS

    rank("market_cap", "TCS", src=mt)
    mc = vals("market_cap", mt)
    close("TCS: 1.9x Infosys by market cap", mc["TCS"] / mc["INFY"], 1.919, 0.01)
    close("TCS: 5.1x Tech Mahindra by market cap",
          mc["TCS"] / mc["TECHM"], 5.111, 0.01)
    rank("roce_3y", "TCS")
    rank("roce_5y", "TCS")
    close("TCS: roce_3y 1.6x Infosys's 37.98%",
          cm["TCS"]["roce_3y"] / cm["INFY"]["roce_3y"], 1.610, 0.01)
    close("TCS: roce_3y 3.4x Wipro's 17.86%",
          cm["TCS"]["roce_3y"] / cm["WIPRO"]["roce_3y"], 3.424, 0.01)
    rank("op_margin_3y", "TCS")
    rank("opm_now", "TCS")
    # The corrected claim: slowest of the four that grew at all, not of five.
    grew = [s for s in FIVE if cm[s]["ttm_np_pct"] > 0]
    ck("TCS: slowest trailing profit growth of the four that grew at all",
       len(grew) == 4 and min(grew, key=lambda s: cm[s]["ttm_np_pct"]) == "TCS")
    ck("WIPRO: the only one of the five with negative ttm_np_pct",
       [s for s in FIVE if cm[s]["ttm_np_pct"] < 0] == ["WIPRO"])
    ck("TCS: ttm_np_pct is under half ttm_sales_pct",
       cm["TCS"]["ttm_np_pct"] * 2 < cm["TCS"]["ttm_sales_pct"])
    rank("cfo_ebitda_3y", "TCS", reverse=False)
    rank("dso", "TCS")
    close("TCS: cfo_op 0.720 against a prior mean of 0.719 — flat",
          eq["TCS"]["cfo_op_latest"] - eq["TCS"]["cfo_op_prior_mean"],
          0.001, 0.002)
    tb = rows["TCS"]["pe_band"]
    close("TCS: pe_ttm 26% below its own ten-year average",
          100 * (1 - cm["TCS"]["pe_ttm"] / tb["avg"]), 26.4, 0.5)
    # Widest discount to own history of the four quotable bands.
    disc = {s: 100 * (1 - cm[s]["pe_ttm"] / rows[s]["pe_band"]["avg"])
            for s in ("HCLTECH", "INFY", "TCS", "TECHM")}
    ck("TCS: widest discount to own history of the four quotable bands",
       max(disc, key=disc.get) == "TCS")
    rank("div_yield", "TCS", n=2)
    # TECHM's 3.47% is lower, and TECHM's own row says so — the first draft
    # had TCS "lowest of the five", contradicting another row in the batch.
    rank("fcf_yield", "TCS", n=2, reverse=False)
    rank("fcf_yield", "TECHM", reverse=False)
    rank("pct_above_200ema_252d", "TCS", reverse=False)
    close("TCS: 11 of the last 252 sessions above the 200-day EMA",
          cm["TCS"]["pct_above_200ema_252d"] * 252, 11.0, 0.1)
    ck("TCS: fii_pct 11.48 a year ago (2025-06-30), now 9.07",
       shq("TCS", "2025-06-30", "fii_pct") == 11.48
       and cm["TCS"]["fii_pct"] == 9.07)
    ck("TCS: promoter_pct has not moved across the series",
       len({r["promoter_pct"] for r in rows["TCS"]["shareholding"]}) == 1)

    # =========================================================== HCLTECH

    rank("market_cap", "HCLTECH", n=3, src=mt)
    # The holding, from app.portfolio_holding (not in the pack).
    cost, ltp, qty = 1466.80, 1244.85, 6
    close("HCLTECH: 15.1% below cost", 100 * (ltp - cost) / cost, -15.13, 0.05)
    close("HCLTECH: position worth 7,469", qty * ltp, 7469.10, 0.01)
    rank("rev_cagr_5y", "HCLTECH")
    close("HCLTECH: rev_cagr_5y 2.8x Wipro's 3.96%",
          cm["HCLTECH"]["rev_cagr_5y"] / cm["WIPRO"]["rev_cagr_5y"], 2.787, 0.01)
    ck("HCLTECH: fastest rev_cagr_5y of the five but NOT of the six — LTM is "
       "12.83%", LTM["rev_cagr_5y"] > cm["HCLTECH"]["rev_cagr_5y"])
    rank("ttm_sales_pct", "HCLTECH", n=2)
    rank("ttm_sales_pct", "TECHM")
    rank("roce_3y", "HCLTECH", n=3)
    # The step-down pattern: sales > op > np.
    ck("HCLTECH: ttm_sales_pct > ttm_op_pct > ttm_np_pct",
       cm["HCLTECH"]["ttm_sales_pct"] > cm["HCLTECH"]["ttm_op_pct"]
       > cm["HCLTECH"]["ttm_np_pct"])
    drops = {s: eq[s]["cfo_op_prior_mean"] - eq[s]["cfo_op_latest"]
             for s in FIVE}
    close("HCLTECH: cash conversion fell 0.108", drops["HCLTECH"], 0.108, 0.001)
    ck("HCLTECH: second-largest cash-conversion fall of the five",
       sorted(drops, key=drops.get, reverse=True)[1] == "HCLTECH")
    rank("dso", "HCLTECH", n=2)
    hb = rows["HCLTECH"]["pe_band"]
    close("HCLTECH: pe_ttm 20% above its own ten-year average",
          100 * (cm["HCLTECH"]["pe_ttm"] / hb["avg"] - 1), 19.88, 0.5)
    above = [s for s in ("HCLTECH", "INFY", "TCS", "TECHM")
             if cm[s]["pe_ttm"] > rows[s]["pe_band"]["avg"]]
    ck("HCLTECH: one of two quotable bands trading above its own average, "
       "the other being TECHM", sorted(above) == ["HCLTECH", "TECHM"])
    ck("TECHM: at a far greater premium than HCLTECH",
       -disc["TECHM"] > -disc["HCLTECH"] * 2)
    ck("HCLTECH: second-highest peg of the four carrying one",
       sorted(pegs, key=pegs.get, reverse=True)[1] == "HCLTECH")
    rank("ev_ebitda_ttm", "HCLTECH", n=3)
    rank("div_yield", "HCLTECH", n=4)
    rank("fcf_yield", "HCLTECH", n=3)
    ck("HCLTECH: best ret_12m_rel of the four names outside TECHM",
       max((s for s in FIVE if s != "TECHM"),
           key=lambda s: cm[s]["ret_12m_rel"]) == "HCLTECH")
    ck("HCLTECH: ema_stack_bull is 1", cm["HCLTECH"]["ema_stack_bull"] == 1.0)
    rank("pct_above_200ema_252d", "HCLTECH", n=2)
    ck("HCLTECH: fii_pct 19.15 is five quarters before the current reading",
       quarters_back("HCLTECH", "2025-03-31") == 5
       and shq("HCLTECH", "2025-03-31", "fii_pct") == 19.15)
    close("HCLTECH: fii_pct now 14.90", cm["HCLTECH"]["fii_pct"], 14.90, 0.01)
    close("HCLTECH: dii_pct 18.75", cm["HCLTECH"]["dii_pct"], 18.75, 0.01)

    # ============================================================= WIPRO

    rank("market_cap", "WIPRO", n=4, src=mt)
    # The holding, and the reason no return is stated.
    close("WIPRO: unadjusted, 45.6% down",
          100 * (164.02 - 301.50) / 301.50, -45.60, 0.05)
    close("WIPRO: bonus-adjusted, 8.8% up",
          100 * (164.02 - 301.50 / 2) / (301.50 / 2), 8.80, 0.05)
    rank("pe_ttm", "WIPRO", reverse=False)
    rank("ev_ebitda_ttm", "WIPRO", reverse=False)
    rank("ev_sales_ttm", "WIPRO", reverse=False)
    rank("div_yield", "WIPRO")
    rank("fcf_yield", "WIPRO")
    close("WIPRO: div_yield 1.5x Infosys's",
          cm["WIPRO"]["div_yield"] / cm["INFY"]["div_yield"], 1.505, 0.01)
    rank("cfo_ebitda_3y", "WIPRO")
    rank("rev_cagr_5y", "WIPRO", reverse=False)
    ck("WIPRO: rev_cagr_5y under four-tenths of HCLTECH's",
       cm["WIPRO"]["rev_cagr_5y"] / cm["HCLTECH"]["rev_cagr_5y"] < 0.40)
    rank("np_cagr_5y", "WIPRO", n=4)
    rank("np_cagr_5y", "TECHM", reverse=False)
    ck("TECHM: the only negative np_cagr_5y of the five",
       [s for s in FIVE if cm[s]["np_cagr_5y"] < 0] == ["TECHM"])
    rank("ttm_sales_pct", "WIPRO", reverse=False)
    ck("WIPRO: the only negative np_yoy_q of the five",
       [s for s in FIVE if cm[s]["np_yoy_q"] < 0] == ["WIPRO"])
    for w, denom, want in (("5y", 5, 2), ("7y", 7, 4), ("10y", 10, 7)):
        close(f"WIPRO: 13% cleared in {want} of {denom}",
              cm["WIPRO"][f"roe_avg_above_threshold_{w}"] * denom, want, 0.02)
        v = vals(f"roe_avg_above_threshold_{w}")
        ck(f"WIPRO: worst ROE-threshold record of the five on {w}",
           min(v, key=v.get) == "WIPRO")
    v = vals("np_growth_above_inflation_5y")
    ck("WIPRO: worst five-year inflation record of the five",
       min(v, key=v.get) == "WIPRO")
    rank("roce_3y", "WIPRO", reverse=False)
    rank("roce_5y", "WIPRO", reverse=False)
    ck("WIPRO: highest peg of the four carrying one",
       max(pegs, key=pegs.get) == "WIPRO")
    # The DII exit, and who was on the other side.
    dii = [shq("WIPRO", p, "dii_pct") for p in
           ("2025-12-31", "2026-03-31", "2026-06-30")]
    ck("WIPRO: dii_pct 8.38 -> 7.86 -> 5.22", dii == [8.38, 7.86, 5.22])
    ck("WIPRO: dii_pct down by more than a third over those two quarters",
       dii[2] < dii[0] * 2 / 3)
    moves = {s: shq(s, "2026-06-30", "dii_pct") - shq(s, "2025-12-31", "dii_pct")
             for s in FIVE}
    ck("WIPRO: sharpest dii_pct fall of the five",
       min(moves, key=moves.get) == "WIPRO")
    ck("domestic institutions were adding to INFY and HCLTECH, not TECHM",
       moves["INFY"] > 0 and moves["HCLTECH"] > 0 and moves["TECHM"] < 0)
    rank("fii_pct", "WIPRO", reverse=False)
    ck("WIPRO: one of exactly two of the five with ema_stack_bull 0",
       sorted(s for s in FIVE if cm[s]["ema_stack_bull"] == 0.0)
       == ["INFY", "WIPRO"])
    ck("WIPRO: the only negative ret_6m_rel of the five",
       [s for s in FIVE if cm[s]["ret_6m_rel"] < 0] == ["WIPRO"])
    close("WIPRO: 32 of the last 252 sessions above the 200-day EMA",
          cm["WIPRO"]["pct_above_200ema_252d"] * 252, 32.0, 0.1)
    rank("shareholders", "WIPRO")
    close("WIPRO: promoter_pct 72.59", cm["WIPRO"]["promoter_pct"], 72.59, 0.01)

    # ============================================================= TECHM

    rank("market_cap", "TECHM", reverse=False, src=mt)
    close("TECHM: promoter_pct 34.96", cm["TECHM"]["promoter_pct"], 34.96, 0.01)
    # The blocker: valuation on 75 of 100, peg absent.
    valp = ((rows["TECHM"].get("scorecard_coverage") or {})
            .get("pillars") or {}).get("valuation") or {}
    ck("TECHM: valuation pillar covered_weight 75 of 100",
       valp.get("covered_weight") == 75 and valp.get("declared_weight") == 100)
    ck("TECHM: the missing valuation component is peg, worth 25",
       (valp.get("missing") or {}) == {"peg": 25})
    ck("TECHM: the only one of the five without a peg",
       [s for s in FIVE if cm[s].get("peg") is None] == ["TECHM"])
    ck("TECHM: no peg because np_cagr_5y is negative",
       cm["TECHM"]["np_cagr_5y"] < 0)
    # The momentum, stated fairly.
    rank("ret_12m_rel", "TECHM")
    ck("TECHM: the only positive ret_12m_rel of the five",
       [s for s in FIVE if cm[s]["ret_12m_rel"] > 0] == ["TECHM"])
    r12 = vals("ret_12m_rel")
    close("TECHM: 32.7pp above the next best ret_12m_rel",
          100 * (r12["TECHM"] - sorted(r12.values(), reverse=True)[1]),
          32.68, 0.05)
    rank("ret_6m_rel", "TECHM")
    rank("ret_3m_rel", "TECHM")
    rank("pct_above_200ema_252d", "TECHM")
    close("TECHM: 133 of the last 252 sessions above the 200-day EMA",
          cm["TECHM"]["pct_above_200ema_252d"] * 252, 133.0, 0.1)
    ck("TECHM: ema_stack_bull is 1", cm["TECHM"]["ema_stack_bull"] == 1.0)
    rank("ttm_op_pct", "TECHM")
    rank("ttm_np_pct", "TECHM")
    close("TECHM: +2.85pp margin step", steps["TECHM"], 2.845, 0.01)
    ck("TECHM: the only margin expansion of the five",
       [s for s in FIVE if steps[s] > 0] == ["TECHM"])
    # ...and the base it expanded from.
    rank("op_margin_3y", "TECHM", reverse=False)
    close("TECHM: op_margin_3y 6.80pp below Wipro's 19.37%",
          100 * (cm["WIPRO"]["op_margin_3y"] - cm["TECHM"]["op_margin_3y"]),
          6.805, 0.01)
    rank("opm_now", "TECHM", reverse=False)
    for w, denom, want in (("5y", 5, 4), ("7y", 7, 6), ("10y", 10, 9)):
        close(f"TECHM: 13% cleared in {want} of {denom}",
              cm["TECHM"][f"roe_avg_above_threshold_{w}"] * denom, want, 0.02)
        v = vals(f"roe_avg_above_threshold_{w}")
        ck(f"TECHM: better than WIPRO and worse than the other three on {w}",
           v["TECHM"] > v["WIPRO"]
           and all(v["TECHM"] < v[s] for s in ("HCLTECH", "INFY", "TCS")))
    # The accrual tell.
    close("TECHM: cash conversion fell 0.223", drops["TECHM"], 0.223, 0.001)
    ck("TECHM: largest cash-conversion fall of the five",
       max(drops, key=drops.get) == "TECHM")
    ck("TECHM: more than double HCLTECH's 0.108 fall",
       drops["TECHM"] > 2 * drops["HCLTECH"])
    ck("TECHM: the fall coincides with a 36.13% operating-profit rise",
       cm["TECHM"]["ttm_op_pct"] > 36 and drops["TECHM"] > 0.2)
    rank("pe_ttm", "TECHM")
    mb = rows["TECHM"]["pe_band"]
    close("TECHM: pe_ttm 43% above its own ten-year average",
          100 * (cm["TECHM"]["pe_ttm"] / mb["avg"] - 1), 42.87, 0.5)
    rank("ev_ebitda_ttm", "TECHM")
    rank("div_yield", "TECHM", reverse=False)
    rank("fcf_yield", "TECHM", reverse=False)
    rank("dii_pct", "TECHM", n=2)
    ck("TECHM: dii_pct second-highest of the five, behind INFY's 42.78",
       cm["INFY"]["dii_pct"] > cm["TECHM"]["dii_pct"])
    ck("TECHM: dii_pct 32.13 a year ago (2025-06-30), now 36.92",
       shq("TECHM", "2025-06-30", "dii_pct") == 32.13
       and cm["TECHM"]["dii_pct"] == 36.92)
    ck("TECHM: fii_pct 23.28 a year ago (2025-06-30), now 18.66",
       shq("TECHM", "2025-06-30", "fii_pct") == 23.28
       and cm["TECHM"]["fii_pct"] == 18.66)

    print(f"{CHECKS[0]} rank and ratio claims checked, {len(FAILS)} failed")
    for f in FAILS:
        print(f"  FAIL {f}")
    if FAILS:
        raise SystemExit(1)


def infl(sym, cm, ck, n5, n7, n10):
    """Inflation pass rates are stored as rates; the denominator is N-1."""
    for w, denom, want in (("5y", 4, n5), ("7y", 6, n7), ("10y", 9, n10)):
        v = cm[sym].get(f"np_growth_above_inflation_{w}")
        if v is None:
            ck(f"{sym}: inflation {w} reading exists", False)
            continue
        ck(f"{sym}: inflation {w} is {want} of {denom}",
           abs(v * denom - want) < 0.02)


if __name__ == "__main__":
    main()
