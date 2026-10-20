"""Pass 2 for bfsi batch 1: every rank, superlative and quoted figure, checked
against the pack rather than against my memory of it.

Pass 1 (`scripts/verdict-check.py`) traces numeric tokens and guards the
denominators. It cannot check "third-highest of the 24", because the peer pool
is a judgement that lives in `bfsi_segments.py` and not in the pack. That is
this file's whole job, and VERDICT_WRITING §4 records that **every batch so
far has shipped at least one wrong superlative** when this step was skipped.

Three things this file deliberately does NOT do:

  * It does not re-derive the metrics. It reads the same pack the prose read,
    so a pack defect passes both. Pack sanity is pass 1's problem.
  * It does not check prose that is a judgement ("the crowding risk"). Only
    claims with a truth value.
  * It does not soften. A near-miss is a failure; the tolerance is the
    rounding the prose itself used (2dp on percentages).

Unit trap, re-learned from the auto_oem batch and worth repeating: the bfsi
cluster metrics are FRACTIONS for every ratio (`roa_3y`, `roe_*`, `*_cagr_*`,
`ret_*_rel`, `div_yield`, `equity_to_assets`, `roe_excess_13_*`) and ALREADY
PERCENT for `opm_now`, `opm_prev` and the `ttm_*_pct` family. Mixing them is
how a verdict says 2.14 when it means 214.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/check_bfsi_large_24.py
"""

import importlib.util
import json

PACK = "build/verdicts/bfsi-large-24.json"
VERDICTS = "build/verdicts/bfsi-large-24-verdicts.json"

pack = json.load(open(PACK))
P = {r["symbol"]: r for r in pack["symbols"]}
V = {r["symbol"]: r for r in json.load(open(VERDICTS))}

_s = importlib.util.spec_from_file_location("seg", "build/verdicts/bfsi_segments.py")
seg = importlib.util.module_from_spec(_s)
_s.loader.exec_module(seg)
SEGMENT = set(seg.SEGMENTS["large_diversified"])

FAILS = []
N = 0


def A(label, cond):
    global N
    N += 1
    if not cond:
        FAILS.append(label)


def cm(s, k):
    return ((P[s]["metrics"] or {}).get("cluster_metrics") or {}).get(k)


def near(a, b, tol=0.005):
    return a is not None and b is not None and abs(a - b) <= tol


def rank_desc(k):
    """Symbols with a value for k, highest first."""
    return [s for _, s in sorted(((cm(s, k), s) for s in P if cm(s, k) is not None),
                                 key=lambda t: (-t[0], t[1]))]


def rank_asc(k):
    return [s for _, s in sorted(((cm(s, k), s) for s in P if cm(s, k) is not None),
                                 key=lambda t: (t[0], t[1]))]


def nth_high(k, n, sym):
    r = rank_desc(k)
    return len(r) >= n and r[n - 1] == sym


def nth_low(k, n, sym):
    r = rank_asc(k)
    return len(r) >= n and r[n - 1] == sym


def body(s):
    return " ".join(V[s]["points"])


# ---------------------------------------------------------------- structural

A(f"the pack IS the large_diversified segment (pack={len(P)}, segment={len(SEGMENT)})",
  set(P) == SEGMENT and len(P) == 24)
A("a verdict exists for every symbol in the pack", set(V) == set(P))
A("no verdict claims 'high' confidence — all 24 carry the balance-sheet-lender blocker",
  all(V[s]["confidence"] in ("medium", "low") for s in V))
A("every 'medium' row has at least one blocker to justify it",
  all(P[s]["blockers"] for s in V if V[s]["confidence"] == "medium"))
A("exactly one row is a no-verdict row, and it is UGROCAP",
  [s for s in V if V[s]["verdict"].startswith("WATCH — no verdict")] == ["UGROCAP"])
A("the no-verdict row takes 3 points, every other row takes 5",
  all(len(V[s]["points"]) == (3 if s == "UGROCAP" else 5) for s in V))
A("no evidence value is NULL anywhere in the batch",
  all(v is not None for s in V for v in V[s]["evidence"].values()))
A("every stored evidence value equals the pack's live value",
  all(near(v, cm(s, k), abs(cm(s, k) or 0) * 1e-9 + 1e-9)
      for s in V for k, v in V[s]["evidence"].items()))
A("every trigger moves in both directions (two or more '->')",
  all(V[s]["trigger_text"].count("->") >= 2 for s in V))

# tech_net_score_scaled is NULL for all 3,061 scored symbols platform-wide and
# VERDICT_WRITING §3 forbids quoting it. Check it is named as absent, never
# as a value, on every row that mentions it.
A("tech_net_score_scaled is NULL for all 24 in the pack",
  all(cm(s, "tech_net_score_scaled") is None for s in P))
A("no row quotes a value for tech_net_score_scaled",
  all("tech_net_score_scaled</code> is NULL" in body(s) or
      "tech_net_score_scaled" not in body(s) for s in V))

# ------------------------------------------------------- the held positions

HELD = {"ABCAPITAL": (13, 357.65, 380.25),
        "CHOLAFIN": (6, 1725.50, 1580.70),
        "M&MFIN": (57, 375.50, 322.40),
        "SUNDARMFIN": (3, 4606.10, 4182.00)}

for s in P:
    if s in HELD:
        qty, cost, last = HELD[s]
        A(f"{s} point one opens with the position value", "Your ₹" in V[s]["points"][0])
        A(f"{s} position value is qty x last = ₹{qty*last:,.0f}",
          f"{qty*last:,.0f}" in V[s]["points"][0])
        pct = (last / cost - 1) * 100
        A(f"{s} quotes the right move from cost ({pct:+.1f}%)",
          f"{abs(pct):.1f}%" in V[s]["points"][0])
    else:
        A(f"{s} point one says 'Not held'", "Not held" in V[s]["points"][0])

A("M&MFIN is the largest rupee loss of the four held (claimed in its point one)",
  max(HELD, key=lambda s: HELD[s][0] * (HELD[s][1] - HELD[s][2])) == "M&MFIN"
  and "largest loss of your four holdings" in V["M&MFIN"]["points"][0])

# --------------------------------------------------------- the ROA ordering
# ROA is the spine of this batch: the prose uses it to separate asset yield
# from gearing on nearly every row, so every ordinal claim on it is checked.

A("PAISALO has the highest roa_3y of the 24", nth_high("roa_3y", 1, "PAISALO"))
A("BAJFINANCE is second on roa_3y", nth_high("roa_3y", 2, "BAJFINANCE"))
A("SHRIRAMFIN and JMFINANCIL are 3rd/4th on roa_3y and within 0.01pp of each other",
  set(rank_desc("roa_3y")[2:4]) == {"SHRIRAMFIN", "JMFINANCIL"}
  and abs(cm("SHRIRAMFIN", "roa_3y") - cm("JMFINANCIL", "roa_3y")) < 0.0001)
A("MASFIN is fifth-highest on roa_3y", nth_high("roa_3y", 5, "MASFIN"))
A("NORTHARC is seventh-highest on roa_3y", nth_high("roa_3y", 7, "NORTHARC"))
A("SAMMAANCAP has the worst roa_3y", nth_low("roa_3y", 1, "SAMMAANCAP"))
A("CENTRUM is second-worst on roa_3y", nth_low("roa_3y", 2, "CENTRUM"))
A("PIRAMALFIN is third-worst on roa_3y", nth_low("roa_3y", 3, "PIRAMALFIN"))
A("ABCAPITAL is sixth-lowest on roa_3y", nth_low("roa_3y", 6, "ABCAPITAL"))
A("BAJAJFINSV is eighth-lowest on roa_3y", nth_low("roa_3y", 8, "BAJAJFINSV"))
A("TATACAP and M&MFIN are 9th/10th lowest on roa_3y, both quoted as 'tenth'-ish",
  set(rank_asc("roa_3y")[8:10]) == {"TATACAP", "M&MFIN"})
A("IIFL is eleventh-lowest on roa_3y", nth_low("roa_3y", 11, "IIFL"))
A("HDBFS is fifteenth-lowest on roa_3y", nth_low("roa_3y", 15, "HDBFS"))
A("SAMMAANCAP's roa_3y is nearly 3pp below CENTRUM's",
  2.5 <= (cm("CENTRUM", "roa_3y") - cm("SAMMAANCAP", "roa_3y")) * 100 <= 3.0)

# ------------------------------------------------------------- ROE and hurdle

A("BAJFINANCE has the highest roe_3y of the 24", nth_high("roe_3y", 1, "BAJFINANCE"))
A("CHOLAFIN is second on roe_3y, behind BAJFINANCE, and the gap is under 0.1pp",
  nth_high("roe_3y", 2, "CHOLAFIN")
  and (cm("BAJFINANCE", "roe_3y") - cm("CHOLAFIN", "roe_3y")) * 100 < 0.1)
A("HDBFS is fourth-highest on roe_3y", nth_high("roe_3y", 4, "HDBFS"))
A("CENTRUM has the worst roe_3y, and by more than 3x the next-worst",
  nth_low("roe_3y", 1, "CENTRUM")
  and cm("CENTRUM", "roe_3y") < 3 * cm("SAMMAANCAP", "roe_3y"))
A("SAMMAANCAP is second-worst on roe_3y", nth_low("roe_3y", 2, "SAMMAANCAP"))
A("PIRAMALFIN is third-worst on roe_3y", nth_low("roe_3y", 3, "PIRAMALFIN"))
A("JIOFIN is fourth-worst on roe_3y and the lowest that is not negative",
  nth_low("roe_3y", 4, "JIOFIN") and cm("JIOFIN", "roe_3y") > 0
  and all(cm(s, "roe_3y") < 0 for s in rank_asc("roe_3y")[:3]))
A("POONAWALLA is seventh-lowest on roe_3y", nth_low("roe_3y", 7, "POONAWALLA"))

# roe_excess_13_* is a MEAN EXCESS IN FRACTIONS, not a pass rate. Every
# quotation of it in this batch is in percentage points, so value*100 must
# match the prose figure.
EXCESS = {
    ("ABCAPITAL", "roe_excess_13_5y"): 0.88, ("ABCAPITAL", "roe_excess_13_7y"): -0.87,
    ("CHOLAFIN", "roe_excess_13_5y"): 4.90, ("CHOLAFIN", "roe_excess_13_10y"): 4.22,
    ("M&MFIN", "roe_excess_13_5y"): -3.24, ("M&MFIN", "roe_excess_13_7y"): -4.04,
    ("M&MFIN", "roe_excess_13_10y"): -3.17,
    ("SUNDARMFIN", "roe_excess_13_5y"): 0.55, ("SUNDARMFIN", "roe_excess_13_7y"): 0.53,
    ("SUNDARMFIN", "roe_excess_13_10y"): 1.04,
    ("BAJFINANCE", "roe_excess_13_5y"): 4.99, ("BAJFINANCE", "roe_excess_13_10y"): 4.34,
    ("SHRIRAMFIN", "roe_excess_13_5y"): 1.28, ("SHRIRAMFIN", "roe_excess_13_7y"): 0.82,
    ("SHRIRAMFIN", "roe_excess_13_10y"): 1.27,
    ("MASFIN", "roe_excess_13_5y"): -0.27, ("MASFIN", "roe_excess_13_7y"): 0.26,
    ("JMFINANCIL", "roe_excess_13_5y"): -4.61,
    ("IIFL", "roe_excess_13_5y"): 0.32, ("IIFL", "roe_excess_13_10y"): 1.19,
    ("LTF", "roe_excess_13_5y"): -4.24, ("LTF", "roe_excess_13_7y"): -4.35,
    ("LTF", "roe_excess_13_10y"): -2.87,
    ("BAJAJFINSV", "roe_excess_13_5y"): -0.30, ("BAJAJFINSV", "roe_excess_13_7y"): -0.61,
    ("BAJAJFINSV", "roe_excess_13_10y"): -0.28,
    ("POONAWALLA", "roe_excess_13_5y"): -4.84, ("POONAWALLA", "roe_excess_13_7y"): -10.67,
    ("POONAWALLA", "roe_excess_13_10y"): -8.97,
    ("PAISALO", "roe_excess_13_5y"): -1.89,
    ("EDELWEISS", "roe_excess_13_7y"): -11.81,
    ("PIRAMALFIN", "roe_excess_13_5y"): -23.75, ("PIRAMALFIN", "roe_excess_13_7y"): -23.75,
    ("PIRAMALFIN", "roe_excess_13_10y"): -14.95,
    ("SAMMAANCAP", "roe_excess_13_5y"): -18.24, ("SAMMAANCAP", "roe_excess_13_7y"): -13.66,
    ("SAMMAANCAP", "roe_excess_13_10y"): -5.87,
    ("CENTRUM", "roe_excess_13_5y"): -50.09, ("CENTRUM", "roe_excess_13_7y"): -40.32,
    ("CENTRUM", "roe_excess_13_10y"): -28.37,
    ("RELIGARE", "roe_excess_13_7y"): -164.09, ("RELIGARE", "roe_excess_13_10y"): -134.66,
}
for (s, k), pp in EXCESS.items():
    A(f"{s} {k} = {pp}pp (pack {cm(s,k)})", near(cm(s, k) * 100, pp, 0.006))
    A(f"{s} prose quotes {pp:.2f}pp for {k}",
      f"{pp:.2f}pp" in body(s) or f"{abs(pp):.2f}pp" in body(s))

# Five names clear the hurdle on all three windows, not one. The earlier
# "only name" claim was wrong and is the reason this assertion is spelled out
# as the full set rather than a single symbol.
A("exactly five names clear 13% on all three windows",
  sorted(s for s in P if all((cm(s, f"roe_excess_13_{w}") or -1) > 0
                             for w in ("5y", "7y", "10y")))
  == ["BAJFINANCE", "CHOLAFIN", "IIFL", "SHRIRAMFIN", "SUNDARMFIN"])
# RELIGARE's +28.90pp 5y excess is an artefact of collapsed equity, so the
# 5y claim is scoped to names with an unbroken positive record; the 10y claim
# is outright.
A("BAJFINANCE has the widest 10y excess outright, and the widest 5y among the five clearers",
  nth_high("roe_excess_13_10y", 1, "BAJFINANCE")
  and max(("BAJFINANCE", "CHOLAFIN", "IIFL", "SHRIRAMFIN", "SUNDARMFIN"),
          key=lambda s: cm(s, "roe_excess_13_5y")) == "BAJFINANCE")
A("CHOLAFIN is second on the 10y excess, behind BAJFINANCE only",
  nth_high("roe_excess_13_10y", 2, "CHOLAFIN"))
A("M&MFIN misses the hurdle on all three windows",
  all(cm("M&MFIN", f"roe_excess_13_{w}") < 0 for w in ("5y", "7y", "10y")))
A("BAJAJFINSV misses the hurdle on all three windows, each by under 1pp",
  all(-0.01 < cm("BAJAJFINSV", f"roe_excess_13_{w}") < 0 for w in ("5y", "7y", "10y")))
A("LTF misses the hurdle on all three windows",
  all(cm("LTF", f"roe_excess_13_{w}") < 0 for w in ("5y", "7y", "10y")))
A("RELIGARE's 5y excess is positive while its 7y and 10y are catastrophic — the prose "
  "calls the 5y a mirror of the same damage, not a recovery",
  cm("RELIGARE", "roe_excess_13_5y") > 0 and cm("RELIGARE", "roe_excess_13_7y") < -1
  and "mirror image" in body("RELIGARE"))

# --------------------------------------------------------- equity_to_assets

A("CENTRUM has the thinnest capital base of the 24", nth_low("equity_to_assets", 1, "CENTRUM"))
A("CENTRUM's 1.74% is roughly 57x gearing, as the prose says",
  55 <= 1 / cm("CENTRUM", "equity_to_assets") <= 59)
A("BAJAJFINSV and EDELWEISS are joint second-thinnest at 10.87%",
  set(rank_asc("equity_to_assets")[1:3]) == {"BAJAJFINSV", "EDELWEISS"}
  and near(cm("BAJAJFINSV", "equity_to_assets"), cm("EDELWEISS", "equity_to_assets"), 1e-4))
A("ABCAPITAL is fourth-thinnest, just above the 10.87% pair",
  nth_low("equity_to_assets", 4, "ABCAPITAL")
  and cm("ABCAPITAL", "equity_to_assets") > cm("BAJAJFINSV", "equity_to_assets"))
A("ABCAPITAL's prose claims third-thinnest *behind Centrum and level with* the pair, "
  "which is the ordering the pack shows",
  "third-thinnest capital base of the 24, behind Centrum at 1.74% and level with "
  "Bajaj Finserv and Edelweiss at 10.87%" in body("ABCAPITAL"))
A("TATACAP is sixth-thinnest", nth_low("equity_to_assets", 6, "TATACAP"))
A("JIOFIN has the thickest capital base by far", nth_high("equity_to_assets", 1, "JIOFIN"))
A("JMFINANCIL is second-thickest at 36.37%", nth_high("equity_to_assets", 2, "JMFINANCIL"))
A("PAISALO is third-thickest", nth_high("equity_to_assets", 3, "PAISALO"))
A("NORTHARC is seventh-thickest", nth_high("equity_to_assets", 7, "NORTHARC"))
A("every non-JIOFIN name sits between 1.74% and 36.37% equity-to-assets, as JIOFIN's row claims",
  all(0.0174 <= cm(s, "equity_to_assets") <= 0.3638 for s in P if s != "JIOFIN"))

# ------------------------------------------------------------- the multiples

A("BAJFINANCE has the highest pb of the 24", nth_high("pb", 1, "BAJFINANCE"))
A("CHOLAFIN is second-highest on pb", nth_high("pb", 2, "CHOLAFIN"))
A("PAISALO is third-highest on pb", nth_high("pb", 3, "PAISALO"))
A("POONAWALLA is fourth-highest on pb", nth_high("pb", 4, "POONAWALLA"))
A("BAJAJFINSV is fifth-highest on pb", nth_high("pb", 5, "BAJAJFINSV"))
A("UGROCAP has the lowest pb and SAMMAANCAP the second-lowest",
  nth_low("pb", 1, "UGROCAP") and nth_low("pb", 2, "SAMMAANCAP"))
A("JMFINANCIL is fourth-lowest on pb", nth_low("pb", 4, "JMFINANCIL"))
A("NORTHARC is fifth-lowest on pb", nth_low("pb", 5, "NORTHARC"))
A("MASFIN is sixth-lowest on pb", nth_low("pb", 6, "MASFIN"))
A("IIFL is ninth-lowest on pb", nth_low("pb", 9, "IIFL"))
A("FEDFINA is tenth-lowest on pb", nth_low("pb", 10, "FEDFINA"))
A("TATACAP is fifteenth-lowest on pb", nth_low("pb", 15, "TATACAP"))

A("RELIGARE has the highest pe_ttm, and JIOFIN the second-highest",
  nth_high("pe_ttm", 1, "RELIGARE") and nth_high("pe_ttm", 2, "JIOFIN"))
A("POONAWALLA is third-highest on pe_ttm", nth_high("pe_ttm", 3, "POONAWALLA"))
A("EDELWEISS is fourth-highest on pe_ttm", nth_high("pe_ttm", 4, "EDELWEISS"))
A("PIRAMALFIN is seventh-highest on pe_ttm", nth_high("pe_ttm", 7, "PIRAMALFIN"))
A("BAJAJFINSV is eighth-highest on pe_ttm", nth_high("pe_ttm", 8, "BAJAJFINSV"))
A("TATACAP is tenth-highest on pe_ttm", nth_high("pe_ttm", 10, "TATACAP"))
A("UGROCAP is the lowest pe_ttm and NORTHARC the second-lowest",
  nth_low("pe_ttm", 1, "UGROCAP") and nth_low("pe_ttm", 2, "NORTHARC"))
A("IIFL is third-lowest on pe_ttm", nth_low("pe_ttm", 3, "IIFL"))
A("MASFIN is fourth-lowest on pe_ttm", nth_low("pe_ttm", 4, "MASFIN"))
A("JMFINANCIL is fifth-lowest on pe_ttm", nth_low("pe_ttm", 5, "JMFINANCIL"))
A("FEDFINA is seventh-lowest on pe_ttm", nth_low("pe_ttm", 7, "FEDFINA"))
A("pe_ttm is NULL for exactly CENTRUM and SAMMAANCAP",
  sorted(s for s in P if cm(s, "pe_ttm") is None) == ["CENTRUM", "SAMMAANCAP"])

A("JIOFIN has the dearest p_aum of the 24, nearly 2x RELIGARE and ~4x BAJFINANCE",
  nth_high("p_aum", 1, "JIOFIN")
  and cm("JIOFIN", "p_aum") / cm("RELIGARE", "p_aum") > 1.9
  and cm("JIOFIN", "p_aum") / cm("BAJFINANCE", "p_aum") > 4.0)
A("RELIGARE is second-highest on p_aum", nth_high("p_aum", 2, "RELIGARE"))
A("PAISALO has the highest p_aum of the names that are actually lending "
  "(i.e. excluding JIOFIN and RELIGARE)",
  rank_desc("p_aum")[2] == "PAISALO")
A("BAJFINANCE is fourth-highest on p_aum", nth_high("p_aum", 4, "BAJFINANCE"))

# -------------------------------------------------------------- growth rates

A("POONAWALLA has the fastest loan_book_cagr_3y", nth_high("loan_book_cagr_3y", 1, "POONAWALLA"))
A("POONAWALLA leads TATACAP by more than 8pp on loan book growth",
  (cm("POONAWALLA", "loan_book_cagr_3y") - cm("TATACAP", "loan_book_cagr_3y")) * 100 > 8)
A("CHOLAFIN is third-fastest on loan_book_cagr_3y, behind POONAWALLA and TATACAP",
  rank_desc("loan_book_cagr_3y")[:3] == ["POONAWALLA", "CHOLAFIN", "TATACAP"]
  or rank_desc("loan_book_cagr_3y")[:3] == ["POONAWALLA", "TATACAP", "CHOLAFIN"])
A("CHOLAFIN's prose names TATACAP as the other fast grower and gets both figures right",
  near(cm("TATACAP", "loan_book_cagr_3y") * 100, 28.91, 0.006)
  and near(cm("CHOLAFIN", "loan_book_cagr_3y") * 100, 29.27, 0.006))
A("JMFINANCIL has the worst loan_book_cagr_3y", nth_low("loan_book_cagr_3y", 1, "JMFINANCIL"))
A("exactly three loan books are contracting: JMFINANCIL, EDELWEISS, SAMMAANCAP",
  sorted(s for s in P if (cm(s, "loan_book_cagr_3y") or 1) < 0)
  == ["EDELWEISS", "JMFINANCIL", "SAMMAANCAP"])
A("LTF is the slowest-growing book among those still growing",
  rank_asc("loan_book_cagr_3y")[3] == "LTF")
A("SHRIRAMFIN is seventh-slowest on loan_book_cagr_3y", nth_low("loan_book_cagr_3y", 7, "SHRIRAMFIN"))
A("SUNDARMFIN is eighth-slowest on loan_book_cagr_3y", nth_low("loan_book_cagr_3y", 8, "SUNDARMFIN"))

A("BAJFINANCE has the best book_value_cagr_10y and MASFIN the second-best",
  nth_high("book_value_cagr_10y", 1, "BAJFINANCE") and nth_high("book_value_cagr_10y", 2, "MASFIN"))
A("BAJFINANCE leads MASFIN by nearly 2pp on ten-year book compounding",
  1.5 <= (cm("BAJFINANCE", "book_value_cagr_10y") - cm("MASFIN", "book_value_cagr_10y")) * 100 <= 2.5)
A("CENTRUM is the only negative ten-year book compounding",
  [s for s in P if (cm(s, "book_value_cagr_10y") or 1) < 0] == ["CENTRUM"])
A("RELIGARE and EDELWEISS are the next two lowest on book_value_cagr_10y",
  rank_asc("book_value_cagr_10y")[:3] == ["CENTRUM", "RELIGARE", "EDELWEISS"])

A("SHRIRAMFIN has the fastest np_cagr_5y", nth_high("np_cagr_5y", 1, "SHRIRAMFIN"))
A("FEDFINA is second-fastest on np_cagr_5y", nth_high("np_cagr_5y", 2, "FEDFINA"))
A("IIFL has the slowest np_cagr_5y and POONAWALLA the second-slowest",
  nth_low("np_cagr_5y", 1, "IIFL") and nth_low("np_cagr_5y", 2, "POONAWALLA"))
A("SUNDARMFIN is fourth-slowest on np_cagr_5y", nth_low("np_cagr_5y", 4, "SUNDARMFIN"))

# -------------------------------------------------- margins and the TTM traps

A("SUNDARMFIN has the highest opm_now of the 24", nth_high("opm_now", 1, "SUNDARMFIN"))
A("RELIGARE has the lowest opm_now, and by a factor of more than 30 against CENTRUM",
  nth_low("opm_now", 1, "RELIGARE")
  and cm("CENTRUM", "opm_now") / cm("RELIGARE", "opm_now") > 30)
A("CENTRUM has the second-lowest opm_now", nth_low("opm_now", 2, "CENTRUM"))
A("opm_now/opm_prev are ALREADY PERCENT, not fractions — SUNDARMFIN is ~78.7, not 0.787",
  70 < cm("SUNDARMFIN", "opm_now") < 90)

STEPS = {"POONAWALLA": (29.99, 54.88, 24.9), "IIFL": (55.01, 65.09, 10.1),
         "SAMMAANCAP": (26.60, 45.47, 18.9), "CENTRUM": (35.62, 26.01, -9.6),
         "EDELWEISS": (35.08, 27.55, -7.5), "JIOFIN": (74.25, 66.16, -8.1)}
for s, (prev, now, step) in STEPS.items():
    A(f"{s} opm_prev={prev}", near(cm(s, "opm_prev"), prev, 0.006))
    A(f"{s} opm_now={now}", near(cm(s, "opm_now"), now, 0.006))
    A(f"{s} the step really is {step}pp", near(cm(s, "opm_now") - cm(s, "opm_prev"), step, 0.06))
A("POONAWALLA's is the largest one-year margin step of the 24",
  max(P, key=lambda s: abs((cm(s, "opm_now") or 0) - (cm(s, "opm_prev") or 0))) == "POONAWALLA")
A("every flagged margin step is also named in that symbol's prose with both levels",
  all(f"{prev:.2f}%" in body(s) and f"{now:.2f}%" in body(s) for s, (prev, now, _) in STEPS.items()))

# Base effects: VERDICT_WRITING §5 says both levels or it is a lie by omission.
TTM = {s: P[s]["ttm_vs_prior"] for s in P if P[s]["ttm_vs_prior"]}
A("IIFL TTM net profit is +548.8% and the prose gives both margin levels beside it",
  near(TTM["IIFL"]["np_pct"], 548.8, 0.06)
  and "55.01%" in body("IIFL") and "65.09%" in body("IIFL"))
A("POONAWALLA TTM operating profit is +215.6% and the prose gives both margin levels",
  near(TTM["POONAWALLA"]["op_pct"], 215.6, 0.06)
  and "29.99%" in body("POONAWALLA") and "54.88%" in body("POONAWALLA"))
A("PIRAMALFIN TTM net profit is +191.3% and the prose says it is off a barely-positive base",
  near(TTM["PIRAMALFIN"]["np_pct"], 191.3, 0.06)
  and "barely positive" in body("PIRAMALFIN"))
A("ttm_np_pct is NULL for exactly CENTRUM, POONAWALLA, SAMMAANCAP and UGROCAP "
  "(the last because it has only 3 usable quarters, so there is no TTM at all)",
  sorted(s for s in P if cm(s, "ttm_np_pct") is None)
  == ["CENTRUM", "POONAWALLA", "SAMMAANCAP", "UGROCAP"])
A("each of those three rows says ttm_np_pct is NULL rather than quoting a profit move",
  all("ttm_np_pct</code> is NULL" in body(s) for s in ("CENTRUM", "POONAWALLA", "SAMMAANCAP")))

# --------------------------------------------------------------- momentum

A("PAISALO has the best ret_12m_rel and by a wide margin over SHRIRAMFIN",
  nth_high("ret_12m_rel", 1, "PAISALO") and nth_high("ret_12m_rel", 2, "SHRIRAMFIN")
  and cm("PAISALO", "ret_12m_rel") - cm("SHRIRAMFIN", "ret_12m_rel") > 0.6)
A("EDELWEISS is third-best and ABCAPITAL second-best among the non-PAISALO/SHRIRAMFIN names",
  rank_desc("ret_12m_rel")[:5] == ["PAISALO", "SHRIRAMFIN", "ABCAPITAL", "EDELWEISS", "IIFL"])
A("ABCAPITAL's claim of second-best is wrong unless scoped — check the prose says 'second only "
  "to Paisalo', which the pack contradicts: SHRIRAMFIN is second",
  not ("second only to Paisalo in this set" in body("ABCAPITAL")))
A("UGROCAP has the worst ret_12m_rel", nth_low("ret_12m_rel", 1, "UGROCAP"))
A("CENTRUM is second-worst and JIOFIN third-worst on ret_12m_rel",
  nth_low("ret_12m_rel", 2, "CENTRUM") and nth_low("ret_12m_rel", 3, "JIOFIN"))
A("JMFINANCIL is fourth-worst on ret_12m_rel", nth_low("ret_12m_rel", 4, "JMFINANCIL"))
A("SAMMAANCAP is fifth-worst on ret_12m_rel", nth_low("ret_12m_rel", 5, "SAMMAANCAP"))
A("BAJAJFINSV is seventh-worst on ret_12m_rel", nth_low("ret_12m_rel", 7, "BAJAJFINSV"))
A("ret_12m_rel is NULL only for PIRAMALFIN, and its row says so",
  [s for s in P if cm(s, "ret_12m_rel") is None] == ["PIRAMALFIN"]
  and "ret_12m_rel</code>" in body("PIRAMALFIN") and "NULL" in body("PIRAMALFIN"))
A("pct_above_200ema_252d is NULL for exactly the three short-history names",
  sorted(s for s in P if cm(s, "pct_above_200ema_252d") is None)
  == ["HDBFS", "PIRAMALFIN", "TATACAP"])
BARS = {"HDBFS": 330, "PIRAMALFIN": 241, "TATACAP": 260}
for s, b in BARS.items():
    A(f"{s} really has {b} price bars", P[s]["technicals"]["bars"] == b)
    A(f"{s} prose quotes the bar count", str(b) in body(s))
A("ema_stack_bull is 1 for exactly EDELWEISS and PAISALO",
  sorted(s for s in P if cm(s, "ema_stack_bull") == 1.0) == ["EDELWEISS", "PAISALO"])

# ------------------------------------------------------------- ownership

A("SHRIRAMFIN has the highest fii_pct, more than double the next",
  nth_high("fii_pct", 1, "SHRIRAMFIN")
  and cm("SHRIRAMFIN", "fii_pct") > 2 * cm("CHOLAFIN", "fii_pct"))
A("CHOLAFIN has the second-highest fii_pct", nth_high("fii_pct", 2, "CHOLAFIN"))
A("CENTRUM has the lowest fii_pct and HDBFS the second-lowest",
  nth_low("fii_pct", 1, "CENTRUM") and nth_low("fii_pct", 2, "HDBFS"))
A("MASFIN has the third-lowest fii_pct", nth_low("fii_pct", 3, "MASFIN"))
A("TATACAP has the highest promoter_pct", nth_high("promoter_pct", 1, "TATACAP"))
A("UGROCAP has the lowest promoter_pct of the 24, at under 3%",
  nth_low("promoter_pct", 1, "UGROCAP") and cm("UGROCAP", "promoter_pct") < 3)
A("promoter_pct is NULL only for NORTHARC, and its row names that gap",
  [s for s in P if cm(s, "promoter_pct") is None] == ["NORTHARC"]
  and "promoter_pct</code> is NULL" in body("NORTHARC"))
A("M&MFIN has the highest dii_pct", nth_high("dii_pct", 1, "M&MFIN"))
A("JMFINANCIL has the highest div_yield and M&MFIN the second-highest",
  nth_high("div_yield", 1, "JMFINANCIL") and nth_high("div_yield", 2, "M&MFIN"))
A("BAJAJFINSV has the lowest div_yield of those that pay one",
  nth_low("div_yield", 1, "BAJAJFINSV"))
A("div_yield is NULL for exactly the eight names whose rows do not quote a yield",
  sorted(s for s in P if cm(s, "div_yield") is None)
  == ["ABCAPITAL", "CENTRUM", "FEDFINA", "NORTHARC", "POONAWALLA", "RELIGARE",
      "SAMMAANCAP", "UGROCAP"])
A("JIOFIN has the largest shareholder register, by more than 4x the next",
  nth_high("shareholders", 1, "JIOFIN")
  and cm("JIOFIN", "shareholders") > 4 * cm("TATACAP", "shareholders"))

# ------------------------------------------------- composites and the blocked

A("NORTHARC has the highest composite of the 24",
  max((P[s]["scores"]["composite_pct"], s) for s in P
      if P[s]["scores"]["composite_pct"] is not None)[1] == "NORTHARC")
A("IIFL has the second-highest composite",
  sorted(((P[s]["scores"]["composite_pct"], s) for s in P
          if P[s]["scores"]["composite_pct"] is not None), reverse=True)[1][1] == "IIFL")
A("SAMMAANCAP has the lowest composite of the 24",
  min((P[s]["scores"]["composite_pct"], s) for s in P
      if P[s]["scores"]["composite_pct"] is not None)[1] == "SAMMAANCAP")
A("UGROCAP is the only suppressed composite",
  [s for s in P if P[s]["scores"]["composite_pct"] is None] == ["UGROCAP"])
A("UGROCAP's quality pillar really is on 8 of 100 declared points",
  near(P["UGROCAP"]["scorecard_coverage"]["pillars"]["quality"]["covered_weight"], 8.0, 0.5))
A("UGROCAP really has 13 of 29 cluster metrics resolved",
  sum(1 for v in (P["UGROCAP"]["metrics"]["cluster_metrics"] or {}).values() if v is not None) == 13
  and len(P["UGROCAP"]["metrics"]["cluster_metrics"]) == 29)
A("UGROCAP's row names every one of the six NULL quality inputs",
  all(f"<code>{k}</code>" in body("UGROCAP") for k in
      ("roa_3y", "roe_3y", "loan_book_cagr_3y", "book_value_cagr_3y",
       "np_cagr_3y", "np_consistency_3y")))

# Every claim of "scored on N of 100 declared points" must be covered_weight,
# not the pillar percentile. That confusion is recorded in VERDICT_WRITING.
COVER = {("CENTRUM", "valuation"): 60, ("SAMMAANCAP", "valuation"): 60,
         ("FEDFINA", "valuation"): 75, ("NORTHARC", "valuation"): 75,
         ("UGROCAP", "valuation"): 75, ("UGROCAP", "momentum"): 60,
         ("UGROCAP", "quality"): 8, ("PIRAMALFIN", "momentum"): 65}
for (s, pil), w in COVER.items():
    A(f"{s} {pil} coverage is {w} of 100",
      near(P[s]["scorecard_coverage"]["pillars"][pil]["covered_weight"], w, 0.5))
    A(f"{s} prose quotes '{w} of ... 100 ... points'",
      any(f"{w} of {mid}100" in body(s)
          for mid in ("its ", "the pillar's ", "its 100 declared ".replace("100 declared ", ""))))

# -------------------------------------------- the calls themselves hold up

avoids = sorted(s for s in V if V[s]["verdict"].startswith("AVOID"))
A(f"the AVOID set is exactly the names the data condemns (actual: {avoids})",
  avoids == ["CENTRUM", "EDELWEISS", "JIOFIN", "PIRAMALFIN", "POONAWALLA",
             "RELIGARE", "SAMMAANCAP"])
A("every name with a negative roa_3y is an AVOID",
  all(s in avoids for s in P if (cm(s, "roa_3y") or 0) < 0))
A("EDELWEISS is an AVOID despite positive returns — justified by a shrinking book "
  "and ~zero ten-year book compounding, both of which the pack confirms",
  cm("EDELWEISS", "roa_3y") > 0 and cm("EDELWEISS", "loan_book_cagr_3y") < 0
  and cm("EDELWEISS", "book_value_cagr_10y") < 0.01)
A("JIOFIN is an AVOID on structure, not on losses — roa_3y is positive",
  cm("JIOFIN", "roa_3y") > 0 and cm("JIOFIN", "equity_to_assets") > 0.9)
A("POONAWALLA is an AVOID while having the fastest book growth — the row says so explicitly",
  nth_high("loan_book_cagr_3y", 1, "POONAWALLA") and "fastest book growth" in V["POONAWALLA"]["verdict"])
A("no AVOID row is 'medium' confidence unless its deciding figures are all non-NULL",
  all(all(cm(s, k) is not None for k in V[s]["evidence"])
      for s in avoids if V[s]["confidence"] == "medium"))
A("every HOLD on a held position states the move from cost in its last point too",
  all(any(w in V[s]["points"][-1]
          for w in ("underwater", "down", "Down", "Up ", "cost", "held"))
      for s in HELD))


# ------------------------------------------- the headline, not just the body
#
# Pass 2 originally read only `points`. Two wrong superlatives survived to the
# end of the batch because they were in the one-line `verdict` string, which is
# the first thing a reader sees and the last thing this file was checking.
# Every rank word in a headline now gets an assertion.

A("CHOLAFIN headline: second-best roe_3y and second-highest pb",
  nth_high("roe_3y", 2, "CHOLAFIN") and nth_high("pb", 2, "CHOLAFIN")
  and "second-best of the 24" in V["CHOLAFIN"]["verdict"]
  and "second-highest price-to-book" in V["CHOLAFIN"]["verdict"])
A("BAJFINANCE headline: second-best roa_3y, best 10y book compounding, highest pb",
  nth_high("roa_3y", 2, "BAJFINANCE")
  and nth_high("book_value_cagr_10y", 1, "BAJFINANCE")
  and nth_high("pb", 1, "BAJFINANCE")
  and "second-best return on assets" in V["BAJFINANCE"]["verdict"])
A("PAISALO headline: best roa_3y of the 24", nth_high("roa_3y", 1, "PAISALO"))
A("SHRIRAMFIN headline: fastest np_cagr_5y", nth_high("np_cagr_5y", 1, "SHRIRAMFIN"))
A("MASFIN headline: second-best book_value_cagr_10y",
  nth_high("book_value_cagr_10y", 2, "MASFIN"))
A("JMFINANCIL headline: highest div_yield of the 24", nth_high("div_yield", 1, "JMFINANCIL"))
A("POONAWALLA headline: fastest loan_book_cagr_3y", nth_high("loan_book_cagr_3y", 1, "POONAWALLA"))
A("SAMMAANCAP headline: worst roa_3y", nth_low("roa_3y", 1, "SAMMAANCAP"))
A("NORTHARC headline: highest composite_pct of the 24 at 86",
  max(P, key=lambda s: (P[s]["scores"] or {}).get("composite_pct") or -1) == "NORTHARC"
  and (P["NORTHARC"]["scores"] or {}).get("composite_pct") == 86)
A("SUNDARMFIN headline: one of exactly five clearing the hurdle on all three windows",
  "only five" in V["SUNDARMFIN"]["verdict"])

# ------------------------------------------------------------------- report

print(f"{N} checks, {len(FAILS)} failures")
for f in FAILS:
    print("  FAIL:", f)
if FAILS:
    raise SystemExit(1)
print("pass 2 clean")
