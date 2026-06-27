#!/usr/bin/env python3
"""
apply-corp-adjustments.py — populate adj_close in golden.price_history
by applying cumulative split/bonus adjustment factors.

WHY: NSE bhavcopy (our price source) contains raw unadjusted prices.
After a bonus or split, historical prices look much higher than the
current price, making return calculations wildly wrong (e.g. KOTAKBANK
showing −86% for 6M after its 1:5 split in Jan 2026).

TWO PHASES:

  Phase 1 — AUTO-DETECT missing corporate actions
    Scans price_history for single-day drops >30% whose ratio is close
    to a standard split/bonus fraction (1/2, 1/3, 1/4, 1/5, 2/3, etc.).
    Inserts unrecorded events into golden.corporate_actions so Phase 2
    can apply them. Source = 'price_detect' distinguishes these from the
    indianapi-sourced entries.

    Deliberately EXCLUDES demerger-type drops (e.g. VEDL Apr 2026) whose
    ratio is not a clean fraction.

  Phase 2 — APPLY ADJUSTMENTS
    For each symbol in golden.corporate_actions with split/bonus events:
    resets adj_close = close, then iterates events from LATEST → EARLIEST,
    multiplying adj_close × split_factor for all rows before each ex_date.
    This accumulates correctly for stocks with multiple historic events.

    Symbols with NO events: adj_close is left as close (no-op / reset).

USAGE:
  etl/.venv/bin/python scripts/apply-corp-adjustments.py            # full run
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --dry-run  # preview only
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --symbol KOTAKBANK.NS
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --apply-only   # skip detect
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --detect-only  # skip apply

After running, update the price API queries to use adj_close instead of
close for historical anchor lookups.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parent.parent

# ── Clean-fraction detection ──────────────────────────────────────────────────
# Standard denominators for split/bonus events in India.
# Covers: split 1:2 (→0.5), 1:3, 1:4, 1:5, 1:10;
#         bonus 1:1 (→0.5), 1:2 (→0.667), 2:1 (→0.333), 3:1 (→0.25), 4:1 (→0.2), etc.
STANDARD_FRACTIONS: list[float] = sorted({
    n / d
    for d in range(2, 11)
    for n in range(1, d)
})

DETECT_TOLERANCE  = 0.015   # within 1.5% of a standard fraction → candidate event
                             # (2.5% was too loose — caught VEDL demerger at 0.351 ≈ 1/3)
DROP_THRESHOLD    = 0.70    # price drops to <70% of previous close
MIN_PREV_PRICE    = 10.0    # ignore micro-cap penny stocks under ₹10
NS_ONLY           = True    # restrict detection to .NS symbols (our universe)
DETECT_LOOKBACK_Y = 3       # only auto-detect events within this many years
                            # older splits are already reflected in historical market prices
                            # and must not be re-applied to recent anchor-date prices


def closest_standard_fraction(ratio: float) -> tuple[float, float] | None:
    """Return (std_fraction, abs_diff) if ratio is within DETECT_TOLERANCE of
    any standard split/bonus fraction, else None."""
    best = min(STANDARD_FRACTIONS, key=lambda f: abs(ratio - f))
    diff = abs(ratio - best)
    return (best, diff) if diff <= DETECT_TOLERANCE else None


# ── Helpers ───────────────────────────────────────────────────────────────────

def env_url(name: str) -> str:
    import os
    v = os.environ.get(name)
    if v:
        return v
    p = REPO / ".env.local"
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit(f"{name} not set — add to .env.local or pass --golden-url")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Apply corporate action adjustments to adj_close.")
    ap.add_argument("--golden-url", help="golden_db Postgres URL (default GOLDEN_DB_URL)")
    ap.add_argument("--symbol",     help="Restrict to one symbol, e.g. KOTAKBANK.NS")
    ap.add_argument("--dry-run",    action="store_true", help="Show plan, no DB writes")
    ap.add_argument("--detect-only", action="store_true", help="Phase 1 only (skip apply)")
    ap.add_argument("--apply-only",  action="store_true", help="Phase 2 only (skip detect)")
    args = ap.parse_args()

    golden_url = args.golden_url or env_url("GOLDEN_DB_URL")

    with psycopg.connect(golden_url) as conn:

        # ── Phase 1: Auto-detect ──────────────────────────────────────────────
        if not args.apply_only:
            print("── Phase 1: Detecting unlisted split/bonus events ──", file=sys.stderr)

            sym_clause = "AND ph.symbol = %s" if args.symbol else ""
            ns_clause  = "AND ph.symbol LIKE '%%.NS'" if (NS_ONLY and not args.symbol) else ""
            sym_params: list = [args.symbol] if args.symbol else []

            # Find all large single-day drops across 1d price history.
            # LAG() gives the previous trading day's close for the same symbol.
            with conn.cursor() as cur:
                cur.execute(f"""
                    WITH lagged AS (
                        SELECT
                            symbol, date, close,
                            LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close,
                            LAG(date)  OVER (PARTITION BY symbol ORDER BY date) AS prev_date
                        FROM golden.price_history ph
                        WHERE interval = '1d'
                          AND date >= CURRENT_DATE - (%s * INTERVAL '1 year')
                          {sym_clause} {ns_clause}
                    )
                    SELECT symbol, date, close, prev_close, prev_date,
                           close / prev_close AS ratio
                    FROM lagged
                    WHERE prev_close  >= %s
                      AND close / prev_close < %s
                      AND close / prev_close > 0.08
                    ORDER BY symbol, date
                """, [DETECT_LOOKBACK_Y] + sym_params + [MIN_PREV_PRICE, DROP_THRESHOLD])
                drops = cur.fetchall()

            print(f"  Scanning {len(drops)} large drops (>{int((1-DROP_THRESHOLD)*100)}% in one day)…",
                  file=sys.stderr)

            # Load existing events to avoid re-inserting.
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT symbol, ex_date
                    FROM golden.corporate_actions
                    WHERE action_type IN ('bonus', 'split', 'price_detect')
                """)
                existing: set[tuple] = {(r[0], r[1]) for r in cur.fetchall()}

            detected: list[dict] = []
            skipped_no_fraction = 0
            skipped_known = 0

            for symbol, date, close, prev_close, prev_date, ratio in drops:
                ratio = float(ratio)  # may be Decimal from psycopg
                match = closest_standard_fraction(ratio)
                if match is None:
                    skipped_no_fraction += 1
                    continue  # Not a clean fraction → demerger, crash, bad data, etc.

                snap_factor, diff = match

                # Allow ±1 day tolerance when checking if already recorded.
                import datetime
                already_known = (
                    (symbol, date) in existing or
                    (prev_date and (symbol, prev_date) in existing)
                )
                if already_known:
                    skipped_known += 1
                    continue

                detected.append({
                    "symbol":      symbol,
                    "ex_date":     date,
                    "close":       float(close),
                    "prev_close":  float(prev_close),
                    "ratio":       float(ratio),
                    "snap_factor": snap_factor,
                    "diff":        diff,
                })
                tag = "[DRY-RUN] " if args.dry_run else ""
                print(
                    f"  {tag}DETECTED {symbol} on {date}: "
                    f"₹{prev_close:.2f} → ₹{close:.2f} "
                    f"(ratio {ratio:.4f} ≈ {snap_factor:.4f}, err {diff:.4f})",
                    file=sys.stderr,
                )

            print(
                f"  {len(detected)} new events | "
                f"{skipped_known} already recorded | "
                f"{skipped_no_fraction} non-clean-fraction drops (demergers etc.)",
                file=sys.stderr,
            )

            if detected and not args.dry_run:
                with conn.cursor() as cur:
                    for d in detected:
                        cur.execute("""
                            INSERT INTO golden.corporate_actions
                              (symbol, ex_date, action_type, split_factor, purpose, source)
                            VALUES (%s, %s, 'price_detect', %s, %s, 'price_detect')
                            ON CONFLICT (symbol, ex_date, action_type) DO UPDATE SET
                              split_factor = EXCLUDED.split_factor,
                              purpose      = EXCLUDED.purpose
                        """, (
                            d["symbol"],
                            d["ex_date"],
                            d["snap_factor"],
                            f"Auto-detected: ratio={d['ratio']:.4f} ≈ {d['snap_factor']:.4f}",
                        ))
                conn.commit()
                print(f"  Inserted {len(detected)} events into golden.corporate_actions",
                      file=sys.stderr)

        # ── Phase 2: Apply cumulative adjustments ─────────────────────────────
        if not args.detect_only:
            print("\n── Phase 2: Applying cumulative adj_close factors ──", file=sys.stderr)

            sym_clause = "AND symbol = %s" if args.symbol else ""
            sym_params = [args.symbol] if args.symbol else []

            # Load events that affect adj_close — only within our lookback window.
            # Events older than DETECT_LOOKBACK_Y years are already reflected in
            # the historical market prices stored in golden.price_history; applying
            # them again would compound the factor incorrectly.
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT symbol, ex_date, split_factor
                    FROM golden.corporate_actions
                    WHERE action_type IN ('bonus', 'split', 'price_detect')
                      AND ex_date >= CURRENT_DATE - (%s * INTERVAL '1 year')
                    {sym_clause}
                    ORDER BY symbol, ex_date ASC
                """, [DETECT_LOOKBACK_Y] + sym_params)
                ca_rows = cur.fetchall()

            by_symbol: dict[str, list[tuple]] = defaultdict(list)
            for symbol, ex_date, split_factor in ca_rows:
                by_symbol[symbol].append((ex_date, float(split_factor)))

            print(f"  {len(by_symbol)} symbols have adjustable events", file=sys.stderr)

            if args.dry_run:
                for symbol, events in sorted(by_symbol.items()):
                    cum = 1.0
                    for ex_date, sf in sorted(events, key=lambda x: x[0], reverse=True):
                        cum *= sf
                    print(
                        f"  [DRY-RUN] {symbol}: {len(events)} event(s), "
                        f"earliest adj factor = {cum:.6f}",
                        file=sys.stderr,
                    )
                print("  [DRY-RUN] No changes written.", file=sys.stderr)
                return

            rows_updated = 0
            for symbol, events in by_symbol.items():
                # Sort LATEST first so we can accumulate iteratively.
                events_desc = sorted(events, key=lambda x: x[0], reverse=True)

                with conn.cursor() as cur:
                    # Unlock the append-only immutability guard for this
                    # transaction — the golden DB trigger allows repair
                    # operations when this session GUC is set.
                    cur.execute("SET LOCAL golden.allow_repair = 'on'")

                    # Clean slate: reset adj_close = close for this symbol.
                    cur.execute("""
                        UPDATE golden.price_history
                           SET adj_close = close
                         WHERE symbol = %s AND interval = '1d'
                    """, (symbol,))

                    # Apply events latest → earliest.
                    # Each pass multiplies adj_close × split_factor for all
                    # rows BEFORE this event's ex_date. Because we go latest→
                    # earliest, earlier dates accumulate the product of all
                    # subsequent events' factors automatically.
                    for ex_date, split_factor in events_desc:
                        cur.execute("""
                            UPDATE golden.price_history
                               SET adj_close = adj_close * %s
                             WHERE symbol = %s
                               AND interval = '1d'
                               AND date < %s
                        """, (split_factor, symbol, ex_date))

                    rows_updated += cur.rowcount
                conn.commit()

            # Verify a known stock as sanity check.
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT date, close, adj_close
                    FROM golden.price_history
                    WHERE symbol = 'KOTAKBANK.NS' AND interval = '1d'
                      AND date BETWEEN '2026-01-12' AND '2026-01-16'
                    ORDER BY date
                """)
                rows = cur.fetchall()

            if rows:
                print("\n  Sanity check — KOTAKBANK.NS around 2026-01-14:", file=sys.stderr)
                for date, close, adj_close in rows:
                    marker = " ← split ex-date" if str(date) == "2026-01-14" else ""
                    print(
                        f"    {date}  close=₹{close:,.2f}  adj_close=₹{adj_close:,.2f}{marker}",
                        file=sys.stderr,
                    )

            print(f"\n  Done — {rows_updated} price rows had adj_close updated.",
                  file=sys.stderr)


if __name__ == "__main__":
    main()
