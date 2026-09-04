#!/usr/bin/env python3
"""
apply-corp-adjustments.py — populate adj_close in golden.price_history
by applying cumulative split/bonus adjustment factors.

WHY: NSE bhavcopy (our price source) contains raw unadjusted prices.
After a bonus or split, historical prices look much higher than the
current price, making return calculations wildly wrong (e.g. KOTAKBANK
showing −86% for 6M after its 1:5 split in Jan 2026).

THREE PHASES:

  Phase 0 — BRIDGE app.corporate_action → golden.corporate_actions
    The live corporate-actions feed (fetch-corporate-actions-iapi.py) writes
    ONLY to the app DB (app.corporate_action), storing the raw ratio string
    ("Bonus 1:1", "Split 1:2") with NO numeric split_factor. The adjustment
    engine + scoring engine read golden.corporate_actions, which needs the
    numeric factor. This phase parses each app-side bonus/split/rights ratio
    into (ratio_num, ratio_den, split_factor) and upserts it into golden with
    source 'fundamental_app:indianapi' — so freshly-fetched events actually
    reach the adjustment math instead of stranding in the app DB.

    Factor conventions (reverse-engineered to match the legacy bridge):
      bonus  a:b  → b/(a+b)   (a new shares issued per b held)
      rights a:b  → b/(a+b)   (same formula the old bridge used; an
                               approximation that ignores subscription price)
      split  a:b  → a/b       (a old share becomes b — FV a→b; 1:2 → 0.5)

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
  etl/.venv/bin/python scripts/apply-corp-adjustments.py            # bridge+detect+apply
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --dry-run  # preview only
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --symbol KOTAKBANK.NS
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --apply-only   # bridge+apply, skip detect
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --detect-only  # skip apply
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --bridge-only  # Phase 0 only
  etl/.venv/bin/python scripts/apply-corp-adjustments.py --skip-bridge  # skip Phase 0

DAILY GO-FORWARD PATH: run with --apply-only (bridge fresh events → apply).
Auto-detect (Phase 1) is skipped there on purpose: it scans RAW close for
single-day drops, and the raw bhavcopy sawtooth can masquerade as false
bonus events. Run a full (detect-enabled) pass manually when auditing.

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

def env_url(*names: str) -> str:
    """First non-empty value among env vars / .env.local keys in `names`.

    Lets a caller list fallbacks, e.g. env_url("APP_DB_URL", "NEON_APP_URL")
    so CI (which exports APP_DB_URL) and local (.env.local NEON_APP_URL) both
    resolve without extra config.
    """
    import os
    for name in names:
        v = os.environ.get(name)
        if v:
            return v
    p = REPO / ".env.local"
    if p.exists():
        lines = p.read_text().splitlines()
        for name in names:
            for line in lines:
                if line.startswith(name + "="):
                    val = line.split("=", 1)[1].strip().strip("\"'")
                    if val:
                        return val
    raise SystemExit(f"{' / '.join(names)} not set — add to .env.local or pass the URL flag")


import re as _re

_RATIO_RE = _re.compile(r"(\d+)\s*:\s*(\d+)")


def parse_ratio(text: str) -> tuple[int, int] | None:
    """Extract (num, den) from a ratio string like 'Bonus 1:1' or '2:5'."""
    m = _RATIO_RE.search(text or "")
    if not m:
        return None
    num, den = int(m.group(1)), int(m.group(2))
    if num <= 0 or den <= 0:
        return None
    return num, den


def ratio_to_factor(action_type: str, num: int, den: int) -> float | None:
    """Multiplicative pre-ex-date price adjustment for a corporate action.

    bonus / rights  a:b → b/(a+b)   (price shrinks toward the diluted base)
    split           a:b → a/b       (a old share becomes b shares)
    Returns None for unsupported types or out-of-range results.
    """
    if action_type in ("bonus", "rights"):
        f = den / (num + den)
    elif action_type == "split":
        f = num / den
    else:
        return None
    # Sanity envelope: bonus/rights are always <1; splits can be >1 only for
    # rare reverse splits. Reject absurd values from malformed ratios.
    if not (0 < f <= 10):
        return None
    return round(f, 8)


# ── Price-confirmation gate ───────────────────────────────────────────────────
# The corporate-action feed (indianapi) is frequently wrong on ex-dates and
# occasionally on magnitude. Applying an announced factor to a series that never
# actually stepped by it MANUFACTURES a cliff (the GOLDIAM 1:3 case: a 20% fake
# jump where the traded price only drifted). So a recent (post-yfinance-cutoff)
# event is only applied if the RAW close actually shows a matching step.
CONFIRM_WINDOW = 4      # trading days each side of ex_date to look for the cliff
CONFIRM_LO     = 0.80   # observed drop must land in [factor*LO, factor*HI]
CONFIRM_HI     = 1.15


def dedup_events(events: list[tuple]) -> list[tuple]:
    """Collapse events that describe the SAME real action.

    events: (ex_date, factor, action_type). An announced bonus/split is
    authoritative; a 'price_detect' within ±3 days of one is the same cliff
    re-found by auto-detect and is DROPPED — otherwise both factors compound
    (the ZFCVINDIA 0.167 × 0.167 → 6× spike). Same-day announced events of
    different type (bonus + split, e.g. BAJFINANCE) are genuinely stacked and
    both kept.
    """
    announced = [e for e in events if e[2] in ("bonus", "split")]
    kept = list(announced)
    for e in events:
        if e[2] != "price_detect":
            continue
        if any(abs((e[0] - a[0]).days) <= 3 for a in announced):
            continue
        kept.append(e)
    return kept


def confirmed_cliff(cur, symbol: str, ex_date, factor: float) -> bool:
    """True if the RAW close shows a ≈`factor` single-day drop within
    ±CONFIRM_WINDOW trading days of ex_date.

    Gates POST-boundary (recent, fully-raw) events so a wrong feed ex-date/ratio
    can't invent a cliff the traded price never had. Pre-boundary events are NOT
    gated by this — their cliff lives in the yfinance-adjusted close, not the
    sparse raw gap-fill rows (the WIPRO case), so a raw day-over-day check there
    would wrongly reject a real event.
    """
    cur.execute("""
        SELECT close / prev FROM (
            SELECT close, LAG(close) OVER (ORDER BY date) AS prev
            FROM golden.price_history
            WHERE symbol = %s AND interval = '1d'
              AND date BETWEEN (%s::date - %s) AND (%s::date + %s)
              AND close IS NOT NULL
        ) t WHERE prev IS NOT NULL AND prev > 0
    """, (symbol, ex_date, CONFIRM_WINDOW, ex_date, CONFIRM_WINDOW))
    lo, hi = factor * CONFIRM_LO, factor * CONFIRM_HI
    return any(lo <= float(r[0]) <= hi for r in cur.fetchall())


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Apply corporate action adjustments to adj_close.")
    ap.add_argument("--golden-url", help="golden_db Postgres URL (default GOLDEN_DB_URL)")
    ap.add_argument("--app-url",    help="app_db Postgres URL (default APP_DB_URL / NEON_APP_URL)")
    ap.add_argument("--symbol",     help="Restrict to one symbol, e.g. KOTAKBANK.NS")
    ap.add_argument("--dry-run",    action="store_true", help="Show plan, no DB writes")
    ap.add_argument("--detect-only", action="store_true", help="Phase 1 only (skip bridge + apply)")
    ap.add_argument("--apply-only",  action="store_true", help="Bridge + Phase 2 (skip detect)")
    ap.add_argument("--bridge-only", action="store_true", help="Phase 0 only (skip detect + apply)")
    ap.add_argument("--skip-bridge", action="store_true", help="Skip Phase 0 (app→golden bridge)")
    args = ap.parse_args()

    golden_url = args.golden_url or env_url("GOLDEN_DB_URL")

    # Phase 0 (bridge) runs by default; it is upstream of detect + apply.
    run_bridge = not (args.skip_bridge or args.detect_only)

    with psycopg.connect(golden_url) as conn:

        # ── Phase 0: Bridge app.corporate_action → golden.corporate_actions ──
        if run_bridge:
            print("── Phase 0: Bridging app.corporate_action → golden.corporate_actions ──",
                  file=sys.stderr)
            app_url = args.app_url or env_url("APP_DB_URL", "NEON_APP_URL")

            bare = args.symbol[:-3] if (args.symbol and args.symbol.endswith(".NS")) else args.symbol
            a_sym_clause = "AND symbol = %s" if bare else ""
            a_sym_params: list = [bare] if bare else []

            with psycopg.connect(app_url) as app_conn, app_conn.cursor() as acur:
                acur.execute(f"""
                    SELECT symbol, action_type, ex_date, purpose, details
                    FROM app.corporate_action
                    WHERE action_type IN ('bonus', 'split', 'rights')
                      AND ex_date IS NOT NULL
                    {a_sym_clause}
                    ORDER BY symbol, ex_date
                """, a_sym_params)
                app_rows = acur.fetchall()

            bridged: list[tuple] = []
            skipped_ratio = 0
            reverse_splits = 0
            for symbol, atype, ex_date, purpose, details in app_rows:
                # Prefer the structured "Ratio" from details jsonb; fall back to
                # the purpose text ("Bonus 1:1"). Both carry the a:b ratio.
                ratio_src = None
                if isinstance(details, dict):
                    ratio_src = details.get("Ratio")
                pr = parse_ratio(ratio_src or purpose or "")
                if pr is None:
                    skipped_ratio += 1
                    continue
                num, den = pr
                factor = ratio_to_factor(atype, num, den)
                if factor is None:
                    skipped_ratio += 1
                    continue
                if atype == "split" and factor > 1:
                    reverse_splits += 1
                bridged.append((
                    f"{symbol}.NS", ex_date, atype, num, den, factor,
                    purpose or f"{atype.capitalize()} {num}:{den}",
                ))

            if args.dry_run:
                print(f"  [DRY-RUN] would bridge {len(bridged)} events "
                      f"({skipped_ratio} unparseable ratio skipped, "
                      f"{reverse_splits} reverse-split(s))", file=sys.stderr)
            else:
                with conn.cursor() as cur:
                    for row in bridged:
                        cur.execute("""
                            INSERT INTO golden.corporate_actions
                              (symbol, ex_date, action_type, ratio_num, ratio_den,
                               split_factor, purpose, source)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, 'fundamental_app:indianapi')
                            ON CONFLICT (symbol, ex_date, action_type) DO UPDATE SET
                              ratio_num    = EXCLUDED.ratio_num,
                              ratio_den    = EXCLUDED.ratio_den,
                              split_factor = EXCLUDED.split_factor,
                              purpose      = EXCLUDED.purpose,
                              source       = 'fundamental_app:indianapi'
                        """, row)
                conn.commit()
                print(f"  Bridged {len(bridged)} events into golden.corporate_actions "
                      f"({skipped_ratio} unparseable ratio skipped, "
                      f"{reverse_splits} reverse-split(s))", file=sys.stderr)

        if args.bridge_only:
            return

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
                    SELECT symbol, ex_date, split_factor, action_type
                    FROM golden.corporate_actions
                    WHERE action_type IN ('bonus', 'split', 'price_detect')
                      AND ex_date >= CURRENT_DATE - (%s * INTERVAL '1 year')
                    {sym_clause}
                    ORDER BY symbol, ex_date ASC
                """, [DETECT_LOOKBACK_Y] + sym_params)
                ca_rows = cur.fetchall()

            by_symbol: dict[str, list[tuple]] = defaultdict(list)
            for symbol, ex_date, split_factor, action_type in ca_rows:
                by_symbol[symbol].append((ex_date, float(split_factor), action_type))

            print(f"  {len(by_symbol)} symbols have adjustable events", file=sys.stderr)

            if args.dry_run:
                n_skipped = 0
                for symbol, events in sorted(by_symbol.items()):
                    with conn.cursor() as cur:
                        cur.execute("""
                            SELECT MAX(date) FROM golden.price_history
                             WHERE symbol = %s AND interval = '1d' AND data_source = 'yfinance'
                        """, (symbol,))
                        boundary = cur.fetchone()[0]
                        kept = []
                        for ex_date, sf, atype in dedup_events(events):
                            post_boundary = boundary is None or ex_date > boundary
                            if post_boundary and not confirmed_cliff(cur, symbol, ex_date, sf):
                                n_skipped += 1
                                print(f"  [DRY-RUN] SKIP {symbol} {ex_date} {atype} "
                                      f"f={sf:.3f} — no confirming price cliff", file=sys.stderr)
                                continue
                            kept.append((ex_date, sf))
                    cum = 1.0
                    for ex_date, sf in sorted(kept, key=lambda x: x[0], reverse=True):
                        cum *= sf
                    print(
                        f"  [DRY-RUN] {symbol}: {len(kept)}/{len(events)} event(s) applied, "
                        f"earliest adj factor = {cum:.6f}",
                        file=sys.stderr,
                    )
                print(f"  [DRY-RUN] {n_skipped} event(s) skipped (unconfirmed). No changes written.",
                      file=sys.stderr)
                return

            # Both tables mirror the same rows and the chart reads _1d; keep them
            # in lock-step or the candle series diverges from everything else.
            TABLES = ("price_history", "price_history_1d")

            rows_updated = 0
            skipped_unconfirmed: list[tuple] = []
            for symbol, events in by_symbol.items():
                with conn.cursor() as cur:
                    # golden.price_history mixes two adjustment bases per row:
                    #   • yfinance rows are back-adjusted TO THEIR FETCH DATE, so every
                    #     action on/before that boundary is ALREADY baked into `close`.
                    #     Re-applying a pre-boundary event to them would DOUBLE-adjust.
                    #   • nse_bhavcopy rows are RAW/unadjusted — no action is baked in,
                    #     so EVERY event dated after the row still needs applying. These
                    #     raw rows are often gap-fills scattered in the pre-boundary era
                    #     (e.g. WIPRO 2023-24), and skipping them was what produced the
                    #     sawtooth spikes: a raw ₹560 bar sitting beside an adjusted ₹275.
                    # So we gate each event PER ROW by data_source rather than dropping
                    # pre-boundary events wholesale for the whole symbol.
                    cur.execute("""
                        SELECT MAX(date) FROM golden.price_history
                         WHERE symbol = %s AND interval = '1d' AND data_source = 'yfinance'
                    """, (symbol,))
                    boundary = cur.fetchone()[0]

                    # 1) Dedup overlapping events (announced supersedes auto-detect).
                    # 2) Confirmation gate: a post-boundary (recent, fully-raw) event
                    #    is applied only if the raw close actually stepped by ≈factor
                    #    near its ex_date — else the feed's wrong date/ratio would
                    #    manufacture a cliff (GOLDIAM). Pre-boundary events pass through
                    #    ungated (their cliff is in the yfinance close, not raw).
                    effective: list[tuple] = []   # (ex_date, factor, post_boundary)
                    for ex_date, split_factor, atype in dedup_events(events):
                        post_boundary = boundary is None or ex_date > boundary
                        if post_boundary and not confirmed_cliff(cur, symbol, ex_date, split_factor):
                            skipped_unconfirmed.append((symbol, ex_date, atype, split_factor))
                            continue
                        effective.append((ex_date, split_factor, post_boundary))

                    # Sort LATEST first so factors accumulate iteratively.
                    events_desc = sorted(effective, key=lambda x: x[0], reverse=True)

                    # Unlock the append-only immutability guard for this transaction —
                    # the golden DB trigger allows repair when this session GUC is set.
                    cur.execute("SET LOCAL golden.allow_repair = 'on'")

                    for tbl in TABLES:
                        # Clean slate: reset adj_close = close for this symbol.
                        cur.execute(
                            f"UPDATE golden.{tbl} SET adj_close = close "
                            "WHERE symbol = %s AND interval = '1d'",
                            (symbol,),
                        )
                        # Apply events latest → earliest; each pass scales adj_close for
                        # all rows BEFORE its ex_date, so earlier dates accumulate the
                        # product of all subsequent factors. The provenance gate:
                        #   post_boundary=True  → event is newer than the yfinance cutoff
                        #     (or the symbol has no yfinance rows): apply to ALL rows
                        #     before ex_date, both sources.
                        #   post_boundary=False → pre-boundary event: apply ONLY to
                        #     non-yfinance (raw) rows; yfinance rows already carry it.
                        for ex_date, split_factor, post_boundary in events_desc:
                            cur.execute(
                                f"UPDATE golden.{tbl} SET adj_close = adj_close * %s "
                                "WHERE symbol = %s AND interval = '1d' AND date < %s "
                                "  AND (data_source IS DISTINCT FROM 'yfinance' OR %s)",
                                (split_factor, symbol, ex_date, post_boundary),
                            )
                        if tbl == "price_history":
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

            if skipped_unconfirmed:
                print(f"\n  Gated {len(skipped_unconfirmed)} post-boundary event(s) with no "
                      f"confirming price cliff (feed date/ratio didn't match traded price):",
                      file=sys.stderr)
                for sym, ex, atype, sf in sorted(skipped_unconfirmed)[:60]:
                    print(f"    SKIP {sym} {ex} {atype} f={sf:.3f}", file=sys.stderr)
                if len(skipped_unconfirmed) > 60:
                    print(f"    … and {len(skipped_unconfirmed) - 60} more", file=sys.stderr)

            print(f"\n  Done — {rows_updated} price rows had adj_close updated.",
                  file=sys.stderr)


if __name__ == "__main__":
    main()
