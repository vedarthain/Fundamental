#!/usr/bin/env python3
"""
audit-renamed-tickers.py — surface stocks with suspicious price-history gaps.

The LTIM/LTM rename was found by accident: the user noticed the chart
showed only 3 months of data despite the company being listed since 2016.
This script finds candidates of the same shape systematically:

  Active universe stock with
    - ≥5 years of fundamentals (Screener has full history)
    - <270 days of price history in golden.price_history

That gap almost always means an NSE ticker rename that broke yfinance's
historical lookup — exactly the LTIM → LTM situation.  These are the
stocks that need an NSE-bhavcopy backfill via:

  scripts/backfill-nse-bhavcopy.py --symbol <SYM> --also <OLD_SYM> ...

Stocks already in SYMBOL_RENAMES (managed in backfill-nse-bhavcopy.py)
are shown separately as "known" so we don't keep re-flagging them.

USAGE:
  # Default: list candidates against local DBs
  scripts/audit-renamed-tickers.py

  # Against Neon (use case: production-only check)
  APP_DB_URL="$NEON_APP_URL" GOLDEN_DB_URL="$NEON_GOLDEN_URL" \\
    scripts/audit-renamed-tickers.py

  # Tune thresholds
  scripts/audit-renamed-tickers.py --min-years 3 --max-price-days 365

Output is plain text — pipe through `tee` if you want to capture it.
Exit code is always 0 (this is an informational audit, not a check that
should fail CI).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
# Pick up SYMBOL_RENAMES so we can exclude already-known renames from the
# "needs investigation" list.  The backfill script is the source of truth.
sys.path.insert(0, str(ROOT / "scripts"))


def _load_known_renames() -> dict[str, list[str]]:
    """Import SYMBOL_RENAMES from backfill-nse-bhavcopy.py without
    executing its main() (it's a __main__ guard, so just importing is safe).
    Returns the dict {current_symbol: [old_symbols...]}.
    """
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "backfill_nse_bhavcopy",
            ROOT / "scripts" / "backfill-nse-bhavcopy.py",
        )
        if spec is None or spec.loader is None:
            return {}
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return dict(getattr(mod, "SYMBOL_RENAMES", {}))
    except Exception as e:
        print(f"⚠ couldn't load SYMBOL_RENAMES: {e}", file=sys.stderr)
        return {}


def env_url(name: str) -> str:
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"✗ {name} not set — pass as env var or add to .env.local")


def mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit for likely ticker renames (stocks with fundamentals but missing price history).",
    )
    parser.add_argument("--min-years", type=int, default=5,
        help="Min years of fundamentals data to consider the stock long-listed (default 5)")
    parser.add_argument("--max-price-days", type=int, default=270,
        help="Max days of price history for a stock to be flagged as suspicious (default 270 = ~9 months)")
    args = parser.parse_args()

    app_url = env_url("APP_DB_URL")
    golden_url = env_url("GOLDEN_DB_URL")
    print(f"App DB:    {mask(app_url)}")
    print(f"Golden DB: {mask(golden_url)}")
    print(f"Thresholds: ≥{args.min_years}y fundamentals AND ≤{args.max_price_days}d price history")
    print()

    known = _load_known_renames()
    if known:
        print(f"Known renames in SYMBOL_RENAMES ({len(known)}):")
        for canon, olds in known.items():
            print(f"  {canon} ← {', '.join(olds)}")
        print()

    # 1. Active universe stocks with sufficient fundamentals history.
    #    years_of_data is maintained by the maturity-tier classifier.
    with psycopg.connect(app_url) as ac, ac.cursor() as cur:
        cur.execute("""
            SELECT u.symbol,
                   u.company_name,
                   u.years_of_data,
                   COALESCE(sm.market_cap_cr, 0)::float AS market_cap_cr
              FROM app.universe u
         LEFT JOIN app.screener_meta sm USING (symbol)
             WHERE u.is_active
               AND u.years_of_data >= %s
             ORDER BY u.symbol
        """, (args.min_years,))
        candidates = cur.fetchall()

    if not candidates:
        print("No active stocks meet the fundamentals threshold — nothing to audit.")
        return 0

    print(f"Checking price coverage for {len(candidates)} candidates...")

    # 2. For each candidate, count days of price history in golden.
    #    Single grouped query — fast even across 2,000+ symbols.
    sym_ns_list = [f"{c[0]}.NS" for c in candidates]
    with psycopg.connect(golden_url) as gc, gc.cursor() as cur:
        cur.execute("""
            WITH targets AS (SELECT unnest(%s::text[]) AS symbol)
            SELECT t.symbol,
                   COALESCE(COUNT(p.date), 0)::int           AS n_days,
                   MIN(p.date)                                AS first_date,
                   MAX(p.date)                                AS last_date
              FROM targets t
         LEFT JOIN golden.price_history p
                ON p.symbol = t.symbol
               AND p.interval = '1d'
               AND p.close IS NOT NULL
             GROUP BY t.symbol
        """, (sym_ns_list,))
        coverage = {
            r[0].replace(".NS", ""): {"n_days": r[1], "first": r[2], "last": r[3]}
            for r in cur.fetchall()
        }

    # 3. Filter to suspicious gaps.  Sort by market cap desc so the most
    #    impactful (large-cap with missing history) lead the list.
    suspicious = []
    for sym, name, years, mcap in candidates:
        cov = coverage.get(sym, {"n_days": 0, "first": None, "last": None})
        if cov["n_days"] <= args.max_price_days:
            suspicious.append((sym, name, years, mcap, cov))

    # Split known from new
    new_suspects = [r for r in suspicious if r[0] not in known]
    already_known = [r for r in suspicious if r[0] in known]

    # Sort by PriceDays asc (worst gaps first), then mcap desc as tiebreak.
    # Smallest PriceDays = most likely real rename; large mcap = highest
    # impact if it IS a rename.
    sort_key = lambda r: (r[4]["n_days"], -(r[3] or 0))  # noqa: E731
    new_suspects.sort(key=sort_key)
    already_known.sort(key=sort_key)

    print()
    print(f"Found {len(suspicious)} suspicious stocks "
          f"({len(new_suspects)} new, {len(already_known)} already in SYMBOL_RENAMES)")
    print()
    print("INTERPRETATION:")
    print("  Most candidates are recent IPOs or demergers — the fundamentals span")
    print("  the parent entity but the new ticker only has trading data since the")
    print("  listing date.  Those are NOT bugs.")
    print()
    print("  True renames look like: 10+ years of fundamentals AND only ~20-30 days")
    print("  of price history (yfinance lost the old ticker's history).  Those rows")
    print("  appear at the top of the list — sorted by PriceDays ascending.")
    print()

    if new_suspects:
        print("=" * 90)
        print("NEW CANDIDATES — need investigation + backfill")
        print("=" * 90)
        print(f"{'SYMBOL':<14} {'YearsFund':>9}  {'PriceDays':>9}  {'Mcap (Cr)':>14}  COMPANY")
        print("-" * 90)
        for sym, name, years, mcap, cov in new_suspects:
            mcap_str = f"{mcap:,.0f}" if mcap else "—"
            name_short = (name or "")[:40]
            print(f"{sym:<14} {years:>9}  {cov['n_days']:>9}  {mcap_str:>14}  {name_short}")
        print()
        print("To backfill: scripts/backfill-nse-bhavcopy.py --symbol <SYM> --also <OLD_SYM> "
              "--start <listing_date>")
        print("Add the rename to SYMBOL_RENAMES in scripts/backfill-nse-bhavcopy.py.")

    if already_known:
        print()
        print("=" * 90)
        print("KNOWN (already in SYMBOL_RENAMES — listed for completeness)")
        print("=" * 90)
        print(f"{'SYMBOL':<14} {'YearsFund':>9}  {'PriceDays':>9}  {'Mcap (Cr)':>14}  COMPANY")
        print("-" * 90)
        for sym, name, years, mcap, cov in already_known:
            mcap_str = f"{mcap:,.0f}" if mcap else "—"
            name_short = (name or "")[:40]
            print(f"{sym:<14} {years:>9}  {cov['n_days']:>9}  {mcap_str:>14}  {name_short}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
