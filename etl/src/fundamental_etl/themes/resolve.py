"""Resolve an upstream company NAME to an NSE symbol.

The source publishes no symbol and no ISIN, so this is the only bridge between
their taxonomy and our universe — and it is the part of the importer most likely
to be quietly wrong.

Measured on the full 1,297-name catalogue against 2,622 active universe rows:

    unique exact match   1,121   86.4%
    ambiguous (>1 hit)       9
    unmatched              167

The 176-name residue is NOT fuzz-matched. A trigram matcher run over it proposed
"Solarium Green Energy" → SOLARINDS (Solar Industries India) — a different
company roughly two orders of magnitude larger — with no signal distinguishing
that from a correct hit. A theme page carrying one wrong constituent is worse
than a theme page missing five, because the error is invisible to the reader.
So: exact-or-human. `suggest()` exists only to give a reviewer a starting point
and its output is never acted on automatically.

Roughly a third of the residue is unmatchable for a reason that is ours, not
theirs: 472 active universe rows carry company_name = symbol, i.e. no company
name at all. Those cannot be matched by name at any threshold.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

# Corporate-form words and generic filler that appear on one side of a pair but
# not the other ("Cummins India" vs "Cummins India Limited", "Amber Enterprises
# India" vs "Amber Enterprises India Limited"). Stripped as whole words from
# BOTH sides before comparison, which is what lifts the match rate from 67% to
# 86%. Order does not matter — every occurrence is removed, not just a suffix.
_NOISE = re.compile(
    r"\b(ltd|limited|corporation|corp|company|co|the|and|of|india|"
    r"industries|enterprises|technologies|inc)\b"
)


def normalise(name: str) -> str:
    """Lowercase, drop corporate-form noise, then drop every non-alphanumeric.

    The final strip is what absorbs "&" vs "and", "(India)" parentheses,
    hyphens and double spaces. It also makes the key unreadable, so callers
    should keep the raw name for display and for the review queue.
    """
    return re.sub(r"[^a-z0-9]", "", _NOISE.sub("", name.lower()))


def build_index(rows: Iterable[tuple[str, str]]) -> dict[str, list[str]]:
    """Map normalised company_name -> [symbol, …] from (symbol, company_name).

    A list, not a scalar: collisions are real (DCM Shriram resolves to both
    DCMSHRIRAM and DCMSRIND) and must be surfaced as ambiguity rather than
    silently resolved by whichever row sorted first.
    """
    idx: dict[str, list[str]] = {}
    for symbol, company_name in rows:
        if not company_name:
            continue
        key = normalise(company_name)
        if not key:
            continue
        idx.setdefault(key, []).append(symbol)
    return idx


def resolve(name: str, idx: dict[str, list[str]]) -> Optional[str]:
    """Symbol iff exactly one universe row normalises to the same key."""
    hits = idx.get(normalise(name))
    return hits[0] if hits and len(hits) == 1 else None


def suggest(name: str, idx: dict[str, list[str]], limit: int = 3) -> Optional[str]:
    """Best-effort candidates for a human reviewer. NEVER auto-applied.

    Prefix containment in both directions, which catches the common real cases
    ("Steel Authority of India (SAIL)" → SAIL, "Websol Energy Systems" →
    "Websol Energy System") without pretending to be a scorer.
    """
    key = normalise(name)
    if len(key) < 5:
        return None
    cands: list[str] = []
    for k, syms in idx.items():
        if len(k) < 5:
            continue
        if k.startswith(key[:6]) or key.startswith(k[:6]) or key in k or k in key:
            cands.extend(syms)
        if len(cands) >= limit:
            break
    return ",".join(sorted(set(cands))[:limit]) or None
