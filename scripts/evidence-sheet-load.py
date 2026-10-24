#!/usr/bin/env python3
"""Render evidence packs into app.stock_evidence_sheet. Nothing hand-written.

Input is a pack produced by scripts/verdict-evidence.py — the same file a
verdict generator reads. Output is one row per symbol in app.stock_evidence_sheet
(migration 0088).

    APP_DB_URL="$NEON_APP_URL" FUNDAMENTAL_ALLOW_REMOTE_DB=1 \\
      etl/.venv/bin/python scripts/evidence-sheet-load.py /tmp/pack.json --floor 27

HOW THIS DIFFERS FROM scripts/verdict-load.py, AND WHY

`verdict-load.py` validates prose a human wrote: it cannot check whether a
sentence is *true*, only whether its evidence keys resolve. Here there is no
sentence. The sheet is a pure function of (pack, template), so the one class of
bug — a template rendering a figure the pack does not support — is checkable
completely rather than as a ratio. Four consequences:

  1. **It renders; it does not accept content.** There is no field in the input
     that becomes output text. `build/verdicts/lib/sheet.py` builds every
     sentence out of digit-free literals plus traced pack reads, so "every
     number came from the pack" is a property of construction, not a hope.

  2. **check_sheet.py runs on this loader's own output and a single untraced
     number refuses the whole load.** Not a warning. `verdict-load.py`'s own
     docstring records what a warning bought: the unresolvable-key check
     printed one stderr line underneath "N verdict(s) valid" and nobody read
     it for five months. 100% is the only acceptable number here, because
     unlike hand-written prose a template has no legitimate untraced figure.

  3. **--floor is required and has no default.** It is the cohort's thinnest
     anchored reading and it was measured per cohort — 27 in leisure, 28/17 in
     cement, 19 in textiles. A default bakes one cluster's measurement into
     every cluster, and nothing in the rendered output looks wrong when the
     floor is wrong. That is the single most likely way to ship a wrong sheet.

  4. **A symbol that already has a hand-written verdict is SKIPPED, not
     loaded.** The render precedence on the stock page shows the verdict and
     never the sheet, so a row written here for such a symbol is invisible —
     and invisible rows are what the staleness assertion in coverage.py then
     has to explain. Pass --include-verdicted only if you are deliberately
     pre-building sheets for symbols whose verdicts you intend to retire.

A PACK BLOCKER DOES NOT STOP A SHEET. The blockers in a pack exist to stop a
human writing prose over a hole — "no 200-EMA reading: 274 bars, needs ~450".
A sheet makes no claim that a hole could undermine, so each blocker is recorded
in `withheld` and the row loads. Skipping instead reproduces the gap this
artefact exists to close: a stock with data showing nothing, indistinguishable
from a stock nobody looked at. (That is the DURLAX case — scored, in cluster,
and silently absent from every batch.)

WHY `generator` IS A HASH AND NOT A HAND-BUMPED VERSION STRING

PLAN-sheet-main-session.md asked for "a version string bumped by hand when
sheet.py changes output". It is a hash of sheet.py + refusals.py instead, and
the deviation is deliberate: a hand-bumped string is CLAUDE.md §5's whole
subject. It is correct on the day it is written and silently wrong on every
subsequent edit, and the failure is invisible — two rows claiming the same
generator while rendering differently is precisely the state the column exists
to detect. A content hash cannot drift, and `--generator` is still there for a
caller who wants to label a run.

`pack_sha` is the hash of the pack file actually read, so a row's inputs and
its renderer are both pinned. Together they answer "could this row be
reproduced today, and would it come out the same" — see 0088.

APPEND-ONLY, like app.stock_verdict. A second load on the same timestamp for
the same symbol is a conflict, reported, never an overwrite.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "build" / "verdicts" / "lib"

# sheet.py imports `refusals` flat (`import refusals as R`), so its own
# directory has to be on the path rather than the package root.
sys.path.insert(0, str(LIB))
import check_sheet as CS  # noqa: E402
import sheet as S  # noqa: E402


def env_url(name: str, required: bool = True) -> Optional[str]:
    """Same resolution order as verdict-load.py: env first, then .env.local."""
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if required:
        raise SystemExit(f"{name} not set — pass as env var, or add to .env.local.")
    return None


def _sha12(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def renderer_id() -> str:
    """Identity of the code that produced the output, not of its intent.

    Hashes both files because the refusal rules decide what is withheld, and a
    sheet that withholds differently IS different output even when sheet.py is
    byte-identical.
    """
    return f"sheet.py+refusals.py@{_sha12(LIB / 'sheet.py', LIB / 'refusals.py')}"


#: The prose block whose content the TABLE replaces. sheet.py renders the peer
#: ranks twice on purpose — once as a paragraph, once as a grid — and
#: check_sheet.py validates both. Only one may be stored: two copies of the
#: same thirty-eight measurements would be the duplicated buy marker of
#: CLAUDE.md §4 with ranks attached, and the paragraph is the copy that forces
#: a selection among them, which is the judgment a sheet may not make.
RANK_PROSE_TITLE = "What the data positions"


def stored_blocks(out: dict, table: dict) -> list[dict]:
    """The display-order block list that goes into the `blocks` column.

    Text blocks keep their {title, text} shape; the ranks arrive as a block
    carrying {title, rows, cohort_n} and no text at all, so the renderer
    chooses a shape per block rather than the loader choosing a layout.
    """
    blocks: list[dict] = []
    for b in out["blocks"]:
        if b["title"] == RANK_PROSE_TITLE:
            blocks.append({"title": "Peer ranks",
                           "cohort_n": table["cohort_n"],
                           "rows": table["rows"]})
            continue
        blocks.append(b)
    # A pack can be thin enough that the rank paragraph never rendered. The
    # table still has rows in that case, and dropping them silently is how a
    # sheet ends up shorter than the data it was built from.
    if table["rows"] and not any(b.get("rows") for b in blocks):
        blocks.append({"title": "Peer ranks",
                       "cohort_n": table["cohort_n"],
                       "rows": table["rows"]})
    return blocks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", help="pack JSON from scripts/verdict-evidence.py")
    ap.add_argument("--floor", type=int, required=True,
                    help="the cohort's thinnest anchored reading, MEASURED for "
                         "this cohort. No default by design — see docstring.")
    ap.add_argument("--dry-run", action="store_true",
                    help="render, check and report; write nothing")
    ap.add_argument("--include-verdicted", action="store_true",
                    help="also write sheets for symbols that already have a "
                         "hand-written verdict (they will not render)")
    ap.add_argument("--generator", default=None,
                    help="override the renderer id; the default is a content "
                         "hash and is almost always what you want")
    ap.add_argument("--show", default=None, metavar="SYMBOL",
                    help="print one rendered sheet to stdout")
    args = ap.parse_args()

    pack_path = Path(args.path)
    pack = json.loads(pack_path.read_text())
    rows = pack.get("symbols") or []
    if not rows:
        print("  X  pack carries no symbols", file=sys.stderr)
        return 1

    pack_sha = hashlib.sha256(pack_path.read_bytes()).hexdigest()
    generator = args.generator or renderer_id()

    # snapshot_date comes from the PACK, not from MAX(app.scores) now. The pack
    # is the thing that was measured; reading the DB again here would stamp a
    # row with a snapshot it was not built from the moment a new ETL run lands
    # mid-session, and snapshot_date is the key the staleness assertion counts.
    sanity = pack.get("sanity") or {}
    snap = sanity.get("snapshot_date")
    if not snap:
        print("  X  pack has no sanity.snapshot_date — cannot stamp the rows "
              "with the snapshot they were measured from", file=sys.stderr)
        return 1
    snapshot_date = date.fromisoformat(snap) if isinstance(snap, str) else snap
    pmax = sanity.get("price_max_date")
    price_asof = date.fromisoformat(pmax) if isinstance(pmax, str) else pmax

    conn = psycopg.connect(env_url("APP_DB_URL"), row_factory=dict_row)

    symbols = [str(r["symbol"]).upper() for r in rows]
    with conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT symbol FROM app.stock_verdict WHERE symbol = ANY(%s)",
            (symbols,),
        )
        verdicted = {r["symbol"] for r in cur.fetchall()}

    # RENDER AND CHECK EVERYTHING BEFORE WRITING ANYTHING. A pack is a cohort;
    # half a cohort loaded is a sheet whose "of the N" sentences describe peers
    # that are not there.
    rendered: list[tuple[str, dict]] = []
    errors: list[str] = []
    blocked_but_loaded: list[str] = []
    skipped_verdicted: list[str] = []

    for row in rows:
        sym = str(row["symbol"]).upper()
        if sym in verdicted and not args.include_verdicted:
            skipped_verdicted.append(sym)
            continue
        try:
            errs, out = CS.check(row, args.floor)
            table = S.render_table(row, args.floor)
        except Exception as exc:  # a template that raises is a failed load
            errors.append(f"{sym}: render raised {type(exc).__name__}: {exc}")
            continue
        # check_sheet already prefixes every error with the symbol.
        errors += list(errs)
        if not errs:
            out["blocks"] = stored_blocks(out, table)
            # A PACK BLOCKER IS RECORDED, NOT A REASON TO SKIP. The blockers
            # exist to stop a human writing PROSE over a hole — "no 200-EMA
            # reading: 274 bars, needs 450". A sheet makes no claim to be
            # undermined, so the honest handling is to state the limitation
            # beside the numbers. Skipping instead produces exactly the gap
            # this artefact was built to close: a stock with data, showing
            # nothing, indistinguishable from a stock nobody looked at.
            for i, b in enumerate(row.get("blockers") or []):
                out["withheld"][f"pack_blocker_{i + 1}"] = b
            if row.get("blockers"):
                blocked_but_loaded.append(sym)
            rendered.append((sym, out))

    for e in errors:
        print(f"  X  {e}", file=sys.stderr)
    if blocked_but_loaded:
        print(f"  ~  loaded WITH a pack blocker recorded in `withheld` "
              f"({len(blocked_but_loaded)}): {', '.join(sorted(blocked_but_loaded))}",
              file=sys.stderr)
    if skipped_verdicted:
        print(f"  ~  skipped, hand-written verdict exists ({len(skipped_verdicted)}): "
              f"{', '.join(sorted(skipped_verdicted))}", file=sys.stderr)

    if args.show:
        for sym, out in rendered:
            if sym == args.show.upper():
                print(f"=== {sym} " + "=" * 50)
                for b in out["blocks"]:
                    if b.get("rows") is not None:
                        print(f"\n[{b['title']}] cohort n={b['cohort_n']}")
                        for c in b["rows"]:
                            print(f"  {c['label']:<34} {c['value']:>14}  "
                                  f"{c['rank']:>5}/{c['of']:<5} {c['note']}")
                        continue
                    print(f"\n[{b['title']}]\n{b['text']}")
                if out["withheld"]:
                    print(f"\n[withheld] {json.dumps(out['withheld'], indent=2)}")

    if errors:
        # Refusal, not a warning. One untraced number means the renderer and
        # the pack disagree, and that disagreement is silent in every row.
        print(f"\n{len(errors)} error(s) — nothing written. A sheet with an "
              f"untraced figure is the one failure this artefact cannot "
              f"absorb.", file=sys.stderr)
        return 1

    if not rendered:
        print("  .. nothing to write (every symbol skipped)", file=sys.stderr)
        return 0

    if args.dry_run:
        print(f"  .. {len(rendered)} sheet(s) valid, floor={args.floor}, "
              f"snapshot={snapshot_date}, generator={generator} "
              f"(dry run, nothing written)", file=sys.stderr)
        return 0

    written, conflicts = 0, []
    gen_at = datetime.now().astimezone()
    with conn.cursor() as cur:
        for sym, out in rendered:
            try:
                cur.execute(
                    """INSERT INTO app.stock_evidence_sheet
                         (symbol, generated_at, blocks, withheld,
                          snapshot_date, price_asof, pack_sha, generator)
                       VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s)""",
                    (sym, gen_at, json.dumps(out["blocks"]),
                     json.dumps(out["withheld"]), snapshot_date, price_asof,
                     pack_sha, generator),
                )
                written += 1
            except psycopg.errors.UniqueViolation:
                conn.rollback()
                conflicts.append(f"{sym} @ {gen_at.isoformat()}")
                continue
    conn.commit()

    print(f"  -> {written} sheet(s) written, snapshot={snapshot_date}, "
          f"floor={args.floor}", file=sys.stderr)
    for c in conflicts:
        print(f"  !! already present, not overwritten: {c}", file=sys.stderr)
    return 1 if conflicts and written == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
