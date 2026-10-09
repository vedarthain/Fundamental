#!/usr/bin/env python3
"""Traceability checker for a verdict batch, plus the helpers a per-batch
rank-claim file needs.

WHY THIS EXISTS
---------------
Verdict prose is hand-written against a symbol pack, and hand-written prose
invents numbers. Over five batches (polycab-adjacent, bfsi-pvt-banks-large-5,
oil-refining-9, oil-refining-tail-17, oil-refining-blocked-14) a checker of
this shape caught a real factual error in **every single one** — 3 wrong
superlatives in the banks, 7 in the oil nine, 14 in the oil seventeen, 1 in the
blocked fourteen, and one wrong pass-rate denominator that had silently
corrupted six verdicts. None of those were caught by reading.

Two passes, and only the first is reusable:

  PASS 1 (here, generic): every numeric token in every verdict's prose must
    match some value derivable from that symbol's own pack. Catches invented
    figures, transcription slips, and stale copies.

  PASS 2 (per batch, not here): every rank or superlative claim -- "the
    cheapest of the nine", "the weakest cash conversion of the 17" -- restated
    as code and evaluated. This is the pass that finds the errors, and it
    cannot be generic because the peer set is different every time. Write it as
    a sibling file and import the helpers below.

USAGE
-----
    etl/.venv/bin/python scripts/verdict-check.py PACK.json VERDICTS.json

    # or, from a per-batch claims file:
    import importlib.util, pathlib
    spec = importlib.util.spec_from_file_location(
        "vc", pathlib.Path("scripts/verdict-check.py"))
    vc = importlib.util.module_from_spec(spec); spec.loader.exec_module(vc)
    P, VS, C = vc.load("/tmp/pack.json", "/tmp/verdicts.json")
    vc.trace(P, VS, C, extra={"RELIANCE": [16037]})
    ck = []
    ck.append(("X cheapest of the five", vc.rk(C, "pe_ttm", False)[0] == "X"))
    vc.report(ck)

THE PASS-RATE DENOMINATOR RULE -- read this before quoting "n of N"
-------------------------------------------------------------------
Two scorecard metrics look alike and are counted differently. Getting this
wrong does not raise; it produces a plausible wrong fraction.

  roe_avg_above_threshold_Ny / roe_excess_13_Ny -- a LEVEL test. One
      observation per year, so the denominator is **N**.
      5y -> 5, 7y -> 7, 10y -> 10.

  np_growth_above_inflation_Ny -- a GROWTH test. Each step needs two points,
      so the denominator is **N-1**.
      5y -> 4, 7y -> 6, 10y -> 9.

CHENNPETRO: roe 0.7 on 10y = 7 of 10. np_growth 0.4444 on 10y = 4 of 9. Use
the wrong denominator and you get 6.3 and 4.285 -- fractions of a year, which
is the tell. `denominator_guard()` below asserts every rate times its
denominator lands on an integer, so the error cannot recur silently.

PACK SHAPE -- the fields that are not where you expect
------------------------------------------------------
  * Top level is a dict, not a list: iterate json.load(...)["symbols"].
  * metrics.pe_ttm and friends are None. The live values are all in
    metrics.cluster_metrics.*.
  * pe_band keys are n / lo / hi / avg / derived_here -- NOT pe_band_lo.
    (In the verdict `evidence` object they ARE pe_band_lo/hi/avg, because
    those are DERIVED_KEYS. The two namespaces differ.)
  * metrics.market_cap is already in crore. RELIANCE = 1,580,194.11.
  * ttm_vs_prior keys: window / sales_pct / op_pct / np_pct / opm_now /
    opm_prev.
  * scores keys: quality_pct / valuation_pct / momentum_pct / composite_pct /
    cluster_id / maturity_tier / score_status / missing_pillars /
    snapshot_date. A suppressed pillar leaves composite_pct None.

METRICS THAT ARE NULL FOR >=95% OF EVERY TIER -- never put these in prose
------------------------------------------------------------------------
  book_value_cagr_3y, p_premium, roe_latest, tech_net_score_scaled.
Also golden.delivery_data holds only 2 distinct sessions, so any delivery
percentage is a single-day reading, not a trend.
"""
from __future__ import annotations

import json
import re
import sys

NUM = re.compile(r"-?\d[\d,]*\.?\d*")

#: Level-test / growth-test denominators. See the docstring.
LEVEL_DENOM = {"5y": 5, "7y": 7, "10y": 10}
GROWTH_DENOM = {"5y": 4, "7y": 6, "10y": 9}

LEVEL_KEYS = ("roe_avg_above_threshold_{w}", "roe_excess_13_{w}")
GROWTH_KEYS = ("np_growth_above_inflation_{w}",)


def load(pack_path: str, verdicts_path: str):
    """-> (pack_by_symbol, verdicts_by_symbol, cluster_metrics_by_symbol)."""
    raw = json.load(open(pack_path))
    syms = raw["symbols"] if isinstance(raw, dict) else raw
    P = {s["symbol"]: s for s in syms}
    V = json.load(open(verdicts_path))
    VS = {v["symbol"]: v for v in (V["verdicts"] if isinstance(V, dict) else V)}
    C = {s: P[s]["metrics"]["cluster_metrics"] for s in P}
    return P, VS, C


def candidates(P, C, sym, extra=()):
    """Every number legitimately quotable for `sym`, as RAW floats.

    Stored unrounded on purpose. The match in `trace()` rounds the *candidate*
    to the precision the prose actually used, which is the only direction that
    is sound: prose rounds a real value, so 57.8384 may legitimately appear as
    "57.8" or "58", but a prose token of "63.4" must not be satisfied by a real
    value of 63.0.

    An earlier version pre-rounded candidates to 0-4 dp and then also rounded
    the prose token to 0-4 dp before comparing. That made every prose number
    between 62.5 and 63.5 match a candidate of 63 -- and integers 0-100 are
    dense in the set because every pillar percentile is one. It let an invented
    "ROCE 63.4%" through in a negative test. Match at one precision, not all.

    Variants kept: raw, x100 (ratios rendered as percents), and the negations,
    because prose says "fell 18.5%" for an op_pct of -0.185.
    """
    c: set[float] = set()

    def add(x):
        if x is None or isinstance(x, bool):
            return
        try:
            f = float(x)
        except (TypeError, ValueError):
            return
        for v in (f, f * 100, -f, -f * 100):
            c.add(v)

    s = P[sym]
    for v in C[sym].values():
        add(v)
    for d in ("pe_band", "earnings_quality", "ttm_vs_prior", "metrics", "scores",
              "technicals", "delivery", "identity"):
        for v in (s.get(d) or {}).values():
            add(v)
    for row in (s.get("shareholding") or [])[:4]:
        for v in row.values():
            add(v)
    for row in (s.get("annual") or [])[:6]:
        for v in row.values():
            add(v)

    mc = (s.get("metrics") or {}).get("market_cap")
    if mc:
        add(mc)
        add(mc / 100000.0)            # lakh crore
    sh = C[sym].get("shareholders")
    if sh:
        add(sh / 1e6)                 # millions

    # pass-rate counts, both denominators -- so "7 of 10" traces
    for w in LEVEL_DENOM:
        for tpl in LEVEL_KEYS:
            v = C[sym].get(tpl.format(w=w))
            if v is not None:
                add(v * LEVEL_DENOM[w])
        for tpl in GROWTH_KEYS:
            v = C[sym].get(tpl.format(w=w))
            if v is not None:
                add(v * GROWTH_DENOM[w])
    for n in set(LEVEL_DENOM.values()) | set(GROWTH_DENOM.values()):
        add(n)

    # numbers that appear only inside blocker / earnings-quality prose: bar
    # counts, pillar weights, margin steps. A verdict is allowed to quote them.
    for b in (s.get("blockers") or []):
        for m in NUM.finditer(b):
            add(m.group(0).replace(",", ""))
    for f in ((s.get("earnings_quality") or {}).get("flags") or []):
        for m in NUM.finditer(f):
            add(m.group(0).replace(",", ""))

    for n in (0, 1, 2, 3, 4, 5, 13, 100, 200, 252, 450):
        add(n)                        # thresholds the prose states as rules
    for x in extra:
        add(x)
    return c


def _decimals(token: str) -> int:
    """Decimal places the prose actually wrote. '57.8' -> 1, '58' -> 0."""
    return len(token.split(".", 1)[1]) if "." in token else 0


def trace(P, VS, C, extra=None, quiet=False):
    """Pass 1. Returns (tokens, unmatched_list).

    A prose token matches only if some candidate, rounded to the token's OWN
    precision, equals it. See the note in `candidates()` for why matching at
    every precision at once is unsound.
    """
    extra = extra or {}
    tokens, bad = 0, []
    for sym, v in VS.items():
        cand = candidates(P, C, sym, extra.get(sym, ()))
        text = " ".join([v["verdict"], *v["points"], v.get("trigger_text", "")])
        for m in NUM.finditer(text):
            raw = m.group(0).rstrip(".").replace(",", "")
            try:
                f = float(raw)
            except ValueError:
                continue
            tokens += 1
            d = _decimals(raw)
            if not any(abs(round(x, d) - f) < 1e-9 for x in cand):
                ctx = text[max(0, m.start() - 45):m.end() + 45]
                bad.append((sym, raw, ctx))
                if not quiet:
                    print(f"UNMATCHED {sym} {raw} :: {ctx}")
    print(f"{tokens} numeric tokens, {len(bad)} unmatched")
    print("  (threshold figures stated as rules in trigger_text, and years, "
          "legitimately do not trace -- read each one before dismissing it)")
    return tokens, bad


def denominator_guard(C, symbols=None):
    """Every pass rate x its denominator must land on an integer.

    This is the check that makes the level-vs-growth rule self-enforcing: if
    the metric semantics ever change, or a window is counted differently, the
    product stops being a whole number and this fails loudly instead of
    yielding "6.3 of 10".
    """
    symbols = symbols or list(C)
    ok = True
    for s in symbols:
        for w in LEVEL_DENOM:
            for tpl, denom in ((t, LEVEL_DENOM[w]) for t in LEVEL_KEYS):
                v = C[s].get(tpl.format(w=w))
                if v is not None and abs(v * denom - round(v * denom)) > 1e-6:
                    print(f"DENOMINATOR {s} {tpl.format(w=w)}={v} x {denom} "
                          f"= {v * denom} -- not an integer")
                    ok = False
            for tpl, denom in ((t, GROWTH_DENOM[w]) for t in GROWTH_KEYS):
                v = C[s].get(tpl.format(w=w))
                if v is not None and abs(v * denom - round(v * denom)) > 1e-6:
                    print(f"DENOMINATOR {s} {tpl.format(w=w)}={v} x {denom} "
                          f"= {v * denom} -- not an integer")
                    ok = False
    return ok


# ---------------------------------------------------------------- pass-2 helpers

def rk(C, key, rev=True, pool=None):
    """Symbols ranked by `key`, Nones dropped. rk(...)[0] is the extreme."""
    pool = pool or list(C)
    vals = [(s, C[s][key]) for s in pool if C[s].get(key) is not None]
    return [s for s, _ in sorted(vals, key=lambda t: t[1], reverse=rev)]


def sc(P, s, k):
    """A scores pillar percentile. May be None when a pillar is suppressed."""
    return P[s]["scores"][k]


def band(P, s, k):
    """pe_band field. Keys are n / lo / hi / avg -- not pe_band_lo."""
    return (P[s].get("pe_band") or {}).get(k)


def report(ck):
    """ck is [(claim_text, bool)]. Prints failures, returns the failure count."""
    fails = [n for n, ok in ck if not ok]
    for n in fails:
        print("CLAIM FAILED:", n)
    print(f"{len(ck)} rank claims, {len(fails)} failed")
    return len(fails)


def main(argv):
    if len(argv) != 3:
        print(__doc__.split("USAGE")[0])
        print("usage: verdict-check.py PACK.json VERDICTS.json")
        return 2
    P, VS, C = load(argv[1], argv[2])
    _, bad = trace(P, VS, C)
    print()
    ok = denominator_guard(C, list(VS))
    print(f"denominator guard: {'pass' if ok else 'FAIL'}")
    print("\nPass 2 (rank and superlative claims) is NOT run here -- it is "
          "per-batch by construction.\nEvery batch so far has contained at "
          "least one wrong superlative. Write the claims file.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
