#!/usr/bin/env python3
"""Verify, independently of sheet.py, that every number in a sheet traces.

WHY A SECOND CHECK WHEN Sentence.t() ALREADY REJECTS DIGITS
----------------------------------------------------------
Because a rule enforced only by the thing it governs is a rule nobody is
checking. `sheet.py` could grow a path that appends to `_out` directly, a
pack-authored string could carry a figure nobody declared, or a format string
could render a token the provenance list does not hold. Each of those passes
`t()` and still puts an untraced number in front of a reader.

So this script re-derives the claim from the OUTPUT: pull every numeric token
out of the rendered text, pull every token out of the provenance list, and
assert the first set is covered by the second. Unlike `verdict-check.py`'s
ratio over hand-written prose, 100% is the only acceptable answer here —
there is no legitimate untraced number in a templated sentence.

It also asserts the sheet never grades: no action word, no adjective that
ranks a row, no falsification language. A sheet that starts sounding like a
verdict is the failure mode this whole artefact exists to avoid.

Usage:
  etl/.venv/bin/python build/verdicts/lib/check_sheet.py <pack.json> <floor>
  etl/.venv/bin/python build/verdicts/lib/check_sheet.py <pack.json> <floor> --show SYMBOL
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sheet as S  # noqa: E402

# Numbers as a reader sees them: 1,234.56 / 12.3 / -4 / 95
# The thousands group is spelled out rather than a [\d,] class: the loose
# version swallows the comma AFTER a number in a list ("62, in a 3-way tie")
# and then reports "62," as an untraced figure, which is 117 false failures.
NUM = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")

# Words that turn a sheet into a verdict. Checked as whole words so that
# "accumulated depreciation" does not read as ACCUMULATE.
GRADING = (
    # action labels
    "buy", "sell", "accumulate", "reduce", "avoid", "hold", "watch",
    "speculative",
    # adjectives that grade rather than describe
    "cheap", "expensive", "attractive", "unattractive", "strong", "weak",
    "durable", "fragile", "healthy", "unhealthy", "impressive", "poor",
    "excellent", "concerning", "worrying", "compelling", "undervalued",
    "overvalued", "quality business", "best", "worst",
    # thesis language
    "thesis", "if this", "would trigger", "downgrade", "upgrade",
    "we expect", "should outperform", "target price",
)


def numeric_tokens(text: str) -> list[str]:
    """Every number a reader would see, with markup stripped first so that a
    tag's own characters are never mistaken for a figure."""
    return NUM.findall(re.sub(r"<[^>]+>", " ", text))


def check(row: dict, floor: int) -> tuple[list[str], dict]:
    errs: list[str] = []
    out = S.render(row, floor)
    sym = out["symbol"]

    traced: set[str] = set()
    for _path, _value, token in out["provenance"]:
        for t in numeric_tokens(str(token)):
            traced.add(t)

    for b in out["blocks"]:
        for tok in numeric_tokens(b["text"]):
            if tok not in traced:
                errs.append(f"{sym}: block '{b['title']}' states {tok}, which "
                            f"no pack field produced")

    low = " ".join(b["text"] for b in out["blocks"]).lower()
    for w in GRADING:
        if re.search(rf"\b{re.escape(w)}\b", low):
            errs.append(f"{sym}: the sheet says '{w}' — a sheet describes, it "
                        f"does not grade")

    # The table carries the same figures through a DIFFERENT path — the unit
    # map multiplies fractions by a hundred, so a token there is not the raw
    # pack value and the block check above cannot see it. Checked separately:
    # every token in a cell must be in that row's own provenance, and a column
    # with no declared unit must SAY so in its note rather than render a bare
    # number the reader will read as a percentage.
    tab = S.render_table(row, floor)
    ttraced: set[str] = set()
    for _p, _v, token in tab["provenance"]:
        ttraced |= set(numeric_tokens(str(token)))
    for c in tab["rows"]:
        for field in ("value", "rank", "of", "note"):
            for tok in numeric_tokens(c[field]):
                if tok not in ttraced:
                    errs.append(f"{sym}: table row '{c['metric']}' states "
                                f"{tok} in {field}, which no pack field "
                                f"produced")
        if S.unit(c["metric"]) is None \
                and "unit not declared" not in c["note"]:
            errs.append(f"{sym}: {c['metric']} has no declared unit and the "
                        f"table does not say so — a bare number reads as "
                        f"whatever unit the label implies")
        if c["label"] == c["metric"]:
            errs.append(f"{sym}: {c['metric']} has no plain-English label")

    # A sheet that withholds nothing and says so nowhere is suspicious: every
    # pack measured so far refuses something. This is the "check that cannot
    # fail" guard turned on this script itself.
    if not out["withheld"] and S.R.band_state(row) is None \
            and not S.R.pillar_caveats(row):
        errs.append(f"{sym}: nothing is withheld and no band or pillar "
                    f"shortfall is reported — verify this row really is "
                    f"complete rather than unread")
    return errs, out


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    pack_path, floor = sys.argv[1], int(sys.argv[2])
    show = (sys.argv[sys.argv.index("--show") + 1]
            if "--show" in sys.argv else None)

    rows = json.load(open(pack_path))["symbols"]
    all_errs: list[str] = []
    tokens = traced_ok = 0
    for row in rows:
        errs, out = check(row, floor)
        all_errs += errs
        for b in out["blocks"]:
            n = len(numeric_tokens(b["text"]))
            tokens += n
        traced_ok += sum(
            1 for b in out["blocks"] for t in numeric_tokens(b["text"]))
        if show and out["symbol"] == show:
            print(f"=== {out['symbol']} " + "=" * 50)
            for b in out["blocks"]:
                print(f"\n[{b['title']}]\n{b['text']}")
            print("\n" + "=" * 60 + "\n")

    print(f"{len(rows)} row(s), {tokens} numeric token(s) rendered, "
          f"{len(all_errs)} error(s)")
    for e in all_errs:
        print(f"  FAIL {e}")
    return 1 if all_errs else 0


if __name__ == "__main__":
    sys.exit(main())
