#!/usr/bin/env python
"""Re-derive app.fundamentals_annual.expenses / operating_profit from the stored
Screener exports, after the "Change in Inventory" sign fix in parser.py.

WHY THIS EXISTS

`operating_profit` was never sourced from Screener. parser.py derived it as
`sales - sum(expense components)`, and summed "Change in Inventory" as though an
inventory build were a cost of the period. It is not: cost of goods sold is Raw
Material Cost MINUS the build, so the component must carry a negative sign.

Measured on TITAN FY26, against the company's own filing to BSE (2026-08-07,
year ended 31-Mar-2026):

    expenses          99,099 stored  ->  79,227 correct   (filing 81,235 incl. dep+interest)
    operating_profit -11,515 stored  ->   8,357 correct   (filing-derived 8,355)

The live site showed Titan making an ~11,500 crore operating LOSS on 87,584
crore of sales while reporting 6,801 crore of profit before tax. 302 companies
were in that impossible state.

WHY RE-PARSE RATHER THAN PATCH IN SQL

`operating_profit` could be repaired arithmetically from the PBT identity
without reading a single blob. `expenses` could not — the component breakdown
is not stored in fundamentals_annual, so the only place the correct sum exists
is the original xlsx. Patching OP alone would leave Titan's expenses at 99,099
and the two columns mutually contradictory, which is a worse state than being
uniformly wrong: it would silence the very check that found this.

WHAT MAKES THE RESULT VERIFIABLE

Two independent routes to the same number, sharing no inputs:

    A) operating_profit = sales - sum(signed components)        <- this parser
    B) operating_profit = pbt - other_income + dep + interest   <- sourced rows

Route B touches none of the component rows. Agreement is therefore evidence,
not tautology — unlike `sales - expenses = operating_profit`, which is the
definition of the column and passed on every one of the 24,848 broken rows.
This script reports A-vs-B agreement before and after, and that delta is the
whole point: if "after" is not dramatically better than "before", do not apply.

USAGE
    python scripts/backfill-operating-profit.py            # dry run, writes nothing
    python scripts/backfill-operating-profit.py --apply    # writes
"""
from __future__ import annotations

import os
import sys

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etl", "src"))
from fundamental_etl.screener.parser import parse_export, ParseError  # noqa: E402

# Agreement tolerance between routes A and B, as a fraction of sales. Screener
# rounds to one decimal and small companies carry rounding noise; 0.5% is loose
# enough not to cry wolf and far tighter than the defect (Titan was off by 23%
# of sales). NOT tuned to make the run look good — the pre-fix number is
# reported with the same tolerance, so both sides are measured the same way.
TOL = 0.005


def route_b(f: dict) -> float | None:
    """operating_profit implied by the independently-sourced P&L rows."""
    if f.get("profit_before_tax") is None:
        return None
    g = lambda k: f.get(k) or 0.0  # noqa: E731
    return g("profit_before_tax") - g("other_income") + g("depreciation") + g("interest")


def main() -> int:
    apply = "--apply" in sys.argv
    url = os.environ.get("APP_DB_URL")
    if not url:
        raise SystemExit("APP_DB_URL not set")
    if apply and "localhost" not in url and os.environ.get("FUNDAMENTAL_ALLOW_REMOTE_DB") != "1":
        raise SystemExit("refusing to write to a remote DB without FUNDAMENTAL_ALLOW_REMOTE_DB=1")

    changed = agree_before = agree_after = compared = parse_fail = 0
    updates: list[tuple[float | None, float | None, str, str]] = []

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT ON (symbol) symbol, content FROM app.screener_export_raw"
                        " ORDER BY symbol, fetched_at DESC")
            blobs = cur.fetchall()
        print(f"re-parsing {len(blobs)} stored exports…", flush=True)

        for n, (symbol, content) in enumerate(blobs, 1):
            try:
                parsed = parse_export(bytes(content))
            except (ParseError, Exception):  # noqa: B014 - a bad blob must not halt the sweep
                parse_fail += 1
                continue
            with conn.cursor() as cur:
                cur.execute("SELECT period_end, sales, expenses, operating_profit,"
                            " other_income, depreciation, interest, profit_before_tax"
                            " FROM app.fundamentals_annual WHERE symbol=%s", (symbol,))
                for (pe, sales, exp_old, op_old, oi, dep, intr, pbt) in cur.fetchall():
                    f = parsed.annual.get(pe)
                    if not f:
                        continue
                    # The columns are numeric, so psycopg hands back Decimal.
                    # Mixing that with the parser's floats raises TypeError on
                    # the first multiply — cast once, here, rather than at each
                    # use site.
                    sales, exp_old, op_old, oi, dep, intr, pbt = (
                        None if v is None else float(v)
                        for v in (sales, exp_old, op_old, oi, dep, intr, pbt)
                    )
                    exp_new, op_new = f.get("expenses"), f.get("operating_profit")
                    if op_new is None or sales is None:
                        continue
                    b = route_b({"profit_before_tax": pbt, "other_income": oi,
                                 "depreciation": dep, "interest": intr})
                    if b is not None:
                        compared += 1
                        tol = TOL * max(abs(sales), 1.0)
                        if op_old is not None and abs(op_old - b) <= tol:
                            agree_before += 1
                        if abs(op_new - b) <= tol:
                            agree_after += 1
                    if op_old is None or abs(op_new - op_old) > 0.01:
                        changed += 1
                        updates.append((exp_new, op_new, symbol, pe))
            if n % 250 == 0:
                print(f"  {n}/{len(blobs)}…", flush=True)

        pct = lambda x: f"{100.0*x/compared:.1f}%" if compared else "n/a"  # noqa: E731
        print(f"\nrows compared        {compared}")
        print(f"route A==B BEFORE    {agree_before:>6}  ({pct(agree_before)})")
        print(f"route A==B AFTER     {agree_after:>6}  ({pct(agree_after)})")
        print(f"rows changed         {changed}")
        print(f"blobs unparseable    {parse_fail}")

        if not apply:
            print("\nDRY RUN — nothing written. Re-run with --apply.")
            return 0
        if agree_after <= agree_before:
            print("\nREFUSING TO APPLY: agreement did not improve. The fix is wrong or the"
                  " blobs do not match what is stored.")
            return 1

        with conn.cursor() as cur:
            cur.executemany("UPDATE app.fundamentals_annual SET expenses=%s, operating_profit=%s"
                            " WHERE symbol=%s AND period_end=%s", updates)
        conn.commit()
        print(f"\napplied {len(updates)} row updates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
