#!/usr/bin/env python3
"""Mutation suite for the refusal library: feed it broken packs, demand refusal.

WHY THIS IS A DIFFERENT KIND OF TEST FROM replay_refusals.py
------------------------------------------------------------
`replay_refusals.py` proves the library AGREES with twenty-one hand-written
generators on real packs. That is agreement, not correctness: every one of those
packs is a row the generators already judged clean, so a rule that returned
"nothing is ever refused" would disagree loudly, but a rule that refused
correctly for the wrong reason would pass unnoticed — and a rule whose threshold
sits at the wrong number passes too, because no real pack happens to sit on the
boundary.

So this file breaks the pack on purpose and demands the refusal:

* `refuses(...)` — a mutation that MUST be caught. This is the §4 rule, "a fix
  must fail on the bug it fixes", applied to a library instead of a fix: the
  buy-anchor tripwire was set at 2.0x while the bug that motivated it measured
  1.75x, and it would have passed green forever.
* `permits(...)` — the same mutation moved to the safe side of the threshold,
  which MUST NOT be caught. Without these the suite cannot distinguish a rule
  from a function that refuses everything, and "refuses everything" passes every
  refusal test ever written. Half the cases below are of this kind on purpose.
* `survives(...)` — a degenerate row (empty, null-keyed) must produce a FLAG,
  never a traceback. A rule that crashes on a thin row is a rule that takes the
  whole backfill down on symbol 1,400 of 2,773.

Every case names the threshold it is probing, so a failure says which number
moved rather than which assertion broke.

PROOF THAT THIS SUITE CAN FAIL
------------------------------
A suite that passes is evidence of nothing until it has been shown to fail, so
each of the library's six thresholds was moved by one step and the suite re-run.
All six break it:

    BAND_RATIO_MAX  5.0 -> 6.0    1 missed
    BAND_MIN_N      5   -> 4      1 missed
    TIE_DIVISOR     3   -> 4      1 overeager
    PRICEHIST_MIN   450 -> 400    1 missed
    thin_reads      0.95 -> 0.80  1 missed
    min_shortfall   0.0 -> 10.0   2 missed, 1 crash

Two things that hid during that exercise are worth knowing before repeating it.
**Edit the constant, not the docstring** — `BAND_RATIO_MAX = 5.0` also appears
in prose at the top of `refusals.py`, and a first-occurrence replace silently
changed the sentence instead of the rule, so the suite was right to stay green.
And **disable the bytecode cache** (`python -B`): changing `5.0` to `6.0` leaves
the file the same length, and if the edit lands in the same second Python reuses
the stale `.pyc` and runs the old rule.

Usage:
  etl/.venv/bin/python build/verdicts/lib/mut_refusals.py
  etl/.venv/bin/python build/verdicts/lib/mut_refusals.py --verbose
"""
from __future__ import annotations

import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refusals as R  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))

# The pack this suite mutates. Any pack carrying a `peer_ranks` block would do;
# this one is named rather than globbed so a case that depends on the row's
# actual shape (62 peers, a usable band) cannot start probing a different
# cohort silently when the glob order changes.
PACK = "/tmp/leisure5.json"
SYMBOL = "LEMONTREE"
FLOOR = 27

VERBOSE = "--verbose" in sys.argv
results: list[tuple[str, str, str]] = []   # (outcome, case, detail)


def _base() -> dict:
    rows = json.load(open(PACK))["symbols"]
    for r in rows:
        if r["symbol"] == SYMBOL:
            return r
    raise SystemExit(f"{SYMBOL} not in {PACK}")


BASE = _base()


def _mut(fn) -> dict:
    row = copy.deepcopy(BASE)
    fn(row)
    return row


def refuses(case: str, mutate, probe, want) -> None:
    """`mutate` breaks the row; `probe(row)` must then return `want`."""
    try:
        got = probe(_mut(mutate))
    except Exception as e:                      # a crash is not a refusal
        results.append(("CRASH", case, f"{type(e).__name__}: {e}"))
        return
    ok = got == want
    results.append(("CAUGHT" if ok else "MISSED", case,
                    f"got {got!r}, wanted {want!r}"))


def permits(case: str, mutate, probe, want) -> None:
    """The same mutation on the SAFE side of the threshold. Must NOT refuse."""
    try:
        got = probe(_mut(mutate))
    except Exception as e:
        results.append(("CRASH", case, f"{type(e).__name__}: {e}"))
        return
    ok = got == want
    results.append(("HELD" if ok else "OVEREAGER", case,
                    f"got {got!r}, wanted {want!r}"))


def survives(case: str, probe) -> None:
    """A degenerate row must flag, not raise."""
    try:
        probe()
        results.append(("SURVIVED", case, ""))
    except Exception as e:
        results.append(("CRASH", case, f"{type(e).__name__}: {e}"))


# ---------------------------------------------------------------------------
# the band: BAND_RATIO_MAX = 5.0, BAND_MIN_N = 5
# ---------------------------------------------------------------------------
def _band(row, **kw):
    row.setdefault("pe_band", {})
    row["pe_band"].update(kw)


refuses("band ratio just over 5.0 is too wide to price",
        lambda r: _band(r, lo=10.0, hi=50.01, n=8), R.band_state, R.BAND_WIDE)
permits("band ratio just under 5.0 still prices the row",
        lambda r: _band(r, lo=10.0, hi=49.99, n=8), R.band_state, None)
permits("band ratio exactly 5.0 is the boundary and is allowed",
        lambda r: _band(r, lo=10.0, hi=50.0, n=8), R.band_state, None)
refuses("a band built on four readings is no band",
        lambda r: _band(r, lo=10.0, hi=20.0, n=4), R.band_state, R.BAND_ABSENT)
permits("five readings is the declared minimum and is allowed",
        lambda r: _band(r, lo=10.0, hi=20.0, n=5), R.band_state, None)
refuses("a zero low is an earnings denominator through zero",
        lambda r: _band(r, lo=0.0, hi=20.0, n=8), R.band_state, R.BAND_ABSENT)
refuses("no band block at all",
        lambda r: r.pop("pe_band", None), R.band_state, R.BAND_ABSENT)
refuses("figures are withheld in every state the band is refused in",
        lambda r: _band(r, lo=10.0, hi=99.0, n=8), R.band_figures, None)
permits("figures are released when the band is usable",
        lambda r: _band(r, lo=10.0, hi=20.0, n=8, avg=15.0),
        lambda r: R.band_figures(r) is not None, True)


# ---------------------------------------------------------------------------
# ranks: the floor, the tie divisor, and their precedence
# ---------------------------------------------------------------------------
def _metric(row, key="roce_3y", **kw):
    row["peer_ranks"]["metrics"].setdefault(key, {})
    row["peer_ranks"]["metrics"][key].update(kw)


def _why(key="roce_3y"):
    return lambda r: R.withheld_metrics(r, FLOOR).get(key)


refuses("a reading carried by one peer fewer than the floor",
        lambda r: _metric(r, of=FLOOR - 1), _why(), R.SUB_FLOOR)
permits("a reading carried by exactly the floor",
        lambda r: _metric(r, of=FLOOR), _why(), None)
refuses("a metric the cohort does not rank",
        lambda r: _metric(r, rankable=False), _why(), R.NOT_RANKABLE)
refuses("a tie covering more than a third of a 62-row cohort",
        lambda r: _metric(r, of=62, tied=21), _why(), R.WIDE_TIE)
permits("a tie covering exactly a third is the boundary and is allowed",
        lambda r: _metric(r, of=62, tied=20), _why(), None)
refuses("a sub-floor reading is refused for its denominator, not its tie",
        lambda r: _metric(r, of=FLOOR - 1, tied=21), _why(), R.SUB_FLOOR)
refuses("an unrankable reading is refused before its denominator is read",
        lambda r: _metric(r, rankable=False, of=FLOOR - 1), _why(),
        R.NOT_RANKABLE)
refuses("a null-keyed metric block is a refusal, not a KeyError",
        lambda r: r["peer_ranks"]["metrics"].update({"roce_3y": None}),
        _why(), R.NOT_RANKABLE)

# The pair property: a caller enumerating one side must see every metric
# exactly once. A metric that falls out of both lists is a figure nobody
# refused and nobody ranked, which is how an untraced number reaches a reader.
permits("every metric is either ranked or refused, never neither nor both",
        lambda r: _metric(r, of=FLOOR - 1),
        lambda r: (set(R.rankable_metrics(r, FLOOR))
                   | set(R.withheld_metrics(r, FLOOR))
                   == set(r["peer_ranks"]["metrics"])
                   and not (set(R.rankable_metrics(r, FLOOR))
                            & set(R.withheld_metrics(r, FLOOR)))), True)

refuses("a two-way tie must still be declared beside the rank",
        lambda r: _metric(r, tied=2, tie_span=[4, 5]),
        lambda r: R.tie_requirement(r["peer_ranks"]["metrics"]["roce_3y"]),
        (2, (4, 5)))
permits("an untied rank needs no tie clause",
        lambda r: _metric(r, tied=1),
        lambda r: R.tie_requirement(r["peer_ranks"]["metrics"]["roce_3y"]),
        None)


# ---------------------------------------------------------------------------
# thin readings: ranked, but only beside how thin they are
# ---------------------------------------------------------------------------
refuses("a reading over a 62-row cohort carried by 58 is thin",
        lambda r: _metric(r, of=58, rankable=True),
        lambda r: R.thin_reads(r).get("roce_3y"), 58)
permits("a reading carried by the whole cohort is not thin",
        lambda r: _metric(r, of=62, rankable=True),
        lambda r: R.thin_reads(r).get("roce_3y"), None)
permits("a cohort with no size reports no thinness rather than dividing by it",
        lambda r: r["peer_ranks"]["cohort"].update({"n": None}),
        lambda r: R.thin_reads(r), {})


# ---------------------------------------------------------------------------
# pillar weights: the threshold that was never declared
# ---------------------------------------------------------------------------
def _pillar(row, pillar="quality", **kw):
    row.setdefault("scorecard_coverage", {}).setdefault("pillars", {})
    row["scorecard_coverage"]["pillars"].setdefault(pillar, {})
    row["scorecard_coverage"]["pillars"][pillar].update(kw)


refuses("a pillar short by a tenth of a point is still disclosed by default",
        lambda r: _pillar(r, covered_weight=99.9, declared_weight=100.0,
                          missing={"roe_3y": 0.1}),
        lambda r: R.pillar_caveats(r).get("quality", {}).get("covered"), 99.9)
permits("a pillar on its full declared weight carries no caveat",
        lambda r: _pillar(r, covered_weight=100.0, declared_weight=100.0,
                          missing={}),
        lambda r: "quality" in R.pillar_caveats(r), False)
# This is the live defect, reproduced on purpose: the six published verdicts in
# SPEC-evidence-sheet.md are silent because their generators used a threshold
# of this shape and never said so. The case asserts the parameter is LIVE —
# if it ever stops hiding the shortfall, the default changed and the spec's
# account of why those six are silent is no longer true.
refuses("a caller naming a 15-point threshold reproduces the published silence",
        lambda r: _pillar(r, covered_weight=92.8, declared_weight=100.0,
                          missing={"roe_3y": 7.2}),
        lambda r: "quality" in R.pillar_caveats(r, min_shortfall=15.0), False)
refuses("the same shortfall is disclosed when no threshold is named",
        lambda r: _pillar(r, covered_weight=92.8, declared_weight=100.0,
                          missing={"roe_3y": 7.2}),
        lambda r: "quality" in R.pillar_caveats(r), True)
refuses("what is missing underneath the pillar is named, not just the gap",
        lambda r: _pillar(r, covered_weight=90.0, declared_weight=100.0,
                          missing={"cfo_pat_3y": 6.0, "roe_3y": 4.0}),
        lambda r: R.pillar_caveats(r)["quality"]["missing"],
        ["cfo_pat_3y", "roe_3y"])
permits("a pillar with no declared weight is skipped, not crashed on",
        lambda r: _pillar(r, covered_weight=90.0, declared_weight=None),
        lambda r: "quality" in R.pillar_caveats(r), False)


# ---------------------------------------------------------------------------
# the annual record
# ---------------------------------------------------------------------------
def _annual(row, i, **kw):
    row["annual"][i].update(kw)


_CASH_NEG = R.cash_counts(BASE)["negative"]
_CASH_ROWS = R.cash_counts(BASE)["rows"]
_ABOVE_OP = R.profit_counts(BASE)["above_operating"]
_LOSS = R.profit_counts(BASE)["loss"]

refuses("a year flipped to negative operating cash raises the count",
        lambda r: _annual(r, 0, cash_from_operating=-1.0),
        lambda r: R.cash_counts(r)["negative"], _CASH_NEG + 1)
refuses("a year with no operating-cash figure lowers the rows counted",
        lambda r: _annual(r, 0, cash_from_operating=None),
        lambda r: R.cash_counts(r)["rows"], _CASH_ROWS - 1)
refuses("earnings made below the operating line are counted",
        lambda r: _annual(r, 0, net_profit=1e9, operating_profit=1.0),
        lambda r: R.profit_counts(r)["above_operating"], _ABOVE_OP + 1)
# Row 1, not row 0: this row's FY2017 is ALREADY a loss, so flipping it to
# negative changes nothing and the case passed while testing nothing. That is
# the "mutation that cannot fail" trap in miniature — the suite reported
# CAUGHT because the count matched, not because the rule worked.
refuses("a loss year is counted",
        lambda r: _annual(r, 1, net_profit=-1.0, operating_profit=1.0),
        lambda r: R.profit_counts(r)["loss"], _LOSS + 1)
permits("a year missing operating profit leaves the pair count honest",
        lambda r: _annual(r, 0, operating_profit=None),
        lambda r: R.profit_counts(r)["rows"],
        R.profit_counts(BASE)["rows"] - 1)
permits("no annual block counts zero rather than guessing",
        lambda r: r.pop("annual", None),
        lambda r: R.cash_counts(r)["rows"], 0)


# ---------------------------------------------------------------------------
# pack flags: bucketed by the claim they make
# ---------------------------------------------------------------------------
def _flags(row, *fs):
    row.setdefault("earnings_quality", {})["flags"] = list(fs)


refuses("a margin-step flag is bucketed as a margin step",
        lambda r: _flags(r, "Operating margin stepped down 9pp"),
        lambda r: R.pack_flags(r)["margin_step"],
        ["Operating margin stepped down 9pp"])
refuses("a cash-conversion deterioration is not bucketed as a level",
        lambda r: _flags(r, "Cash conversion deterioration over 3y"),
        lambda r: R.pack_flags(r)["cash_level"], [])
refuses("a flag nobody has a bucket for is kept, not dropped",
        lambda r: _flags(r, "Something the pack learned to say last Tuesday"),
        lambda r: R.pack_flags(r)["other"],
        ["Something the pack learned to say last Tuesday"])


# ---------------------------------------------------------------------------
# the price series the momentum ranks are computed on
# ---------------------------------------------------------------------------
# 449 and 450 are written as LITERALS, not as `R.PRICEHIST_MIN - 1`. The first
# version of these two cases read the threshold off the module under test, so
# the probe moved with the rule and the pair stayed green no matter what the
# constant was set to — a check that cannot fail, caught only by sabotaging the
# library and finding the suite indifferent. A threshold test that imports its
# threshold is testing nothing.
refuses("one bar under the window the momentum metrics need",
        lambda r: r.setdefault("technicals", {}).update({"bars": 449}),
        lambda r: (R.price_history(r) or {}).get("bars"), 449)
permits("exactly the declared minimum of 450 bars is enough",
        lambda r: r.setdefault("technicals", {}).update({"bars": 450}),
        R.price_history, None)
permits("an unknown bar count is not a short series",
        lambda r: r.setdefault("technicals", {}).update({"bars": None}),
        R.price_history, None)


# ---------------------------------------------------------------------------
# delivery and shareholding alignment
# ---------------------------------------------------------------------------
refuses("thirteen sessions is a print and the count is surfaced",
        lambda r: r.setdefault("delivery", {}).update({"sessions": 13}),
        lambda r: R.delivery_state(r)["sessions"], 13)
refuses("filings in two different months are not an aligned ownership rank",
        lambda r: r["peer_ranks"]["cohort"].update(
            {"shareholding_as_of": {"aligned": False, "rows_with_filing": 51,
                                    "periods": ["2026-06-30", "2026-03-31"]}}),
        lambda r: (R.shareholding_alignment(r) or {}).get("rows_with_filing"),
        51)
permits("aligned filings raise nothing",
        lambda r: r["peer_ranks"]["cohort"].update(
            {"shareholding_as_of": {"aligned": True, "rows_with_filing": 51}}),
        R.shareholding_alignment, None)
permits("an absent alignment block is not a misalignment claim",
        lambda r: r["peer_ranks"]["cohort"].pop("shareholding_as_of", None),
        R.shareholding_alignment, None)


# ---------------------------------------------------------------------------
# the degenerate row: every rule must flag rather than raise
# ---------------------------------------------------------------------------
_EMPTY: dict = {}
for _name, _probe in (
        ("band_state", lambda: R.band_state(_EMPTY)),
        ("band_figures", lambda: R.band_figures(_EMPTY)),
        ("withheld_metrics", lambda: R.withheld_metrics(_EMPTY, FLOOR)),
        ("rankable_metrics", lambda: R.rankable_metrics(_EMPTY, FLOOR)),
        ("tie_requirement", lambda: R.tie_requirement({})),
        ("thin_reads", lambda: R.thin_reads(_EMPTY)),
        ("pillar_denominators", lambda: R.pillar_denominators(_EMPTY)),
        ("pillar_caveats", lambda: R.pillar_caveats(_EMPTY)),
        ("cash_counts", lambda: R.cash_counts(_EMPTY)),
        ("profit_counts", lambda: R.profit_counts(_EMPTY)),
        ("pack_flags", lambda: R.pack_flags(_EMPTY)),
        ("price_history", lambda: R.price_history(_EMPTY)),
        ("delivery_state", lambda: R.delivery_state(_EMPTY)),
        ("shareholding_alignment", lambda: R.shareholding_alignment(_EMPTY))):
    survives(f"an empty row flags rather than crashing: {_name}", _probe)


def main() -> int:
    bad = [r for r in results if r[0] in ("MISSED", "OVEREAGER", "CRASH")]
    counts: dict[str, int] = {}
    for outcome, _c, _d in results:
        counts[outcome] = counts.get(outcome, 0) + 1
    order = ("CAUGHT", "HELD", "SURVIVED", "MISSED", "OVEREAGER", "CRASH")
    print(f"{len(results)} mutation(s): " + ", ".join(
        f"{counts[k]} {k.lower()}" for k in order if k in counts))
    for outcome, case, detail in results:
        if outcome in ("MISSED", "OVEREAGER", "CRASH"):
            print(f"  {outcome} {case}\n           {detail}")
        elif VERBOSE:
            print(f"  {outcome} {case}")
    if not bad:
        print("every refusal fires on its own broken input, and every "
              "boundary case is still allowed through.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
