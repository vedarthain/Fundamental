#!/usr/bin/env python3
"""Pass 2, once, for every batch — peer-set claims in verdict prose.

    scripts/verdict-ranks-check.py \
        --verdicts build/verdicts/<batch>-verdicts.json \
        --pack /tmp/<batch>.json

WHAT THIS REPLACES
------------------
Verdict verification is two passes. Pass 1 (scripts/verdict-check.py) traces
every numeric token in the prose back to the symbol's own evidence pack. It is
generic and permanent, and it structurally CANNOT see a claim about the peer
set — "#2 of 37", "the largest of the 14", "bottom nine of 42". Every single
number in such a sentence is present and correct in the pack; only the ordering
BETWEEN symbols is wrong, and the ordering was nowhere in it.

So every batch grew a hand-written build/verdicts/check_<batch>.py: 200-330
lines, run once, deleted from memory. On 2026-10-22, across just TWO verdicts,
that file caught three false claims — a market cap called "the largest" that
was second, a peer count of nine that was twelve, and a rank of "37th of 42"
inside a nine-way tie at zero. The pair for the first 76 verdicts is already
gone, so those claims are unverifiable forever.

verdict-evidence.py now emits a `peer_ranks` block per symbol (see its
"WHY THIS BLOCK EXISTS" comment). The prose therefore QUOTES a rank instead of
deriving one, and this script is the diff. It is the same script for every
batch. No per-batch checker is written again.

THE RULE THAT MAKES IT WORK
---------------------------
AN UNPARSEABLE COMPARATIVE CLAIM IS A FAILURE, NOT A SKIP.

A checker that silently ignores phrasings it does not recognise is CLAUDE.md
§5's check-that-cannot-fail: it would have passed all three errors above and
rendered a green tick. So the prose is constrained to the grammar in FORMS
below, and anything that *smells* comparative but does not parse stops the
batch. "Smells" is deliberately over-broad — a false positive costs one
rewrite, a false negative publishes a lie.

Claims that genuinely cannot be resolved against peer_ranks (a prior snapshot,
a sub-group the pack has no concept of) are not whitelisted in code. They go in
the batch JSON as a `rank_waivers` entry carrying the quote AND a reason
string, so the exception is recorded next to the prose it excuses rather than
buried here.

EXIT
----
0 only if every comparative claim resolved and matched. Non-zero otherwise.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

FAILS: list[str] = []
CHECKS = 0


def ck(label: str, ok: bool) -> None:
    global CHECKS
    CHECKS += 1
    if not ok:
        FAILS.append(label)
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}")


# ----------------------------------------------------------------- numbers

ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20,
}
CARDINALS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50,
}
_ORD_SUFFIX = re.compile(r"^(\d+)(?:st|nd|rd|th)$")


def num(tok: str) -> Optional[int]:
    """'3', '3rd', 'third', 'fourteen' -> int. Prose mixes all four freely."""
    t = tok.strip().lower().replace(",", "")
    if t.isdigit():
        return int(t)
    m = _ORD_SUFFIX.match(t)
    if m:
        return int(m.group(1))
    return ORDINALS.get(t) or CARDINALS.get(t)


_NUMWORD = (r"\d+(?:st|nd|rd|th)?|"
            + "|".join(sorted(set(ORDINALS) | set(CARDINALS), key=len, reverse=True)))

# ----------------------------------------------------------------- grammar
#
# Each form resolves to (kind, n, m). `m` is the stated denominator and is
# ALWAYS asserted against the metric's own `of` — a right rank on a wrong
# denominator still misleads, which is the whole lesson of this file.
#
#   exact   -> rank_high == n
#   lowest  -> rank_low  == n
#   top     -> rank_high <= n
#   bottom  -> rank_low  <= n   (and the tie must be stated, see check_claim)
#   cohort  -> no rank, just "ranked against M peers"

# ORDER IS SIGNIFICANT — most specific first. A span claimed by an earlier form
# is not re-matched by a later one, so the generic "N of M" must come LAST.
# With it first, "bottom six of 31" parsed as a plain rank of six and demanded
# the tie be stated when the sentence already did state it.
#
# "of the M" is also written "of all M" ("the lowest of all 16"), which the
# first version did not accept and so reported as an unanchored superlative.
_OF = r"of\s+(?:the\s+|all\s+(?:the\s+)?)?"

FORMS: list[tuple[str, str]] = [
    # "ranks it against 42 broking peers" — a cohort-size claim, no rank
    ("cohort", rf"against\s+({_NUMWORD})\s+[\w\s,-]{{0,40}}?peers\b"),
    # "bottom nine of 42", "top three of 32"
    ("bottom", rf"\bbottom\s+({_NUMWORD})\s+of\s+({_NUMWORD})\b"),
    ("top", rf"\btop\s+({_NUMWORD})\s+of\s+({_NUMWORD})\b"),
    # "second-largest of the 14", "the largest of all 16"
    ("exact_sup", rf"\b({_NUMWORD})[-\s](?:largest|highest|biggest|best|"
                  rf"most expensive|dearest)\s+{_OF}({_NUMWORD})\b"),
    ("exact_sup1", rf"\bthe\s+(largest|highest|biggest|best|dearest)\s+"
                   rf"{_OF}({_NUMWORD})\b"),
    ("lowest_sup", rf"\b({_NUMWORD})[-\s](?:lowest|smallest|cheapest|worst)\s+"
                   rf"{_OF}({_NUMWORD})\b"),
    ("lowest_sup1", rf"\b(?:the\s+)?(lowest|smallest|cheapest|worst)\s+"
                    rf"(?:row\s+)?{_OF}({_NUMWORD})\b"),
    # "#2 of 37"
    ("exact", rf"#\s*({_NUMWORD})\s+of\s+({_NUMWORD})\b"),
    # "34th of 42", "the second of 14", "tied fourth of the nine"
    ("exact", rf"\b({_NUMWORD})\s+{_OF}({_NUMWORD})\b"),
]

# The comparative sniffer: a superlative with no anchored rank.
#
# The first version also listed bare ordinals (first, second, third, 4th …) on
# the theory that over-broad is safe. It is not usable: English uses those
# words non-comparatively all the time, and on the two shipped capital-markets
# verdicts it fired on "a second quarter near 10% margins", "takes a third off
# the earnings" and "the uncomfortable answer first". Twenty-odd false
# positives per batch is how a checker gets ignored wholesale, which is a worse
# outcome than a narrower one — a checker nobody reads catches nothing.
#
# So: a superlative is only a claim when the sentence also names a cohort.
# "the best in the cluster" and "the worst row in its pool" are caught;
# "the uncomfortable answer first" is not. An anchored superlative always
# mentions what it is best OF — that is exactly the property being enforced.
# "only" is listed as "the only" on purpose: "the only broker in the cluster"
# is a peer claim, while "could only say" and "only goes one way" are adverbs
# and fired as false positives on the shipped prose.
_SUPERLATIVE = (r"largest|highest|biggest|lowest|smallest|cheapest|worst|best|"
                r"dearest|steepest|widest|narrowest|the only|bottom|top|"
                r"median|quartile")
SMELLS = re.compile(rf"\b(?:{_SUPERLATIVE})\b", re.I)
_COHORT_WORD = re.compile(
    r"\b(?:cluster|pool|peers?|names?|rows?|brokers?|cohort|quartile|"
    r"of\s+(?:all\s+)?(?:the\s+)?\d+)\b", re.I)

_CODE = re.compile(r"<code>([a-z0-9_]+)</code>")
_TAGS = re.compile(r"</?[a-z]+>")

# Prose names a few dimensions in words rather than as a <code> key.
WORD_DIMS = [
    (re.compile(r"market cap|mcap|₹[\d,]+cr\b", re.I), "market_cap"),
    (re.compile(r"\bcomposite\b", re.I), "composite_pct"),
    (re.compile(r"\bvaluation\b", re.I), "valuation_pct"),
    (re.compile(r"\bmomentum\b", re.I), "momentum_pct"),
    (re.compile(r"\bquality\b", re.I), "quality_pct"),
    # Every batch writes this one in words — "the close held above its 200-day
    # EMA on 63.10% of the last 252 sessions, second of 28".
    (re.compile(r"200-day EMA|200ema", re.I), "pct_above_200ema_252d"),
    # "the 3.96% dividend, third of 79" — written in words in every batch so
    # far, and the cheap-on-dividend-yield line is one of the few claims that
    # routinely appears with no key beside it.
    (re.compile(r"\bdividend(?: yield)?\b", re.I), "div_yield"),

    # --- the headline vocabulary -------------------------------------------
    # The one-line `verdict` field is rendered as a JSX text child
    # (VerdictQueueClient.tsx:485, VerdictPanel.tsx:236), so React ESCAPES it:
    # a <code> tag written there reaches the reader as literal angle brackets.
    # Six rows shipped that way on 2026-10-22 before anyone looked at the page.
    # The headline therefore has to name its metrics in English — and English
    # without an entry here is an unattributable claim, which is a FAIL by
    # design. So the names the headline actually uses live below.
    #
    # Teaching a name is also what REMOVES a hijack rather than creating one.
    # "composite 93 … against three-year cash conversion of 0.184, 30th of 34"
    # attributed to `composite_pct` while "cash conversion" meant nothing here:
    # the nearest subject won, and the nearest subject was the only one the
    # script could see. Every addition below moves a claim closer to its real
    # owner.
    (re.compile(r"cash conversion", re.I), "cfo_pat_3y"),
    (re.compile(r"x book\b|book value|price[-\s]to[-\s]book", re.I), "pb"),
    (re.compile(r"foreign institutions?|\bFIIs?\b", re.I), "fii_pct"),
    (re.compile(r"domestic institutions?|\bDIIs?\b", re.I), "dii_pct"),
    (re.compile(r"return on capital|\bROCE\b", re.I), "roce_3y"),
    # Horizon-bearing names. The metric family is the same and only the
    # suffix differs, so the year is READ FROM THE PROSE rather than assumed —
    # `np_consistency_3y` and `np_consistency_10y` are different claims with
    # different denominators, and defaulting to either one would silently
    # check the wrong column. `{y}` is filled by attribute().
    (re.compile(r"(?P<yr>three|five|seven|ten)-year profit growth above "
                r"inflation|profit growth above inflation", re.I),
     "np_growth_above_inflation_{y}"),
    (re.compile(r"(?P<yr>three|five|seven|ten)-year profit consistency|"
                r"profit consistency", re.I), "np_consistency_{y}"),
    (re.compile(r"(?P<yr>three|five|ten)-year profit growth", re.I),
     "np_cagr_{y}"),
]

# Spelled horizons, for the `{y}` keys above.
_YEAR_WORD = {"three": "3y", "five": "5y", "seven": "7y", "ten": "10y"}


# <code> is used for things that are not metrics: the cluster id, the
# score_status badge, a column name. The attributor takes the NEAREST code tag,
# so a cohort sentence ending "...the row is badged <code>full</code>" made the
# next rank claim in that block attribute to `full` — eight FAILs in the
# chemicals batch reading "ranks <code>full</code>, which carries no rank",
# every one of them a correctly-written claim.
#
# The skip is an ALLOWLIST, not "skip anything the pack does not rank". A
# mistyped key must still fail loudly — that is most of this script's value —
# so only names known not to be metrics are passed over. Cluster ids are added
# at load from the pack itself, because they are indistinguishable from metric
# keys by shape (both are lowercase_with_underscores).
NOT_A_METRIC = {"full", "partial-cluster-mixed-tiers", "partial-no-peers",
                "cluster_metrics", "score_status", "maturity_tier"}


def strip_tags(s: str) -> str:
    return _TAGS.sub("", s)


def sentence_of(plain: str, quote: str) -> str:
    """The sentence of `plain` containing `quote`, or the whole block.

    Used to scope a rank_waiver to the claim it names. Returning the block on
    a miss is deliberate: a waiver whose quote is not in the prose at all
    should still be found by the quote/reason check in main(), not silently
    applied to nothing here.
    """
    i = plain.find(quote)
    if i < 0:
        return plain
    start = plain.rfind(".", 0, i) + 1
    end = plain.find(".", i + len(quote))
    return plain[start:end if end > 0 else len(plain)]


# ----------------------------------------------------------------- resolve


def attribute(text: str, at: int) -> Optional[str]:
    """Which metric is the claim at offset `at` about?

    The nearest subject BEFORE the claim, within 200 characters, whether it is
    written as <code>key</code> or in words. Prose puts the subject first
    ("`pe_ttm` 71.00 is #2 of 28"), so backwards is the right direction; 200 is
    about one clause.

    NEAREST, not "tag first then fall back to words". Tag-first was wrong the
    moment a point chained two claims with different subjects, which is most of
    them: "`fcf_yield` +0.28% is 68th of 103. The close held above its 200-day
    EMA on 73.41% of 252 sessions, eighth of 87" attributed the EMA rank to
    `fcf_yield` and failed a correct sentence on the denominator. Four of the
    twelve chemicals rows failed that way, all on the same construction.

    The cost is that a worded dimension is a common noun — "quality", "valuation"
    — so one standing in a clause it does not own can hijack a claim. That
    direction is safe: it manufactures a loud FAIL on good prose, never a silent
    pass on bad.
    """
    window = text[max(0, at - 200):at]
    best: Optional[tuple[int, str]] = None
    for m in _CODE.finditer(window):
        if m.group(1) in NOT_A_METRIC:
            continue
        if best is None or m.start() > best[0]:
            best = (m.start(), m.group(1))
    for rx, key in WORD_DIMS:
        for m in rx.finditer(window):
            if best is None or m.start() > best[0]:
                k = key
                if "{y}" in k:
                    # No spelled horizon beside a horizon-bearing name means
                    # the claim is ambiguous between siblings. Leave `best`
                    # alone rather than guess: unattributable is a loud FAIL
                    # that the writer fixes by naming the year, which is the
                    # outcome wanted. Guessing a suffix checks a column the
                    # sentence never mentioned and can pass a wrong rank.
                    yr = (m.groupdict().get("yr") or "").lower()
                    if yr not in _YEAR_WORD:
                        continue
                    k = k.replace("{y}", _YEAR_WORD[yr])
                best = (m.start(), k)
    if best is None:
        return None
    key = best[1]
    # Prose abbreviates a sibling horizon: "`np_growth_above_inflation_5y`
    # 1.000 and `_7y` 1.000 … and `_10y` 0.889". Resolve the stub against
    # the last full key seen anywhere earlier in this point, otherwise
    # every abbreviated claim reads as a metric that does not exist.
    if key.startswith("_"):
        earlier = [c for c in _CODE.findall(text[:at]) if not c.startswith("_")]
        for full in reversed(earlier):
            base = re.sub(r"_\d+y$", "", full)
            if base != full:
                return base + key
    return key


def lookup(pr: dict, key: str) -> Optional[dict]:
    for scope in ("metrics", "scores", "shareholding"):
        d = (pr.get(scope) or {}).get(key)
        if d is not None:
            return d
    return None


def check_claim(sym: str, pr: dict, kind: str, a: str, b: str,
                key: Optional[str], quote: str, ctx: str = "") -> Optional[dict]:
    """Assert one parsed claim. Both the rank AND the denominator, always.

    `ctx` is the match plus ~50 characters before it, and the tie test reads
    the TIE WORD FROM IT rather than from `quote`: the honest phrasing is
    "tied fourth of the nine", where "tied" sits outside the matched span.
    Testing `quote` alone failed prose that had already stated the tie.

    Returns the resolved rank dict when the claim is about an extreme (first
    or last), so the caller can tell whether a nearby worded superlative is
    anchored by a checked number.
    """
    m = num(b)
    if kind == "cohort":
        n = num(a)
        ck(f"{sym}: cohort '{quote}' claims {n} peers "
           f"(pack: {pr['cohort']['n']}, basis {pr['cohort']['basis']})",
           n == pr["cohort"]["n"])
        return None

    if key is None:
        ck(f"{sym}: '{quote}' — no metric attributable within 200 chars; "
           f"name the key in <code>…</code> or waive it", False)
        return
    d = lookup(pr, key)
    if d is None:
        ck(f"{sym}: '{quote}' ranks <code>{key}</code>, which carries no rank "
           f"in the pack (absent from this cluster's metrics)", False)
        return
    if not d.get("rankable"):
        ck(f"{sym}: '{quote}' ranks {key} with only {d['of']} reading(s) — "
           f"not rankable; '#2 of 2' must not ship", False)
        return

    # "N of M" is not always a rank, and this test MUST come before the
    # denominator test. The track-record metrics are ratios and the prose
    # states them as such: `np_growth_above_inflation_10y` 0.889 is "8 of 9"
    # year-steps, `roe_avg_above_threshold_10y` 0.500 is "five of ten" years.
    # Those are claims about the symbol's own value, which pass 1 already
    # traces. Run after the denominator check and a correct sentence fails,
    # because 10 year-steps is not the 9 peers carrying the metric — which is
    # exactly what happened on the first run against PRIMESECU.
    n0 = num(a)
    if (kind == "exact" and n0 and m and m > 0
            and d.get("value") is not None
            and abs(float(d["value"]) - n0 / m) < 0.005):
        ck(f"{sym}: '{quote}' reads as {key}'s own pass rate "
           f"{n0}/{m} = {float(d['value']):.3f}, not a rank", True)
        return

    if m != d["of"]:
        ck(f"{sym}: '{quote}' — denominator {m} but {key} has {d['of']} "
           f"reading(s) in the cohort of {pr['cohort']['n']}", False)
        return

    if kind in ("exact", "exact_sup", "exact_sup1"):
        n = 1 if kind == "exact_sup1" else num(a)
        # A bare "Nth of M" inside a tie is fake precision even when the sort
        # returns it. Real case: cfo_pat_3y 0.000 "37th of 42" with nine names
        # tied at the floor. The prose must state the tie.
        if d["tied"] > 1 and "tied" not in ctx.lower():
            ck(f"{sym}: '{quote}' — {key} sits in a {d['tied']}-way tie "
               f"spanning positions {d['tie_span'][0]}-{d['tie_span'][1]}; "
               f"state the tie, do not pick a position", False)
            return
        ck(f"{sym}: {key} is #{n} of {m} (pack: #{d['rank_high']} of {d['of']})",
           n == d["rank_high"])
    elif kind in ("lowest_sup", "lowest_sup1"):
        n = 1 if kind == "lowest_sup1" else num(a)
        if d["tied"] > 1 and "tied" not in ctx.lower():
            ck(f"{sym}: '{quote}' — {key} sits in a {d['tied']}-way tie "
               f"({d['tie_span'][0]}-{d['tie_span'][1]}); state the tie", False)
            return
        ck(f"{sym}: {key} is {n} from the bottom of {m} "
           f"(pack: rank_low {d['rank_low']} of {d['of']})", n == d["rank_low"])
    elif kind == "top":
        n = num(a)
        ck(f"{sym}: {key} is inside the top {n} of {m} "
           f"(pack: #{d['rank_high']})", d["rank_high"] <= n)
    elif kind == "bottom":
        n = num(a)
        # "bottom nine of 42, all nine tied at the floor" is the honest form:
        # the count claimed must BE the tie group when there is one.
        if d["tied"] > 1:
            ck(f"{sym}: '{quote}' — bottom {n} of {m} against a "
               f"{d['tied']}-way tie at {d['value']}", n == d["tied"])
        else:
            ck(f"{sym}: {key} is inside the bottom {n} of {m} "
               f"(pack: rank_low {d['rank_low']})", d["rank_low"] <= n)
    return d


def scan(sym: str, pr: dict, text: str, where: str, waivers: list[dict],
         anchors: Optional[set[str]] = None) -> set[str]:
    """Parse every comparative claim in one block of prose.

    Returns the metric keys this block anchored at an extreme (verified first
    or last). A worded superlative — "the best in the cluster", "the worst row
    of all 16" — is accepted when the same block, or for the verdict and
    trigger lines any block, carries such a checked claim. The prohibition is
    on UNANCHORED superlatives; one that sits beside a number this script
    verified is anchored, and failing it would only teach the writer to delete
    the summary sentence rather than to check it.
    """
    plain = strip_tags(text) if "<" in text else text
    found: set[str] = set()
    # Attribution needs the <code> tags, so claims are located on the tagged
    # text and the quote is read from it too.
    spans: list[tuple[int, int]] = []
    for kind, rx in FORMS:
        for m in re.finditer(rx, text, re.I):
            if any(s <= m.start() < e for s, e in spans):
                continue  # already claimed by an earlier, more specific form
            spans.append((m.start(), m.end()))
            quote = strip_tags(m.group(0))
            # A waiver is matched against the SENTENCE holding the span, not
            # the span and not the whole block. Span-to-waiver silently missed
            # every waiver whose quote was longer than the regex match (the
            # span is "worst of all 16"; the waiver says "worst of all 16
            # wealth names"). Block-to-waiver is worse in the other direction:
            # any waiver anywhere in the block waived every span in it, so
            # PRIMESECU's "the worst row of all 16" waiver swallowed the
            # neighbouring "the lowest of all 16" — a claim this script can
            # and does verify — which left `found` empty and fired the sniffer
            # on a sentence that was in fact anchored. A waiver must excuse
            # only the claim it names.
            hit = next((w for w in waivers
                        if w.get("quote")
                        and w["quote"] in sentence_of(plain, quote)), None)
            if hit:
                print(f"  waived {sym}: '{quote}' — {hit['reason']}")
                continue
            key = attribute(text, m.start())
            # The cohort form has a single group; everything else has two.
            g = m.groups()
            ctx = strip_tags(text[max(0, m.start() - 50):m.end()])
            d = check_claim(sym, pr, kind, g[0], g[1] if len(g) > 1 else g[0],
                            key, quote, ctx)
            if d and key and (d["rank_high"] == 1 or d["rank_low"] == 1
                              or d["tie_span"][0] == 1):
                found.add(key)

    # Now the sniffer: a comparative word in a sentence with no parsed claim
    # covering it. Sentence-level, because "the only broker in the cluster to
    # beat inflation" is a peer claim with no number at all.
    for sm in SMELLS.finditer(plain):
        start = plain.rfind(".", 0, sm.start()) + 1
        end = plain.find(".", sm.end())
        sent = plain[start:end if end > 0 else len(plain)].strip()
        if not sent:
            continue
        if any(w.get("quote") and w["quote"] in sent for w in waivers):
            continue
        # Did any FORM match inside this sentence on the tagged text? Compare
        # on the stripped sentence, which is what the reader sees.
        covered = any(re.search(rx, sent, re.I) for _, rx in FORMS)
        if covered:
            continue
        # A superlative with no cohort word in the sentence is ordinary
        # English, not a peer claim. See the SMELLS comment.
        if not _COHORT_WORD.search(sent):
            continue
        # Anchored by a verified extreme in this block, or — for the verdict
        # and trigger lines, which summarise — anywhere in the verdict.
        if found or (anchors and where in ("verdict", "trigger")):
            continue
        ck(f"{sym} [{where}]: comparative '{sm.group(0)}' with no anchored "
           f"rank — \"{sent[:110]}\"", False)
    return found


# ----------------------------------------------------------------- prior


def check_prior(sym: str, prior: dict) -> None:
    """A claim about a PRIOR snapshot is in neither the pack nor the cohort.

    Legitimate — "composite 15, down from 61 before the re-peering" is a real
    and useful sentence — but it must be measured once and recorded with the
    query that measured it, not left floating. check_capmkt_14_v2.py did this
    by hand; here it is a required block.
    """
    need = ("snapshot_date", "query", "values")
    missing = [k for k in need if k not in prior]
    ck(f"{sym}: prior-snapshot block carries {need}", not missing)
    if not missing:
        print(f"         prior {prior['snapshot_date']}: {prior['values']}")
        print(f"         via   {prior['query']}")


# ----------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--verdicts", required=True, help="batch -verdicts.json")
    ap.add_argument("--pack", required=True, help="verdict-evidence.py --out JSON")
    args = ap.parse_args()

    batch = json.loads(Path(args.verdicts).read_text())
    if isinstance(batch, dict):
        batch = batch.get("verdicts", [])
    pack = json.loads(Path(args.pack).read_text())
    packs = {s["symbol"]: s for s in pack["symbols"]}

    # Cluster ids look exactly like metric keys, so they cannot be filtered by
    # shape; take them from the pack. Prose names the cluster in <code> in
    # nearly every cohort sentence.
    NOT_A_METRIC.update(
        cid for s in packs.values()
        if (cid := ((s.get("peer_ranks") or {}).get("cohort") or {}).get("cluster_id"))
    )

    for v in batch:
        sym = v["symbol"]
        print(f"\n== {sym}")
        p = packs.get(sym)
        if p is None:
            ck(f"{sym}: present in the evidence pack", False)
            continue
        pr = p.get("peer_ranks")
        if not pr:
            ck(f"{sym}: pack carries a peer_ranks block", False)
            continue
        for w in pr.get("warnings", []):
            ck(f"{sym}: peer_ranks sanity — {w}", False)

        waivers = v.get("rank_waivers") or []
        for w in waivers:
            if not (w.get("quote") and w.get("reason")):
                ck(f"{sym}: every rank_waiver carries quote AND reason", False)
        if "prior" in v:
            check_prior(sym, v["prior"])

        anchors: set[str] = set()
        for i, pt in enumerate(v.get("points") or []):
            anchors |= scan(sym, pr, pt, f"point {i + 1}", waivers)
        scan(sym, pr, v.get("verdict") or "", "verdict", waivers, anchors)
        scan(sym, pr, v.get("trigger_text") or v.get("trigger") or "",
             "trigger", waivers, anchors)

    print(f"\n{CHECKS} check(s), {len(FAILS)} failed")
    for f in FAILS:
        print(f"  FAIL  {f}")
    if not CHECKS:
        # A run that asserted nothing is not a pass. Either the batch has no
        # comparative claims at all (possible, and then say so deliberately
        # with --allow-empty) or the parser is broken and silent.
        print("  !! nothing was checked — the parser found no claims at all")
        return 1
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
