"""Generate the bfsi_psu_banks batch of 5 — SBIN, BANKBARODA, BANKINDIA,
INDIANB, MAHABANK.

Run from the repo root:
    etl/.venv/bin/python build/verdicts/mk_psu_5.py

then pass 1 and pass 2:
    etl/.venv/bin/python scripts/verdict-check.py /tmp/psu5.json \\
        build/verdicts/psu-5-verdicts.json
    etl/.venv/bin/python build/verdicts/check_psu_5.py


WHY THIS BATCH IS SHAPED THE WAY IT IS

The deliberate choices, numbered, each one asserted below rather than trusted
from this comment.

 1. THE CLUSTER IS BIG ENOUGH, AND THAT IS THE DIFFERENCE FROM THE LAST BATCH.
    `bfsi_psu_banks` has twelve members, above the scorer's MIN_PEERS of 10
    (scorer.py:48), and all twelve carry `score_status` 'full'. So unlike
    it_services_large — six names, every percentile one of six values — these
    percentiles are real ranks and no "direction, not rank" caveat appears in
    any row. The granularity is still 1/11, about nine points, which is why no
    row distinguishes two names by a single percentile step.

 2. SEVEN OF THE TWELVE ARE UNWRITTEN, AND THE BATCH PACK CANNOT SEE THEM.
    Only five PSU banks are watchlisted; the other seven (UNIONBANK, CANBK,
    PNB, CENTRALBK, IOB, UCOBANK, PSB) are untracked and not written. But most
    of the superlatives in this file are scoped "of the twelve", and the
    previous batch shipped two wrong ordinals for exactly this reason: the
    sixth cluster member was absent from the pack, so every six-way check was
    silently a five-way check. PEERS below holds all twelve, read from
    app.metrics_snapshot at the same 2026-10-21 snapshot, and every
    twelve-wide claim is re-derived from it in check_psu_5.py.

    This already earned its keep. The first draft of this batch said no PSU
    bank in the cluster has a bullish EMA stack — true of the five in the
    pack, false of the twelve, because PNB's `ema_stack_bull` is 1.0. See
    choice 6.

 3. THE LENDER EXEMPTION IS THE BATCH-WIDE BLOCKER, AND IT BANS THE METRICS
    THE LAST BATCH WAS BUILT ON. All five carry the same blocker: for this
    cluster the cash-conversion and net-profit-vs-operating-profit tests are
    not applied, because operating cash flow for a bank is deposit and loan
    flow and `operating_profit` is not comparable across lenders. The pack
    still reports `cfo_op_latest` and `np_over_op_gap` unflagged — MAHABANK's
    cash conversion reads -0.559 — and a reader who met those numbers in an IT
    verdict last week would take them as an earnings-quality signal. So
    LENDER appears verbatim in point one of every row, and BANNED_EQ refuses
    the fields outright anywhere in the prose or the evidence.

 4. THE SPINE: NOT ONE OF THE TWELVE HAS EARNED 13% ON EQUITY OVER A DECADE.
    `roe_excess_13_10y` is negative for all twelve, best of them INDIANB at
    -3.62pp. Over five years three are positive (MAHABANK, SBIN, CANBK). That
    is the whole PSU-bank question in two numbers: the profitability is real
    and it is five years old. Any row quoting the field must say the decade
    shortfall is cluster-wide, or a sector fact reads as a company defect.

 5. `np_consistency_10y` IS QUOTED HERE, AND THE LAST BATCH REFUSED IT.
    Not a change of mind — a change of spread. In it_services_large the five
    sat inside 1.8035-1.8586, a 0.055 span on a 0-2 index, so any rank was
    noise. Across these twelve the span is 0.545 to 1.543, a full point. The
    guard asserts the span rather than trusting this paragraph, so if a future
    PSU batch compresses the index the quote stops being allowed.

 6. `ema_stack_bull` IS 0 FOR ELEVEN OF TWELVE, NOT FOR ALL TWELVE.
    PNB is the exception. Any row that quotes the field must say "eleven of
    the twelve" and name PNB; the guard rejects the word "none" near it. This
    is choice 2's near-miss made permanent.

 7. INDIANB'S TTM WINDOW IS ONE QUARTER AHEAD OF THE OTHER FOUR.
    Its `ttm_vs_prior` window is 2025-12-31..2026-09-30; the other four are
    2025-09-30..2026-06-30. So every cross-sectional TTM comparison in this
    batch is a September trailing year against four June trailing years.
    INDIANB's row says so. The guard reads the windows out of the pack, so if
    the others catch up the requirement lifts itself.

 8. ONLY ONE OF THE FIVE PE BANDS IS QUOTABLE, AND SBIN'S IS THE REASON THE
    RULE EXISTS. The rule is n >= 8 and lo >= 4.0 and hi <= 100. BANKBARODA
    passes (n=9, 5.72-31.10). MAHABANK n=7 and BANKINDIA n=6 are too short;
    INDIANB's lo of 3.05 is a loss-year artefact. SBIN's band runs to 969.79x
    with an average of 129.81x — a near-zero-earnings year dividing a normal
    price — and quoting that average would make the most expensive PSU bank in
    the cluster look like a historic bargain. Every non-quotable row says "not
    quotable" rather than leaving the reader to assume the comparison was made
    and came out neutral.

 9. SBIN'S `opm_now` IS THE LOWEST OF THE TWELVE AND THE ROW REFUSES TO
    EXPLAIN IT. 45.02% against a cluster that runs 60-76%, the next lowest IOB
    at 60.29%. SBI's reported revenue spans mutual funds, insurance and equity
    trading alongside lending, so the ratio is probably not measuring the same
    thing as a pure lender's — but the pack does not segment it, so the row
    states the figure, states that it is not comparable, and does not assert
    the cause.

10. `np_cagr_7y` EXISTS FOR ONLY FIVE OF THE TWELVE, SO IT IS NEVER RANKED
    CLUSTER-WIDE. Seven are NULL, BANKINDIA among them — which is also why
    BANKINDIA is the one row whose quality pillar is renormalised, at 95.68%
    of declared weight, and its row says so.

11. NONE OF THE FIVE IS HELD. All five are watchlisted, none has a prior
    verdict. So there is no cost basis anywhere in this batch and no row
    states a return against one.

12. CONFIDENCE VARIES, AND IT CARRIES INFORMATION. The last batch was medium
    across the board because the whole cluster was under the peer floor. Here
    the cluster is full and twelve deep, so BANKBARODA, MAHABANK and SBIN are
    high. BANKINDIA is medium because a quality input is missing and the
    pillar is renormalised (choice 10); INDIANB is medium because its TTM
    window does not line up with the rest (choice 7). Both reasons are stated
    in the row that carries them.

13. `tech_net_score_scaled` IS NULL FOR EVERY SCORED COMPANY ON THE PLATFORM,
    so the momentum pillar scored on 95 of its 100 declared points. Unchanged
    from previous batches and asserted the same way.

14. DELIVERY IS UNUSABLE. `golden.delivery_data` holds 12 distinct sessions,
    so any delivery percentage is a single-day reading. Quoted nowhere.
"""

import json
import re

PACK = "/tmp/psu5.json"
PEERS_PACK = "/tmp/psu12.json"
OUT = "build/verdicts/psu-5-verdicts.json"
GENERATED_AT = "2026-10-22T13:30:00+00:00"
SOURCE_REPORT = "bfsi-psu-banks v1"
MODEL = "claude-opus-4-7"

DERIVED_KEYS = {"pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
                "delivery_pct", "pledge_pct"}

LABELS = ("BUY", "ACCUMULATE", "HOLD", "WATCH", "AVOID", "REDUCE", "SELL",
          "SPECULATIVE")

# Choice 1.
CLUSTER = "bfsi_psu_banks"
CLUSTER_SIZE = 12
MIN_PEERS = 10          # scorer.py:48 — this cluster clears it, unlike the last

# Choice 11.
HELD = set()
WATCHLISTED = {"SBIN", "BANKBARODA", "BANKINDIA", "INDIANB", "MAHABANK"}

# Choice 3. The exemption, verbatim in point one of every row.
LENDER = ("Scored inside <code>bfsi_psu_banks</code> as a balance-sheet "
          "lender: the cash-conversion and net-profit-against-operating-profit "
          "tests are deliberately not applied here, because a bank's operating "
          "cash flow is deposit and loan movement and <code>operating_profit"
          "</code> is not a comparable line between lenders. The pack still "
          "prints those figures unflagged — read them as balance-sheet growth, "
          "not as earnings quality.")

# Choice 3, enforced. These are the fields the previous batch's verdicts were
# built on, and they are exactly the ones the exemption invalidates.
BANNED_EQ = ("cfo_op", "np_over_op_gap", "cash conversion", "cfo_pat",
             "cfo_sales")

# Choice 13.
TNS = ("<code>tech_net_score_scaled</code> is NULL for every scored company on "
       "the platform, so the momentum pillar scored on 95 of its 100 declared "
       "points and renormalised around the components that do exist.")

# Choice 4.
SPINE_FIELD = "roe_excess_13_10y"
SPINE = ("<code>roe_excess_13_10y</code> is negative for all twelve members of "
         "the cluster — not one listed Indian public-sector bank has averaged a "
         "13% return on equity across the last decade")

# Choice 6.
EMA_FIELD = "ema_stack_bull"
EMA_SCOPE = "eleven of the twelve"
EMA_EXCEPTION = "PNB"

# Choice 5. Asserted against PEERS, not trusted.
CONSISTENCY_MIN_SPAN = 0.5

# Choice 8.
BAND_QUOTABLE = {"BANKBARODA"}
BAND_RULE = (8, 4.0, 100.0)

# Choice 7. The symbol whose trailing year ends a quarter later than the rest.
OFF_WINDOW = "INDIANB"

# Choice 12.
CONFIDENCE = {"BANKBARODA": "high", "MAHABANK": "high", "SBIN": "high",
              "BANKINDIA": "medium", "INDIANB": "medium"}

# Choice 2. The scoping rule, unchanged: a superlative is allowed only where
# the point it sits in names its peer set by an explicit count, or points at
# the company's own history.
SCOPE_PHRASES = ("of the five", "of the twelve", "of the eleven", "of the four",
                 "of the three", "of the two", "own history", "own ten-year",
                 "own decade", "own past", "in the batch", "of this batch",
                 "in this batch")
SCOPE_COUNT = re.compile(r"of (?:the |those |only |just )?\d+")
SUPERLATIVES = ("highest", "lowest", "cheapest", "best", "worst", "fastest",
                "slowest", "richest", "smallest", "largest", "biggest",
                "steepest", "flattest", "sharpest", "widest", "thinnest",
                "most expensive", "most consistent", "least")

# Choice 10. Present for five of twelve, so never ranked cluster-wide.
SPARSE_FIELDS = {"np_cagr_7y": 5}

# A rank word, for the sparse-field guard. The guard must fire on "np_cagr_7y
# of 27.09% is the lowest of the twelve" and stay quiet on BANKINDIA's
# "np_cagr_7y is NULL here ... seven of the twelve cluster members lack the
# same field", which is the prose that refuses the rank. The difference is a
# ranking word between the field and the count, not the count itself.
RANK_WORDS = (r"(?:" + "|".join(SUPERLATIVES) + r"|first|second|third|fourth|"
              r"fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|"
              r"top|bottom|rank)")

# The one pass rate this cluster actually scores. roe_avg_above_threshold_Ny
# is NOT in this cluster's quality pillar — it uses roe_excess_13_Ny, which is
# a level in percentage points, not an n-of-N. So the previous batch's "13%"
# anchor is deliberately absent: an anchor for a metric this cluster does not
# score would match the SPINE sentence's "13%" and fail valid prose.
PASS_RATE_ANCHORS = (
    ("inflation", {4, 6, 9}, "np_growth_above_inflation_Ny is n of N-1 "
                             "(5y->4, 7y->6, 10y->9)"),
)
N_OF_N = re.compile(r"\b\d+ of (?:the last )?(\d+)\b")


def _within_sentence(n):
    """Up to n characters that do not cross a sentence boundary.

    `[^.]{0,n}` is the obvious spelling and it is wrong, because every figure
    in this batch has a decimal point in it. The sparse-field guard below was
    written that way, and the negative test that fed it the exact prose it
    exists to reject — "np_cagr_7y of 27.09% is the lowest of the twelve" —
    passed green, because the "." in 27.09 ended the match. A guard that
    cannot fire on its own target is decoration (CLAUDE.md §5). A sentence
    boundary is a period followed by whitespace; a decimal point is not.
    """
    return r"(?:(?!\.\s)[\s\S]){0," + str(n) + r"}"


def _pass_rate_denominators(sym, body):
    starts = sorted(m.start() for a, _, _ in PASS_RATE_ANCHORS
                    for m in re.finditer(re.escape(a), body))
    for anchor, allowed, rule in PASS_RATE_ANCHORS:
        for m in re.finditer(re.escape(anchor), body):
            nxt = next((s for s in starts if s > m.start()), len(body))
            window = body[m.end():min(nxt, m.end() + 140)]
            for hit in N_OF_N.finditer(window):
                n = int(hit.group(1))
                if n not in allowed:
                    raise SystemExit(
                        f"{sym}: {hit.group(0)!r} written within 140 chars of "
                        f"{anchor!r}, but {rule}. Allowed {sorted(allowed)}")


def _blocker_coverage(sym, blockers, body):
    """Every blocker the pack raised has to be visible in the prose."""
    for b in blockers:
        m = re.search(r"scored on (\d+)% of its declared weight", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: a pillar scored on {m.group(1)}% of its "
                             f"declared weight and the prose never says so")
        m = re.search(r"only (\d+) quarters", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: only {m.group(1)} quarters, unstated")
        m = re.search(r"(\d+) price bars", b)
        if m and m.group(1) not in body:
            raise SystemExit(f"{sym}: {m.group(1)} price bars, unstated")
        if "balance-sheet lender" in b and LENDER not in body:
            raise SystemExit(f"{sym}: carries the lender exemption blocker and "
                             f"the prose does not state it verbatim")
        for frag, want, label in (
                ("no delivery row", "delivery", "the missing delivery rows"),
                ("no company overview", "overview", "the missing overview"),
                ("own-history PE band", "band", "the absent PE band"),
                ("composite suppressed", "composite", "the suppressed composite"),
                ("EMA stack", "EMA stack", "the missing EMA stack")):
            if frag in b and want not in body:
                raise SystemExit(f"{sym}: blocker names {label} and the prose "
                                 f"never mentions it")


SPEC = {}

SPEC["BANKBARODA"] = {
    "confidence": "high",
    "verdict": ("WATCH — the top composite of the twelve on a quality and "
                "valuation record that is five to ten years old, and the only "
                "one of the twelve whose trailing profit is actually falling: "
                "-6.67% on the year and -48.6% in the latest quarter"),
    "points": [
        "<b>Not held; on the watchlist.</b> " + LENDER + " The cluster has "
        "twelve members, above the ten-peer floor the scorer needs, so every "
        "percentile below is a real rank among twelve rather than a direction — "
        "but the steps are about nine points wide, so no claim here separates "
        "two banks by one notch. Seven of the twelve are untracked and "
        "unwritten; the counts below say which population they mean.",

        "<b>It scores 100 on composite and is the only one of the twelve losing "
        "money year on year.</b> <code>ttm_np_pct</code> is -6.67%, the only "
        "negative of the twelve, and <code>np_yoy_q</code> is -48.6%, the worst "
        "of the twelve; <code>sales_yoy_q</code> at 6.84% is the lowest of the "
        "twelve as well. The composite is not wrong, it is just slow: this "
        "cluster weights quality 55 and valuation 30 against momentum 15, and "
        "the quality pillar is built from five-, seven- and ten-year histories "
        "that a single bad trailing year cannot move. " + TNS,

        "<b>What the long window sees is genuinely good.</b> "
        "<code>np_cagr_5y</code> of 26.10%, <code>book_value_cagr_10y</code> of "
        "16.16% — fourth of the twelve — and profit growth beat inflation in 3 "
        "of 4 five-year steps, 5 of 6 seven-year steps and 6 of 9 ten-year "
        "steps. " + SPINE + "; Bank of Baroda's shortfall of -6.02pp is the "
        "third-smallest of the twelve, which is the useful way to read it.",

        "<b>It is priced as the market's third-cheapest large PSU bank on book "
        "and it pays for waiting.</b> <code>pb</code> of 0.74 is tenth of "
        "twelve on expensiveness, <code>pe_ttm</code> is 8.13 against an "
        "own-history band of 5.72x to 31.10x averaging 15.28x across nine "
        "years, and <code>div_yield</code> of 3.57% is the second-highest of "
        "the eleven in the cluster that have one. Foreign holding has gone "
        "8.98% to 10.14% across five quarters while the shareholder count fell "
        "from 1,689,797 to 1,460,575 — institutions buying what retail is "
        "leaving.",

        "<i>The disagreement in this row is the whole point, and it is why the "
        "label is WATCH and not ACCUMULATE on a composite of 100. A decade of "
        "compounding and a 0.74x book say buy; a 48.6% quarterly profit "
        "collapse says find out why first, and the pack does not tell you — it "
        "reports the fall without decomposing it into provisions, treasury or "
        "net interest margin. Nor is it only a quarter: full-year net profit "
        "went 20,716 crore in FY2025 to 19,846 crore in FY2026, the first "
        "annual decline after five years of increases. One more quarter "
        "resolves this in either direction, and it is the only thing worth "
        "waiting for.</i>",
    ],
    "trigger": ("np_yoy_q back above zero with opm_now holding 63% -> "
                "ACCUMULATE; a second consecutive quarter of falling profit, "
                "or pb above 1.0 before profit recovers -> AVOID"),
    "evidence": ["ttm_np_pct", "np_yoy_q", "sales_yoy_q", "np_cagr_5y",
                 "book_value_cagr_10y", "roe_excess_13_10y", "pb", "pe_ttm",
                 "div_yield", "fii_pct", "shareholders"],
}

SPEC["MAHABANK"] = {
    "confidence": "high",
    "verdict": ("ACCUMULATE — first of the twelve on return on equity over "
                "three, five and seven years, on assets, on loan growth and on "
                "twelve-month relative return, and the most expensive of the "
                "twelve on book at 1.85x; the decade record is the eighth-worst "
                "of the twelve and that gap is the investment case"),
    "points": [
        "<b>Not held; on the watchlist.</b> " + LENDER + " The cluster has "
        "twelve members, above the ten-peer floor, so the percentiles are real "
        "ranks among twelve; seven of the twelve are untracked and unwritten, "
        "and the counts below say which population they mean. Note before any "
        "of the figures: the pack prints this bank's latest cash conversion at "
        "-0.559, which under the exemption above is deposit and loan movement "
        "and is not read here as a quality signal at all.",

        "<b>On every recent measure of profitability it is first of the "
        "twelve.</b> <code>roe_3y</code> 20.30%, <code>roe_5y</code> 17.12%, "
        "<code>roe_7y</code> 13.42%, <code>roa_3y</code> 1.49%, "
        "<code>loan_book_cagr_3y</code> 16.86%, <code>np_cagr_5y</code> 57.05% "
        "and <code>ttm_sales_pct</code> 15.83% — the top of the cluster on all "
        "seven. Profit growth beat inflation in 4 of 4 five-year steps and 6 of "
        "6 seven-year steps. Counted across the 28 cluster metrics where a "
        "higher reading is the better one, it ranks first of the twelve on "
        "eleven of them; the next bank in the cluster leads on six, and no "
        "other name in this batch leads on more than four.",

        "<b>The decade undoes most of it.</b> " + SPINE + ", and Bank of "
        "Maharashtra's shortfall of -14.63pp is the eighth-worst of the twelve "
        "— worse than six of its peers, including three it now beats on every "
        "recent horizon. Over five years its <code>roe_excess_13_5y</code> is "
        "+4.12pp, the best of the twelve and one of only three positive "
        "readings in the cluster. So the correct description is a repaired "
        "bank, not a good one, and the annual record says exactly when the "
        "repair happened: losses in FY2017, FY2018 and FY2019 — the last of "
        "them 4,763 crore — then profitable every year since FY2020, with net "
        "profit going from 399 crore in FY2020 to 7,017 crore in FY2026. A "
        "single 4,763 crore loss three years into a ten-year window is enough "
        "to swamp the decade average on its own.",

        "<b>You are paying the cluster's highest price for that repair.</b> "
        "<code>pb</code> of 1.85 is the most expensive of the twelve, "
        "<code>pe_ttm</code> of 8.15 only mid-cluster, and "
        "<code>div_yield</code> of 1.50% is the lowest of the eleven in the "
        "cluster that pay one. Its own PE band is not quotable — seven years of "
        "history against the eight this platform requires — so no "
        "cheap-or-dear-against-itself claim is made here. The government cut "
        "its stake from 79.60% to 73.60% in the December 2025 quarter and "
        "foreign holding went 1.72% to 5.82% across five quarters, better than "
        "tripling into the float that sale created. " + TNS,

        "<i>The price is the risk and the operating record is the reason to pay "
        "it anyway. <code>ret_12m_rel</code> of +47.06% is the best of the "
        "twelve and <code>pct_above_200ema_252d</code> is 1.00 — it closed "
        "above its 200-day average on every session of the last year, the only "
        "bank of the twelve to do so. That is not a cheap entry and nothing "
        "here pretends otherwise; it is a bank whose three-year return on "
        "equity is 20% in a cluster averaging low teens, and the 1.85x book is "
        "what that costs. ACCUMULATE means in pieces, not at once.</i>",
    ],
    "trigger": ("roe_3y holding above 18% through two more quarters -> add; "
                "pb above 2.2x, or roe_3y back under 15% -> HOLD and stop "
                "adding"),
    "evidence": ["roe_3y", "roe_5y", "roe_7y", "roa_3y", "loan_book_cagr_3y",
                 "np_cagr_5y", "ttm_sales_pct", "roe_excess_13_10y",
                 "roe_excess_13_5y", "pb", "pe_ttm", "div_yield",
                 "ret_12m_rel", "pct_above_200ema_252d", "promoter_pct",
                 "fii_pct", "np_growth_above_inflation_5y",
                 "np_growth_above_inflation_7y"],
}

SPEC["BANKINDIA"] = {
    "confidence": "medium",
    "verdict": ("WATCH — the cheapest of the twelve on both earnings and book, "
                "5.33x and 0.70x, and eighth or ninth of the twelve on every "
                "measure of what it earns on that book; the cheapness is a "
                "price for the returns, not a discount to them"),
    "points": [
        "<b>Not held; on the watchlist.</b> " + LENDER + " The cluster has "
        "twelve members, above the ten-peer floor, so the percentiles are real "
        "ranks among twelve; seven of the twelve are untracked and unwritten. "
        "This row is medium confidence rather than high for a specific reason "
        "given in point four: one of its quality inputs is missing and the "
        "pillar was renormalised to cover it.",

        "<b>It is the cheapest bank in the cluster on both multiples at "
        "once.</b> <code>pe_ttm</code> of 5.33 and <code>pb</code> of 0.70 are "
        "both the lowest of the twelve, and the valuation pillar scores it 90. "
        "The trailing quarter looks like a turn, too: <code>np_yoy_q</code> of "
        "+80.51% is the highest of the twelve and <code>ttm_np_pct</code> of "
        "+24.13% is fifth. <code>opm_now</code> of 72.26% is the third-highest "
        "of the twelve. " + TNS,

        "<b>And it earns less on that book than almost anyone in the "
        "cluster.</b> <code>roe_3y</code> 10.86% is ninth of the twelve, "
        "<code>roe_5y</code> 9.02% is eighth, <code>roe_7y</code> 6.07% is "
        "eighth and <code>roa_3y</code> 0.83% is eighth. "
        "<code>np_consistency_10y</code> of 0.864 is eighth of the twelve on an "
        "index that runs 0.545 to 1.543 across this cluster — a wide enough "
        "spread to rank on, unlike the compressed readings this platform "
        "refuses to quote elsewhere. " + SPINE + ", and this one's -11.95pp is "
        "sixth-worst.",

        "<b>One quality input is missing and the pillar was renormalised.</b> "
        "<code>np_cagr_7y</code> is NULL here, so the quality pillar scored on "
        "95.68% of its declared weight — the only row of the five that is not "
        "at 100% — and seven of the twelve cluster members lack the same field, "
        "which is why it is never ranked cluster-wide in this batch. Its own PE "
        "band is not quotable either: six years of history against the eight "
        "required, so no comparison against its own past is offered. Foreign "
        "holding rose 3.88% to 6.87% across five quarters while the shareholder "
        "count fell from 726,167 to 595,832.",

        "<i>Cheap and bad is a real category and this is in it. Nothing in the "
        "pack says the 0.70x book is wrong — a bank earning 10.9% on equity "
        "over three years and 6.1% over seven arguably should trade below book, "
        "and the +80% quarter is one quarter. The thing that would change this "
        "is not a lower price, it is two or three quarters of double-digit "
        "return on equity; at that point the 0.70x becomes the opportunity it "
        "currently only resembles.</i>",
    ],
    "trigger": ("roe_3y above 13% with np_yoy_q staying positive for two more "
                "quarters -> ACCUMULATE; pb above 1.0x without roe_3y "
                "improving -> AVOID"),
    "evidence": ["pe_ttm", "pb", "np_yoy_q", "ttm_np_pct", "opm_now", "roe_3y",
                 "roe_5y", "roe_7y", "roa_3y", "np_consistency_10y",
                 "roe_excess_13_10y", "fii_pct", "shareholders"],
}

SPEC["INDIANB"] = {
    "confidence": "medium",
    "verdict": ("ACCUMULATE — the most consistent ten-year profit record of the "
                "twelve and the smallest decade shortfall against a 13% return "
                "on equity, and the only one of the five whose earnings yield "
                "is now moving the wrong way"),
    "points": [
        "<b>Not held; on the watchlist.</b> " + LENDER + " The cluster has "
        "twelve members, above the ten-peer floor, so the percentiles are real "
        "ranks among twelve; seven of the twelve are untracked and unwritten. "
        "This row is medium rather than high confidence because its trailing "
        "year does not line up with the rest of the batch — point four.",

        "<b>Across the decade it is the steadiest bank in the cluster.</b> "
        "<code>np_consistency_10y</code> of 1.543 is the highest of the twelve "
        "on an index spanning 0.545 to 1.543 here, and "
        "<code>roe_excess_13_10y</code> of -3.62pp is the smallest shortfall of "
        "the twelve. " + SPINE + " — Indian Bank is simply the one that came "
        "closest. <code>book_value_cagr_10y</code> of 18.45% is second of the "
        "twelve and <code>roa_3y</code> of 1.17% is second as well; "
        "<code>roe_7y</code> of 10.94% is third. " + TNS,

        "<b>The recent record is good without being exceptional.</b> "
        "<code>roe_3y</code> of 14.78% is fifth of the twelve, "
        "<code>np_cagr_5y</code> of 29.65% is ninth, and profit growth beat "
        "inflation in 3 of 4 five-year steps, 5 of 6 seven-year steps and 6 of "
        "9 ten-year steps — the same pass rates as Bank of Baroda and weaker "
        "than the three other banks in this batch. <code>sales_yoy_q</code> of "
        "15.16% is third of the twelve, so the growth is present now.",

        "<b>Two things qualify all of the above.</b> First, its trailing year "
        "ends 2026-09-30 while the other four in this batch end 2026-06-30, so "
        "every TTM figure here is compared against four trailing years that "
        "stop a quarter earlier — the one genuinely non-comparable number in "
        "the batch, and the reason for medium confidence. Second, "
        "<code>earnings_yield_trend</code> of -0.0227 is eleventh of the twelve "
        "and the only negative of the five: the price has been rising faster "
        "than the earnings behind it. Its own PE band is not quotable — the low "
        "of 3.05x is a loss-year artefact below the 4.0x floor this platform "
        "requires — so there is no against-its-own-history check available to "
        "settle that.",

        "<i>What you are buying here is the absence of a disaster rather than "
        "the presence of a boom, and in this cluster that is the scarcer thing: "
        "the decade is the window in which eleven of these twelve banks "
        "destroyed capital, and this is the one that nearly did not. "
        "<code>pb</code> of 1.46 is fourth-highest of the twelve, so it is not "
        "cheap, and the negative earnings-yield trend says the market has "
        "already noticed. ACCUMULATE on the consistency, slowly, and watch the "
        "earnings yield rather than the price.</i>",
    ],
    "trigger": ("earnings_yield_trend back above zero with roe_3y holding 14% "
                "-> add; np_consistency_10y falling below 1.3, or pb above "
                "1.8x -> HOLD"),
    "evidence": ["np_consistency_10y", "roe_excess_13_10y",
                 "book_value_cagr_10y", "roa_3y", "roe_7y", "roe_3y",
                 "np_cagr_5y", "sales_yoy_q", "earnings_yield_trend", "pb",
                 "np_growth_above_inflation_5y", "np_growth_above_inflation_7y",
                 "np_growth_above_inflation_10y"],
}

SPEC["SBIN"] = {
    "confidence": "high",
    "verdict": ("HOLD — second of the twelve on return on equity over five, "
                "seven and ten years, and scored 33rd percentile because it is "
                "the most expensive of the twelve on earnings at 10.45x and "
                "eleventh of the twelve on five-year profit growth; the low "
                "composite is a verdict on the price, not on the bank"),
    "points": [
        "<b>Not held; on the watchlist.</b> " + LENDER + " The cluster has "
        "twelve members, above the ten-peer floor, so the percentiles are real "
        "ranks among twelve; seven of the twelve are untracked and unwritten. "
        "One figure in this row is reported without an explanation on purpose — "
        "point four.",

        "<b>Its composite of 33 is ninth of the twelve and that number will "
        "mislead you if you read it as a quality judgement.</b> On quality the "
        "pillar scores it 64; on valuation 21. <code>roe_5y</code> of 14.63%, "
        "<code>roe_7y</code> of 12.74%, <code>roe_excess_13_5y</code> of "
        "+1.63pp, <code>roe_excess_13_7y</code> of -0.26pp and "
        "<code>roe_excess_13_10y</code> of -4.17pp are each second of the "
        "twelve — the same rank on five separate horizons, behind Bank of "
        "Maharashtra every time. " + SPINE + ", and State Bank is the "
        "second-closest to clearing it.",

        "<b>What the scorer is objecting to is the price and the growth.</b> "
        "<code>pe_ttm</code> of 10.45 is the highest of the twelve, "
        "<code>pb</code> of 1.51 is third-highest, and <code>div_yield</code> "
        "of 1.78% is tenth of the eleven in the cluster that pay one. On growth "
        "<code>np_cagr_5y</code> of 23.88% is eleventh of the twelve and "
        "<code>ttm_op_pct</code> of -0.01% is the only non-positive operating "
        "profit change of the twelve — flat, not falling, but flat while ten "
        "peers grew. <code>equity_to_assets</code> of 6.66% is the "
        "second-thinnest of the twelve. " + TNS,

        "<b>One number here is not comparable and is reported anyway.</b> "
        "<code>opm_now</code> of 45.02% is the lowest of the twelve by a wide "
        "margin — the next lowest is 60.29% and the cluster runs to 75.53%. "
        "State Bank's reported revenue spans mutual funds, insurance and equity "
        "trading alongside lending, so this ratio is probably not measuring the "
        "same thing it measures for a pure lender, but the pack does not "
        "segment the revenue and this row will not guess at the cause. Treat "
        "the figure as unusable for cross-bank comparison rather than as a "
        "margin problem. Its own PE band is not quotable either, and for a "
        "related reason: the band runs to 969.79x with an average of 129.81x, a "
        "near-zero-earnings year divided into a normal price, and quoting that "
        "average would make the cluster's most expensive bank look like a "
        "historic bargain.",

        "<i>This is the one row in the batch where the platform's own score and "
        "the sensible answer diverge, and the honest resolution is HOLD rather "
        "than either. It is the most widely held bank of the twelve — 3,898,366 "
        "shareholders, the most of the cluster, and one of only two of the five "
        "whose holder count rose across the last five quarters: up 71,817 here "
        "against Indian Bank's 750, while the other three lost retail holders "
        "outright — the least government-owned at 55.47% promoter "
        "holding, and the most domestically institutionally owned at 26.52%. "
        "None of that is a reason to buy it at the cluster's highest earnings "
        "multiple. It is a reason not to sell a position you already have, "
        "which is what HOLD means here.</i>",
    ],
    "trigger": ("pe_ttm back under 9x with roe_5y holding above 14% -> "
                "ACCUMULATE; roe_excess_13_5y turning negative, or ttm_op_pct "
                "negative for a second year -> REDUCE"),
    "evidence": ["roe_5y", "roe_7y", "roe_excess_13_5y", "roe_excess_13_7y",
                 "roe_excess_13_10y", "pe_ttm", "pb", "div_yield",
                 "np_cagr_5y", "ttm_op_pct", "equity_to_assets", "opm_now",
                 "shareholders", "promoter_pct", "dii_pct"],
}


def main():
    pack = json.load(open(PACK))
    rows = {r["symbol"]: r for r in pack["symbols"]}
    peers = json.load(open(PEERS_PACK))
    pcm = peers["cluster_metrics"]

    if set(rows) != set(SPEC):
        raise SystemExit(f"spec/pack mismatch: "
                         f"spec-only={sorted(set(SPEC) - set(rows))} "
                         f"pack-only={sorted(set(rows) - set(SPEC))}")

    # Choice 2. The peer file is the batch's only view of the seven unwritten
    # members, so it is checked before anything leans on it.
    if peers.get("cluster_id") != CLUSTER:
        raise SystemExit(f"peer pack is for {peers.get('cluster_id')!r}")
    if len(pcm) != CLUSTER_SIZE:
        raise SystemExit(f"peer pack holds {len(pcm)} members, batch asserts "
                         f"{CLUSTER_SIZE} — every 'of the twelve' is rescoped")
    if not set(rows) <= set(pcm):
        raise SystemExit(f"peer pack is missing written symbols "
                         f"{sorted(set(rows) - set(pcm))}")
    snaps = {str(peers.get("snapshot_date"))} | {
        str((r.get("scores") or {}).get("snapshot_date")) for r in rows.values()}
    if len(snaps) != 1:
        raise SystemExit(f"peer pack and batch pack are on different snapshots: "
                         f"{sorted(snaps)} — cross-cluster ranks are not "
                         f"comparable across snapshot dates")

    # Choice 1, as a check that can fail. If the cluster drops below the floor
    # the absence of a lattice caveat in every row stops being defensible.
    if CLUSTER_SIZE < MIN_PEERS:
        raise SystemExit(f"cluster is {CLUSTER_SIZE} < MIN_PEERS {MIN_PEERS} — "
                         f"this batch asserts the percentiles are real ranks "
                         f"and they would not be")
    for sym, row in rows.items():
        sc = row.get("scores") or {}
        if sc.get("cluster_id") != CLUSTER:
            raise SystemExit(f"{sym}: cluster is {sc.get('cluster_id')!r}")
        if sc.get("score_status") != "full":
            raise SystemExit(f"{sym}: score_status is {sc.get('score_status')!r}, "
                             f"not 'full' — the batch asserts clean scoring and "
                             f"carries no percentile caveat anywhere")

    # Choices 4, 6, 13: the three cluster-wide assertions, against all twelve.
    bad = {s: v[SPINE_FIELD] for s, v in pcm.items()
           if (v.get(SPINE_FIELD) is None) or v[SPINE_FIELD] >= 0}
    if bad:
        raise SystemExit(f"{SPINE_FIELD} is not negative for all twelve: {bad} "
                         f"— the batch spine is wrong in every row that quotes it")
    ema_bull = sorted(s for s, v in pcm.items() if (v.get(EMA_FIELD) or 0) > 0)
    if ema_bull != [EMA_EXCEPTION]:
        raise SystemExit(f"{EMA_FIELD} is bullish for {ema_bull}, but the batch "
                         f"says {EMA_SCOPE} are flat with {EMA_EXCEPTION} the "
                         f"only exception")
    tns_set = {s for s, v in pcm.items()
               if v.get("tech_net_score_scaled") is not None}
    if tns_set:
        raise SystemExit(f"tech_net_score_scaled now reads for {sorted(tns_set)} "
                         f"— the '95 of 100 declared points' sentence is wrong")

    # Choice 5. The reversal of the previous batch's refusal, asserted.
    cons = [v["np_consistency_10y"] for v in pcm.values()
            if v.get("np_consistency_10y") is not None]
    span = max(cons) - min(cons)
    if span < CONSISTENCY_MIN_SPAN:
        raise SystemExit(f"np_consistency_10y spans only {span:.3f} across the "
                         f"cluster; below {CONSISTENCY_MIN_SPAN} any rank is "
                         f"manufactured and this batch quotes it")

    # Choice 10. A field present for a minority of the cluster must never be
    # ranked cluster-wide, so the count is asserted and the prose is checked.
    for field, expect in SPARSE_FIELDS.items():
        have = sorted(s for s, v in pcm.items() if v.get(field) is not None)
        if len(have) != expect:
            raise SystemExit(f"{field} is present for {len(have)} of "
                             f"{CLUSTER_SIZE} ({have}), batch asserts {expect}")

    # Choice 7. The off-window symbol is read out of the pack, not trusted.
    windows = {s: tuple((r.get("ttm_vs_prior") or {}).get("window") or ())
               for s, r in rows.items()}
    odd = sorted(s for s, w in windows.items()
                 if w != windows.get("BANKBARODA"))
    if odd != [OFF_WINDOW]:
        raise SystemExit(f"TTM windows disagree for {odd}, batch asserts only "
                         f"{OFF_WINDOW}: {windows}")

    # Choice 8: the band rule, checked both ways against the pack.
    n_min, lo_min, hi_max = BAND_RULE
    for sym, row in rows.items():
        band = row.get("pe_band") or {}
        ok = (band.get("n") or 0) >= n_min and \
             (band.get("lo") or 0) >= lo_min and \
             (band.get("hi") or 1e9) <= hi_max
        if ok and sym not in BAND_QUOTABLE:
            raise SystemExit(f"{sym}: band {band} passes the rule but the row "
                             f"refuses a comparison it is entitled to make")
        if not ok and sym in BAND_QUOTABLE:
            raise SystemExit(f"{sym}: band {band} fails n>={n_min}, "
                             f"lo>={lo_min}, hi<={hi_max} and the row quotes it")

    out = []
    for sym, s in SPEC.items():
        row = rows[sym]
        cm = (row.get("metrics") or {}).get("cluster_metrics") or {}
        scores = row.get("scores") or {}
        blockers = row.get("blockers") or []
        points, verdict, trig = s["points"], s["verdict"], s["trigger"]
        conf = s["confidence"]
        body = " ".join(points)

        if len(points) != 5:
            raise SystemExit(f"{sym}: {len(points)} points, expected 5")
        if verdict.split(" —")[0] not in LABELS:
            raise SystemExit(f"{sym}: label must open with one of {LABELS}, "
                             f"got {verdict[:20]!r}")
        if len(verdict.split("—", 1)[1].strip()) < 30:
            raise SystemExit(f"{sym}: headline says nothing after the label")

        # Choice 12. Confidence is not uniform in this batch, so the table is
        # the authority and the row must match it.
        if conf != CONFIDENCE[sym]:
            raise SystemExit(f"{sym}: confidence {conf!r} but CONFIDENCE says "
                             f"{CONFIDENCE[sym]!r}")
        if conf == "medium" and "medium" not in body:
            raise SystemExit(f"{sym}: is medium confidence and the row never "
                             f"says why — in a batch where three rows are high, "
                             f"an unexplained medium is just a hedge")

        if not points[-1].startswith("<i>"):
            raise SystemExit(f"{sym}: the last point is not italicised")
        for i, p in enumerate(points[:-1]):
            if not p.startswith("<b>"):
                raise SystemExit(f"{sym}: point {i+1} has no <b> lead sentence")

        # Choice 11. Nothing in this batch is held, so nothing may claim a
        # return against a cost basis.
        if sym in HELD:
            raise SystemExit(f"{sym}: HELD is empty in this batch by assertion")
        if "Not held" not in points[0]:
            raise SystemExit(f"{sym}: point one does not state it is not held")
        if sym in WATCHLISTED and "watchlist" not in points[0]:
            raise SystemExit(f"{sym}: is watchlisted and point one does not say so")
        for frag in ("below cost", "above cost", "avg cost", "average cost",
                     "paper loss", "LTP"):
            if frag in body:
                raise SystemExit(f"{sym}: says {frag!r} but nothing in this "
                                 f"batch is held — there is no cost basis")

        # Choice 3. The exemption verbatim, and the fields it invalidates
        # refused outright — in the evidence as well as the prose, because the
        # evidence list is what a future reader re-checks against.
        if LENDER not in points[0]:
            raise SystemExit(f"{sym}: point one does not carry the lender "
                             f"exemption verbatim, so cash-flow and "
                             f"profit-vs-operating-profit figures in the pack "
                             f"read as earnings quality")
        for frag in BANNED_EQ:
            where = ("prose" if frag in body else
                     "evidence" if any(frag in k for k in s["evidence"]) else None)
            if where and not (frag == "cash conversion"
                              and "not read here as a quality signal" in body):
                raise SystemExit(f"{sym}: {frag!r} appears in the {where}, but "
                                 f"this cluster's exemption says it is deposit "
                                 f"flow and not an earnings-quality signal")
        if TNS not in body:
            raise SystemExit(f"{sym}: the row never says tech_net_score_scaled "
                             f"is NULL, so momentum 95-of-100 goes unstated")

        # Choice 4. Keyed on the evidence list too: a row can quote -6.02pp
        # without naming the field, and then a cluster-wide shortfall reads as
        # that bank's own defect.
        if (SPINE_FIELD in body or SPINE_FIELD in s["evidence"]) \
                and SPINE not in body:
            raise SystemExit(f"{sym}: quotes {SPINE_FIELD} without saying the "
                             f"decade shortfall is true of all twelve")

        # Choice 6. The near-miss, made permanent.
        if EMA_FIELD in body or EMA_FIELD in s["evidence"]:
            if EMA_SCOPE not in body or EMA_EXCEPTION not in body:
                raise SystemExit(f"{sym}: quotes {EMA_FIELD} without scoping it "
                                 f"{EMA_SCOPE} and naming {EMA_EXCEPTION} — the "
                                 f"first draft of this batch said none of the "
                                 f"cluster was bullish and that is false")
            if re.search(r"(none|not one|no bank)" + _within_sentence(80)
                         + EMA_FIELD, body):
                raise SystemExit(f"{sym}: says none of the cluster has a "
                                 f"bullish EMA stack; {EMA_EXCEPTION} does")

        # Choice 10.
        for field in SPARSE_FIELDS:
            if field in body and re.search(
                    re.escape(field) + _within_sentence(120) + RANK_WORDS
                    + _within_sentence(40) + r"of the twelve", body):
                raise SystemExit(f"{sym}: ranks {field} across the twelve, but "
                                 f"it is present for only "
                                 f"{SPARSE_FIELDS[field]} of them")

        # Choice 7.
        if sym == OFF_WINDOW:
            if "2026-09-30" not in body or "2026-06-30" not in body:
                raise SystemExit(f"{sym}: its trailing year ends a quarter "
                                 f"later than the other four and the row does "
                                 f"not give both window ends")

        _pass_rate_denominators(sym, body)

        if sum(p.count("<code>") for p in points) < 6:
            raise SystemExit(f"{sym}: fewer than 6 <code> field names")

        # Choice 2, the scoping rule.
        for p in points:
            low = p.lower()
            if not any(w in low for w in SUPERLATIVES):
                continue
            if any(ph in p for ph in SCOPE_PHRASES) or SCOPE_COUNT.search(p):
                continue
            raise SystemExit(f"{sym}: a superlative with no peer set counted in "
                             f"the same point: {p[:110]!r}")

        # Choice 8, in the prose.
        quotes_band = " band of " in body or "own-history band" in body
        if quotes_band and sym not in BAND_QUOTABLE:
            band = row.get("pe_band") or {}
            raise SystemExit(f"{sym}: quotes an own-history band but it fails "
                             f"the rule (n={band.get('n')}, lo={band.get('lo')}, "
                             f"hi={band.get('hi')})")
        if sym not in BAND_QUOTABLE and "not quotable" not in body:
            raise SystemExit(f"{sym}: has no quotable band and never says so — "
                             f"the reader assumes the comparison was made and "
                             f"came out neutral")

        if trig.count("->") < 2:
            raise SystemExit(f"{sym}: trigger is one-sided — a wish, not a trigger")

        _blocker_coverage(sym, blockers, body)

        evidence = {}
        for k in s["evidence"]:
            if k in DERIVED_KEYS:
                evidence[k] = None
                continue
            if k not in cm:
                raise SystemExit(f"{sym}: evidence key {k} is not a {CLUSTER} "
                                 f"cluster metric — this cluster scores roe_*, "
                                 f"pb and equity_to_assets, not roce_*/ev_*")
            if cm[k] is None:
                raise SystemExit(f"{sym}: evidence key {k} is NULL — a verdict "
                                 f"must anchor on fields that can be rechecked")
            evidence[k] = cm[k]
        if len(evidence) < 3:
            raise SystemExit(f"{sym}: {len(evidence)} evidence keys, need 3+")

        snap = str(scores.get("snapshot_date") or pack.get("generated_at", "")[:10])
        out.append({
            "symbol": sym,
            "generated_at": GENERATED_AT,
            "verdict": verdict,
            "confidence": conf,
            "points": points,
            "trigger_text": trig,
            "evidence": evidence,
            "snapshot_date": snap,
            "price_asof": snap,
            "model": MODEL,
            "source_report": SOURCE_REPORT,
        })

    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    buckets = {}
    for r in out:
        b = r["verdict"].split(" —")[0].strip()
        buckets[b] = buckets.get(b, 0) + 1
    print(f"-> {OUT}  {len(out)} rows  {buckets}")
    print(f"   cluster {CLUSTER} has {CLUSTER_SIZE} members, {CLUSTER_SIZE - len(out)} "
          f"untracked and unwritten; percentiles are real ranks")
    for r in out:
        print(f"   {r['symbol']:<11} {r['confidence']:<6} {r['verdict'][:78]}")


if __name__ == "__main__":
    main()
