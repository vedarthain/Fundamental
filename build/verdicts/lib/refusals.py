"""The refusal rules, written down once.

WHY THIS FILE EXISTS
--------------------
Twenty-one `mk_*.py` generators have each re-derived the same handful of rules
about when a number may NOT be stated: a band too wide to price a row, a rank
whose tie covers so much of the bucket that it is not a rank, a reading carried
by too few peers to position against, a pillar percentile computed on part of
its declared weight. `BAND_RATIO_MAX = 5.0` appears verbatim in six of them.

That was tolerable at five symbols a batch. It is not tolerable for the 2,773
scored symbols with no verdict, which is what `SPEC-evidence-sheet.md` proposes
to cover. So the rules move here.

WHAT IS A RULE AND WHAT IS A MEASUREMENT
----------------------------------------
The distinction this file is built on, and the reason the extraction is not
simply a copy-paste:

* The **rule** is universal. "No ordinal may be stated for a reading carried by
  fewer peers than the cohort's floor" holds in every cluster.
* The **value** is per-batch and was MEASURED. The floor is 27 in leisure,
  28/17 in cement, 19 in textiles — because each was read off that cohort's
  thinnest anchored reading.

So every function here takes its thresholds as arguments with the defaults that
were in fact uniform across batches, and takes nothing on faith that varied.
A function that silently baked in one batch's floor would be exactly the
"seeded once, nothing maintains it" failure this codebase keeps shipping.

WHAT THIS FILE MUST NOT DO
--------------------------
No prose. No adjectives. No judgment. Every function answers "may this number
be stated, and if not, why not" and returns the reason as a machine-readable
tag, never as a sentence. Rendering belongs to the template layer; grading
belongs to a human.

PROOF OBLIGATION
----------------
`replay_refusals.py` runs these functions over every surviving pack and
compares them against the constants the generators measured BY HAND
(`BAND_REASON`, `CASHYRS`, `LOSSYRS`, `THIN_READS`, `PILLAR_WEIGHT`,
`PRICEHIST_BARS`). If this file cannot reproduce what twenty-one hand-written
guard sets already assert, these were never rules — they were my judgment each
time — and the evidence sheet cannot be built on them.
"""
from __future__ import annotations

# The thresholds that were in fact uniform across every batch written so far.
# Each is stated here ONCE rather than retyped, and each is overridable,
# because a cluster that needs a different one needs it visibly at the call
# site rather than silently in a copy.
BAND_RATIO_MAX = 5.0   # high/low above this and the band cannot price the row
BAND_MIN_N = 5         # fewer readings than this and there is no band at all
TIE_DIVISOR = 3        # a tie covering more than 1/3 of the bucket is no rank
PRICEHIST_MIN = 450    # a 252-day window above a 200-day EMA needs this many

# Reason tags. Machine-readable, deliberately not sentences.
BAND_ABSENT = "band_absent"
BAND_WIDE = "band_wide"
NOT_RANKABLE = "not_rankable"
SUB_FLOOR = "sub_floor_denominator"
WIDE_TIE = "tie_over_bucket_fraction"
THIN = "thin_reading"


# --------------------------------------------------------------------------
# the band
# --------------------------------------------------------------------------
def band_state(row: dict, ratio_max: float = BAND_RATIO_MAX,
               min_n: int = BAND_MIN_N) -> str | None:
    """Three-valued: BAND_ABSENT, BAND_WIDE, or None meaning usable.

    Three-valued and not two, because "absent" and "too wide" are different
    findings with different sentences, and collapsing them is how a batch ends
    up with nobody quoting a band and no guard noticing.
    """
    band = row.get("pe_band") or {}
    lo, hi, n = band.get("lo"), band.get("hi"), band.get("n")
    if not band or not lo or (n or 0) < min_n:
        return BAND_ABSENT
    if (hi / lo) > ratio_max:
        return BAND_WIDE
    return None


def band_figures(row: dict) -> tuple | None:
    """(n, lo, hi, avg) when the band is usable, else None.

    Returns the figures only in the state where they may be stated, so a
    caller cannot accidentally render a band this module just refused.
    """
    if band_state(row) is not None:
        return None
    b = row["pe_band"]
    return (b["n"], b["lo"], b["hi"], b["avg"])


# --------------------------------------------------------------------------
# ranks: which readings may carry a position at all
# --------------------------------------------------------------------------
def withheld_metrics(row: dict, floor: int,
                     tie_divisor: int = TIE_DIVISOR) -> dict[str, str]:
    """metric -> reason tag, for every metric that may NOT carry an ordinal.

    `floor` is the caller's measurement of the thinnest reading this cohort
    anchors on; it is required rather than defaulted precisely because it
    varied in every batch.
    """
    out: dict[str, str] = {}
    pr = row.get("peer_ranks") or {}
    n = (pr.get("cohort") or {}).get("n") or 0
    for k, d in (pr.get("metrics") or {}).items():
        if not d or not d.get("rankable"):
            out[k] = NOT_RANKABLE
            continue
        if (d.get("of") or 0) < floor:
            out[k] = SUB_FLOOR
            continue
        if n and (d.get("tied") or 1) * tie_divisor > n:
            out[k] = WIDE_TIE
    return out


def rankable_metrics(row: dict, floor: int,
                     tie_divisor: int = TIE_DIVISOR) -> dict[str, dict]:
    """The complement: metric -> its rank block, for readings a position may
    be stated on. The two functions are written as a pair so a caller cannot
    enumerate one and forget the other."""
    pr = row.get("peer_ranks") or {}
    bad = withheld_metrics(row, floor, tie_divisor)
    return {k: d for k, d in (pr.get("metrics") or {}).items()
            if k not in bad}


def tie_requirement(d: dict) -> tuple[int, tuple[int, int]] | None:
    """(tied, (span_lo, span_hi)) when a rank sits in a tie that must be
    declared alongside it, else None. A tie small enough to state is still a
    tie, and a rank stated without it is wrong by omission."""
    tied = d.get("tied") or 1
    if tied <= 1:
        return None
    span = d.get("tie_span") or [None, None]
    return tied, (span[0], span[1])


def thin_reads(row: dict, min_fraction: float = 0.95) -> dict[str, int]:
    """metric -> how many peers carry it, for readings covering less than
    `min_fraction` of the cohort but still at or above the floor.

    These may be ranked, but only beside a statement of how thin the reading
    is: a rank of 9th of 41 inside a 62-row bucket places the row among 41
    peers, not 62, and a reader cannot see that from the ordinal.
    """
    pr = row.get("peer_ranks") or {}
    n = (pr.get("cohort") or {}).get("n") or 0
    out: dict[str, int] = {}
    if not n:
        return out
    for k, d in (pr.get("metrics") or {}).items():
        if not d or not d.get("rankable"):
            continue
        of = d.get("of") or 0
        if of and of < n * min_fraction:
            out[k] = of
    return out


def pillar_denominators(row: dict) -> dict[str, int]:
    """pillar/score key -> the count it is actually read across.

    Separate from the cohort size on purpose. A single-tier batch does not
    remove the denominator trap, it moves it here: quality across 62 while
    valuation is across 61 is invisible to a reader and to every other check.
    """
    pr = row.get("peer_ranks") or {}
    return {k: d["of"] for k, d in (pr.get("scores") or {}).items()
            if d and d.get("of") is not None}


# --------------------------------------------------------------------------
# pillar weights: a percentile computed on part of its declared weight
# --------------------------------------------------------------------------
def pillar_caveats(row: dict, min_shortfall: float = 0.0) -> dict[str, dict]:
    """pillar -> {covered, declared, missing} for any pillar scored on less
    than its declared weight.

    The figure may still be quoted, but only in the same breath as what is
    missing underneath it, and never in a headline that has no room for the
    caveat.

    `min_shortfall` IS THE RULE THAT WAS NEVER WRITTEN DOWN. Every generator
    applied a materiality threshold here and none of them declared it, so they
    disagreed: realty disclosed a quality pillar at 92.8 of 100 while defense
    left the same 92.8 silent, and media disclosed quality at 80.2 while
    leaving valuation at 85 unsaid. The replay found six published verdicts
    quoting a pillar percentile over an undisclosed shortfall of 5 to 15
    points.

    The default is 0.0 — disclose ANY shortfall — because this library exists
    to serve a templated sheet where the caveat costs a clause, not a session,
    and because the alternative is to pick a number that happens to match
    history. A caller who wants the old behaviour has to name the threshold and
    own it.
    """
    out: dict[str, dict] = {}
    cov = row.get("scorecard_coverage") or {}
    for pillar, d in (cov.get("pillars") or {}).items():
        cw, dw = d.get("covered_weight"), d.get("declared_weight")
        if cw is None or dw is None or (dw - cw) <= min_shortfall:
            continue
        out[pillar] = {"covered": cw, "declared": dw,
                       "missing": sorted((d.get("missing") or {}).keys())}
    return out


# --------------------------------------------------------------------------
# the annual record: counted, never characterised
# --------------------------------------------------------------------------
def cash_counts(row: dict) -> dict:
    """{'rows': n, 'negative': n, 'cfo_op_latest': x} over the annual rows that
    actually carry an operating-cash figure.

    Counted off `annual` rather than read off a summary field, because the
    summary is what goes stale: a restated history has to change this number
    rather than leave a sentence behind it.
    """
    yrs = [r for r in (row.get("annual") or [])
           if r.get("cash_from_operating") is not None]
    return {"rows": len(yrs),
            "negative": sum(1 for r in yrs if r["cash_from_operating"] < 0),
            "cfo_op_latest": (row.get("earnings_quality") or {}).get(
                "cfo_op_latest")}


def profit_counts(row: dict) -> dict:
    """{'rows': n, 'loss': n, 'above_operating': n} over the annual rows that
    carry BOTH net profit and operating profit.

    `above_operating` is the one that matters for pricing: a row whose earnings
    are made below the operating line cannot carry an uncaveated earnings
    multiple, and nothing else in the pack says so.
    """
    pairs = [r for r in (row.get("annual") or [])
             if r.get("net_profit") is not None
             and r.get("operating_profit") is not None]
    return {"rows": len(pairs),
            "loss": sum(1 for r in pairs if r["net_profit"] < 0),
            "above_operating": sum(1 for r in pairs
                                   if r["net_profit"] > r["operating_profit"])}


def pack_flags(row: dict) -> dict[str, list[str]]:
    """The pack's own earnings-quality flags, bucketed by the kind of claim
    they make. Bucketed rather than passed through, because the prose rule
    differs per kind: a margin step must sit beside either margin term, a
    cash-conversion fall may be called a deterioration and a cash-conversion
    level may not.
    """
    out: dict[str, list[str]] = {"margin_step": [], "cash_level": [],
                                 "cash_deterioration": [], "below_operating": [],
                                 "other": []}
    for f in ((row.get("earnings_quality") or {}).get("flags") or []):
        low = f.lower()
        if "operating margin stepped" in low:
            out["margin_step"].append(f)
        elif "deterioration" in low:
            out["cash_deterioration"].append(f)
        elif "cash conversion" in low:
            out["cash_level"].append(f)
        elif "below ebit" in low or "outran operating profit" in low:
            out["below_operating"].append(f)
        else:
            out["other"].append(f)
    return out


# --------------------------------------------------------------------------
# the series the momentum ranks are computed on
# --------------------------------------------------------------------------
def price_history(row: dict, min_bars: int = PRICEHIST_MIN) -> dict | None:
    """{'bars': n, 'min': min_bars} when the series is too short for the
    momentum window to mean what it says, else None."""
    bars = (row.get("technicals") or {}).get("bars")
    if bars is None or bars >= min_bars:
        return None
    return {"bars": bars, "min": min_bars}


def delivery_state(row: dict) -> dict:
    """{'sessions': n} — and the rule the caller must honour: a delivery figure
    may not be stated off a handful of sessions. Thirteen sessions is a print,
    not a series, and zero sessions is an absence that has to be named rather
    than passed over."""
    return {"sessions": (row.get("delivery") or {}).get("sessions")}


# --------------------------------------------------------------------------
# shareholding: whether an ownership rank is read across aligned filings
# --------------------------------------------------------------------------
def shareholding_alignment(row: dict) -> dict | None:
    """{'periods': [...], 'rows_with_filing': n} when the cohort's filings are
    NOT aligned, else None. An ownership rank read across rows that filed in
    different months is a rank across different dates, and the reader cannot
    see that from the ordinal."""
    al = (((row.get("peer_ranks") or {}).get("cohort") or {})
          .get("shareholding_as_of") or {})
    if not al or al.get("aligned") is not False:
        return None
    return {"periods": al.get("periods") or [],
            "rows_with_filing": al.get("rows_with_filing")}
