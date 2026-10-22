"""Pass 2 for the bfsi_psu_banks batch of 5 — every rank, superlative, ratio
and quarter-over-quarter claim in `mk_psu_5.py`, restated as code and
evaluated against the data.

Pass 1 (`scripts/verdict-check.py`) only asks whether a number appears
somewhere in a symbol's own pack. It cannot see "the lowest of the twelve",
cannot see a derived ratio, and cannot see a shareholding claim like "8.98% to
10.14% across five quarters" — all of those are claims about something outside
the row. Every batch written so far has contained at least one wrong
superlative, and this file is the only thing that finds them.

WHAT MAKES THIS BATCH DIFFERENT FROM THE LAST ONE

Most of the claims here are scoped "of the twelve" and only five of the twelve
cluster members are written, so the batch pack cannot check them at all. In
the previous batch that exact gap shipped two wrong ordinals: the sixth
cluster member was untracked, absent from the pack, and every "of the six"
check was silently a five-way check. So this file reads /tmp/psu12.json — all
twelve members' `cluster_metrics` at the same 2026-10-21 snapshot — and
re-derives every cluster-wide rank from it.

It paid for itself before a single verdict was written. The first draft said
no bank in the cluster had a bullish EMA stack: true of the five in the pack,
false of the twelve, because PNB's `ema_stack_bull` is 1.0.

ERRORS THIS BATCH'S CHECKING FOUND

  1. The EMA-stack claim above, found by widening to twelve before writing.
  2. `np_cagr_7y` was being ranked cluster-wide; it exists for five of the
     twelve, so no twelve-wide rank on it is possible. The generator now
     refuses it and BANKINDIA's row says why.
  3. MAHABANK's recovery was dated "about 2021" from memory. The annual
     series says net profit turned positive in FY2020; the row now gives the
     actual figures instead of an approximation.
  4. The sparse-field guard was decoration. Written as `[^.]{0,120}`, it was
     fed the exact prose it exists to reject — "np_cagr_7y of 27.09% is the
     lowest of the twelve" — and passed green, because the decimal point in
     27.09 ended the match. Every figure in this batch has a decimal point in
     it, so the guard could never have fired. See `_within_sentence`.

Then two more, found by this file once it ran:

  5. SBIN's row called it "the only count of the five that is rising" on
     shareholders. Indian Bank's went 317,481 to 318,231 — up too, by 750
     against SBIN's 71,817. This is the *second consecutive batch* to ship an
     unqualified "only" where a second member moved the same way by a trivial
     amount; the previous one said Infosys had the only improving cash
     conversion while TCS's rose by 0.001. The fix both times was to name the
     other member and give both magnitudes. If a third batch does this, the
     rule should become mechanical: no "only" without the runner-up's value.
  6. MAHABANK's row listed seven metrics it tops and then said no other bank
     tops "more than one of these" — which the first clause already implies.
     Vacuous prose, and it was found only because the check written to verify
     it was itself badly specified (it counted `pe_ttm` and `pb`, where being
     the maximum means being the most expensive). Replaced with a claim that
     can be false: eleven of the 28 higher-is-better cluster metrics, against
     six for the next bank.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/check_psu_5.py
"""

import json

PACK = "/tmp/psu5.json"
PEERS = "/tmp/psu12.json"
FIVE = ("BANKBARODA", "BANKINDIA", "INDIANB", "MAHABANK", "SBIN")
TWELVE = ("BANKBARODA", "BANKINDIA", "CANBK", "CENTRALBK", "INDIANB", "IOB",
          "MAHABANK", "PNB", "PSB", "SBIN", "UCOBANK", "UNIONBANK")

FAILS = []
CHECKS = [0]


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}
    peers = json.load(open(PEERS))
    p12 = peers["cluster_metrics"]
    s12 = peers["scores"]

    if set(rows) != set(FIVE):
        raise SystemExit(f"pack is {sorted(rows)}, expected {sorted(FIVE)}")
    if set(p12) != set(TWELVE):
        raise SystemExit(f"peer pack is {sorted(p12)}, expected {sorted(TWELVE)}")

    cm = {s: (r.get("metrics") or {}).get("cluster_metrics") or {}
          for s, r in rows.items()}
    sc = {s: (r.get("scores") or {}) for s, r in rows.items()}
    sh = {s: (r.get("shareholding") or []) for s, r in rows.items()}
    an = {s: (r.get("annual") or []) for s, r in rows.items()}

    def ck(label, cond):
        CHECKS[0] += 1
        if not cond:
            FAILS.append(label)

    def close(label, a, b, tol=0.02):
        ck(f"{label} ({a} vs {b})", a is not None and abs(a - b) <= tol)

    def rank(key, sym, n=1, reverse=True, pop=12):
        """Position of sym within the population, 1-indexed.

        pop=12 ranks across the whole cluster, pop=5 across the written five.
        Members with a NULL reading are dropped, and the drop is reported in
        the label so a shrinking denominator cannot hide inside a passing
        check.
        """
        src = p12 if pop == 12 else {s: p12[s] for s in FIVE}
        vals = {s: v[key] for s, v in src.items() if v.get(key) is not None}
        order = sorted(vals, key=lambda s: -vals[s] if reverse else vals[s])
        got = order.index(sym) + 1 if sym in order else None
        ck(f"{sym}.{key} is #{n} of {pop} ({'desc' if reverse else 'asc'}, "
           f"n={len(vals)}) -- got #{got}", got == n)

    def allneg(key):
        vals = {s: v.get(key) for s, v in p12.items()}
        bad = {s: v for s, v in vals.items() if v is None or v >= 0}
        ck(f"{key} negative for all twelve -- offenders {bad}", not bad)

    def present(key, n):
        have = [s for s, v in p12.items() if v.get(key) is not None]
        ck(f"{key} present for {n} of twelve -- got {len(have)} {sorted(have)}",
           len(have) == n)

    def shq(sym, period, field):
        for r in sh[sym]:
            if r["period_end"] == period:
                return r.get(field)
        return None

    def fy(sym, year, field="net_profit"):
        for r in an[sym]:
            if r["period_end"][:4] == str(year):
                return r.get(field)
        return None

    # ---------------------------------------------------------------- batch
    # Choice 1: the cluster clears the peer floor and scores cleanly, which is
    # what entitles every row to state ranks without a lattice caveat.
    ck(f"cluster has 12 members -- got {len(p12)}", len(p12) == 12)
    for s in TWELVE:
        ck(f"{s} score_status full", s12[s] is not None)
    for s in FIVE:
        ck(f"{s} score_status is 'full' -- {sc[s].get('score_status')}",
           sc[s].get("score_status") == "full")
        ck(f"{s} cluster is bfsi_psu_banks",
           sc[s].get("cluster_id") == "bfsi_psu_banks")

    # Choice 4: the spine.
    allneg("roe_excess_13_10y")
    rank("roe_excess_13_10y", "INDIANB", 1)      # smallest shortfall of twelve
    pos5 = sorted(s for s in p12 if p12[s]["roe_excess_13_5y"] > 0)
    ck(f"roe_excess_13_5y positive for exactly CANBK/MAHABANK/SBIN -- {pos5}",
       pos5 == ["CANBK", "MAHABANK", "SBIN"])

    # Choice 6: eleven of twelve flat, PNB the exception. The claim the first
    # draft got wrong.
    bull = sorted(s for s in p12 if (p12[s].get("ema_stack_bull") or 0) > 0)
    ck(f"ema_stack_bull bullish for PNB alone -- {bull}", bull == ["PNB"])
    flat = [s for s in p12 if (p12[s].get("ema_stack_bull") or 0) == 0]
    ck(f"ema_stack_bull flat for eleven -- got {len(flat)}", len(flat) == 11)

    # Choice 13: momentum scored on 95 of 100.
    ck("tech_net_score_scaled NULL for all twelve",
       all(p12[s].get("tech_net_score_scaled") is None for s in p12))

    # Choice 5: the index is quoted here because it discriminates here.
    cons = [p12[s]["np_consistency_10y"] for s in p12]
    close("np_consistency_10y cluster low 0.545", min(cons), 0.545, 0.001)
    close("np_consistency_10y cluster high 1.543", max(cons), 1.543, 0.001)
    ck(f"np_consistency_10y span > 0.5 -- {max(cons) - min(cons):.3f}",
       max(cons) - min(cons) > 0.5)

    # Choice 10: five of twelve, so never ranked cluster-wide.
    present("np_cagr_7y", 5)
    present("div_yield", 11)

    # Choice 14: delivery is a 12-session window and is quoted nowhere.
    for s in FIVE:
        ck(f"{s} delivery is 12 sessions",
           (rows[s].get("delivery") or {}).get("sessions") == 12)

    # Choice 7: INDIANB alone is a quarter ahead.
    wins = {s: tuple((rows[s].get("ttm_vs_prior") or {}).get("window") or ())
            for s in FIVE}
    odd = sorted(s for s in FIVE if wins[s] != ("2025-09-30", "2026-06-30"))
    ck(f"only INDIANB is off-window -- {odd} {wins}", odd == ["INDIANB"])
    ck(f"INDIANB window ends 2026-09-30 -- {wins['INDIANB']}",
       wins["INDIANB"] == ("2025-12-31", "2026-09-30"))

    # Choice 8: the band rule, one pass and four refusals.
    bands = {s: rows[s].get("pe_band") or {} for s in FIVE}
    for s, want in (("BANKBARODA", True), ("MAHABANK", False),
                    ("BANKINDIA", False), ("INDIANB", False), ("SBIN", False)):
        b = bands[s]
        ok = (b.get("n") or 0) >= 8 and (b.get("lo") or 0) >= 4.0 \
            and (b.get("hi") or 1e9) <= 100
        ck(f"{s} band quotable={want} -- {b}", ok == want)
    close("BANKBARODA band avg 15.28", bands["BANKBARODA"].get("avg"), 15.28)
    close("BANKBARODA band lo 5.72", bands["BANKBARODA"].get("lo"), 5.72)
    close("BANKBARODA band hi 31.10", bands["BANKBARODA"].get("hi"), 31.10)
    close("SBIN band hi 969.79", bands["SBIN"].get("hi"), 969.79)
    close("SBIN band avg 129.81", bands["SBIN"].get("avg"), 129.81)
    close("INDIANB band lo 3.05", bands["INDIANB"].get("lo"), 3.05)
    ck(f"MAHABANK band n=7 -- {bands['MAHABANK'].get('n')}",
       bands["MAHABANK"].get("n") == 7)
    ck(f"BANKINDIA band n=6 -- {bands['BANKINDIA'].get('n')}",
       bands["BANKINDIA"].get("n") == 6)

    # Choice 11: nothing held, all five watchlisted, no prior verdicts.
    for s in FIVE:
        ck(f"{s} has no prior verdict", not (rows[s].get("prior_verdicts") or []))

    # Pillar weights, quoted in BANKBARODA's row as 55/30/15.
    for s in FIVE:
        w = (rows[s].get("scorecard_coverage") or {}).get("pillar_weights") or {}
        ck(f"{s} pillar weights 55/30/15 -- {w}",
           (w.get("q"), w.get("v"), w.get("m")) == (55, 30, 15))

    # ----------------------------------------------------------- BANKBARODA
    c = cm["BANKBARODA"]
    ck(f"BANKBARODA composite 100 -- {sc['BANKBARODA'].get('composite_pct')}",
       sc["BANKBARODA"].get("composite_pct") == 100)
    top = max(s12, key=lambda s: s12[s]["composite_pct"])
    ck(f"BANKBARODA tops the cluster composite -- {top}", top == "BANKBARODA")
    neg = sorted(s for s in p12 if p12[s]["ttm_np_pct"] < 0)
    ck(f"BANKBARODA the only negative ttm_np_pct of twelve -- {neg}",
       neg == ["BANKBARODA"])
    close("BANKBARODA ttm_np_pct -6.67", c["ttm_np_pct"], -6.666, 0.01)
    rank("ttm_np_pct", "BANKBARODA", 12)        # worst of twelve
    close("BANKBARODA np_yoy_q -48.6", c["np_yoy_q"], -0.486, 0.001)
    rank("np_yoy_q", "BANKBARODA", 12)
    close("BANKBARODA sales_yoy_q 6.84", c["sales_yoy_q"] * 100, 6.84)
    rank("sales_yoy_q", "BANKBARODA", 12)
    close("BANKBARODA np_cagr_5y 26.10", c["np_cagr_5y"] * 100, 26.10)
    close("BANKBARODA book_value_cagr_10y 16.16",
          c["book_value_cagr_10y"] * 100, 16.16)
    rank("book_value_cagr_10y", "BANKBARODA", 4)
    # Pass rates: np_growth_above_inflation_Ny is n of N-1.
    close("BANKBARODA inflation 5y = 3 of 4",
          c["np_growth_above_inflation_5y"], 3 / 4, 0.001)
    close("BANKBARODA inflation 7y = 5 of 6",
          c["np_growth_above_inflation_7y"], 5 / 6, 0.001)
    close("BANKBARODA inflation 10y = 6 of 9",
          c["np_growth_above_inflation_10y"], 6 / 9, 0.001)
    close("BANKBARODA roe_excess_13_10y -6.02pp",
          c["roe_excess_13_10y"] * 100, -6.02)
    rank("roe_excess_13_10y", "BANKBARODA", 3)  # third-smallest shortfall
    close("BANKBARODA pb 0.74", c["pb"], 0.743, 0.005)
    rank("pb", "BANKBARODA", 10)                # tenth on expensiveness
    close("BANKBARODA pe_ttm 8.13", c["pe_ttm"], 8.126, 0.01)
    close("BANKBARODA div_yield 3.57", c["div_yield"] * 100, 3.571)
    rank("div_yield", "BANKBARODA", 2)          # second of the eleven paying
    close("BANKBARODA opm_now 63.95", c["opm_now"], 63.95, 0.01)
    # Shareholding, five quarters.
    close("BANKBARODA fii five quarters ago 8.98",
          shq("BANKBARODA", "2025-03-31", "fii_pct"), 8.98)
    close("BANKBARODA fii now 10.14",
          shq("BANKBARODA", "2026-06-30", "fii_pct"), 10.14)
    ck("BANKBARODA shareholders 1,689,797 -> 1,460,575",
       shq("BANKBARODA", "2025-03-31", "shareholders") == 1689797
       and shq("BANKBARODA", "2026-06-30", "shareholders") == 1460575)
    # The annual confirmation that the fall is not one quarter.
    ck(f"BANKBARODA FY2025 np 20,716 -- {fy('BANKBARODA', 2025)}",
       round(fy("BANKBARODA", 2025)) == 20716)
    ck(f"BANKBARODA FY2026 np 19,846 -- {fy('BANKBARODA', 2026)}",
       round(fy("BANKBARODA", 2026)) == 19846)
    seq = [fy("BANKBARODA", y) for y in range(2020, 2026)]
    ck(f"BANKBARODA five consecutive annual increases to FY2025 -- {seq}",
       all(seq[i] < seq[i + 1] for i in range(5)))
    ck("BANKBARODA FY2026 is the first decline after those",
       fy("BANKBARODA", 2026) < fy("BANKBARODA", 2025))

    # ------------------------------------------------------------- MAHABANK
    c = cm["MAHABANK"]
    for key in ("roe_3y", "roe_5y", "roe_7y", "roa_3y", "loan_book_cagr_3y",
                "np_cagr_5y", "ttm_sales_pct"):
        rank(key, "MAHABANK", 1)
    close("MAHABANK roe_3y 20.30", c["roe_3y"] * 100, 20.30)
    close("MAHABANK roe_5y 17.12", c["roe_5y"] * 100, 17.12)
    close("MAHABANK roe_7y 13.42", c["roe_7y"] * 100, 13.42)
    close("MAHABANK roa_3y 1.49", c["roa_3y"] * 100, 1.49)
    close("MAHABANK loan_book_cagr_3y 16.86",
          c["loan_book_cagr_3y"] * 100, 16.86)
    close("MAHABANK np_cagr_5y 57.05", c["np_cagr_5y"] * 100, 57.05)
    close("MAHABANK ttm_sales_pct 15.83", c["ttm_sales_pct"], 15.83, 0.01)
    # "first of the twelve on eleven of the 28 higher-is-better metrics; the
    # next bank leads on six, no other name in the batch on more than four."
    #
    # The first version of this check took max() over every cluster metric,
    # which counts `pe_ttm` and `pb` as things to lead on — being the most
    # expensive bank is not an achievement. It also tested a prose sentence
    # that could not be false: the row listed seven metrics MAHABANK tops and
    # then said no other bank tops more than one "of these", which is implied
    # by the first clause. Vacuous prose, caught by a badly specified check.
    NOT_HIB = {"pe_ttm", "pb", "tech_net_score_scaled", "equity_to_assets",
               "shareholders", "promoter_pct", "fii_pct", "dii_pct",
               "opm_prev"}
    hib = [k for k in p12["SBIN"] if k not in NOT_HIB]
    ck(f"28 higher-is-better cluster metrics -- got {len(hib)}", len(hib) == 28)
    leads = {}
    for s in p12:
        n = 0
        for key in hib:
            vals = {x: p12[x][key] for x in p12 if p12[x].get(key) is not None}
            if s in vals and max(vals, key=lambda x: vals[x]) == s:
                n += 1
        leads[s] = n
    order = sorted(leads, key=lambda s: -leads[s])
    ck(f"MAHABANK leads on 11 of 28 -- {leads['MAHABANK']}",
       leads["MAHABANK"] == 11)
    ck(f"MAHABANK leads the whole cluster -- {order[0]}",
       order[0] == "MAHABANK")
    ck(f"the next bank in the cluster leads on six -- {order[1]} "
       f"{leads[order[1]]}", leads[order[1]] == 6)
    ck(f"no other written name leads on more than four -- "
       f"{ {s: leads[s] for s in FIVE} }",
       max(leads[s] for s in FIVE if s != "MAHABANK") == 4)
    close("MAHABANK inflation 5y = 4 of 4",
          c["np_growth_above_inflation_5y"], 1.0, 0.001)
    close("MAHABANK inflation 7y = 6 of 6",
          c["np_growth_above_inflation_7y"], 1.0, 0.001)
    close("MAHABANK roe_excess_13_10y -14.63pp",
          c["roe_excess_13_10y"] * 100, -14.63)
    rank("roe_excess_13_10y", "MAHABANK", 8)    # eighth-worst of twelve
    close("MAHABANK roe_excess_13_5y +4.12pp",
          c["roe_excess_13_5y"] * 100, 4.12)
    rank("roe_excess_13_5y", "MAHABANK", 1)
    close("MAHABANK pb 1.85", c["pb"], 1.848, 0.005)
    rank("pb", "MAHABANK", 1)                   # most expensive of twelve
    close("MAHABANK pe_ttm 8.15", c["pe_ttm"], 8.146, 0.01)
    close("MAHABANK div_yield 1.50", c["div_yield"] * 100, 1.504)
    rank("div_yield", "MAHABANK", 11, reverse=True)  # last of the eleven
    close("MAHABANK ret_12m_rel +47.06", c["ret_12m_rel"] * 100, 47.06)
    rank("ret_12m_rel", "MAHABANK", 1)
    close("MAHABANK pct_above_200ema_252d 1.00",
          c["pct_above_200ema_252d"], 1.0, 0.0001)
    alltime = sorted(s for s in p12
                     if (p12[s].get("pct_above_200ema_252d") or 0) >= 1.0)
    ck(f"MAHABANK alone closed above its 200EMA every session -- {alltime}",
       alltime == ["MAHABANK"])
    # The government stake sale and the FII response.
    close("MAHABANK promoter 79.60 at 2025-09-30",
          shq("MAHABANK", "2025-09-30", "promoter_pct"), 79.60)
    close("MAHABANK promoter 73.60 at 2025-12-31",
          shq("MAHABANK", "2025-12-31", "promoter_pct"), 73.60)
    close("MAHABANK fii 1.72 five quarters ago",
          shq("MAHABANK", "2025-03-31", "fii_pct"), 1.72)
    close("MAHABANK fii 5.82 now",
          shq("MAHABANK", "2026-06-30", "fii_pct"), 5.82)
    ck("MAHABANK fii more than tripled",
       shq("MAHABANK", "2026-06-30", "fii_pct")
       > 3 * shq("MAHABANK", "2025-03-31", "fii_pct"))
    # The annual record that replaced the "about 2021" guess.
    for y in (2017, 2018, 2019):
        ck(f"MAHABANK FY{y} was a loss -- {fy('MAHABANK', y)}",
           fy("MAHABANK", y) < 0)
    ck(f"MAHABANK FY2019 loss 4,763 -- {fy('MAHABANK', 2019)}",
       round(abs(fy("MAHABANK", 2019))) == 4763)
    ck("MAHABANK profitable every year from FY2020",
       all(fy("MAHABANK", y) > 0 for y in range(2020, 2027)))
    ck(f"MAHABANK FY2020 np 399 -- {fy('MAHABANK', 2020)}",
       round(fy("MAHABANK", 2020)) == 399)
    ck(f"MAHABANK FY2026 np 7,017 -- {fy('MAHABANK', 2026)}",
       round(fy("MAHABANK", 2026)) == 7017)

    # ------------------------------------------------------------ BANKINDIA
    c = cm["BANKINDIA"]
    close("BANKINDIA pe_ttm 5.33", c["pe_ttm"], 5.334, 0.01)
    rank("pe_ttm", "BANKINDIA", 1, reverse=False)   # cheapest of twelve
    close("BANKINDIA pb 0.70", c["pb"], 0.698, 0.005)
    rank("pb", "BANKINDIA", 1, reverse=False)
    ck(f"BANKINDIA valuation pillar 90 -- "
       f"{sc['BANKINDIA'].get('valuation_pct')}",
       sc["BANKINDIA"].get("valuation_pct") == 90)
    close("BANKINDIA np_yoy_q +80.51", c["np_yoy_q"] * 100, 80.51)
    rank("np_yoy_q", "BANKINDIA", 1)
    close("BANKINDIA ttm_np_pct +24.13", c["ttm_np_pct"], 24.13, 0.01)
    rank("ttm_np_pct", "BANKINDIA", 5)
    close("BANKINDIA opm_now 72.26", c["opm_now"], 72.26, 0.01)
    rank("opm_now", "BANKINDIA", 3)
    close("BANKINDIA roe_3y 10.86", c["roe_3y"] * 100, 10.86)
    rank("roe_3y", "BANKINDIA", 9)
    close("BANKINDIA roe_5y 9.02", c["roe_5y"] * 100, 9.02)
    rank("roe_5y", "BANKINDIA", 8)
    close("BANKINDIA roe_7y 6.07", c["roe_7y"] * 100, 6.07)
    rank("roe_7y", "BANKINDIA", 8)
    close("BANKINDIA roa_3y 0.83", c["roa_3y"] * 100, 0.83)
    rank("roa_3y", "BANKINDIA", 8)
    close("BANKINDIA np_consistency_10y 0.864", c["np_consistency_10y"], 0.864)
    rank("np_consistency_10y", "BANKINDIA", 8)
    close("BANKINDIA roe_excess_13_10y -11.95pp",
          c["roe_excess_13_10y"] * 100, -11.95)
    rank("roe_excess_13_10y", "BANKINDIA", 6)   # sixth-worst shortfall
    ck("BANKINDIA np_cagr_7y is NULL", c.get("np_cagr_7y") is None)
    q = (rows["BANKINDIA"].get("scorecard_coverage") or {})["pillars"]["quality"]
    close("BANKINDIA quality covered 95.68%", q["covered_weight"], 95.68)
    ck(f"BANKINDIA is the only row under 100% quality coverage",
       all((rows[s]["scorecard_coverage"]["pillars"]["quality"]
            ["covered_weight"]) == 100.0 for s in FIVE if s != "BANKINDIA"))
    close("BANKINDIA fii 3.88 five quarters ago",
          shq("BANKINDIA", "2025-03-31", "fii_pct"), 3.88)
    close("BANKINDIA fii 6.87 now",
          shq("BANKINDIA", "2026-06-30", "fii_pct"), 6.87)
    ck("BANKINDIA shareholders 726,167 -> 595,832",
       shq("BANKINDIA", "2025-03-31", "shareholders") == 726167
       and shq("BANKINDIA", "2026-06-30", "shareholders") == 595832)

    # -------------------------------------------------------------- INDIANB
    c = cm["INDIANB"]
    close("INDIANB np_consistency_10y 1.543", c["np_consistency_10y"], 1.543)
    rank("np_consistency_10y", "INDIANB", 1)
    close("INDIANB roe_excess_13_10y -3.62pp",
          c["roe_excess_13_10y"] * 100, -3.62)
    close("INDIANB book_value_cagr_10y 18.45",
          c["book_value_cagr_10y"] * 100, 18.45)
    rank("book_value_cagr_10y", "INDIANB", 2)
    close("INDIANB roa_3y 1.17", c["roa_3y"] * 100, 1.17)
    rank("roa_3y", "INDIANB", 2)
    close("INDIANB roe_7y 10.94", c["roe_7y"] * 100, 10.94)
    rank("roe_7y", "INDIANB", 3)
    close("INDIANB roe_3y 14.78", c["roe_3y"] * 100, 14.78)
    rank("roe_3y", "INDIANB", 5)
    close("INDIANB np_cagr_5y 29.65", c["np_cagr_5y"] * 100, 29.65)
    rank("np_cagr_5y", "INDIANB", 9)
    close("INDIANB sales_yoy_q 15.16", c["sales_yoy_q"] * 100, 15.16)
    rank("sales_yoy_q", "INDIANB", 3)
    # "the same pass rates as Bank of Baroda and weaker than the other three"
    for n in ("5y", "7y", "10y"):
        k = f"np_growth_above_inflation_{n}"
        close(f"INDIANB {k} equals BANKBARODA's", c[k], cm["BANKBARODA"][k],
              0.001)
        for other in ("MAHABANK", "BANKINDIA", "SBIN"):
            ck(f"INDIANB {k} below {other}'s ({c[k]:.4f} vs "
               f"{cm[other][k]:.4f})", c[k] < cm[other][k])
    close("INDIANB inflation 5y = 3 of 4",
          c["np_growth_above_inflation_5y"], 3 / 4, 0.001)
    close("INDIANB inflation 7y = 5 of 6",
          c["np_growth_above_inflation_7y"], 5 / 6, 0.001)
    close("INDIANB inflation 10y = 6 of 9",
          c["np_growth_above_inflation_10y"], 6 / 9, 0.001)
    close("INDIANB earnings_yield_trend -0.0227",
          c["earnings_yield_trend"], -0.0227, 0.0001)
    rank("earnings_yield_trend", "INDIANB", 11)
    neg5 = sorted(s for s in FIVE if cm[s]["earnings_yield_trend"] < 0)
    ck(f"INDIANB the only negative earnings_yield_trend of the five -- {neg5}",
       neg5 == ["INDIANB"])
    close("INDIANB pb 1.46", c["pb"], 1.455, 0.005)
    rank("pb", "INDIANB", 4)

    # ----------------------------------------------------------------- SBIN
    c = cm["SBIN"]
    ck(f"SBIN composite 33 -- {sc['SBIN'].get('composite_pct')}",
       sc["SBIN"].get("composite_pct") == 33)
    comp_order = sorted(s12, key=lambda s: -s12[s]["composite_pct"])
    ck(f"SBIN is ninth of twelve on composite -- "
       f"#{comp_order.index('SBIN') + 1}", comp_order.index("SBIN") + 1 == 9)
    ck(f"SBIN quality 64 -- {sc['SBIN'].get('quality_pct')}",
       sc["SBIN"].get("quality_pct") == 64)
    ck(f"SBIN valuation 21 -- {sc['SBIN'].get('valuation_pct')}",
       sc["SBIN"].get("valuation_pct") == 21)
    # Second of twelve on five separate horizons, behind MAHABANK every time.
    for key, val in (("roe_5y", 14.63), ("roe_7y", 12.74),
                     ("roe_excess_13_5y", 1.63), ("roe_excess_13_7y", -0.26),
                     ("roe_excess_13_10y", -4.17)):
        close(f"SBIN {key} {val}pp", c[key] * 100, val)
        rank(key, "SBIN", 2)
    for key in ("roe_5y", "roe_7y", "roe_excess_13_5y", "roe_excess_13_7y"):
        vals = {s: p12[s][key] for s in p12}
        ck(f"MAHABANK ahead of SBIN on {key}",
           max(vals, key=lambda s: vals[s]) == "MAHABANK")
    # roe_excess_13_10y is the one where the leader is INDIANB, not MAHABANK.
    ck("SBIN second on roe_excess_13_10y behind INDIANB",
       sorted(p12, key=lambda s: -p12[s]["roe_excess_13_10y"])[:2]
       == ["INDIANB", "SBIN"])
    close("SBIN pe_ttm 10.45", c["pe_ttm"], 10.448, 0.01)
    rank("pe_ttm", "SBIN", 1)                   # most expensive of twelve
    close("SBIN pb 1.51", c["pb"], 1.511, 0.005)
    rank("pb", "SBIN", 3)
    close("SBIN div_yield 1.78", c["div_yield"] * 100, 1.778)
    rank("div_yield", "SBIN", 10)               # tenth of the eleven paying
    close("SBIN np_cagr_5y 23.88", c["np_cagr_5y"] * 100, 23.88)
    rank("np_cagr_5y", "SBIN", 11)
    close("SBIN ttm_op_pct -0.01", c["ttm_op_pct"], -0.013, 0.005)
    nonpos = sorted(s for s in p12 if p12[s]["ttm_op_pct"] <= 0)
    ck(f"SBIN the only non-positive ttm_op_pct of twelve -- {nonpos}",
       nonpos == ["SBIN"])
    grew = [s for s in p12 if p12[s]["ttm_op_pct"] > 0]
    ck(f"ten peers grew operating profit -- {len(grew)}", len(grew) == 11)
    close("SBIN equity_to_assets 6.66", c["equity_to_assets"] * 100, 6.66)
    rank("equity_to_assets", "SBIN", 11)        # second-thinnest of twelve
    close("SBIN opm_now 45.02", c["opm_now"], 45.02, 0.01)
    rank("opm_now", "SBIN", 12, reverse=True)   # lowest of twelve
    second_lowest = sorted(p12, key=lambda s: p12[s]["opm_now"])[1]
    close(f"next-lowest opm_now is {second_lowest} at 60.29",
          p12[second_lowest]["opm_now"], 60.29, 0.01)
    close("cluster opm_now high 75.53",
          max(p12[s]["opm_now"] for s in p12), 75.53, 0.01)
    ck(f"SBIN shareholders 3,898,366 -- {c['shareholders']}",
       round(c["shareholders"]) == 3898366)
    rank("shareholders", "SBIN", 1)
    # "one of only two of the five whose holder count rose: up 71,817 here
    # against Indian Bank's 750, the other three down."
    #
    # The row first said SBIN was the ONLY one of the five that was rising.
    # INDIANB went 317,481 -> 318,231, so it rose too. This is the same error
    # the previous batch made — an unqualified "only" where a second member
    # moved the same way by a trivial amount — and it is the second time pass
    # 2 has caught that exact shape. The fix is to name the other one and give
    # both magnitudes, not to add the word "material" and move on.
    delta = {s: shq(s, "2026-06-30", "shareholders")
             - shq(s, "2025-03-31", "shareholders") for s in FIVE}
    up = sorted(s for s in FIVE if delta[s] > 0)
    ck(f"exactly SBIN and INDIANB rose -- {delta}", up == ["INDIANB", "SBIN"])
    ck(f"SBIN rose 71,817 -- {delta['SBIN']}", delta["SBIN"] == 71817)
    ck(f"INDIANB rose 750 -- {delta['INDIANB']}", delta["INDIANB"] == 750)
    ck(f"the other three fell -- {delta}",
       all(delta[s] < 0 for s in FIVE if s not in up))
    close("SBIN promoter_pct 55.47", c["promoter_pct"], 55.47)
    rank("promoter_pct", "SBIN", 12)            # least government-owned
    close("SBIN dii_pct 26.52", c["dii_pct"], 26.52)
    rank("dii_pct", "SBIN", 1)

    print(f"{CHECKS[0]} rank and ratio claims checked, {len(FAILS)} failed")
    for f in FAILS:
        print("  FAIL", f)
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
