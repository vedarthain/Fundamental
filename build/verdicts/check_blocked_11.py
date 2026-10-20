"""Pass-2 analogue for no-verdict rows.

A normal batch's pass 2 checks rank and superlative claims. A no-verdict row
makes almost no ranking claims; its load-bearing claims are of a different
kind, and they are the ones that would embarrass us if wrong:

  ABSENT  -- a field named in <code> tags inside the points is claimed to be
             NULL, unless it appears in QUOTED below, in which case the row
             quotes its value instead. If a field claimed NULL actually
             resolves, the row tells the reader data is missing when it is
             there -- worse than a wrong rank, because it suppresses a verdict
             that could have been written.
  PRESENT -- every figure quoted as legible resolves, at the value quoted.

Two unit conventions in the pack, both of which have already produced false
failures in this checker and must stay explicit rather than be papered over
with a loose tolerance:
  * ratio metrics (roce_*, op_margin_3y, *_cagr_*, fcf_yield, returns,
    pct_above_200ema, *_yoy_q) are stored as FRACTIONS; the prose quotes them
    as percent, so the claim is compared against value * 100.
  * opm_now / opm_prev / ttm_*_pct are already percent.
And the margin-trend figures are not in `metrics` at all -- they live in
scorecard_coverage.pillars[*].values as op_margin_trend_3y / _5y / _7y.
"""
import json, re, sys

PACK = "build/verdicts/auto-blocked-11.json"
VERD = "build/verdicts/auto-blocked-11-verdicts.json"

P = {r["symbol"]: r for r in json.load(open(PACK))["symbols"]}
V = {r["symbol"]: r for r in json.load(open(VERD))}

fails, checks = [], 0

PCT = {
    "roce_3y", "roce_5y", "roce_7y", "roce_10y", "op_margin_3y", "op_margin_5y",
    "rev_cagr_3y", "rev_cagr_5y", "rev_cagr_7y", "np_cagr_3y", "np_cagr_5y",
    "fcf_yield", "div_yield", "ret_1m_rel", "ret_3m_rel", "ret_6m_rel",
    "ret_12m_rel", "pct_above_200ema_252d", "sales_yoy_q", "np_yoy_q",
    "roe_3y", "roe_5y", "roe_7y",
}


def A(label, ok):
    global checks
    checks += 1
    if not ok:
        fails.append(label)


def cov_values(sym):
    out = {}
    for pil in ((P[sym].get("scorecard_coverage") or {}).get("pillars") or {}).values():
        out.update(pil.get("values") or {})
    return out


def cov_weight(sym, pillar):
    pil = ((P[sym].get("scorecard_coverage") or {}).get("pillars") or {}).get(pillar) or {}
    return pil.get("covered_weight")


def val(sym, key):
    """The value the row is quoting: cluster_metrics, then metrics, then coverage."""
    d = P[sym]["metrics"]["cluster_metrics"] or {}
    if d.get(key) is not None:
        return d[key]
    m = P[sym]["metrics"] or {}
    if m.get(key) is not None:
        return m[key]
    c = cov_values(sym)
    if key in c:
        return c[key]
    if key in d or key in m:
        return None
    return "__nokey__"


def near(a, b, tol=0.02):
    if a is None or a == "__nokey__":
        return False
    try:
        return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(b)))
    except (TypeError, ValueError):
        return False


def claim(sym, key, want, tol=0.02):
    got = val(sym, key)
    cmp_ = got
    if key in PCT and isinstance(got, (int, float)):
        cmp_ = got * 100.0
    A(f"{sym} {key} = {want} (reads {got}{' x100' if cmp_ is not got else ''})",
      near(cmp_, want, tol))


# ---------------------------------------------------------------- ABSENT scan
# Fields named in <code> that the points QUOTE rather than claim missing.
QUOTED = {
    "BIKEWO": {"ret_12m_rel", "ret_6m_rel"},
    "EBIX": {"rev_cagr_3y", "ttm_op_pct"},
    "MERCURYEV": {"pe_ttm", "cfo_pat_3y"},
    "TIL": {"cfo_pat_3y"},
}
for sym, row in V.items():
    named = set()
    for pt in row["points"]:
        named |= set(re.findall(r"<code>([a-z0-9_]+)</code>", pt))
    for key in sorted(named - QUOTED.get(sym, set())):
        v = val(sym, key)
        if v == "__nokey__":
            A(f"{sym}: <code>{key}</code> is not a field in the pack at all", False)
        else:
            A(f"{sym}: <code>{key}</code> claimed NULL but reads {v}", v is None)

# --------------------------------------------------------------- PRESENT claims
for sym, want in [
    ("AMBAAUTO", 199), ("ATHERENERG", 55766), ("BIKEWO", 159), ("DELTIC", 55),
    ("EBIX", 362), ("GURUNANAK", 40), ("MERCURYEV", 704), ("OLAELEC", 17162),
    ("TIL", 2064), ("TUNWAL", 149), ("VICTORYEV", 33),
]:
    got = (P[sym]["metrics"] or {}).get("market_cap")
    A(f"{sym} market_cap ~{want}cr (reads {got})", near(got, want, 0.02))

caps = {s: P[s]["metrics"]["market_cap"] for s in V}
A(f"VICTORYEV smallest of the eleven (actual: {min(caps,key=caps.get)})",
  min(caps, key=caps.get) == "VICTORYEV")

comp = {s: c for s in V if (c := (P[s].get("scores") or {}).get("composite_pct")) is not None}
A(f"TIL lowest composite_pct of the nine that have one (actual: {min(comp,key=comp.get)})",
  min(comp, key=comp.get) == "TIL")
A(f"OLAELEC second-lowest composite_pct (actual order: {sorted(comp,key=comp.get)[:3]})",
  sorted(comp, key=comp.get)[1] == "OLAELEC")

for args in [
    ("AMBAAUTO", "roce_3y", 23.0, 0.05),
    ("ATHERENERG", "opm_prev", -23.11, 0.02),
    ("ATHERENERG", "opm_now", -7.24, 0.02),
    ("ATHERENERG", "roce_5y", -70.57, 0.02),
    ("ATHERENERG", "rev_cagr_5y", 73.15, 0.02),
    ("BIKEWO", "ret_12m_rel", 606.6, 0.02),
    ("BIKEWO", "ret_6m_rel", 598.6, 0.02),
    ("BIKEWO", "roce_3y", 8.07, 0.02),
    ("BIKEWO", "cfo_pat_3y", 1.0, 0.02),
    ("DELTIC", "pb", 0.685, 0.02),
    ("DELTIC", "roce_3y", 22.91, 0.02),
    ("DELTIC", "op_margin_trend_3y", -0.0349, 0.05),
    ("EBIX", "rev_cagr_3y", 3767.3, 0.02),  # prose quotes both the raw 37.67 and the 3,767%
    ("EBIX", "ev_ebitda_ttm", 4.653, 0.02),
    ("EBIX", "ev_sales_ttm", 0.490, 0.02),
    ("EBIX", "roce_3y", -0.68, 0.05),
    ("EBIX", "ttm_op_pct", 2934.9, 0.02),
    ("EBIX", "opm_now", 4.1331, 0.02),
    ("EBIX", "opm_prev", 0.2242, 0.02),
    ("EBIX", "op_margin_trend_3y", -0.1296, 0.05),
    ("EBIX", "promoter_pct", 42.70, 0.01),
    ("GURUNANAK", "pb", 0.852, 0.02),
    ("GURUNANAK", "roce_3y", 33.52, 0.02),
    ("GURUNANAK", "debt_equity", 0.0441, 0.05),
    ("GURUNANAK", "op_margin_3y", 19.23, 0.02),
    ("GURUNANAK", "op_margin_trend_3y", 0.0518, 0.05),
    ("GURUNANAK", "fcf_yield", -5.52, 0.02),
    ("GURUNANAK", "rev_cagr_3y", -2.43, 0.05),
    ("MERCURYEV", "pe_ttm", 180.52, 0.02),
    ("MERCURYEV", "ev_ebitda_ttm", 252.45, 0.02),
    ("MERCURYEV", "cfo_pat_3y", 0.0, 0.02),
    ("MERCURYEV", "ttm_np_pct", -47.59, 0.02),
    ("MERCURYEV", "ttm_op_pct", -32.44, 0.02),
    ("MERCURYEV", "ttm_sales_pct", 4.21, 0.02),
    ("MERCURYEV", "opm_now", 5.59, 0.02),
    ("MERCURYEV", "opm_prev", 8.62, 0.02),
    ("MERCURYEV", "op_margin_3y", 9.17, 0.02),
    ("MERCURYEV", "op_margin_trend_3y", -0.0405, 0.05),
    ("MERCURYEV", "roce_3y", 3.06, 0.02),
    ("MERCURYEV", "promoter_pct", 59.17, 0.01),
    ("MERCURYEV", "shareholders", 75062, 0.01),
    ("OLAELEC", "op_margin_3y", -35.70, 0.02),
    ("OLAELEC", "opm_now", -48.94, 0.02),
    ("OLAELEC", "opm_prev", -47.89, 0.02),
    ("OLAELEC", "ev_sales_ttm", 12.77, 0.02),
    ("OLAELEC", "ttm_sales_pct", -49.16, 0.02),
    ("OLAELEC", "sales_yoy_q", -45.05, 0.02),
    ("OLAELEC", "op_margin_trend_3y", -0.0907, 0.05),
    ("OLAELEC", "fcf_yield", -11.50, 0.02),
    ("OLAELEC", "debt_equity", 0.825, 0.02),
    ("OLAELEC", "roce_3y", -25.18, 0.02),
    ("OLAELEC", "pb", 5.12, 0.02),
    ("OLAELEC", "asset_turnover", 0.289, 0.02),
    ("OLAELEC", "ret_12m_rel", -36.2, 0.02),
    ("OLAELEC", "pct_above_200ema_252d", 15.1, 0.05),
    ("OLAELEC", "rev_cagr_3y", -32.94, 0.02),
    ("TIL", "roce_5y", -22.30, 0.02),
    ("TIL", "roce_3y", 40.13, 0.02),
    ("TIL", "op_margin_3y", -35.14, 0.02),
    ("TIL", "cfo_pat_3y", 0.0, 0.02),
    ("TIL", "debt_equity", 3.444, 0.02),
    ("TIL", "pb", 18.59, 0.02),
    ("TUNWAL", "roce_5y", 22.75, 0.02),
    ("TUNWAL", "rev_cagr_5y", 38.59, 0.02),
    ("TUNWAL", "cfo_pat_3y", 0.24, 0.05),
    ("TUNWAL", "fcf_yield", -16.50, 0.02),
    ("TUNWAL", "pb", 1.188, 0.02),
    ("VICTORYEV", "roce_3y", 29.38, 0.02),
    ("VICTORYEV", "pb", 0.692, 0.02),
    ("VICTORYEV", "rev_cagr_3y", -18.41, 0.02),
    ("VICTORYEV", "np_cagr_3y", -33.69, 0.02),
]:
    claim(*args)

# ------------------------------------------------- the two AVOID rows' P&L case
# These two rows drop the no-verdict label on the strength of the annual series,
# so the series is checked line by line rather than quoted from memory.
def ann(sym, field):
    return [a.get(field) for a in (P[sym].get("annual") or [])]

ola_op = ann("OLAELEC", "operating_profit")
A(f"OLAELEC operating_profit negative in every annual row (reads {ola_op})",
  len(ola_op) == 6 and all(v is not None and v < 0 for v in ola_op))
for i, want in enumerate([-277, -800, -1252, -1266, -1735, -978]):
    A(f"OLAELEC operating_profit[{i}] ~{want} (reads {ola_op[i]})", near(ola_op[i], want, 0.01))
ola_sales = ann("OLAELEC", "sales")
for i, want in [(2, 2631), (3, 5010), (4, 4514), (5, 2253)]:
    A(f"OLAELEC sales[{i}] ~{want} (reads {ola_sales[i]})", near(ola_sales[i], want, 0.01))
A(f"OLAELEC latest net_profit ~-1833 (reads {ann('OLAELEC','net_profit')[-1]})",
  near(ann("OLAELEC", "net_profit")[-1], -1833, 0.01))
A(f"OLAELEC latest interest ~360 (reads {ann('OLAELEC','interest')[-1]})",
  near(ann("OLAELEC", "interest")[-1], 360, 0.01))
sh = P["OLAELEC"]["shareholding"]
A(f"OLAELEC promoter_pct fell 36.78 -> 32.96 over four quarters (reads {[r['promoter_pct'] for r in sh[:4]]})",
  near(sh[0]["promoter_pct"], 32.96, 0.001) and near(sh[3]["promoter_pct"], 36.78, 0.001))

til_op, til_int = ann("TIL", "operating_profit"), ann("TIL", "interest")
A(f"TIL latest operating_profit ~5.7 (reads {til_op[-1]})", near(til_op[-1], 5.72, 0.02))
A(f"TIL latest interest ~47.4 (reads {til_int[-1]})", near(til_int[-1], 47.44, 0.01))
A(f"TIL latest net_profit ~-30.8 (reads {ann('TIL','net_profit')[-1]})",
  near(ann("TIL", "net_profit")[-1], -30.77, 0.01))
below = [o < i for o, i in zip(til_op, til_int)]
A(f"TIL operating_profit below interest in each of the last 7 years, and not the 3 before "
  f"(reads {below})", below[-7:] == [True] * 7 and below[:3] == [False] * 3)
A(f"TIL has 10 annual rows (reads {len(til_op)})", len(til_op) == 10)
oneoff = [(o, n) for o, n in zip(til_op, ann("TIL", "net_profit"))
          if o is not None and n is not None and o < 0 < n]
A(f"TIL has exactly one year of positive net profit on negative operating profit, "
  f"at -74.6/+253.9 (reads {oneoff})",
  len(oneoff) == 1 and near(oneoff[0][0], -74.58, 0.01) and near(oneoff[0][1], 253.9, 0.01))
tsh = P["TIL"]["shareholding"]
A(f"TIL promoter_pct fell 70.12 -> 61.30 (reads {[r['promoter_pct'] for r in tsh[:5]]})",
  near(tsh[0]["promoter_pct"], 61.30, 0.001) and 70.12 in [r["promoter_pct"] for r in tsh[:5]])
A(f"TIL FY2026 cash conversion -15.46 (reads {(P['TIL'].get('earnings_quality') or {}).get('cfo_op_latest')})",
  near((P["TIL"].get("earnings_quality") or {}).get("cfo_op_latest"), -15.46, 0.01))

# Both AVOID rows must actually be labelled AVOID, and nothing else may be.
avoid = sorted(s for s in V if V[s]["verdict"].startswith("AVOID"))
A(f"exactly OLAELEC and TIL are AVOID (actual: {avoid})", avoid == ["OLAELEC", "TIL"])
A("every row is confidence=low", all(r["confidence"] == "low" for r in V.values()))

# PE bands
for sym, n, lo, hi, avg in [
    ("MERCURYEV", 4, 2.69, 705.54, 255.24),
    ("TIL", None, 1.11, 536.38, None),
]:
    b = P[sym].get("pe_band") or {}
    A(f"{sym} pe_band lo {lo} (reads {b.get('lo')})", near(b.get("lo"), lo, 0.02))
    A(f"{sym} pe_band hi {hi} (reads {b.get('hi')})", near(b.get("hi"), hi, 0.02))
    if n is not None:
        A(f"{sym} pe_band n {n} (reads {b.get('n')})", b.get("n") == n)
    if avg is not None:
        A(f"{sym} pe_band avg {avg} (reads {b.get('avg')})", near(b.get("avg"), avg, 0.02))

withband = sorted(s for s in V if (P[s].get("pe_band") or {}).get("lo") is not None)
A(f"only MERCURYEV and TIL have a pe_band (actual: {withband})",
  withband == ["MERCURYEV", "TIL"])

# Percentiles quoted in prose
for sym, key, want in [
    ("BIKEWO", "composite_pct", 85), ("BIKEWO", "momentum_pct", 97),
    ("ATHERENERG", "valuation_pct", 3),
    ("EBIX", "valuation_pct", 91),
    ("GURUNANAK", "composite_pct", 75), ("GURUNANAK", "quality_pct", 73),
    ("GURUNANAK", "valuation_pct", 59), ("GURUNANAK", "momentum_pct", 47),
    ("OLAELEC", "composite_pct", 15), ("OLAELEC", "quality_pct", 12),
    ("OLAELEC", "valuation_pct", 24), ("OLAELEC", "momentum_pct", 28),
    ("TIL", "composite_pct", 6),
]:
    got = (P[sym].get("scores") or {}).get(key)
    A(f"{sym} {key} = {want} (reads {got})", got == want)

# Covered pillar weight, quoted in prose as "scored on N of its 100 points"
for sym, pillar, want in [
    ("AMBAAUTO", "valuation", 22),
    ("ATHERENERG", "valuation", 0),
    ("DELTIC", "valuation", 12),
    ("EBIX", "valuation", 25),
    ("GURUNANAK", "valuation", 22), ("GURUNANAK", "momentum", 30),
    ("MERCURYEV", "valuation", 73), ("MERCURYEV", "quality", 84),
    ("OLAELEC", "valuation", 22), ("OLAELEC", "quality", 82),
]:
    got = cov_weight(sym, pillar)
    A(f"{sym} {pillar} covered_weight {want} (reads {got})", near(got, want, 0.01) or got == want)

# Suppressed composites
for sym, pillar in [("AMBAAUTO", "m"), ("DELTIC", "v")]:
    sc = P[sym].get("scores") or {}
    A(f"{sym} composite_pct suppressed (reads {sc.get('composite_pct')})",
      sc.get("composite_pct") is None)
    A(f"{sym} missing_pillars contains '{pillar}' (reads {sc.get('missing_pillars')})",
      pillar in (sc.get("missing_pillars") or ""))

# Price-bar counts quoted in prose
for sym, want in [("AMBAAUTO", 109), ("DELTIC", 427), ("EBIX", 39),
                  ("GURUNANAK", 230), ("MERCURYEV", 93)]:
    got = (P[sym].get("technicals") or {}).get("bars")
    A(f"{sym} price bars {want} (reads {got})", got == want)

# Zero usable quarters where claimed
for sym in ["AMBAAUTO", "BIKEWO", "GURUNANAK", "TUNWAL"]:
    q = P[sym].get("quarterly") or []
    A(f"{sym} 0 usable quarters (reads {len(q)})", len(q) == 0)

print(f"{checks} checks, {len(fails)} failed")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
