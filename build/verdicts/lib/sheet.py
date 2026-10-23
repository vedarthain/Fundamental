"""The evidence-sheet renderer: every number traced to the pack by construction.

WHY A PROVENANCE WRAPPER AND NOT JUST CAREFUL TEMPLATES
-------------------------------------------------------
`verdict-check.py` exists because hand-written prose can carry a figure that
traces to nothing, and it can only ever report a ratio — 1,117 numeric tokens,
211 untraced — because a human sentence legitimately contains years, thresholds
and counts the pack never held. The ratio is a signal, not a proof.

Here the proof is achievable, so it is taken: a sentence is assembled from two
kinds of piece and nothing else.

* `t(text)` — literal connective tissue. **Rejects any digit.** This is the
  whole trick. If literal text cannot contain a digit, then every digit in the
  output came through `f()`.
* `f(path, fmt)` — a value read from the pack at `path`, formatted. Records
  (path, raw value, rendered token).

So "every number traces to a pack field" is not a check that runs afterwards
and hopes; it is a property the type enforces while the sentence is built.
`check_sheet.py` then verifies it independently, because a rule that is only
enforced by the thing it governs is a rule nobody is checking.

WHAT THIS BUYS BEYOND TRACING
-----------------------------
Two problems that cost whole sessions in the hand-written batches disappear:

1. **The banned-phrase problem.** `BANNED_PHRASES` exists in every generator
   because hand prose translates `cfo_pat_3y` into English as "cash
   conversion", and the English for a column this cluster does not carry reads
   as a claim about a number that does not exist. A sheet names metrics with
   the pack's own keys inside `<code>` tags and never translates, so there is
   no English to be wrong.
2. **The headline-escaping problem.** There is no headline. A sheet has no
   verdict label, so the JSX text child that escapes `<code>` never arises.

WHAT THIS FILE MUST NOT GROW
----------------------------
No adjective that grades a row. No action word. No falsification trigger. If a
sentence here ever needs a judgment to be true, it belongs in a hand-written
verdict and not in a sheet.
"""
from __future__ import annotations

import re

import refusals as R

_DIGIT = re.compile(r"\d")


class Sentence:
    """One sentence, assembled so that every digit in it has a known source."""

    def __init__(self) -> None:
        self._out: list[str] = []
        self.prov: list[tuple[str, object, str]] = []

    def t(self, text: str) -> "Sentence":
        """Literal text. Rejects digits — that is what makes tracing total."""
        if _DIGIT.search(text):
            raise ValueError(
                f"literal text may not contain a digit: {text!r}. Every "
                f"number must come through f() so it carries a pack path.")
        self._out.append(text)
        return self

    def f(self, path: str, value, fmt: str = "{}") -> "Sentence":
        """A value read from the pack at `path`, rendered with `fmt`."""
        token = fmt.format(value)
        self.prov.append((path, value, token))
        self._out.append(token)
        return self

    def code(self, key: str) -> "Sentence":
        """A metric named by the pack's own key. Never translated to English."""
        if _DIGIT.search(key):
            # metric keys legitimately carry horizons: np_cagr_5y. The digits
            # are part of the column name, not a measurement, so they are
            # recorded with the key as their own provenance rather than
            # pretending they came from a value.
            self.prov.append((f"metric_key:{key}", key, key))
        self._out.append(f"<code>{key}</code>")
        return self

    def __str__(self) -> str:
        return "".join(self._out)

    def __bool__(self) -> bool:
        return bool(self._out)


class Block:
    """A titled group of sentences, which is what the UI renders as a point."""

    def __init__(self, title: str) -> None:
        self.title = title
        self.sentences: list[Sentence] = []

    def add(self, s: Sentence) -> "Block":
        if s:
            self.sentences.append(s)
        return self

    @property
    def text(self) -> str:
        return " ".join(str(s) for s in self.sentences)

    @property
    def prov(self) -> list[tuple[str, object, str]]:
        return [p for s in self.sentences for p in s.prov]


# ---------------------------------------------------------------------------
# the blocks
# ---------------------------------------------------------------------------
def _cohort_block(row: dict) -> Block:
    b = Block("Cohort")
    c = (row.get("peer_ranks") or {}).get("cohort") or {}
    w = (row.get("scorecard_coverage") or {}).get("pillar_weights") or {}
    s = Sentence().t("Read against ").f("peer_ranks.cohort.n", c.get("n"))
    s.t(" peers in the ").code(str(c.get("cluster_id")))
    s.t(" ").t(str(c.get("tier"))).t(" tier, weighted quality ")
    s.f("scorecard_coverage.pillar_weights.q", w.get("q"))
    s.t(", valuation ").f("scorecard_coverage.pillar_weights.v", w.get("v"))
    s.t(" and momentum ").f("scorecard_coverage.pillar_weights.m", w.get("m"))
    s.t(".")
    return b.add(s)


def _pillar_block(row: dict, min_shortfall: float = 0.0) -> Block:
    """Each pillar percentile with ITS OWN denominator, plus the shortfall.

    The denominators are stated per pillar rather than once, because they are
    not the cohort size and need not agree with each other: a single-tier
    cluster can read quality across 62 rows and valuation across 61.
    """
    b = Block("The four pillars")
    scores = (row.get("peer_ranks") or {}).get("scores") or {}
    caveats = R.pillar_caveats(row, min_shortfall)
    for key, pillar in (("quality_pct", "quality"),
                        ("valuation_pct", "valuation"),
                        ("momentum_pct", "momentum"),
                        ("composite_pct", None)):
        d = scores.get(key) or {}
        if not d.get("rankable"):
            continue
        s = Sentence().code(key).t(" ")
        s.f(f"peer_ranks.scores.{key}.value", d.get("value"), "{:.0f}")
        tie = R.tie_requirement(d)
        s.t(" is ")
        if tie:
            s.t("tied ")
        s.f(f"peer_ranks.scores.{key}.rank_high", d.get("rank_high"))
        s.t(" of ").f(f"peer_ranks.scores.{key}.of", d.get("of"))
        if tie:
            s.t(", in a ").f(f"peer_ranks.scores.{key}.tied", tie[0])
            s.t("-way tie spanning positions ")
            s.f(f"peer_ranks.scores.{key}.tie_span.0", tie[1][0])
            s.t(" to ").f(f"peer_ranks.scores.{key}.tie_span.1", tie[1][1])
        cv = caveats.get(pillar) if pillar else None
        if cv:
            s.t(". It is computed on ")
            s.f(f"scorecard_coverage.pillars.{pillar}.covered_weight",
                cv["covered"], "{:g}")
            s.t(" of its declared ")
            s.f(f"scorecard_coverage.pillars.{pillar}.declared_weight",
                cv["declared"], "{:g}")
            s.t(" points; absent underneath it: ")
            for i, k in enumerate(cv["missing"]):
                if i:
                    s.t(", ")
                s.code(k)
        s.t(".")
        b.add(s)
    return b


def _rank_block(row: dict, floor: int) -> Block:
    """Readings a position may be stated on, with the tie declared when there
    is one and the thinness declared when the reading covers less than the
    cohort."""
    b = Block("What the data positions")
    thin = R.thin_reads(row)
    for k, d in sorted(R.rankable_metrics(row, floor).items()):
        s = Sentence().code(k).t(" ")
        s.f(f"peer_ranks.metrics.{k}.value", d.get("value"), "{:g}")
        tie = R.tie_requirement(d)
        s.t(" is ")
        if tie:
            s.t("tied ")
        s.f(f"peer_ranks.metrics.{k}.rank_high", d.get("rank_high"))
        s.t(" of ").f(f"peer_ranks.metrics.{k}.of", d.get("of"))
        if tie:
            s.t(", in a ").f(f"peer_ranks.metrics.{k}.tied", tie[0])
            s.t("-way tie spanning positions ")
            s.f(f"peer_ranks.metrics.{k}.tie_span.0", tie[1][0])
            s.t(" to ").f(f"peer_ranks.metrics.{k}.tie_span.1", tie[1][1])
        if k in thin:
            s.t(", a reading carried by ")
            s.f(f"peer_ranks.metrics.{k}.of", thin[k])
            s.t(" of the cohort rather than all of it")
        s.t(".")
        b.add(s)
    return b


def _record_block(row: dict) -> Block:
    """The annual record, counted. No characterisation of what the counts mean."""
    b = Block("The annual record")
    cash, prof = R.cash_counts(row), R.profit_counts(row)
    if cash["rows"]:
        s = Sentence().t("Operating cash is present in ")
        s.f("annual[].cash_from_operating", cash["rows"])
        s.t(" annual rows and negative in ")
        s.f("annual[].cash_from_operating<0", cash["negative"]).t(".")
        if cash["cfo_op_latest"] is not None:
            s.t(" The latest year converted ")
            s.f("earnings_quality.cfo_op_latest", cash["cfo_op_latest"],
                "{:.3f}")
            s.t(" of operating profit into operating cash.")
        b.add(s)
    if prof["rows"]:
        s = Sentence().t("Net profit is present in ")
        s.f("annual[].net_profit", prof["rows"])
        s.t(" annual rows, negative in ")
        s.f("annual[].net_profit<0", prof["loss"])
        s.t(", and above operating profit in ")
        s.f("annual[].net_profit>operating_profit", prof["above_operating"])
        s.t(".")
        b.add(s)
    for kind, flags in R.pack_flags(row).items():
        if not flags or kind == "other":
            continue
        s = Sentence().t("The pack raises ").t(kind.replace("_", " "))
        s.t(" on this row: ")
        # A flag is pack-authored text and may contain digits, so it cannot go
        # through t(). It is recorded as its own provenance.
        for i, f in enumerate(flags):
            if i:
                s.t(" ")
            s.f("earnings_quality.flags[]", f)
        b.add(s)
    return b


def _withheld_block(row: dict, floor: int) -> Block:
    """What is refused, and why. The reason is the content: a reader who is not
    told why a number is missing assumes it was not looked at."""
    b = Block("What is withheld, and why")
    band = R.band_state(row)
    if band == R.BAND_ABSENT:
        s = Sentence().t("No own-history earnings band: the pack holds too "
                         "few yearly readings to build one.")
        b.add(s)
    elif band == R.BAND_WIDE:
        pb = row.get("pe_band") or {}
        s = Sentence().t("The own-history earnings band is not used to price "
                         "this row: its high is ")
        s.f("pe_band.hi/pe_band.lo", (pb.get("hi") or 0) / (pb.get("lo") or 1),
            "{:.1f}")
        s.t(" times its low, which records an earnings denominator passing "
            "near zero rather than a range a price can sit inside.")
        b.add(s)
    else:
        fig = R.band_figures(row)
        if fig:
            n, lo, hi, avg = fig
            s = Sentence().t("The own-history earnings band over ")
            s.f("pe_band.n", n).t(" yearly readings runs ")
            s.f("pe_band.lo", lo, "{:.2f}").t(" to ")
            s.f("pe_band.hi", hi, "{:.2f}").t(", averaging ")
            s.f("pe_band.avg", avg, "{:.2f}").t(".")
            b.add(s)

    buckets: dict[str, list[str]] = {}
    for k, why in R.withheld_metrics(row, floor).items():
        buckets.setdefault(why, []).append(k)
    reasons = {
        R.NOT_RANKABLE: "carry no comparable reading in this cohort",
        R.SUB_FLOOR: "are carried by fewer peers than this cohort's floor, so "
                     "a position on them would not be a position",
        R.WIDE_TIE: "sit in a tie covering more than a third of the cohort, "
                    "which is not a rank",
    }
    for why, keys in buckets.items():
        s = Sentence().t("No position is stated for ")
        for i, k in enumerate(sorted(keys)):
            if i:
                s.t(", ")
            s.code(k)
        s.t(" — they ").t(reasons[why]).t(".")
        b.add(s)

    ph = R.price_history(row)
    if ph:
        s = Sentence().t("The momentum readings are computed inside a price "
                         "history of ")
        s.f("technicals.bars", ph["bars"]).t(" daily bars, under the ")
        s.f("refusals.PRICEHIST_MIN", ph["min"])
        s.t(" a one-year window above a two-hundred-day average needs.")
        b.add(s)

    al = R.shareholding_alignment(row)
    if al:
        s = Sentence().t("Ownership positions are read across filings that "
                         "are not aligned: ")
        s.f("peer_ranks.cohort.shareholding_as_of.rows_with_filing",
            al["rows_with_filing"])
        s.t(" rows filed, across periods ")
        for i, p in enumerate(al["periods"]):
            if i:
                s.t(", ")
            s.f("peer_ranks.cohort.shareholding_as_of.periods[]", p)
        s.t(".")
        b.add(s)

    d = R.delivery_state(row)
    if d["sessions"] is not None:
        s = Sentence().t("No delivery figure is stated: the pack holds ")
        s.f("delivery.sessions", d["sessions"])
        s.t(" sessions, which is a print rather than a series.")
        b.add(s)
    return b


# Columns that are yes/no flags. A flag cannot be ranked at any tie size: the
# whole cohort sits in one of two groups and there is no order inside either,
# so "1 of 59" is not a position, it is membership. Every hand-written batch
# banned these outright; the tie rule alone does not catch them, because 11
# ties out of 59 clears the one-third test.
#
# DECLARED, not detected, and that is a gap worth naming: the pack does not
# mark a column as binary, so this list is maintained by hand and will go
# stale the moment a new flag column is added. The right fix is a flag in the
# pack builder. Until then, anything added here needs a comment saying why.
BINARY_METRICS = frozenset({
    "ema_stack_bull",           # price above a stack of moving averages: 0 or 1
})


def _ordinal(n: int) -> str:
    """1 -> 1st. Returned as a string so it passes through f(), not t()."""
    if n % 100 in (11, 12, 13):
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


# ---------------------------------------------------------------------------
# labels and units
# ---------------------------------------------------------------------------
# THE UNIT IS READ OFF THE FORMULA, NOT GUESSED FROM THE RANGE.
#
# The pack stores the same kind of quantity two different ways: `opm_now`
# arrives at 47.48 because `compute_ttm_context` multiplies by 100, while
# `op_margin_3y` arrives at 0.1453 because `formulas.op_margin_3y` returns
# `op / s` raw. A blanket times-a-hundred rule is therefore right for about
# half these columns and silently wrong for the rest — and a wrong percentage
# is worse than a raw fraction, because the reader cannot tell it is wrong.
#
# So every entry below was established by reading the function that produces
# the column in etl/src/fundamental_etl/scoring/, and the evidence is named in
# the comment where it is not obvious. Specifically:
#   * CONTEXT_KEYS in scoring/metrics.py — `compute_ttm_context` ends each of
#     ttm_*_pct, opm_now, opm_prev with `* 100.0`, so those five are ALREADY
#     percentages. promoter/fii/dii_pct and shareholders are copied verbatim
#     out of app.shareholding_pattern, which stores percent and a headcount.
#   * everything else comes from scoring/formulas.py and returns a bare ratio.
#
# A key absent from this map renders as stored, with the missing unit said out
# loud in the note. That is the §5 discipline: the gap has to be visible in
# the output, or the map silently decays as columns are added.
PCT = "pct"        # the pack already holds a percentage
FRAC = "frac"      # the pack holds a fraction; shown as a percentage
YEARSHARE = "yrs"  # a fraction that counts YEARS passing a test, not a rate
PP_YR = "pp_yr"    # a yearly slope of a margin: percentage points per year
MULT = "x"         # a multiple or a coverage ratio
DAYS = "days"
COUNT = "n"
INDEX = "idx"      # a composite with no unit at all
BOOL = "bool"

COLUMNS: dict[str, tuple[str, str]] = {
    # --- returns and margins (fractions out of formulas.py) ---------------
    "roce_3y": ("Return on capital, 3-yr avg", FRAC),
    "roce_5y": ("Return on capital, 5-yr avg", FRAC),
    "roe_3y": ("Return on equity, 3-yr avg", FRAC),
    "op_margin_3y": ("Operating margin, 3-yr avg", FRAC),
    "op_margin_5y": ("Operating margin, 5-yr avg", FRAC),
    "ebitda_margin_3y": ("EBITDA margin, 3-yr avg", FRAC),
    "ebitda_margin_5y": ("EBITDA margin, 5-yr avg", FRAC),
    "op_margin_trend": ("Operating-margin slope, 5 yr", PP_YR),
    "op_margin_trend_3y": ("Operating-margin slope, 3 yr", PP_YR),
    "op_margin_trend_7y": ("Operating-margin slope, 7 yr", PP_YR),
    # --- growth (CAGRs and YoY, all fractions) ----------------------------
    "rev_cagr_3y": ("Sales growth, 3-yr compound", FRAC),
    "rev_cagr_5y": ("Sales growth, 5-yr compound", FRAC),
    "rev_cagr_7y": ("Sales growth, 7-yr compound", FRAC),
    "rev_cagr_10y": ("Sales growth, 10-yr compound", FRAC),
    "np_cagr_3y": ("Profit growth, 3-yr compound", FRAC),
    "np_cagr_5y": ("Profit growth, 5-yr compound", FRAC),
    "np_cagr_7y": ("Profit growth, 7-yr compound", FRAC),
    "np_cagr_10y": ("Profit growth, 10-yr compound", FRAC),
    "sales_yoy_q": ("Sales, latest quarter vs year earlier", FRAC),
    "np_yoy_q": ("Profit, latest quarter vs year earlier", FRAC),
    # --- the TTM block: already percentages (see comment above) -----------
    "ttm_sales_pct": ("Sales, last 4 quarters vs prior 4", PCT),
    "ttm_op_pct": ("Operating profit, last 4 quarters vs prior 4", PCT),
    "ttm_np_pct": ("Net profit, last 4 quarters vs prior 4", PCT),
    "opm_now": ("Operating margin, last 4 quarters", PCT),
    "opm_prev": ("Operating margin, the 4 quarters before", PCT),
    # --- cash conversion and capital intensity ----------------------------
    "cfo_pat_3y": ("Operating cash per rupee of net profit, 3-yr avg", MULT),
    "cfo_ebitda_3y": ("Operating cash per rupee of EBITDA, 3-yr avg", MULT),
    "cfo_ebitda_5y": ("Operating cash per rupee of EBITDA, 5-yr avg", MULT),
    "cfo_sales_3y": ("Operating cash as a share of sales, 3-yr avg", FRAC),
    "capex_intensity_3y": ("Capex as a share of sales, 3-yr avg", FRAC),
    "asset_turnover": ("Sales per rupee of assets", MULT),
    # --- balance sheet ----------------------------------------------------
    "debt_equity": ("Borrowings per rupee of equity", MULT),
    "net_debt_ebitda": ("Net debt as a multiple of EBITDA", MULT),
    "dso": ("Receivables, in days of sales", DAYS),
    "inv_days": ("Inventory, in days of sales", DAYS),
    "wc_days": ("Working capital, in days of sales", DAYS),
    # --- valuation --------------------------------------------------------
    "pe_ttm": ("Price to trailing earnings", MULT),
    "pb": ("Price to book value", MULT),
    "peg": ("Price to earnings, over 5-yr profit growth", MULT),
    "ev_ebitda_ttm": ("Enterprise value to trailing EBITDA", MULT),
    "ev_sales_ttm": ("Enterprise value to trailing sales", MULT),
    "div_yield": ("Dividend as a share of market value", FRAC),
    "fcf_yield": ("Free cash as a share of market value", FRAC),
    # --- consistency: shares of YEARS, not rates --------------------------
    # `_np_growth_above_inflation` returns the share of yearly comparisons
    # where profit grew more than 6%; `roe_avg_above_threshold_*` the share of
    # years where return on equity cleared 15%. Both are counts over a window,
    # which is why they get their own unit and a label that says "of years" —
    # read as a plain percentage they look like a growth rate.
    # The denominator here is yearly STEPS, not years: a 10-year window holds
    # nine year-on-year comparisons, so 78% is 7 of 9 and a label reading
    # "years of 10" would misstate the base.
    "np_growth_above_inflation_5y": ("Yearly steps in 5 yr where profit beat "
                                     "inflation", YEARSHARE),
    "np_growth_above_inflation_7y": ("Yearly steps in 7 yr where profit beat "
                                     "inflation", YEARSHARE),
    "np_growth_above_inflation_10y": ("Yearly steps in 10 yr where profit beat "
                                      "inflation", YEARSHARE),
    "roe_avg_above_threshold_5y": ("Years of 5 with return on equity over 15%",
                                   YEARSHARE),
    "roe_avg_above_threshold_7y": ("Years of 7 with return on equity over 15%",
                                   YEARSHARE),
    "roe_avg_above_threshold_10y": ("Years of 10 with return on equity over 15%",
                                    YEARSHARE),
    # `_np_consistency` adds a share of positive years to 1/(1+cv), so it runs
    # 0 to 2 and is not a percentage of anything. Labelled a score on purpose.
    "np_consistency_3y": ("Profit-steadiness score, 3 yr (0-2)", INDEX),
    "np_consistency_5y": ("Profit-steadiness score, 5 yr (0-2)", INDEX),
    "np_consistency_7y": ("Profit-steadiness score, 7 yr (0-2)", INDEX),
    "np_consistency_10y": ("Profit-steadiness score, 10 yr (0-2)", INDEX),
    # --- price ------------------------------------------------------------
    "ret_3m_rel": ("3-month return against the index", FRAC),
    "ret_6m_rel": ("6-month return against the index", FRAC),
    "ret_12m_rel": ("12-month return against the index", FRAC),
    "pct_above_200ema_252d": ("Share of the last 252 sessions above the "
                              "200-day average", FRAC),
    "ema_stack_bull": ("Price above every moving average", BOOL),
    # --- ownership: percent and a headcount, straight from the filing -----
    "promoter_pct": ("Promoter holding", PCT),
    "fii_pct": ("Foreign institutional holding", PCT),
    "dii_pct": ("Domestic institutional holding", PCT),
    "shareholders": ("Shareholders on the register", COUNT),
}


def label(key: str) -> str:
    """The plain-English name, falling back to the pack's own key."""
    return COLUMNS.get(key, (key, None))[0]


def unit(key: str) -> str | None:
    return COLUMNS.get(key, (key, None))[1]


def _num(v, key: str | None = None) -> str:
    """Render a value in its declared unit, or say the unit is not declared.

    Called with no key it stays unit-free, which is what the prose blocks
    want: they name the metric with its pack key and state the raw reading.
    """
    if v is None:
        return "—"
    u = unit(key) if key else None
    if u == BOOL:
        return "yes" if v else "no"
    if u == COUNT:
        return f"{int(v):,}"
    if u == PCT:
        return f"{v:,.1f}%"
    if u == FRAC:
        return f"{v * 100:,.1f}%"
    if u == YEARSHARE:
        return f"{v * 100:,.0f}% of years"
    if u == PP_YR:
        return f"{v * 100:+,.2f} pp/yr"
    if u == MULT:
        return f"{v:,.2f}×"
    if u == DAYS:
        return f"{v:,.0f} days"
    if u == INDEX:
        return f"{v:,.2f}"
    # No declared unit. Shown as stored, and said so — a guessed unit is a
    # wrong number wearing the authority of a right one.
    if isinstance(v, int) or (isinstance(v, float) and v.is_integer()):
        return f"{int(v):,}"
    return f"{v:,.3f}" if abs(v) < 10 else f"{v:,.2f}"


def render_table(row: dict, floor: int) -> dict:
    """The same content as the rank paragraph, as rows of a grid.

    A table is the answer to the one thing a sheet cannot do: choose. Prose
    forces a selection — thirty-eight measurements in one paragraph is a wall,
    and picking five is an opinion, which is the thing this artefact is not
    allowed to have. A grid can be exhaustive and still readable, because the
    eye scans a column instead of reading a list.
    """
    pr = (row.get("peer_ranks") or {}).get("metrics") or {}
    n = ((row.get("peer_ranks") or {}).get("cohort") or {}).get("n") or 0
    withheld = R.withheld_metrics(row, floor)
    thin = R.thin_reads(row)
    rows: list[dict] = []
    prov: list[tuple[str, object, str]] = []

    # Ordered by the position of the column in COLUMNS, which groups margins,
    # growth, cash, balance sheet, valuation, consistency, price, ownership.
    # Alphabetical on the pack key scattered those groups; sorting by the
    # LABEL would scatter them differently. The order is declared once, in the
    # map, so it is not a per-row judgment. Undeclared columns sort last.
    order = {k: i for i, k in enumerate(COLUMNS)}
    for k in sorted(pr, key=lambda k: (order.get(k, len(order)), k)):
        d = pr[k] or {}
        base = f"peer_ranks.metrics.{k}"
        cell = {"metric": k, "label": label(k),
                "value": _num(d.get("value"), k),
                "rank": "", "of": "", "note": ""}
        prov.append((f"{base}.value", d.get("value"), cell["value"]))
        notes_pre: list[str] = []
        if unit(k) is None:
            # A column nobody has declared a unit for. Named in the output
            # rather than quietly formatted, so the map's decay is visible to
            # the reader instead of only to whoever next reads this file.
            notes_pre.append("unit not declared — shown as stored")

        if k in BINARY_METRICS:
            notes_pre.append("yes/no column — no order inside either group")
        elif k in withheld:
            notes_pre.append({
                R.NOT_RANKABLE: "no comparable reading in this cohort",
                R.SUB_FLOOR: f"read by too few peers to position against",
                R.WIDE_TIE: "tie covers over a third of the cohort",
            }[withheld[k]])
            if withheld[k] in (R.SUB_FLOOR, R.WIDE_TIE):
                cell["of"] = _num(d.get("of"))
                prov.append((f"{base}.of", d.get("of"), cell["of"]))
        else:
            tie = R.tie_requirement(d)
            cell["rank"] = _ordinal(d["rank_high"])
            cell["of"] = _num(d.get("of"))
            prov.append((f"{base}.rank_high", d.get("rank_high"),
                         cell["rank"]))
            prov.append((f"{base}.of", d.get("of"), cell["of"]))
            if tie:
                t = (f"tied with {tie[0] - 1} others, positions "
                     f"{tie[1][0]}-{tie[1][1]}")
                notes_pre.append(t)
                prov.append((f"{base}.tied", tie[0], t))
            if k in thin:
                notes_pre.append("not carried by the whole cohort")
        cell["note"] = "; ".join(notes_pre)
        rows.append(cell)

    return {"symbol": row["symbol"], "cohort_n": n, "rows": rows,
            "provenance": prov}


def render(row: dict, floor: int, min_shortfall: float = 0.0) -> dict:
    """The whole sheet for one pack row.

    `floor` is the cohort's thinnest anchored reading and is REQUIRED: it
    varied in every batch and defaulting it would bake one cluster's
    measurement into every cluster.
    """
    blocks = [_cohort_block(row),
              _pillar_block(row, min_shortfall),
              _rank_block(row, floor),
              _record_block(row),
              _withheld_block(row, floor)]
    blocks = [b for b in blocks if b.sentences]
    return {
        "symbol": row["symbol"],
        "blocks": [{"title": b.title, "text": b.text} for b in blocks],
        "withheld": R.withheld_metrics(row, floor),
        "provenance": [p for b in blocks for p in b.prov],
    }
