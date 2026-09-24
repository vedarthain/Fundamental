#!/usr/bin/env python
"""Repair operating_profit / expenses on rows the 2026-09-24 backfill could not reach.

WHY THIS EXISTS — AND WHY THE BACKFILL DID NOT ALREADY DO IT

scripts/backfill-operating-profit.py re-derived every row from the stored
Screener xlsx after the "Change in Inventory" sign fix. It reported "applied
15,703 row updates" and nothing else, so it read as complete. It was not.

The re-derivation is keyed on period:

    f = parsed.annual.get(pe)
    if not f:
        continue          # <- silent

`app.screener_export_raw` holds ONE blob per symbol, and a blob does not always
span the rows we have. UGARSUGAR is the worked example: the stored blob (fetched
2026-09-19, but whose content stops at FY23) carries FY19-FY23, while
app.fundamentals_annual carries FY16-FY26. The backfill therefore repaired the
ancient history and skipped FY24, FY25 and FY26 — the only years anyone looks
at — without counting them. A script written to prove a fix shipped the exact
defect CLAUDE.md section 5 warns about: a check that cannot fail.

Measured on 2026-09-24 across all 2,605 blobs and 23,717 rows:

    rows whose period is absent from the blob   2,012
    rows whose symbol has no blob at all           68
    UNREACHABLE total                           2,080
    unreachable AND violating the PBT identity    941
    REACHABLE and violating                         0

That last line is the important one. After the backfill, the identity holds for
every one of the 21,637 reachable rows at a 2%-of-sales tolerance. So the
identity is not an approximation that happens to be loose enough — it is a
property the corrected data actually has, and the 941 stragglers are all rows
still carrying the pre-fix sign.

WHY ROUTE B IS THE ANSWER HERE, HAVING BEEN REFUSED IN THE BACKFILL

backfill-operating-profit.py deliberately re-parsed rather than patching in SQL,
because `expenses` cannot be rebuilt from the P&L identity alone and leaving OP
and expenses mutually contradictory is worse than being uniformly wrong.

That argument does not apply to these rows, for a blunt reason: there is no blob
to re-parse. The component breakdown does not exist anywhere we can reach. The
choice is not "route B vs the components", it is "route B vs leaving a known
sign error in place".

Two independent confirmations that route B is right:

  1. UGARSUGAR FY26. BSE's own inline-XBRL filing (scrip 530363, board-approved
     12-05-2026, Standalone Audited) states Expenses 1,505.9 incl. finance and
     depreciation, giving operating profit 103.5 cr. Route B on our stored rows
     gives 103. Our stored route-A value is MINUS 326. The XBRL components sum
     to the reported total to the decimal and Income - Expenses equals the
     reported PBT exactly, so there is no ambiguity about which is right.
  2. Route A == route B on all 21,637 reachable rows post-fix. If route B were
     systematically biased, that agreement could not exist.

`expenses` is then set to sales - operating_profit, which is the definition of
the column, so the two cannot be left contradicting each other.

WHAT THIS SCRIPT REFUSES TO DO

It does NOT touch reachable rows. Those have real component data behind them and
re-deriving them is backfill-operating-profit.py's job, not this one's.

It does NOT touch unreachable rows that already satisfy the identity. A row
inside tolerance had a near-zero inventory movement and needs no correction;
overwriting it would replace a sourced number with a derived one for nothing.

WHAT KEEPS THIS CURRENT (CLAUDE.md section 5)

Nothing here, and that is deliberate — this is a one-time repair of damage from
a specific parser defect. The thing that keeps it current is the DQ assertion
that must accompany it: if any row anywhere violates the identity beyond
tolerance, that is now a failure, not a curiosity. Without that assertion this
script is exactly the "seeded once" pattern it is repairing.

USAGE
    etl/.venv/bin/python scripts/repair-unreachable-operating-profit.py          # dry run
    etl/.venv/bin/python scripts/repair-unreachable-operating-profit.py --apply  # writes
"""
from __future__ import annotations

import os
import sys

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etl", "src"))
from fundamental_etl.screener.parser import parse_export  # noqa: E402

# Same tolerance the backfill measured agreement with, for the same reason:
# Screener rounds to one decimal, and a company's exceptional items or share of
# associates sit between `Income - Expenses` and PBT (Titan FY26: 101 cr, which
# is 0.11% of sales). Measured: 0 of 21,637 reachable rows exceed this, so it is
# not a threshold picked to make the run look good — it is where the corrected
# data actually lives.
TOL = 0.02

# The symbol/period whose correct answer came from OUTSIDE this pipeline, via
# BSE inline XBRL. If the repair does not reproduce it, the repair is wrong.
# See the module docstring. A fix must fail on the bug it fixes.
PROBE = ("UGARSUGAR", "2026-03-31", 103.5, -326.0)


def route_b(pbt, oi, dep, intr):
    """operating_profit implied by the independently-sourced P&L rows.

    These four columns are read straight from Screener's own labelled rows and
    were never derived by the component-summing code, so they did not carry the
    Change in Inventory sign error. That is what makes this an independent route
    and not a restatement of the broken one.
    """
    g = lambda v: float(v or 0.0)  # noqa: E731
    return g(pbt) - g(oi) + g(dep) + g(intr)


def main() -> int:
    apply = "--apply" in sys.argv
    url = os.environ.get("APP_DB_URL")
    if not url:
        raise SystemExit("APP_DB_URL not set")
    if apply and "localhost" not in url and os.environ.get("FUNDAMENTAL_ALLOW_REMOTE_DB") != "1":
        raise SystemExit("refusing to write to a remote DB without FUNDAMENTAL_ALLOW_REMOTE_DB=1")

    with psycopg.connect(url) as conn:
        # 1. Which (symbol, period) pairs can be re-derived from a stored blob?
        #    Anything NOT in this set is what backfill-operating-profit.py
        #    skipped in silence.
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT ON (symbol) symbol, content"
                        " FROM app.screener_export_raw ORDER BY symbol, fetched_at DESC")
            blobs = cur.fetchall()
        print(f"parsing {len(blobs)} stored exports to establish reachability…", flush=True)
        reachable: dict[str, set] = {}
        unparseable = 0
        for n, (symbol, content) in enumerate(blobs, 1):
            try:
                reachable[symbol] = set(parse_export(bytes(content)).annual)
            except Exception:  # noqa: BLE001 - a bad blob must not halt the sweep
                unparseable += 1
                reachable[symbol] = set()
            if n % 500 == 0:
                print(f"  {n}/{len(blobs)}…", flush=True)

        with conn.cursor() as cur:
            cur.execute(
                """SELECT symbol, period_end, sales, expenses, operating_profit,
                          other_income, depreciation, interest, profit_before_tax
                     FROM app.fundamentals_annual
                    WHERE profit_before_tax IS NOT NULL
                      AND operating_profit IS NOT NULL
                      AND sales IS NOT NULL AND sales <> 0"""
            )
            rows = cur.fetchall()

        total = len(rows)
        unreachable = reach_viol = 0
        updates: list[tuple[float, float, str, object]] = []
        implausible: list[tuple] = []
        probe_before = probe_after = None

        for sym, pe, sales, exp_old, op_old, oi, dep, intr, pbt in rows:
            sales, op_old = float(sales), float(op_old)
            b = route_b(pbt, oi, dep, intr)
            violates = abs(op_old - b) > TOL * abs(sales)
            can_reach = sym in reachable and pe in reachable[sym]
            if can_reach:
                # Not ours to touch. Counted so a regression here is visible
                # rather than assumed away.
                if violates:
                    reach_viol += 1
                continue
            unreachable += 1
            if not violates:
                continue
            # PLAUSIBILITY GUARD — the thing the first run of this script did
            # not have, and the 6 rows it cost.
            #
            # Route B assumes exceptional items are negligible and that other
            # income is incidental to the business. Both assumptions fail hard
            # on two kinds of company:
            #
            #   financials  — FINOPB is a payments bank; its 1,328 cr of "other
            #                 income" IS its revenue against 150 cr of "sales",
            #                 so subtracting it manufactures a 1,110 cr
            #                 operating loss out of an 86 cr profit.
            #   distressed  — RCOM FY20 carries 42,663 cr of impairments below
            #                 the operating line on 1,685 cr of sales. Route B
            #                 hauls all of it above the line.
            #
            # An operating profit larger in magnitude than revenue is not a
            # borderline call, it is arithmetically impossible for an operating
            # figure. Refuse to write it and say so, rather than replacing a
            # wrong number with an absurd one. These rows stay violating, which
            # is correct: we genuinely cannot derive their operating profit from
            # what we hold, and the DQ assertion should keep saying so.
            #
            # Measured on the 2026-09-24 run: 941 rows selected, of which 6
            # tripped this guard (HDIL x3, PENINLAND, KIOCL, OSWALGREEN — all
            # distressed realty/mining). Without it those 6 shipped absurd.
            if abs(b) > abs(sales):
                implausible.append((sym, pe, sales, op_old, b))
                continue
            if (sym, str(pe)) == PROBE[:2]:
                probe_before, probe_after = op_old, b
            updates.append((sales - b, b, sym, pe))

        print(f"\nunparseable blobs              {unparseable}")
        print(f"rows examined                  {total}")
        print(f"UNREACHABLE (no blob coverage) {unreachable}")
        print(f"  -> violating, will repair    {len(updates)}")
        print(f"  -> REFUSED, route B implausible {len(implausible)}")
        print(f"reachable AND violating        {reach_viol}   (not touched — re-parse those)")
        if implausible:
            print("\n  refused (|route B| > |sales| — financial or distressed, route B invalid):")
            for s_, pe_, sa_, oa_, ob_ in implausible:
                print(f"    {s_:12} {pe_}  sales={sa_:10,.0f}  stored={oa_:10,.0f}  routeB={ob_:10,.0f}")

        # A fix must fail on the bug it fixes. The probe's correct value came
        # from BSE XBRL, which this script never reads; if the repair does not
        # land on it, the method is wrong and writing 941 rows would spread the
        # error rather than remove it.
        sym, pe, want, was = PROBE
        if probe_after is None:
            print(f"\nREFUSING: probe {sym} {pe} was not selected for repair. Either it was "
                  f"already fixed by another route, or the reachability logic changed. "
                  f"Verify by hand before trusting this run.")
            return 1
        if abs(probe_after - want) > 0.02 * abs(want):
            print(f"\nREFUSING: probe {sym} {pe} repairs to {probe_after:.1f}, but BSE XBRL "
                  f"says {want}. The repair method does not reproduce an independently "
                  f"known answer — do not write.")
            return 1
        print(f"\nprobe {sym} {pe}: {probe_before:.0f} -> {probe_after:.1f}  "
              f"(BSE XBRL says {want}; was {was:.0f}) ✓")

        if not apply:
            print("\nDRY RUN — nothing written. Re-run with --apply.")
            return 0

        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE app.fundamentals_annual SET expenses=%s, operating_profit=%s"
                " WHERE symbol=%s AND period_end=%s", updates)
        conn.commit()
        print(f"\napplied {len(updates)} row updates.")

        # Prove it, rather than assume it. Re-read and re-check every row.
        with conn.cursor() as cur:
            cur.execute(
                """SELECT count(*) FROM app.fundamentals_annual
                    WHERE profit_before_tax IS NOT NULL AND operating_profit IS NOT NULL
                      AND sales IS NOT NULL AND sales <> 0
                      AND abs(operating_profit - (profit_before_tax
                            - coalesce(other_income,0) + coalesce(depreciation,0)
                            + coalesce(interest,0))) > %s * abs(sales)""", (TOL,))
            left = cur.fetchone()[0]
        print(f"rows still violating the identity after repair: {left}")
        if left:
            print("  (expected 0 — investigate before recomputing scores)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
