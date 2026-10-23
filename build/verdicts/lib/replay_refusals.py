#!/usr/bin/env python3
"""Replay refusals.py against every batch already published.

THE PROOF OBLIGATION
--------------------
`refusals.py` claims that a handful of rules, re-derived by hand in twenty-one
generators, are in fact one set of rules. This script tests that claim the only
way it can be tested: by recomputing them from the pack and comparing against
the constants each generator MEASURED BY HAND and then guarded on.

Those constants are the hand-written answer. `BAND_REASON`, `CASHYRS`,
`LOSSYRS`, `THIN_READS`, `PILLAR_WEIGHT`, `PRICEHIST_BARS` were each read off
the pack by a human, written down, and then asserted by a guard that a batch of
verdicts had to pass before it was published. They are therefore a far stronger
oracle than a fresh assertion would be: 384 verdicts are standing on them.

A MISMATCH IS NOT AUTOMATICALLY A BUG IN THE LIBRARY
----------------------------------------------------
It is one of three things, and the script says which it cannot distinguish:

1. The library is wrong.
2. The generator's constant was batch-specific judgment wearing the clothes of
   a rule — the outcome that kills `SPEC-evidence-sheet.md`.
3. The pack moved under the generator since it was published, in which case the
   generator's own guards would fail too, and that is worth knowing on its own.

So every mismatch is printed in full rather than counted. A green run means the
rules survived extraction. A run with mismatches needs each one read.

Usage:  etl/.venv/bin/python build/verdicts/lib/replay_refusals.py
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refusals as R  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
# A zero-comparison run is a check that cannot fail, so the path is asserted
# here rather than trusted: this script is three directories deep and the
# first version of it was one dirname short and reported a clean 0 of 0.
assert os.path.isdir(os.path.join(ROOT, "build/verdicts")), \
    f"ROOT={ROOT} does not contain build/verdicts"

# BAND_REASON's vocabulary drifted across batches; both spellings mean the
# same finding and the library's tags are canonical.
BAND_WORD = {R.BAND_WIDE: {"wide", "too wide", "wide band"},
             R.BAND_ABSENT: {"absent", "none", "no band", "missing",
                             "short", "too short", "thin"}}

# The one place the extraction genuinely failed, recorded rather than tuned
# away. Each entry is a published verdict that quotes a pillar percentile over
# a shortfall it never discloses, with the shortfall measured. The generators
# each applied an undeclared materiality threshold and disagreed with each
# other; `refusals.pillar_caveats` now takes the threshold as an argument and
# defaults to disclosing everything.
#
# These are listed so the run can go green on what is understood WITHOUT the
# understanding becoming invisible. The script also asserts each one still
# reproduces: a known gap that stops appearing is reported too, because that
# means either the pack moved or the prose was fixed, and both change what this
# file is claiming.
KNOWN_GAPS = {
    ("chemicals_agro_8", "DHARMAJ", "pillar caveats"): "quality 92.0 of 100",
    ("defense_aero_10", "CENTUM", "pillar caveats"): "quality 92.8 of 100",
    ("defense_aero_10", "SIGMAADV", "pillar caveats"): "quality 89.2 of 100",
    ("it_services_8", "CALSOFT", "pillar caveats"): "valuation 95 of 100",
    ("it_services_8", "RATEGAIN", "pillar caveats"):
        "valuation 95 of 100 — the PROSE does disclose it, the constant does "
        "not, so this one is a stale constant rather than a silent verdict",
    ("media_6", "PVRINOX", "pillar caveats"): "valuation 85 of 100",
    ("media_6", "PFOCUS", "pillar caveats"): "valuation 85 of 100",
}

mismatches: list[str] = []
seen_gaps: set = set()
checked = 0
skipped: list[str] = []


def load(path: str) -> dict | None:
    """Exec a generator without letting it write its output file."""
    src = open(path).read()
    src = src.replace('\nif __name__ == "__main__":\n    main()\n', "\n")
    src = re.sub(r"\nmain\(\)\s*$", "\n", src)
    ns: dict = {"__name__": "replay", "__file__": os.path.basename(path)}
    try:
        exec(compile(src, os.path.basename(path), "exec"), ns)
    except Exception as e:                                   # noqa: BLE001
        skipped.append(f"{os.path.basename(path)}: will not import ({e})")
        return None
    return ns


def note(batch: str, sym: str, what: str, hand, lib) -> None:
    global checked
    checked += 1
    if hand == lib:
        return
    key = (batch, sym, what)
    if key in KNOWN_GAPS:
        seen_gaps.add(key)
        return
    mismatches.append(f"{batch:22} {sym:12} {what:24} "
                      f"hand={hand!r} lib={lib!r}")


def band_equal(hand, lib_tag) -> bool:
    if hand is None:
        return lib_tag is None
    if lib_tag is None:
        return False
    return str(hand).strip().lower() in BAND_WORD.get(lib_tag, set())


def main() -> int:
    global checked
    for gen in sorted(glob.glob(os.path.join(ROOT, "build/verdicts/mk_*.py"))):
        batch = os.path.basename(gen)[3:-3]
        ns = load(gen)
        if ns is None:
            continue
        pack_path = ns.get("PACK")
        if not pack_path:
            skipped.append(f"{batch}: no PACK constant")
            continue
        if not os.path.isabs(pack_path):
            pack_path = os.path.join(ROOT, pack_path)
        if not os.path.exists(pack_path):
            skipped.append(f"{batch}: pack gone ({ns['PACK']})")
            continue
        pack = {s["symbol"]: s for s in json.load(open(pack_path))["symbols"]}
        if not any((r.get("peer_ranks") or {}) for r in pack.values()):
            skipped.append(f"{batch}: pack predates the peer_ranks block")
            continue

        spec = ns.get("SPEC") or {}
        syms = [s for s in spec if s in pack] or list(pack)
        # THIN_READS and SHAREALIGN are stated once per batch but describe ONE
        # cohort. In a multi-tier batch each tier has its own denominators and
        # its own filing count, so a batch-wide constant cannot be compared
        # per row without reporting the tier difference as a rule failure.
        tiers = {((pack[s].get("peer_ranks") or {}).get("cohort")
                  or {}).get("tier") for s in syms}
        single_tier = len(tiers) == 1

        # --- the band ------------------------------------------------------
        hand_band = ns.get("BAND_REASON")
        if isinstance(hand_band, dict):
            for s in syms:
                if s not in hand_band:
                    continue
                lib = R.band_state(pack[s])
                checked += 1
                if not band_equal(hand_band[s], lib):
                    mismatches.append(
                        f"{batch:22} {s:12} {'band_state':24} "
                        f"hand={hand_band[s]!r} lib={lib!r}")

        # --- the cash record -----------------------------------------------
        hand_cash = ns.get("CASHYRS")
        if isinstance(hand_cash, dict):
            # CASHYRS is positional and the position MOVED between batches:
            # (neg, rows, ratio) in the recent ones, (neg, ratio, reason) in
            # media and realty. Guessing wrong turns slot 1 into a count and
            # reports ten false mismatches, which is what the first run did.
            # Decide the shape from the data: a row count is a small integer,
            # a cash-conversion ratio is a float.
            slot1 = [t[1] for t in hand_cash.values()
                     if isinstance(t, (tuple, list)) and len(t) > 1]
            rows_at_1 = bool(slot1) and all(
                isinstance(x, int) and not isinstance(x, bool) for x in slot1)
            ratio_at = 2 if rows_at_1 else 1
            for s in syms:
                t = hand_cash.get(s)
                if not isinstance(t, (tuple, list)) or len(t) < 2:
                    continue
                got = R.cash_counts(pack[s])
                note(batch, s, "cash negative years", t[0], got["negative"])
                if rows_at_1:
                    note(batch, s, "cash rows", t[1], got["rows"])
                ratio = t[ratio_at] if len(t) > ratio_at else None
                if isinstance(ratio, (int, float)) \
                        and got["cfo_op_latest"] is not None:
                    note(batch, s, "cfo_op_latest", round(float(ratio), 4),
                         round(float(got["cfo_op_latest"]), 4))

        # --- loss-making years ---------------------------------------------
        hand_loss = ns.get("LOSSYRS")
        if isinstance(hand_loss, dict):
            for s in syms:
                if s not in hand_loss or not isinstance(hand_loss[s], int):
                    continue
                note(batch, s, "loss years", hand_loss[s],
                     R.profit_counts(pack[s])["loss"])

        # --- the sub-floor set, the rule the floor cannot express ----------
        floors = ns.get("DENOM_FLOOR")
        for s in syms:
            tier = ((pack[s].get("peer_ranks") or {}).get("cohort")
                    or {}).get("tier")
            floor = (floors.get(tier) if isinstance(floors, dict)
                     else floors if isinstance(floors, int) else None)
            if floor is None:
                continue
            lib = sorted(k for k, why in R.withheld_metrics(pack[s], floor)
                         .items() if why == R.SUB_FLOOR)
            # the generators compute this inline; recompute the same way and
            # assert the library agrees with the inline version
            mr = (pack[s].get("peer_ranks") or {}).get("metrics") or {}
            hand = sorted(k for k, d in mr.items()
                          if d and d.get("rankable")
                          and (d.get("of") or 0) < floor)
            note(batch, s, f"sub-floor<{floor}", hand, lib)

        # --- thin readings --------------------------------------------------
        hand_thin = ns.get("THIN_READS")
        if isinstance(hand_thin, dict) and not single_tier:
            skipped.append(f"{batch}: THIN_READS is batch-wide across "
                           f"{len(tiers)} tiers, not comparable per row")
        elif isinstance(hand_thin, dict):
            for s in syms:
                lib = R.thin_reads(pack[s])
                for k, of in hand_thin.items():
                    if k in lib:
                        note(batch, s, f"thin {k}", of, lib[k])

        # --- pillar weights --------------------------------------------------
        hand_pw = ns.get("PILLAR_WEIGHT")
        if isinstance(hand_pw, dict):
            for s in syms:
                lib = sorted(R.pillar_caveats(pack[s]))
                # PILLAR_WEIGHT's shape drifted across batches: a list of
                # (pillar, phrase) pairs in the recent ones, longer tuples or
                # a pillar->phrase mapping in the older ones. Read the pillar
                # name out of whichever shape this generator used rather than
                # assuming, or the replay dies on the first old batch.
                decl = hand_pw.get(s) or []
                if isinstance(decl, dict):
                    names = set(decl)
                elif isinstance(decl, str):
                    names = {decl}
                elif (isinstance(decl, (tuple, list)) and len(decl) == 2
                      and all(isinstance(x, str) for x in decl)
                      and " " in decl[1]):
                    # a bare (pillar, phrase) pair rather than a list of them
                    names = {decl[0]}
                else:
                    names = {d[0] if isinstance(d, (tuple, list)) else d
                             for d in decl}
                hand = sorted(names)
                # momentum is handled by its own sentence in several batches
                # rather than by PILLAR_WEIGHT, so compare only what the
                # generator took responsibility for plus what it declared.
                lib = sorted(set(lib) - ({"momentum"} - set(hand)))
                note(batch, s, "pillar caveats", hand, lib)

        # --- the price series ------------------------------------------------
        ph_sym, ph_bars = ns.get("PRICEHIST_SYM"), ns.get("PRICEHIST_BARS")
        if ph_sym and ph_bars and ph_sym in pack:
            note(batch, ph_sym, "price-history bars", ph_bars,
                 (pack[ph_sym].get("technicals") or {}).get("bars"))

        # --- shareholding alignment ------------------------------------------
        if ns.get("SHAREALIGN") and not single_tier:
            skipped.append(f"{batch}: SHAREALIGN is batch-wide across "
                           f"{len(tiers)} tiers, not comparable per row")
        elif ns.get("SHAREALIGN"):
            txt = ns["SHAREALIGN"]
            for s in syms:
                al = R.shareholding_alignment(pack[s])
                note(batch, s, "filings not aligned", True, al is not None)
                if al and al.get("rows_with_filing") is not None:
                    note(batch, s, "rows filed stated",
                         True, str(al["rows_with_filing"]) in txt)

    stale = sorted(set(KNOWN_GAPS) - seen_gaps)
    print(f"{checked} comparison(s) across the surviving packs, "
          f"{len(mismatches)} mismatch(es), "
          f"{len(seen_gaps)} of {len(KNOWN_GAPS)} known gap(s) reproduced")
    if seen_gaps:
        print("\nknown gaps — the undeclared materiality threshold:")
        for k in sorted(seen_gaps):
            print(f"  {k[0]:22} {k[1]:12} {KNOWN_GAPS[k]}")
    if stale:
        print("\nKNOWN_GAPS entries that no longer reproduce — the pack moved "
              "or the prose changed; re-read before deleting:")
        for k in stale:
            print(f"  {k[0]:22} {k[1]:12} {KNOWN_GAPS[k]}")
    if skipped:
        print("\nnot replayed:")
        for s in skipped:
            print(f"  - {s}")
    if mismatches:
        print("\nmismatches — read each one; a mismatch may mean the "
              "constant was judgment, not a rule:")
        for m in mismatches:
            print(f"  {m}")
    return 1 if (mismatches or stale) else 0


if __name__ == "__main__":
    sys.exit(main())
