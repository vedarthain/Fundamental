#!/usr/bin/env python3
"""Load hand-written verdicts into app.stock_verdict.

Input is a JSON file: either one verdict object or a list of them.

    [
      {
        "symbol": "CROMPTON",
        "verdict": "HOLD — downgraded from BUY, I was wrong",
        "confidence": "medium",
        "points": ["<b>…</b> …", "…"],
        "trigger_text": "…",
        "evidence": {"pe_ttm": 31.2, "pct_above_200ema_252d": 0.1111},
        "snapshot_date": "2026-10-04",
        "price_asof": "2026-10-06",
        "model": "claude-opus-4.7",
        "source_report": "consumer-durables-23 v3"
      }
    ]

    APP_DB_URL="$NEON_APP_URL" FUNDAMENTAL_ALLOW_REMOTE_DB=1 \\
      etl/.venv/bin/python scripts/verdict-load.py /tmp/verdicts.json

WHY A LOADER AND NOT PSQL

Three things have to be true of every row and none of them is enforced by a
hand-written INSERT:

  1. `evidence` must be the figures the prose ACTUALLY quotes. That column is
     the whole staleness mechanism — the tab re-reads those keys live and
     reports what moved. An empty or decorative evidence object turns the
     verdict into an assertion with no expiry, which is the failure the table
     was built to prevent. So a row with no evidence is refused unless
     --allow-no-evidence is passed, and the flag exists to make the omission a
     visible decision rather than an oversight.
  2. Evidence keys should be resolvable against cluster_metrics, because a key
     with no live counterpart can never be rechecked. Unknown keys are listed
     as warnings rather than rejected, so that a typo ("pe_tmm") cannot quietly
     become a figure that is permanently uncheckable.

     But the warning only fires for keys that are neither live NOR in
     DERIVED_KEYS. The first version warned on every non-live key, which meant
     a 23-symbol batch printed the same 13 legitimately-derived names 23 times
     — and a check that is noise 299 lines out of 300 gets scrolled past
     together with the one line that mattered. DERIVED_KEYS here MUST mirror
     the set in web/src/lib/verdictTypes.ts: a key the loader accepts silently but
     the tab does not know is derived renders as "unchanged" forever, which is
     the one thing the drift table exists to prevent. Any addition goes in
     both files in the same commit.
  3. `snapshot_date` and `price_asof` must match the data the verdict was
     written from. Defaulted from the live DB when omitted, because getting
     this wrong silently misattributes the evidence to the wrong quarter.

It also refuses to overwrite. The table is append-only by design — a verdict's
history is the most useful thing about it — so a second load on the same day
for the same symbol is a conflict, reported, not a silent no-op.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent

REQUIRED = ("symbol", "verdict", "confidence", "points")
VALID_CONFIDENCE = {"high", "medium", "low"}

# Figures with no cluster_metrics counterpart: the own-history PE band (needs a
# price × earnings computation nothing performs), delivery_pct (no history in
# golden.delivery_data to compare against) and pledge_pct (column exists, NULL
# in every row). The TTM, margin and shareholding figures used to be here and
# are now written into cluster_metrics each snapshot — see CONTEXT_KEYS in
# etl/src/fundamental_etl/scoring/metrics.py.
# Must stay identical to DERIVED_KEYS in web/src/lib/verdictTypes.ts; see the
# docstring for why that coupling is load-bearing rather than tidy.
DERIVED_KEYS = {
    "pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
    "delivery_pct", "pledge_pct",
}


def env_url(name: str, required: bool = True) -> Optional[str]:
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


def validate(v: dict, known_keys: set[str], allow_no_evidence: bool) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for one verdict object."""
    errs, warns = [], []
    for k in REQUIRED:
        if not v.get(k):
            errs.append(f"missing required field '{k}'")
    sym = str(v.get("symbol", "")).upper()
    if sym != v.get("symbol"):
        warns.append(f"symbol upper-cased to {sym}")
    if v.get("confidence") not in VALID_CONFIDENCE:
        errs.append(f"confidence must be one of {sorted(VALID_CONFIDENCE)}, got {v.get('confidence')!r}")
    pts = v.get("points")
    if not isinstance(pts, list) or not all(isinstance(p, str) and p.strip() for p in pts):
        errs.append("points must be a non-empty list of non-empty strings")

    if not v.get("trigger_text"):
        # Not fatal, but a verdict with no falsifying condition is a feeling.
        warns.append("no trigger_text — nothing states what would reverse this verdict")

    ev = v.get("evidence") or {}
    if not isinstance(ev, dict):
        errs.append("evidence must be an object")
    elif not ev:
        if allow_no_evidence:
            warns.append("no evidence stored — this verdict can never be rechecked, "
                         "and the tab will say so")
        else:
            errs.append("no evidence stored. The evidence object is the staleness "
                        "mechanism; without it the verdict has no expiry. Pass "
                        "--allow-no-evidence to accept this deliberately.")
    else:
        unknown = [k for k in ev if k not in known_keys and k not in DERIVED_KEYS]
        if unknown:
            warns.append("evidence keys that are neither live metrics nor known derived "
                         "figures — a typo here is permanently uncheckable: "
                         + ", ".join(sorted(unknown)))
    return errs, warns


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", help="JSON file: one verdict object or a list of them")
    ap.add_argument("--dry-run", action="store_true", help="validate and print, write nothing")
    ap.add_argument("--allow-no-evidence", action="store_true")
    args = ap.parse_args()

    payload = json.loads(Path(args.path).read_text())
    verdicts = payload if isinstance(payload, list) else [payload]

    conn = psycopg.connect(env_url("APP_DB_URL"), row_factory=dict_row)

    with conn.cursor() as cur:
        cur.execute(
            """SELECT MAX(snapshot_date) AS snap,
                      (SELECT array_agg(DISTINCT k)
                         FROM app.metrics_snapshot m2,
                              jsonb_object_keys(m2.cluster_metrics) k
                        WHERE m2.snapshot_date = (SELECT MAX(snapshot_date)
                                                    FROM app.metrics_snapshot)) AS keys
                 FROM app.metrics_snapshot"""
        )
        row = cur.fetchone()
    default_snap: Optional[date] = row["snap"]
    known_keys = set(row["keys"] or [])

    fatal = 0
    for v in verdicts:
        errs, warns = validate(v, known_keys, args.allow_no_evidence)
        tag = str(v.get("symbol", "?")).upper()
        for w in warns:
            print(f"  ~  {tag}: {w}", file=sys.stderr)
        for e in errs:
            print(f"  X  {tag}: {e}", file=sys.stderr)
            fatal += 1
    if fatal:
        print(f"\n{fatal} error(s) — nothing written.", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"  .. {len(verdicts)} verdict(s) valid (dry run, nothing written)", file=sys.stderr)
        return 0

    written, conflicts = 0, []
    with conn.cursor() as cur:
        for v in verdicts:
            sym = str(v["symbol"]).upper()
            gen = v.get("generated_at") or datetime.now().astimezone().isoformat()
            try:
                cur.execute(
                    """INSERT INTO app.stock_verdict
                         (symbol, generated_at, verdict, confidence, points, trigger_text,
                          evidence, snapshot_date, price_asof, model, source_report)
                       VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, %s, %s)""",
                    (sym, gen, v["verdict"], v["confidence"],
                     json.dumps(v["points"]), v.get("trigger_text"),
                     json.dumps(v.get("evidence") or {}),
                     v.get("snapshot_date") or default_snap,
                     v.get("price_asof"), v.get("model"), v.get("source_report")),
                )
                written += 1
            except psycopg.errors.UniqueViolation:
                # Append-only: an identical timestamp for the same symbol means
                # this load is a repeat, not an update. Say so rather than
                # overwriting a verdict whose history is the point.
                conn.rollback()
                conflicts.append(f"{sym} @ {gen}")
                continue
    conn.commit()

    print(f"  -> {written} verdict(s) written", file=sys.stderr)
    for c in conflicts:
        print(f"  !! already present, not overwritten: {c}", file=sys.stderr)
    return 1 if conflicts and written == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
