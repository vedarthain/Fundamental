#!/usr/bin/env python3
"""Sync app.stock_verdict from local Postgres to Neon Production.

Usage:
    # Sync all local verdicts to Neon:
    etl/.venv/bin/python scripts/sync-verdicts-to-neon.py

    # Sync only verdicts generated on or after a specific date:
    etl/.venv/bin/python scripts/sync-verdicts-to-neon.py --since 2026-10-25

    # Dry-run preview without writing:
    etl/.venv/bin/python scripts/sync-verdicts-to-neon.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent


def get_neon_url() -> str:
    url = os.environ.get("NEON_APP_URL")
    if url:
        return url.strip().strip("\"'")
    for env_file in [ROOT / ".env.local", ROOT / "web" / ".env.local"]:
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("NEON_APP_URL="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    raise ValueError("NEON_APP_URL not found in environment or .env.local")


def get_revalidate_token() -> str | None:
    tok = os.environ.get("REVALIDATE_TOKEN")
    if tok:
        return tok.strip().strip("\"'")
    for env_file in [ROOT / ".env.local", ROOT / "web" / ".env.local"]:
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("REVALIDATE_TOKEN="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return None


def revalidate_prod_cache(symbols: list[str]) -> None:
    tok = get_revalidate_token()
    if not tok:
        print("  ~ REVALIDATE_TOKEN not found, skipping edge cache purge.")
        return
    url = "https://equityroots.in/api/revalidate"
    paths = ["/", "/industries", "/sectors", "/watchlist"]
    paths.extend([f"/stock/{s}" for s in symbols[:50]])  # cap individual stock paths
    payload = json.dumps({
        "tags": ["snapshot", "sectors", "panel-cache", "clusters"],
        "paths": paths
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {tok}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                print(f"  ✓ Purged Vercel Edge Cache on production ({resp.read().decode('utf-8')})")
    except Exception as e:
        print(f"  ~ Edge cache purge note: {e}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--since", help="Sync only verdicts generated on or after this date/timestamp (e.g. 2026-10-25)")
    ap.add_argument("--dry-run", action="store_true", help="Preview rows to sync without writing to Neon")
    args = ap.parse_args()

    local_url = os.environ.get("APP_DB_URL", "postgresql:///fundamental_app")
    neon_url = get_neon_url()

    print("\n" + "=" * 80)
    print("🚀 SYNC STOCK VERDICTS TO NEON PRODUCTION")
    print("=" * 80)
    print(f"Source (Local): {local_url}")
    print(f"Target (Neon):  {neon_url.split('@')[-1] if '@' in neon_url else neon_url}")
    if args.since:
        print(f"Filter:         generated_at >= '{args.since}'")
    else:
        print(f"Filter:         All verdicts")
    print(f"Dry Run:        {'YES' if args.dry_run else 'NO'}")
    print("=" * 80 + "\n")

    # Step 1: Read from local
    query = """
        SELECT symbol, generated_at, verdict, confidence, points, trigger_text,
               evidence, snapshot_date, price_asof, model, source_report, anchor_price,
               target_price, buy_below, bear_floor, upside_pct, valuation_method
        FROM app.stock_verdict
    """
    params: list[Any] = []
    if args.since:
        query += " WHERE generated_at >= %s::timestamptz"
        params.append(args.since)
    query += " ORDER BY generated_at ASC;"

    with psycopg.connect(local_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            local_rows = cur.fetchall()

    print(f"✓ Found {len(local_rows)} verdict row(s) in local Postgres.")
    if not local_rows:
        print("Nothing to sync.")
        return 0

    if args.dry_run:
        print(f"\n[Dry Run] Would sync {len(local_rows)} rows to Neon. Exiting.")
        return 0

    # Step 2: Batch upsert into Neon
    print(f"Writing {len(local_rows)} rows to Neon production...")
    upsert_sql = """
        INSERT INTO app.stock_verdict (
            symbol, generated_at, verdict, confidence, points, trigger_text,
            evidence, snapshot_date, price_asof, model, source_report, anchor_price,
            target_price, buy_below, bear_floor, upside_pct, valuation_method
        ) VALUES (
            %(symbol)s, %(generated_at)s, %(verdict)s, %(confidence)s, %(points)s, %(trigger_text)s,
            %(evidence)s, %(snapshot_date)s, %(price_asof)s, %(model)s, %(source_report)s, %(anchor_price)s,
            %(target_price)s, %(buy_below)s, %(bear_floor)s, %(upside_pct)s, %(valuation_method)s
        )
        ON CONFLICT (symbol, generated_at) DO UPDATE SET
            verdict = EXCLUDED.verdict,
            confidence = EXCLUDED.confidence,
            points = EXCLUDED.points,
            trigger_text = EXCLUDED.trigger_text,
            evidence = EXCLUDED.evidence,
            snapshot_date = EXCLUDED.snapshot_date,
            price_asof = EXCLUDED.price_asof,
            model = EXCLUDED.model,
            source_report = EXCLUDED.source_report,
            anchor_price = EXCLUDED.anchor_price,
            target_price = EXCLUDED.target_price,
            buy_below = EXCLUDED.buy_below,
            bear_floor = EXCLUDED.bear_floor,
            upside_pct = EXCLUDED.upside_pct,
            valuation_method = EXCLUDED.valuation_method;
    """

    with psycopg.connect(neon_url) as nconn:
        with nconn.cursor() as ncur:
            # Prepare rows with JSON dumps for jsonb fields
            records = []
            for r in local_rows:
                records.append({
                    "symbol": r["symbol"],
                    "generated_at": r["generated_at"],
                    "verdict": r["verdict"],
                    "confidence": r["confidence"],
                    "points": json.dumps(r["points"]) if isinstance(r["points"], (list, dict)) else r["points"],
                    "trigger_text": r["trigger_text"],
                    "evidence": json.dumps(r["evidence"]) if isinstance(r["evidence"], dict) else (r["evidence"] or "{}"),
                    "snapshot_date": r["snapshot_date"],
                    "price_asof": r["price_asof"],
                    "model": r["model"],
                    "source_report": r["source_report"],
                    "anchor_price": r["anchor_price"],
                    "target_price": r.get("target_price"),
                    "buy_below": r.get("buy_below"),
                    "bear_floor": r.get("bear_floor"),
                    "upside_pct": r.get("upside_pct"),
                    "valuation_method": r.get("valuation_method"),
                })

            ncur.executemany(upsert_sql, records)
        nconn.commit()

    print(f"✓ Successfully upserted {len(local_rows)} verdicts to Neon production!")

    # Step 3: Trigger Vercel cache revalidation
    symbols = sorted(list(set(r["symbol"] for r in local_rows)))
    print(f"Purging cache for {len(symbols)} unique symbols on equityroots.in...")
    revalidate_prod_cache(symbols)

    print("\n🎉 Sync Complete!\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
