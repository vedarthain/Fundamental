#!/usr/bin/env python3
"""
check-drift.py — detect drift between local and Neon production data.

Until this script existed, drift was discovered by accident. We found
stale cluster_assignment rows on Neon weeks after a local re-cluster
because nothing checked. This script runs the same set of "size" queries
on both DBs and reports differences side-by-side.

Compared metrics (per DB pair: local app vs Neon app, local golden vs
Neon golden):

  app:
    - universe count (total + active)
    - cluster_assignment count
    - scores: latest snapshot_date + row count for that snapshot
    - cluster_composite_cache: row count for latest snapshot
    - cluster_stocks_panel_cache: row count for latest snapshot
    - screener_meta count (active stocks)
    - shareholding_pattern count

  golden:
    - price_history MAX(date)
    - price_history row count (interval='1d', last 30 days)

Output: two-column comparison.  Exit 1 if any metric drifts beyond
tolerance — useful for cron / one-off drift checks before/after a sync.

USAGE:
  # Defaults to local URLs from .env.local + NEON_*_URL env vars
  scripts/check-drift.py

  # Explicit overrides
  LOCAL_APP_URL=postgresql:///fundamental_app  \\
      NEON_APP_URL=...  NEON_GOLDEN_URL=...    \\
      LOCAL_GOLDEN_URL=postgresql:///golden_db \\
      scripts/check-drift.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Callable

import psycopg

ROOT = Path(__file__).resolve().parent.parent


def env_url(name: str, fallback: str | None = None) -> str:
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if fallback:
        return fallback
    raise SystemExit(f"✗ {name} not set — pass as env var or add to .env.local")


def mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)


# Each metric is (name, sql, scalar_extractor).  Both DBs run the same sql
# and we compare the resulting scalar.
AppMetric = tuple[str, str, Callable]
GoldenMetric = tuple[str, str, Callable]

_first = lambda row: row[0] if row else None  # noqa: E731


# Tolerance per metric: max absolute drift before flagging. None = must
# match exactly.  Tolerances are conservative — small drift on volatile
# row counts is normal between syncs, big drift means a sync was missed.
_APP_METRICS: list[tuple[str, str, int | None]] = [
    ("universe.total",
        "SELECT COUNT(*) FROM app.universe", 5),
    ("universe.active",
        "SELECT COUNT(*) FROM app.universe WHERE is_active", 5),
    ("cluster_assignment.rows",
        "SELECT COUNT(*) FROM app.cluster_assignment", 0),
    ("scores.latest_snapshot",
        "SELECT MAX(snapshot_date)::text FROM app.scores", None),
    ("scores.rows_for_latest",
        "SELECT COUNT(*) FROM app.scores "
        "WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", 5),
    ("cluster_composite_cache.rows",
        "SELECT COUNT(*) FROM app.cluster_composite_cache "
        "WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", 0),
    ("cluster_stocks_panel_cache.rows",
        "SELECT COUNT(*) FROM app.cluster_stocks_panel_cache "
        "WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", 5),
    ("screener_meta.rows",
        "SELECT COUNT(*) FROM app.screener_meta sm "
        "JOIN app.universe u USING (symbol) WHERE u.is_active", 5),
    ("shareholding_pattern.rows",
        "SELECT COUNT(*) FROM app.shareholding_pattern sp "
        "JOIN app.universe u USING (symbol) WHERE u.is_active", 50),
]

# Golden DB drift — filtered to ACTIVE UNIVERSE SYMBOLS ONLY.
#
# Local golden_db tracks the full ~5,500-symbol NSE universe via the
# user's separate bhavcopy ingest project; Neon only stores rows for
# active universe stocks (sync-neon.sh filters to ~2,163). A blanket
# COUNT(*) comparison would always look like a ~2.6× drift even when
# the sync is perfectly healthy. Filtering by the active universe
# (set as a SQL parameter at run time) makes the comparison
# apples-to-apples.
#
# `:syms` is a placeholder we substitute with the actual symbol list
# (with .NS suffix) fetched from the app DB at the top of main().
_GOLDEN_METRICS: list[tuple[str, str, int | None]] = [
    ("price_history.max_date (universe)",
        "SELECT MAX(date)::text FROM golden.price_history "
        "WHERE interval='1d' AND symbol = ANY(%(syms)s)",
        None),
    # Tolerance is generous (3,000 rows ≈ 7% of typical 30d volume) because
    # sync-neon.sh's price_history sync is *incremental* — it only pushes
    # dates after Neon's MAX(date). Historical backfills (NSE bhavcopy fills
    # for renamed tickers etc.) live on local but aren't pushed retroactively.
    # That natural gap is normally 2,000-3,000 rows; anything beyond that
    # indicates a real sync issue worth investigating.
    ("price_history.rows_last_30d (universe)",
        "SELECT COUNT(*) FROM golden.price_history "
        "WHERE interval='1d' AND date > CURRENT_DATE - INTERVAL '30 days' "
        "  AND symbol = ANY(%(syms)s)",
        3000),
]


def _scalar(conn, sql, params: dict | None = None) -> object:
    with conn.cursor() as cur:
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)
        row = cur.fetchone()
    return row[0] if row else None


def _format(v: object) -> str:
    if v is None:
        return "—"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def _diff_ok(local, neon, tolerance: int | None) -> bool:
    """tolerance=None means exact match required; otherwise allowed delta."""
    if local is None and neon is None:
        return True
    if local is None or neon is None:
        return False
    if tolerance is None:
        return local == neon
    if isinstance(local, int) and isinstance(neon, int):
        return abs(local - neon) <= tolerance
    return local == neon


def main() -> int:
    local_app = env_url("LOCAL_APP_URL", fallback="postgresql:///fundamental_app")
    local_golden = env_url("LOCAL_GOLDEN_URL", fallback="postgresql:///golden_db")
    neon_app = env_url("NEON_APP_URL")
    neon_golden = env_url("NEON_GOLDEN_URL")

    print(f"Local app:    {mask(local_app)}")
    print(f"Neon app:     {mask(neon_app)}")
    print(f"Local golden: {mask(local_golden)}")
    print(f"Neon golden:  {mask(neon_golden)}")
    print()

    drift_lines: list[str] = []

    def run(label: str, conn_l, conn_n, metrics, params: dict | None = None):
        print(f"── {label} ─────────────────────────────────────────────")
        print(f"{'metric':<38} {'local':>16}  {'neon':>16}  status")
        print("-" * 86)
        for name, sql, tol in metrics:
            try:
                v_l = _scalar(conn_l, sql, params)
            except Exception as e:
                v_l = f"ERR: {str(e)[:30]}"
            try:
                v_n = _scalar(conn_n, sql, params)
            except Exception as e:
                v_n = f"ERR: {str(e)[:30]}"
            ok = _diff_ok(v_l, v_n, tol)
            status = "OK" if ok else "DRIFT"
            tol_str = "" if tol is None else f" (±{tol})"
            print(f"{name:<38} {_format(v_l):>16}  {_format(v_n):>16}  {status}{tol_str}")
            if not ok:
                drift_lines.append(
                    f"  {name}: local={_format(v_l)} vs neon={_format(v_n)}"
                )
        print()

    # Universe symbol list — fetched once from local app DB and passed to
    # every golden-DB query so we only compare price_history rows for
    # symbols that are SUPPOSED to be on Neon. Without this filter, local's
    # ~5,500-symbol bhavcopy archive falsely drifts vs Neon's 2,163-symbol
    # production slice.
    universe_ns: list[str] = []
    try:
        with psycopg.connect(local_app) as cl, psycopg.connect(neon_app) as cn:
            run("App DB", cl, cn, _APP_METRICS)
            with cl.cursor() as cur:
                cur.execute("SELECT symbol FROM app.universe WHERE is_active")
                universe_ns = [f"{r[0]}.NS" for r in cur.fetchall()]
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: app DB connection failed — {e}", file=sys.stderr)
        return 2

    try:
        with psycopg.connect(local_golden) as cl, psycopg.connect(neon_golden) as cn:
            run("Golden DB", cl, cn, _GOLDEN_METRICS, params={"syms": universe_ns})
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: golden DB connection failed — {e}", file=sys.stderr)
        return 2

    if drift_lines:
        print(f"DRIFT detected ({len(drift_lines)} metric{'s' if len(drift_lines)!=1 else ''}):")
        for line in drift_lines:
            print(line)
        print()
        print("Likely fix: run ./scripts/sync-neon.sh to push latest local data.")
        return 1
    print("OK — local and Neon are in sync (within tolerances).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
