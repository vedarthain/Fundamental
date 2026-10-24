#!/usr/bin/env python3
"""Re-render every evidence sheet that is behind the newest score snapshot.

WHY THIS EXISTS

A sheet is a pure function of (pack, template), and the pack is built from one
`app.scores` snapshot. So the week a new snapshot lands, every sheet ever loaded
becomes a page of figures from a prior week — and it says so nowhere a reader
would notice, because the numbers still render perfectly.

That is not hypothetical. 31 sheets were loaded on 2026-10-24 against the
2026-10-21 snapshot; the weekly compute wrote a 2026-10-24 snapshot hours later
and `coverage.evidence_sheets_current` went red the same day. Nothing rebuilt
them because nothing existed to.

This is the answer to CLAUDE.md §5's "what keeps this current?". Without it the
honest answer is "the initial load", which is the sentence that precedes every
bug in this codebase.

WHY IT REBUILDS VERDICTED SYMBOLS TOO

A symbol that acquires a hand-written verdict stops RENDERING its sheet — the
stock page shows the verdict and never both. But the row is still in the table,
and the staleness assertion counts rows, not rendered pages. Skipping those
symbols would leave a permanently red check that nobody can turn green, which
is worse than no check: a red that cannot be cleared gets ignored, and takes
the real reds with it.

WHY IT REFUSES TO RUN ONTO A STALE SNAPSHOT

If the weekly compute did not run, the newest snapshot is last week's, and
rebuilding against it would stamp every row with a fresh `generated_at` over
old figures — turning a loud staleness failure into a green tick. So the age of
the snapshot being rebuilt onto is checked first, and an old one FAILS rather
than proceeds. The sheets staying visibly stale is the correct outcome when the
pipeline upstream is broken.

WHY BATCHES

The pack for 30 symbols is 1.2 MB. The full backlog is ~2,800. Batching keeps
each pack file and each render pass bounded, and a failure names the batch it
happened in instead of taking the whole run down with no idea where.

Usage (CI runs it with no arguments):

  APP_DB_URL=... GOLDEN_DB_URL=... FUNDAMENTAL_ALLOW_REMOTE_DB=1 \
    etl/.venv/bin/python scripts/evidence-sheet-rebuild.py
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "scripts" / "verdict-evidence.py"
LOADER = ROOT / "scripts" / "evidence-sheet-load.py"


def env_url(name: str) -> str:
    url = os.environ.get(name)
    if not url:
        print(f"  X  {name} is not set", file=sys.stderr)
        raise SystemExit(2)
    return url


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--batch-size", type=int, default=250)
    ap.add_argument("--max-snapshot-age-days", type=int, default=8,
                    help="refuse to rebuild onto a snapshot older than this; "
                         "see the docstring for why that is a failure and not "
                         "a reason to proceed")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be rebuilt and stop")
    args = ap.parse_args()

    conn = psycopg.connect(env_url("APP_DB_URL"), row_factory=dict_row)
    with conn.cursor() as cur:
        cur.execute("SELECT max(snapshot_date) AS d FROM app.scores")
        latest: date | None = cur.fetchone()["d"]
        if latest is None:
            print("  X  app.scores is empty — nothing to rebuild onto",
                  file=sys.stderr)
            return 1

        age = (date.today() - latest).days
        if age > args.max_snapshot_age_days:
            print(f"  X  newest app.scores snapshot is {latest} ({age}d old, "
                  f"max {args.max_snapshot_age_days}d). REFUSING to rebuild: "
                  f"restamping sheets onto a stale snapshot would turn a "
                  f"staleness failure into a green tick. Fix the weekly "
                  f"compute first.", file=sys.stderr)
            return 1

        # Newest row per symbol, because the table keeps history and an old
        # row being behind the snapshot is the point of keeping it.
        cur.execute("""
            WITH newest AS (
              SELECT DISTINCT ON (symbol) symbol, snapshot_date
                FROM app.stock_evidence_sheet
               ORDER BY symbol, generated_at DESC)
            SELECT symbol FROM newest
             WHERE snapshot_date < %s
             ORDER BY symbol
        """, (latest,))
        symbols = [r["symbol"] for r in cur.fetchall()]

    if not symbols:
        print(f"  .. every sheet is already on {latest} — nothing to rebuild",
              file=sys.stderr)
        return 0

    print(f"  .. {len(symbols)} sheet(s) behind {latest}, in batches of "
          f"{args.batch_size}", file=sys.stderr)
    if args.dry_run:
        print("  .. dry run, nothing rebuilt", file=sys.stderr)
        return 0

    failures: list[str] = []
    rebuilt = 0
    for i in range(0, len(symbols), args.batch_size):
        batch = symbols[i:i + args.batch_size]
        tag = f"batch {i // args.batch_size + 1}"
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp) / "pack.json"
            steps = [
                [sys.executable, str(EVIDENCE), "--symbols", ",".join(batch),
                 "--out", str(pack)],
                # --include-verdicted: see the docstring. A verdicted symbol's
                # sheet does not render, but it is still a row the staleness
                # assertion counts.
                [sys.executable, str(LOADER), str(pack), "--include-verdicted"],
            ]
            ok = True
            for cmd in steps:
                proc = subprocess.run(cmd, cwd=ROOT)
                if proc.returncode != 0:
                    failures.append(f"{tag}: {Path(cmd[1]).name} exited "
                                    f"{proc.returncode}")
                    ok = False
                    break
            if ok:
                rebuilt += len(batch)

    print(f"  -> rebuilt {rebuilt} of {len(symbols)} sheet(s) onto {latest}",
          file=sys.stderr)
    for f in failures:
        print(f"  X  {f}", file=sys.stderr)
    # A partial rebuild is a failure, not a partial success: the sheets that
    # did not rebuild are exactly the ones still showing last week's figures,
    # and coverage.evidence_sheets_current will say so on the next run.
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
