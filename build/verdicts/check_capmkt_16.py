"""Pass 2 for the capital_markets batch of 16 — every rank and superlative
claim in `mk_capmkt_16.py`, restated as code and evaluated against the pack.

Pass 1 (`scripts/verdict-check.py`) only asks whether a number appears
somewhere in a symbol's own pack. It cannot see a claim like "the cheapest of
the 16", because the claim is about a peer set and the peer set is different in
every batch. Every batch written so far has contained at least one wrong
superlative, and this file is the only thing that finds them.

Scope note that matters for this batch specifically: the peer set here is the
16 names, **not** the 182-name `bfsi_nbfc` cluster the percentiles were
computed against. The prose says so in point one of every row; this file
enforces the other half, which is that no superlative is quoted against the
cluster.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/check_capmkt_16.py
"""

import json

PACK = "/tmp/capmkt17.json"
DEAD = {"ASHIKA"}

FAILS = []
CHECKS = [0]


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}
    for d in DEAD:
        rows.pop(d, None)
    if len(rows) != 16:
        raise SystemExit(f"{len(rows)} symbols, expected 16")

    cm = {s: (r.get("metrics") or {}).get("cluster_metrics") or {}
          for s, r in rows.items()}
    mt = {s: (r.get("metrics") or {}) for s, r in rows.items()}
    sc = {s: (r.get("scores") or {}) for s, r in rows.items()}

    def vals(key, src=None):
        src = src or cm
        return {s: v[key] for s, v in src.items()
                if v.get(key) is not None}

    def ck(label, cond):
        CHECKS[0] += 1
        if not cond:
            FAILS.append(label)

    def top(key, sym, n=1, src=None, reverse=True, count=None):
        """sym is the n-th by key, and the cohort size is `count` if given."""
        v = vals(key, src)
        order = sorted(v, key=lambda s: v[s], reverse=reverse)
        ck(f"{sym}: {key} rank {n} of {len(v)}"
           + (f" (prose says {count})" if count else ""),
           order[n - 1] == sym and (count is None or len(v) == count))

    def close(label, a, b, tol=0.005):
        ck(label, abs(a - b) <= tol)

    # ---------------------------------------------------------------- CRISIL
    top("market_cap", "CRISIL", src=mt)
    mc = vals("market_cap", mt)
    ck("CRISIL: largest by a factor of two",
       mc["CRISIL"] > 2 * sorted(mc.values(), reverse=True)[1])
    top("roe_7y", "CRISIL", count=13)
    r5_of_7 = {s: cm[s]["roe_5y"] for s in vals("roe_7y") if cm[s].get("roe_5y")}
    ck("CRISIL: roe_5y highest of the 13 with a 7y reading",
       max(r5_of_7, key=r5_of_7.get) == "CRISIL" and len(r5_of_7) == 13)
    # exactly two names clear the 13% hurdle on all three windows
    clears = {s for s in rows
              if all((cm[s].get(f"roe_excess_13_{w}") or -1) > 0
                     for w in ("5y", "7y", "10y"))}
    ck("CRISIL/WEALTH: exactly two clear 13% on all three windows",
       clears == {"CRISIL", "WEALTH"})
    top("np_consistency_10y", "CRISIL", n=2, count=12)
    top("np_consistency_10y", "AKCAPIT", n=1, count=12)
    top("pb", "CRISIL", n=2)
    top("p_aum", "CRISIL", n=1)
    band = rows["CRISIL"]["pe_band"]
    close("CRISIL: 36.62x is 19% below its 45.43x own average",
          (1 - cm["CRISIL"]["pe_ttm"] / band["avg"]) * 100, 19, 0.6)
    close("CRISIL: within 14% of the 32.05x decade low",
          (cm["CRISIL"]["pe_ttm"] / band["lo"] - 1) * 100, 14, 0.6)
    close("CRISIL: +0.76pp margin step",
          cm["CRISIL"]["opm_now"] - cm["CRISIL"]["opm_prev"], 0.76, 0.01)
    infl("CRISIL", cm, ck, 3, 4, 5)

    # ---------------------------------------------------------------- WEALTH
    ck("WEALTH: roe_3y second of the 16 behind ALGOQUANT",
       sorted(vals("roe_3y"), key=lambda s: -cm[s]["roe_3y"])[1] == "WEALTH")
    top("roa_3y", "WEALTH")
    close("WEALTH: 28.70x is 1.73x its own 16.62x average",
          cm["WEALTH"]["pe_ttm"] / rows["WEALTH"]["pe_band"]["avg"], 1.73, 0.005)
    close("WEALTH: -12.03pp margin step",
          cm["WEALTH"]["opm_now"] - cm["WEALTH"]["opm_prev"], -12.03, 0.01)
    infl("WEALTH", cm, ck, 2, 4, 5)

    # --------------------------------------------------------------- AKCAPIT
    ck("AKCAPIT: roe never clears 13% on any window",
       all(cm["AKCAPIT"][f"roe_excess_13_{w}"] < 0
           for w in ("5y", "7y", "10y"))
       and all(cm["AKCAPIT"][f"roe_{w}"] < 0.13 for w in ("3y", "5y", "7y")))
    payers = {s: v for s, v in vals("div_yield").items() if v > 0}
    ck("AKCAPIT: div_yield highest of the seven payers",
       max(payers, key=payers.get) == "AKCAPIT" and len(payers) == 7)
    top("shareholders", "AKCAPIT", n=2, reverse=False)
    e2a = vals("equity_to_assets")
    ck("AKCAPIT: second-thinnest equity_to_assets of the 16",
       sorted(e2a, key=e2a.get)[1] == "AKCAPIT")
    ck("AKCAPIT: 9.88x is above its own ten-year high of 9.01x",
       cm["AKCAPIT"]["pe_ttm"] > rows["AKCAPIT"]["pe_band"]["hi"]
       and rows["AKCAPIT"]["pe_band"]["n"] == 10)

    # --------------------------------------------------------------- ARYAMAN
    top("np_cagr_7y", "ARYAMAN", count=11)
    top("roe_3y", "ARYAMAN", n=4)
    top("ttm_sales_pct", "ARYAMAN", reverse=False, count=13)
    top("shareholders", "ARYAMAN", reverse=False)
    close("ARYAMAN: 25.96x is 12% below its 29.36x own average",
          (1 - cm["ARYAMAN"]["pe_ttm"] / rows["ARYAMAN"]["pe_band"]["avg"]) * 100,
          12, 0.6)
    close("ARYAMAN: +14.87pp margin step",
          cm["ARYAMAN"]["opm_now"] - cm["ARYAMAN"]["opm_prev"], 14.87, 0.01)

    # ------------------------------------------------------------- PRIMESECU
    steps = {s: cm[s]["opm_now"] - cm[s]["opm_prev"]
             for s in rows if cm[s].get("opm_now") is not None
             and cm[s].get("opm_prev") is not None}
    ck("PRIMESECU: largest negative margin step of the 16",
       min(steps, key=steps.get) == "PRIMESECU")
    top("ttm_np_pct", "PRIMESECU", reverse=False, count=13)
    top("np_yoy_q", "PRIMESECU", reverse=False, count=15)
    top("roe_excess_13_10y", "PRIMESECU", count=12)
    top("pct_above_200ema_252d", "PRIMESECU", count=10)
    ck("PRIMESECU: ret_12m_rel positive", cm["PRIMESECU"]["ret_12m_rel"] > 0)
    ck("PRIMESECU: no pe_ttm", cm["PRIMESECU"].get("pe_ttm") is None)

    # ------------------------------------------------------------------ AFSL
    comp = {s: sc[s]["composite_pct"] for s in rows
            if sc[s].get("composite_pct") is not None}
    ck("AFSL: highest composite of the 15 carrying one",
       max(comp, key=comp.get) == "AFSL" and len(comp) == 15)
    valp = {s: sc[s]["valuation_pct"] for s in rows
            if sc[s].get("valuation_pct") is not None}
    ck("AFSL: highest valuation_pct", max(valp, key=valp.get) == "AFSL")
    top("ttm_sales_pct", "AFSL", count=13)
    top("opm_now", "AFSL", reverse=False, count=13)
    top("fii_pct", "AFSL")
    ck("AFSL: ret_12m_rel exactly 0.00%",
       abs(cm["AFSL"]["ret_12m_rel"]) < 0.00005)
    ck("AFSL: carries no hurdle or inflation reading",
       all(cm["AFSL"].get(k) is None
           for k in ("roe_excess_13_5y", "roe_excess_13_7y",
                     "roe_excess_13_10y", "np_growth_above_inflation_5y",
                     "np_growth_above_inflation_7y",
                     "np_growth_above_inflation_10y")))

    # -------------------------------------------------------------- CHOICEIN
    for w, n in (("5y", 4), ("7y", 6), ("10y", 9)):
        k = f"np_growth_above_inflation_{w}"
        v = vals(k)
        ck(f"CHOICEIN: best inflation record on {w} of the 12",
           max(v.values()) == v["CHOICEIN"] and len(v) == 12)
    infl("CHOICEIN", cm, ck, 4, 6, 8)
    top("book_value_cagr_10y", "CHOICEIN", count=11)
    lb = {s: v for s, v in vals("loan_book_cagr_3y").items() if s != "ASHIKAG"}
    ck("CHOICEIN: fastest book growth of the 16 once ASHIKAG is set aside",
       max(lb, key=lb.get) == "CHOICEIN")
    ck("ASHIKAG: and ASHIKAG is the one being set aside",
       cm["ASHIKAG"]["loan_book_cagr_3y"] > cm["CHOICEIN"]["loan_book_cagr_3y"])
    brokers = {"CHOICEIN", "ASHIKAG", "ALGOQUANT", "THEINVEST", "AVONMORE"}
    ck("CHOICEIN: largest of the five broker-NBFCs",
       max(brokers, key=lambda s: mt[s]["market_cap"]) == "CHOICEIN")
    bsteps = {s: steps[s] for s in brokers if s in steps}
    nxt = sorted(bsteps, key=lambda s: abs(bsteps[s]))[1]
    ck("CHOICEIN: smallest margin move of the five, next is THEINVEST -7.60pp",
       min(bsteps, key=lambda s: abs(bsteps[s])) == "CHOICEIN"
       and nxt == "THEINVEST" and abs(bsteps[nxt] - (-7.60)) < 0.005)
    top("pct_above_200ema_252d", "CHOICEIN", n=2, count=10)
    top("pe_ttm", "CHOICEIN", n=2)

    # --------------------------------------------------------------- ASHIKAG
    ck("ASHIKAG: quality_pct is 72", sc["ASHIKAG"]["quality_pct"] == 72)
    ck("ASHIKAG: promoter 58.00 -> 74.32 across 2026-03-31/2026-06-30",
       _promoter_step(rows["ASHIKAG"]) == ("2026-03-31", 58.0,
                                           "2026-06-30", 74.32))

    # ------------------------------------------------------------- ALGOQUANT
    top("ttm_np_pct", "ALGOQUANT", count=13)
    top("roe_3y", "ALGOQUANT")
    top("pb", "ALGOQUANT")
    ck("ALGOQUANT: above WEALTH on roe_3y",
       cm["ALGOQUANT"]["roe_3y"] > cm["WEALTH"]["roe_3y"])
    close("ALGOQUANT: +10.98pp margin step", steps["ALGOQUANT"], 10.98, 0.01)

    # ------------------------------------------------------------- THEINVEST
    for k, n in (("roe_3y", 16), ("roe_5y", None), ("roe_7y", 13)):
        v = vals(k)
        ck(f"THEINVEST: {k} lowest of its cohort ({len(v)})",
           min(v, key=v.get) == "THEINVEST")
    top("roe_excess_13_5y", "THEINVEST", reverse=False, count=12)
    top("roe_excess_13_7y", "THEINVEST", reverse=False, count=12)
    top("ret_12m_rel", "THEINVEST", reverse=False, count=10)
    top("pct_above_200ema_252d", "THEINVEST", reverse=False, count=10)
    close("THEINVEST: below trend 98% of the year",
          100 - cm["THEINVEST"]["pct_above_200ema_252d"] * 100, 98, 0.1)
    ck("THEINVEST/BLBLIMITED: p_aum indistinguishable, neither ranked",
       abs(cm["THEINVEST"]["p_aum"] - cm["BLBLIMITED"]["p_aum"]) < 0.001)

    # -------------------------------------------------------------- AVONMORE
    top("pe_ttm", "AVONMORE", count=14)
    ey = vals("earnings_yield_trend")
    order = sorted(ey, key=ey.get)
    ck("AVONMORE: earnings_yield_trend worst, next-worst is -6.53pp",
       order[0] == "AVONMORE" and abs(ey[order[1]] * 100 - (-6.53)) < 0.005)
    top("np_cagr_7y", "AVONMORE", reverse=False, count=11)
    ck("AVONMORE: roe_7y above roe_3y by two-thirds",
       cm["AVONMORE"]["roe_7y"] > cm["AVONMORE"]["roe_3y"] * 2.5)
    ck("AVONMORE: band low of 0.13x is not a possible PE",
       rows["AVONMORE"]["pe_band"]["lo"] < 1)
    ck("AVONMORE/WEALTH: above-200EMA tied, neither ranked",
       abs(cm["AVONMORE"]["pct_above_200ema_252d"]
           - cm["WEALTH"]["pct_above_200ema_252d"]) < 0.0005)
    close("AVONMORE: -9.97pp margin step", steps["AVONMORE"], -9.97, 0.01)

    # ------------------------------------------------------------ BLBLIMITED
    ck("BLBLIMITED: smallest of the 16",
       min(mc, key=mc.get) == "BLBLIMITED")
    top("pe_ttm", "BLBLIMITED", reverse=False, count=14)
    nc = vals("np_consistency_10y")
    o = sorted(nc, key=nc.get)
    ck("BLBLIMITED: np_consistency_10y worst of 12, next-worst 1.38",
       o[0] == "BLBLIMITED" and len(nc) == 12 and abs(nc[o[1]] - 1.38) < 0.005)
    top("roe_excess_13_10y", "BLBLIMITED", reverse=False, count=12)
    top("equity_to_assets", "BLBLIMITED")
    top("loan_book_cagr_3y", "BLBLIMITED", reverse=False)
    top("book_value_cagr_10y", "BLBLIMITED", reverse=False, count=11)
    top("np_yoy_q", "BLBLIMITED", count=15)
    top("earnings_yield_trend", "BLBLIMITED")
    top("promoter_pct", "BLBLIMITED", reverse=False)
    ck("BLBLIMITED: fii_pct is 0.00", cm["BLBLIMITED"]["fii_pct"] == 0)
    ck("BLBLIMITED: no ttm_vs_prior", not rows["BLBLIMITED"].get("ttm_vs_prior"))

    # ------------------------------------------------------------ VLSFINANCE
    top("book_value_cagr_10y", "VLSFINANCE", n=3, count=11)
    top("np_cagr_5y", "VLSFINANCE", reverse=False, count=13)
    top("pb", "VLSFINANCE", reverse=False)
    top("ret_12m_rel", "VLSFINANCE", count=10)
    for w in ("5y", "7y", "10y"):
        v = vals(f"np_growth_above_inflation_{w}")
        ck(f"VLSFINANCE: worst inflation record on {w} of the 12",
           min(v, key=v.get) == "VLSFINANCE" and len(v) == 12)
    infl("VLSFINANCE", cm, ck, 1, 2, 3)
    close("VLSFINANCE: +24.98pp margin step", steps["VLSFINANCE"], 24.98, 0.01)

    # -------------------------------------------------------------- PIONRINV
    top("sales_yoy_q", "PIONRINV", reverse=False, count=15)
    ck("PIONRINV: ttm profit up while operating profit fell",
       cm["PIONRINV"]["ttm_np_pct"] > 0 > cm["PIONRINV"]["ttm_op_pct"])
    mom = {s: sc[s]["momentum_pct"] for s in rows
           if sc[s].get("momentum_pct") is not None}
    ck("PIONRINV: lowest momentum_pct of the 15 carrying one",
       min(mom, key=mom.get) == "PIONRINV" and len(mom) == 15)
    top("p_aum", "PIONRINV", reverse=False)
    top("pb", "PIONRINV", n=2, reverse=False)
    ck("PIONRINV: second-smallest of the 16",
       sorted(mc, key=mc.get)[1] == "PIONRINV")
    ck("PIONRINV: geared against BLBLIMITED and VLSFINANCE",
       cm["PIONRINV"]["equity_to_assets"] < cm["BLBLIMITED"]["equity_to_assets"]
       and cm["PIONRINV"]["equity_to_assets"] < cm["VLSFINANCE"]["equity_to_assets"])

    # -------------------------------------------------------------- PNBGILTS
    top("equity_to_assets", "PNBGILTS", reverse=False)
    ck("PNBGILTS: next-thinnest is AKCAPIT at 4.20x",
       sorted(e2a, key=e2a.get)[1] == "AKCAPIT")
    top("roa_3y", "PNBGILTS", reverse=False)
    close("PNBGILTS: roa x gearing reproduces roe_3y",
          cm["PNBGILTS"]["roa_3y"] / cm["PNBGILTS"]["equity_to_assets"] * 100,
          cm["PNBGILTS"]["roe_3y"] * 100, 0.6)
    top("opm_now", "PNBGILTS", count=13)
    ck("PNBGILTS: lowest composite of the 15",
       min(comp, key=comp.get) == "PNBGILTS")
    ck("PNBGILTS: div_yield second of the seven payers",
       sorted(payers, key=payers.get, reverse=True)[1] == "PNBGILTS")
    close("PNBGILTS: -10.70pp margin step", steps["PNBGILTS"], -10.70, 0.01)
    ck("PNBGILTS: band is unusable at both ends",
       rows["PNBGILTS"]["pe_band"]["lo"] < 4
       and rows["PNBGILTS"]["pe_band"]["hi"] > 100)

    # ----------------------------------------------------------------- ARCIL
    prom = vals("promoter_pct")
    ck("ARCIL: highest promoter_pct of the 15 with a reading",
       max(prom, key=prom.get) == "ARCIL" and len(prom) == 15)
    top("shareholders", "ARCIL")
    ck("ARCIL: the only name with no composite",
       [s for s in rows if sc[s].get("composite_pct") is None] == ["ARCIL"])

    print(f"{CHECKS[0]} rank claims checked, {len(FAILS)} failed")
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


def _promoter_step(row):
    sh = row.get("shareholding") or []
    by = {r["period_end"]: r.get("promoter_pct") for r in sh}
    return ("2026-03-31", by.get("2026-03-31"),
            "2026-06-30", by.get("2026-06-30"))


if __name__ == "__main__":
    main()
