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
  2. Evidence keys must be resolvable against cluster_metrics, because a key
     with no live counterpart can never be rechecked. An unresolvable key is a
     fatal error: a typo ("pe_tmm") would otherwise become a figure that is
     permanently uncheckable, and the tab has no way to show that it failed to
     resolve — it simply omits the row from the drift table, silently.

     This was a warning until 2026-10-13. A warning does not stop a load, and
     the dry-run then printed "N verdict(s) valid" underneath it, so the only
     signal was one stderr line in a batch that prints dozens. Measured before
     changing it: across all 220 verdict rows loaded to that date, zero carried
     an unresolvable key — so making it fatal rejects nothing that has ever
     been written deliberately. If a genuinely new derived figure is needed,
     the fix is to add it to DERIVED_KEYS in BOTH files, which is the coupling
     the next paragraph exists to protect.

     The check only fires for keys that are neither live NOR in
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


def anchor_prices(symbols: list[str], asof: dict[str, date]) -> dict[str, Optional[float]]:
    """Close on each verdict's own `price_asof`, read from golden.

    WHY THIS IS HERE AND NOT IN THE MIGRATION. The anchor has to come from
    golden_db and the verdicts live in app_db, so no single SQL file can do it;
    and it has to run on every load, not once, or `anchor_price` becomes the
    next column that was seeded and then fed by nothing (CLAUDE.md §5 — which
    is exactly what happened to `price_asof` itself, see 0087).

    The query shape is copied from `latestCloseBySymbol()` in
    web/src/lib/calls.ts rather than written fresh, because that function
    already carries the four things ad-hoc SQL here would get wrong: the `.NS`
    suffix golden keys symbols by, the `interval = '1d'` filter, the
    `close IS NOT NULL` guard and a positive-close check. The one difference is
    deliberate: that function wants the NEWEST close, this one wants the close
    as of a past date, so the window is `date <= asof` rather than a trailing
    45 days.

    Returns None for a symbol golden cannot price. That is not an error — see
    0087 on why the column is nullable — so a missing bar must never stop the
    prose from loading.
    """
    url = env_url("GOLDEN_DB_URL", required=False)
    if not url or not symbols:
        return {}
    out: dict[str, Optional[float]] = {}
    try:
        with psycopg.connect(url, row_factory=dict_row) as g, g.cursor() as cur:
            for sym in symbols:
                d = asof.get(sym)
                if d is None:
                    continue
                cur.execute(
                    """SELECT close::float AS close
                         FROM golden.price_history
                        WHERE interval = '1d' AND symbol = %s
                          AND date <= %s AND close IS NOT NULL AND close > 0
                        ORDER BY date DESC
                        LIMIT 1""",
                    (f"{sym}.NS", d),
                )
                r = cur.fetchone()
                out[sym] = r["close"] if r else None
    except Exception as exc:  # golden unreachable — load the prose anyway
        print(f"  ~  golden unreachable, anchor prices left NULL: {exc}", file=sys.stderr)
        return {}
    return out


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
            errs.append("evidence keys that are neither live cluster_metrics nor known "
                        "derived figures: " + ", ".join(sorted(unknown))
                        + ". These can never be rechecked, so the verdict would have no "
                          "expiry on those figures. Fix the typo, or add a genuinely new "
                          "derived key to DERIVED_KEYS in BOTH scripts/verdict-load.py "
                          "and web/src/lib/verdictTypes.ts.")
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

    fatal, warned = 0, 0
    for v in verdicts:
        errs, warns = validate(v, known_keys, args.allow_no_evidence)
        tag = str(v.get("symbol", "?")).upper()
        for w in warns:
            print(f"  ~  {tag}: {w}", file=sys.stderr)
            warned += 1
        for e in errs:
            print(f"  X  {tag}: {e}", file=sys.stderr)
            fatal += 1
    if fatal:
        print(f"\n{fatal} error(s) — nothing written.", file=sys.stderr)
        return 1

    # "valid" on its own line read as clean even with warnings printed above it,
    # which is how an unresolvable evidence key used to get through unread.
    tally = f" ({warned} warning(s) above — read them)" if warned else ""
    if args.dry_run:
        print(f"  .. {len(verdicts)} verdict(s) valid{tally} (dry run, nothing written)",
              file=sys.stderr)
        return 0

    # price_asof DEFAULTS TO THE SNAPSHOT DATE. It used to be a bare
    # `v.get("price_asof")`, so the two oil-refining batches — whose generators
    # never set the key — wrote NULL, and nothing complained. The snapshot date
    # is the date the evidence pack was cut, which is the correct fallback: it
    # is the data the verdict was reasoned from.
    asof: dict[str, date] = {}
    for v in verdicts:
        d = v.get("price_asof") or v.get("snapshot_date") or default_snap
        if isinstance(d, str):
            d = date.fromisoformat(d)
        if d is not None:
            asof[str(v["symbol"]).upper()] = d
    anchors = anchor_prices(list(asof), asof)
    unpriced = [s for s in asof if anchors.get(s) is None]
    if unpriced:
        print(f"  ~  no anchor price for {len(unpriced)}: {', '.join(sorted(unpriced)[:12])}",
              file=sys.stderr)

    written, conflicts = 0, []
    with conn.cursor() as cur:
        for v in verdicts:
            sym = str(v["symbol"]).upper()
            gen = v.get("generated_at") or datetime.now().astimezone().isoformat()
            try:
                cur.execute(
                    """INSERT INTO app.stock_verdict
                         (symbol, generated_at, verdict, confidence, points, trigger_text,
                          evidence, snapshot_date, price_asof, anchor_price,
                          model, source_report)
                       VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, %s, %s, %s)""",
                    (sym, gen, v["verdict"], v["confidence"],
                     json.dumps(v["points"]), v.get("trigger_text"),
                     json.dumps(v.get("evidence") or {}),
                     v.get("snapshot_date") or default_snap,
                     asof.get(sym), anchors.get(sym),
                     v.get("model"), v.get("source_report")),
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
