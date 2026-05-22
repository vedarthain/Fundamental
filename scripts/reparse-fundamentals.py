#!/usr/bin/env python3
"""
reparse-fundamentals.py — re-parse every stored Screener raw export and
overwrite app.fundamentals_annual + app.fundamentals_quarterly rows.

Use when the parser logic changes (e.g. the operating_profit derivation
fix in the parser that adds aggregate Expenses + Operating Profit from
component breakdown). No network calls — pulls from app.screener_export_raw
which already has the cached blobs.

Idempotent. ON CONFLICT DO UPDATE means re-running re-applies the latest
parser logic to all existing data.

Usage:
    APP_DB_URL=postgres://... etl/.venv/bin/python scripts/reparse-fundamentals.py

If APP_DB_URL is not set, falls back to .env.local at the repo root.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import psycopg

# Make sibling etl/ src importable when running as a standalone script
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "etl" / "src"))

from fundamental_etl.screener.parser import parse_export, ParseError  # noqa: E402
from fundamental_etl.screener.persist import save_parsed  # noqa: E402


def env_app_db_url() -> str:
    v = os.environ.get("APP_DB_URL")
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("APP_DB_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        "APP_DB_URL not set — pass as env var, or add to .env.local for local runs."
    )


def main() -> None:
    url = env_app_db_url()
    # Open one long-lived connection. The parse loop is single-threaded; no
    # need for a pool. Each per-symbol save_parsed call already manages its
    # own transaction inside.
    with psycopg.connect(url, row_factory=psycopg.rows.dict_row) as conn:
        # Get the latest raw export per symbol.
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ON (symbol)
                       symbol, fetched_at, content
                  FROM app.screener_export_raw
                 ORDER BY symbol, fetched_at DESC
            """)
            rows = cur.fetchall()

        total = len(rows)
        print(f"re-parsing {total} stocks' latest raw exports...")
        ok = parse_err = save_err = 0
        started = time.time()

        for i, r in enumerate(rows, start=1):
            sym = r["symbol"]
            fetched_at = r["fetched_at"]
            blob = r["content"]
            try:
                parsed = parse_export(blob)
            except ParseError as e:
                parse_err += 1
                print(f"  ✗ parse {sym}: {e}", file=sys.stderr)
                continue
            except Exception as e:
                parse_err += 1
                print(f"  ✗ parse {sym}: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
                continue
            try:
                save_parsed(conn, sym, parsed, fetched_at)
                ok += 1
            except Exception as e:
                save_err += 1
                print(f"  ✗ save {sym}: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)

            if i % 100 == 0:
                rate = i / (time.time() - started)
                eta = (total - i) / rate
                print(f"  progress: {i}/{total} ({rate:.0f}/s, eta {eta:.0f}s, "
                      f"ok={ok} parse_err={parse_err} save_err={save_err})")

        elapsed = time.time() - started
        print(f"\n✓ done in {elapsed:.0f}s: ok={ok}, parse_err={parse_err}, save_err={save_err}")


if __name__ == "__main__":
    main()
