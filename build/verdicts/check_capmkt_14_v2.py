"""Pass 2 for the capital-markets v2 batch — every rank and superlative claim
in the two **published** rows, restated as code and evaluated against the live
cluster data.

Pass 1 (`scripts/verdict-check.py`) only asks whether a number appears
somewhere in a symbol's own pack. It cannot see "second of the 37 brokers with
a PE", because that claim is about a peer set and the peer set lives outside
the pack. Every batch written so far has contained at least one wrong
superlative and this file is the only thing that finds them.

Two things are different from `check_capmkt_16.py`:

1. **The peer set is the real cluster, not the batch.** v1 confined every claim
   to a hand-picked 16 because `bfsi_nbfc` was useless as a comparison pool.
   v2 states ranks against `bfsi_broker` (43) and `bfsi_amc_wealth` (16), so
   this file loads `/tmp/capmkt_peers.json` and ranks within the cluster. A
   claim quoted against the batch would now be the error.

2. **Only CHOICEIN and PRIMESECU are checked**, because only those two are
   emitted — scope rule of 2026-10-22, verdicts for held and watched names
   only. The other twelve v2 texts still exist in the generator and still run
   its guards, but nothing published depends on their ranks, so verifying them
   would be work spent on prose no reader will see.

Every cohort size in the prose is checked as well as every rank. A rank that
is right against the wrong denominator is the failure mode that survives
casual reading: "fourth of 32" and "fourth of 41" look equally plausible on
the page and only one of them is true.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/check_capmkt_14_v2.py
"""

import json

PACK = "/tmp/capmkt14.json"
PEERS = "/tmp/capmkt_peers.json"

FAILS: list[str] = []
CHECKS = [0]


def main() -> None:
    pack = {d["symbol"]: d for d in json.load(open(PACK))["symbols"]}
    peers = json.load(open(PEERS))

    # cm[cluster][symbol] = cluster_metrics. Ranks are always computed inside
    # one cluster, because that is the pool the scorer percentiled against and
    # therefore the only pool a rank claim can honestly refer to.
    cm = {cl: {m["symbol"]: m["cm"] for m in members}
          for cl, members in peers.items()}
    sc = {cl: {m["symbol"]: m for m in members}
          for cl, members in peers.items()}

    def ck(label, cond):
        CHECKS[0] += 1
        if not cond:
            FAILS.append(label)

    def rank(cl, key, sym, n, count, reverse=True):
        """`sym` is the n-th name in `cl` by `key`, out of exactly `count`
        names carrying a reading. Both halves are asserted: the prose states
        both and a right rank on a wrong denominator still misleads."""
        v = {s: d[key] for s, d in cm[cl].items() if d.get(key) is not None}
        order = sorted(v, key=lambda s: v[s], reverse=reverse)
        got_n = order.index(sym) + 1 if sym in order else None
        ck(f"{sym}: {key} is #{n} of {count} (got #{got_n} of {len(v)})",
           got_n == n and len(v) == count)

    def close(label, a, b, tol=0.005):
        ck(label, a is not None and abs(a - b) <= tol)

    B, W = "bfsi_broker", "bfsi_amc_wealth"

    # ------------------------------------------------------------- CHOICEIN
    c = cm[B]["CHOICEIN"]

    # "first of the 32 brokers carrying the tests" on 5y and 7y, "second" on
    # 10y. The denominators are N-1 for inflation (each step needs two
    # points), so 1.000 on 5y means 4 of 4 — asserted below, not assumed.
    rank(B, "np_growth_above_inflation_5y", "CHOICEIN", 1, 32)
    rank(B, "np_growth_above_inflation_7y", "CHOICEIN", 1, 32)
    rank(B, "np_growth_above_inflation_10y", "CHOICEIN", 2, 32)
    close("CHOICEIN: inflation 5y is 4 of 4",
          c["np_growth_above_inflation_5y"] * 4, 4, 0.02)
    close("CHOICEIN: inflation 7y is 6 of 6",
          c["np_growth_above_inflation_7y"] * 6, 6, 0.02)
    close("CHOICEIN: inflation 10y is 8 of 9",
          c["np_growth_above_inflation_10y"] * 9, 8, 0.02)

    # The prose says it *shares* the 5y and 7y top spot with SBIFUNDS and is
    # therefore alone among genuine brokers. A tie is the claim; if SBIFUNDS
    # were strictly higher the sentence would be wrong in the other direction.
    for w in ("5y", "7y"):
        k = f"np_growth_above_inflation_{w}"
        ck(f"CHOICEIN: ties SBIFUNDS on {k}, and nobody else is above",
           abs(cm[B]["SBIFUNDS"][k] - c[k]) < 1e-9
           and max(d[k] for d in cm[B].values() if d.get(k) is not None) == c[k])
    ck("CHOICEIN: alone at the top once SBIFUNDS is set aside",
       all(d["np_growth_above_inflation_5y"] < c["np_growth_above_inflation_5y"]
           for s, d in cm[B].items()
           if s not in ("CHOICEIN", "SBIFUNDS")
           and d.get("np_growth_above_inflation_5y") is not None))

    rank(B, "np_cagr_5y", "CHOICEIN", 4, 33)
    rank(B, "roe_3y", "CHOICEIN", 16, 43)
    rank(B, "roce_3y", "CHOICEIN", 16, 43)
    rank(B, "pe_ttm", "CHOICEIN", 2, 37)
    rank(B, "pb", "CHOICEIN", 5, 43)
    rank(B, "fii_pct", "CHOICEIN", 5, 36)
    rank(B, "pct_above_200ema_252d", "CHOICEIN", 4, 32)
    # cfo_pat_3y: nine names sit at exactly 0.000, spanning positions 34-42 of
    # 42. The first draft said "37th of 42", which is what the stored sort
    # order happens to return — but any of 34-42 is equally true of a tied
    # value, so the number was fake precision. The prose now states the tie
    # block and this asserts the block, not an index inside it.
    cf = {s: d["cfo_pat_3y"] for s, d in cm[B].items()
          if d.get("cfo_pat_3y") is not None}
    zeros = [s for s, v in cf.items() if v == 0.0]
    ck("CHOICEIN: cfo_pat_3y at the floor, bottom nine of 42 all tied",
       len(cf) == 42 and len(zeros) == 9 and "CHOICEIN" in zeros
       and sorted(cf.values(), reverse=True).index(0.0) + 1 == 34)

    ck("CHOICEIN: pe_ttm second behind AVONMORE",
       cm[B]["AVONMORE"]["pe_ttm"] > c["pe_ttm"]
       and all(d["pe_ttm"] <= c["pe_ttm"] for s, d in cm[B].items()
               if s not in ("CHOICEIN", "AVONMORE")
               and d.get("pe_ttm") is not None))
    close("CHOICEIN: 71.00x", c["pe_ttm"], 71.00, 0.005)
    close("CHOICEIN: AVONMORE 95.58x", cm[B]["AVONMORE"]["pe_ttm"], 95.58, 0.005)
    close("CHOICEIN: pb 9.68x", c["pb"], 9.68, 0.005)
    close("CHOICEIN: +1.91pp margin step", c["opm_now"] - c["opm_prev"], 1.91, 0.01)
    close("CHOICEIN: roe_3y 16.33%", c["roe_3y"] * 100, 16.33, 0.005)
    close("CHOICEIN: roce_3y 17.65%", c["roce_3y"] * 100, 17.65, 0.005)
    close("CHOICEIN: fii_pct 10.10%", c["fii_pct"], 10.10, 0.005)
    close("CHOICEIN: above-EMA 63.10%",
          c["pct_above_200ema_252d"] * 100, 63.10, 0.005)
    close("CHOICEIN: np_cagr_5y 41.97%", c["np_cagr_5y"] * 100, 41.97, 0.005)

    # "its ten-year band low of 1.82x cannot be told apart from a split
    # adjustment" — the claim is that the low exists and is impossibly small,
    # not that the band is absent.
    band = pack["CHOICEIN"].get("pe_band") or {}
    close("CHOICEIN: band low 1.82x", band.get("lo"), 1.82, 0.005)
    ck("CHOICEIN: band built on ten years", band.get("n") == 10)

    # "the largest of the 14 capital-markets names re-peered" — market cap,
    # measured across the batch, which is the one place the batch is still the
    # right pool because the sentence is about the re-peering itself.
    mc = {s: (d.get("identity") or {}).get("market_cap")
          or (d.get("metrics") or {}).get("market_cap")
          for s, d in pack.items()}
    mc = {s: v for s, v in mc.items() if v is not None}
    # The first draft called CHOICEIN the largest of the 14. It is second:
    # CRISIL is ₹33,243cr against ₹16,186cr. This is exactly the class of
    # sentence pass 1 cannot see — both numbers are in the pack, and the
    # ordering claim between them is not.
    order = sorted(mc, key=mc.get, reverse=True)
    ck(f"CHOICEIN: second-largest of the 14, behind CRISIL ({len(mc)})",
       len(mc) == 14 and order[0] == "CRISIL" and order[1] == "CHOICEIN")
    close("CHOICEIN: ₹16,186cr", mc["CHOICEIN"], 16185.81, 0.5)
    close("CRISIL: ₹33,243cr", mc["CRISIL"], 33242.70, 0.5)

    # "Twelve of those 14 rows carry a margin-step or earnings-quality
    # blocker". The first draft said nine and counted nothing — the blocker
    # list also carries thin-history and missing-data flags, which are not
    # what the sentence claims, so the predicate has to match the prose.
    nblock = sum(
        1 for d in pack.values()
        if any("earnings quality" in str(b).lower()
               or "margin step" in str(b).lower()
               for b in (d.get("blockers") or [])))
    ck(f"CHOICEIN: twelve of the 14 carry one (got {nblock})", nblock == 12)

    # ------------------------------------------------------------ PRIMESECU
    p = cm[W]["PRIMESECU"]

    # Four simultaneous last places, each against the full 16. "lowest of all
    # 16" is a strong form: it asserts the cohort is complete, so a missing
    # reading anywhere would make the sentence false rather than merely thin.
    # reverse=False sorts ascending, so "lowest" is position 1 in that
    # ordering, not 16. The prose claim is "lowest of all 16"; asserting #16
    # against an ascending sort was the checker misreading its own argument.
    for k in ("opm_now", "ttm_np_pct", "ttm_op_pct", "np_yoy_q"):
        rank(W, k, "PRIMESECU", 1, 16, reverse=False)
    close("PRIMESECU: opm_now 10.22%", p["opm_now"], 10.22, 0.005)
    close("PRIMESECU: ttm_np_pct -87.29%", p["ttm_np_pct"], -87.29, 0.005)
    close("PRIMESECU: ttm_op_pct -72.08%", p["ttm_op_pct"], -72.08, 0.005)
    close("PRIMESECU: np_yoy_q -80.82%", p["np_yoy_q"] * 100, -80.82, 0.005)
    close("PRIMESECU: -31.63pp margin step",
          p["opm_now"] - p["opm_prev"], -31.63, 0.01)

    # "the largest single-year margin break of the 14 re-peered names" — this
    # one genuinely is a batch claim, so it is measured across the batch and
    # across both clusters the batch landed in.
    steps = {}
    for cl in cm:
        for s, d in cm[cl].items():
            if s in pack and d.get("opm_now") is not None \
                    and d.get("opm_prev") is not None:
                steps[s] = d["opm_now"] - d["opm_prev"]
    ck(f"PRIMESECU: largest negative margin step of the 14 ({len(steps)})",
       min(steps, key=steps.get) == "PRIMESECU")

    rank(W, "roe_avg_above_threshold_10y", "PRIMESECU", 4, 9)
    rank(W, "np_consistency_10y", "PRIMESECU", 6, 9)
    rank(W, "pct_above_200ema_252d", "PRIMESECU", 5, 11)
    rank(W, "ret_12m_rel", "PRIMESECU", 6, 12)
    # 0.500 is five of ten: a LEVEL test, denominator N, not N-1.
    close("PRIMESECU: hurdle 10y is 5 of 10",
          p["roe_avg_above_threshold_10y"] * 10, 5, 0.02)
    close("PRIMESECU: np_consistency_10y 1.657",
          p["np_consistency_10y"], 1.657, 0.0005)
    close("PRIMESECU: above-EMA 74.21%",
          p["pct_above_200ema_252d"] * 100, 74.21, 0.005)
    close("PRIMESECU: ret_12m_rel +2.80%", p["ret_12m_rel"] * 100, 2.80, 0.005)

    # "There is no pe_ttm at all" — an absence claim, so it gets the §4
    # control: the same key must be readable on a peer, or the lookup is
    # broken rather than the data missing.
    ck("PRIMESECU: no pe_ttm, and the key resolves on a peer",
       p.get("pe_ttm") is None and cm[W]["HDFCAMC"].get("pe_ttm") is not None)

    # Its own band is quotable but unusable: quoted, so it must match.
    pb_ = pack["PRIMESECU"].get("pe_band") or {}
    close("PRIMESECU: band 7.00-59.23x", pb_.get("lo"), 7.00, 0.005)
    close("PRIMESECU: band high 59.23x", pb_.get("hi"), 59.23, 0.005)
    close("PRIMESECU: band average 21.04x", pb_.get("avg"), 21.04, 0.005)

    # Pillars quoted in point one.
    s = sc[W]["PRIMESECU"]
    ck("PRIMESECU: pillars 27/55/41/15",
       (s["q"], s["v"], s["mo"], s["c"]) == (27, 55, 41, 15))
    comp = {sy: sc[cl][sy]["c"] for cl in sc for sy in sc[cl]
            if sy in pack and sc[cl][sy].get("c") is not None}
    ck(f"PRIMESECU: lowest composite of the 14 ({len(comp)} readings)",
       len(comp) == 14 and min(comp, key=comp.get) == "PRIMESECU")

    # "down from 61 before the re-peering" is the one claim neither pass can
    # trace: 61 is a prior snapshot, so it is in neither the pack nor the peer
    # file. Measured once and recorded here rather than left floating —
    #   select snapshot_date, cluster_id, composite_pct from app.scores
    #   where symbol = 'PRIMESECU' order by snapshot_date desc limit 2;
    # returned 2026-10-21 bfsi_amc_wealth 15, and 2026-10-08 bfsi_nbfc 61.
    PRIOR = {"snapshot": "2026-10-08", "cluster": "bfsi_nbfc",
             "q": 72, "v": 18, "mo": 47, "c": 61}
    ck("PRIMESECU: prior composite 61 recorded from 2026-10-08 bfsi_nbfc",
       PRIOR["c"] == 61 and PRIOR["cluster"] == "bfsi_nbfc")
    ck("PRIMESECU: the drop in the prose is 61 -> 15",
       PRIOR["c"] - s["c"] == 46 and s["c"] == 15)

    ch = sc[B]["CHOICEIN"]
    ck("CHOICEIN: pillars 59/19/57/32",
       (ch["q"], ch["v"], ch["mo"], ch["c"]) == (59, 19, 57, 32))

    # Both rows carry the mixed-tier sentence only if the badge is real.
    ck("PRIMESECU: badged partial-cluster-mixed-tiers",
       s["status"] == "partial-cluster-mixed-tiers")
    ck("CHOICEIN: not badged mixed-tiers",
       ch["status"] != "partial-cluster-mixed-tiers")

    print(f"{CHECKS[0]} rank claims checked, {len(FAILS)} failed")
    for f in FAILS:
        print(f"  FAIL {f}")
    if FAILS:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
