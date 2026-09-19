"""
coverage.py — the per-symbol accounting ledger and the invariants over it.

WHAT THIS REPLACES

Before this module, "is our coverage OK?" was answered by a handful of
hand-tuned constants scattered across scripts/check-freshness.py and dq.py:

    --snapshot-min-rows default 2000      # "full universe ~2,150"
    panel_cache threshold 500             # "we usually have ~2,150"
    screener_export_stale_financials 40   # "baseline was 25 on 2026-08-19"

Every one of those numbers was accurate on the day it was written and wrong
within a couple of months, because the universe grows and the constants do not.
Worse, they fail toward silence: a stale threshold never errors, it just keeps
returning green. That is how 472 never-scraped symbols and 23 gated symbols sat
unreported for months while the weekly job printed all-clear.

THE REPLACEMENT

Classify every active symbol into exactly one bucket, then assert the partition
rather than any level:

    sum(buckets) == count(active universe)      # nothing may vanish
    unclassified == 0                           # nothing may be unexplained

Neither assertion contains a number. Neither needs re-tuning when the universe
grows from 2,150 to 2,622 to 3,000. A symbol that falls out of the pipeline for
a reason nobody anticipated does not disappear into a filtered-out remainder; it
lands in 'unclassified' and trips the invariant on the next run.

Anything beyond that is reported as MOVEMENT between snapshots — "never_attempted
0 -> 472" — which needs no ceiling and therefore has no ceiling to get wrong.

THE ONE RULE FOR EVERY QUERY IN HERE

The FROM clause always starts at app.universe and LEFT JOINs outward. Never
INNER JOIN the table whose absence you are testing for. The old coverage check
did exactly that (screener_meta JOIN universe) and so computed its percentage
over the set that had already succeeded — it was structurally incapable of
counting a missing row. If you add a query to this module, start it at
app.universe or it is not a coverage query.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

import psycopg
from psycopg.rows import dict_row

import structlog

log = structlog.get_logger()


# Ordered worst-to-best for reporting. Also the CHECK constraint list in
# migration 0068 — keep the two in step (the constraint will reject an unknown
# status at write time, which is the intended failure mode, not a silent skip).
STATUSES = [
    "scored",
    "gated_stale_financials",
    "gated_insufficient_history",
    "no_metrics",
    "fetch_failing",
    "never_attempted",
    "unclassified",
]

# Buckets that mean "this symbol is NOT on the site and that is a problem we
# should be actively working". Gated buckets are excluded deliberately: the
# pipeline saw those symbols and correctly chose to withhold a score. They still
# get reported, but they are not defects.
PROBLEM_STATUSES = ["never_attempted", "fetch_failing", "no_metrics", "unclassified"]


# ── The classifier ───────────────────────────────────────────────────────────
#
# One SQL statement, one CASE, evaluated in priority order. Written as a single
# statement on purpose: if classification were several UPDATE passes, a symbol
# could be caught by two of them or by none, and "none" is precisely the bug
# this module exists to prevent. A single CASE over a LEFT JOIN from
# app.universe guarantees exactly one row per active symbol, always.
#
# The ELSE arm is 'unclassified' rather than anything plausible-looking. Guessing
# in the ELSE is how a residual bucket stops being a tripwire.

_CLASSIFY_SQL = """
INSERT INTO app.coverage_ledger (snapshot_date, symbol, status, detail)
SELECT
    %(snap)s::date AS snapshot_date,
    u.symbol,
    CASE
        -- 1. Made it. A score row exists for this snapshot.
        WHEN sc.symbol IS NOT NULL THEN 'scored'

        -- 2. Seen and deliberately withheld. score_status is set by
        --    compute_metrics; the scorer excludes these by design.
        WHEN m.score_status = 'stale_data'         THEN 'gated_stale_financials'
        WHEN m.score_status = 'insufficient_data'  THEN 'gated_insufficient_history'

        -- 3. Never even attempted. No screener_meta row at all. This is the
        --    bucket every previous check was blind to, because they all
        --    INNER JOINed screener_meta and so dropped these rows before
        --    counting. It must be tested BEFORE fetch_failing — a NULL
        --    last_status is "never tried", not "tried and failed".
        WHEN sm.symbol IS NULL THEN 'never_attempted'

        -- 4. Tried, and failing. Distinguished from never_attempted because the
        --    remedies differ: this one needs a cookie rotation or a parser fix,
        --    that one just needs the queue to actually drain.
        WHEN sm.last_status IS DISTINCT FROM 'ok' THEN 'fetch_failing'

        -- 5. Scraped clean but absent from this snapshot's metrics — typically
        --    no cluster assignment, so peer-relative percentiles are undefined.
        WHEN m.symbol IS NULL THEN 'no_metrics'

        -- 6. Residual. Asserted to be zero elsewhere in this module. If this
        --    fires, the pipeline grew a path the classifier does not model.
        ELSE 'unclassified'
    END AS status,
    CASE
        WHEN sc.symbol IS NOT NULL THEN NULL
        WHEN m.score_status = 'stale_data' THEN
            'newest financials ' || COALESCE(fresh.newest::text, 'none')
            || ', ' || COALESCE((%(snap)s::date - fresh.newest)::text, '?') || ' days stale'
        WHEN sm.symbol IS NULL THEN 'no screener_meta row — fetch never attempted'
        WHEN sm.last_status IS DISTINCT FROM 'ok' THEN
            'last_status=' || COALESCE(sm.last_status, 'null')
            || ', failures=' || COALESCE(sm.consecutive_failures::text, '?')
        WHEN m.symbol IS NULL THEN 'no metrics row at this snapshot'
        ELSE NULL
    END AS detail
FROM app.universe u
LEFT JOIN app.screener_meta sm
       ON sm.symbol = u.symbol
LEFT JOIN app.metrics_snapshot m
       ON m.symbol = u.symbol AND m.snapshot_date = %(snap)s::date
LEFT JOIN app.scores sc
       ON sc.symbol = u.symbol AND sc.snapshot_date = %(snap)s::date
LEFT JOIN LATERAL (
    SELECT GREATEST(
             (SELECT MAX(period_end) FROM app.fundamentals_annual    a WHERE a.symbol = u.symbol),
             (SELECT MAX(period_end) FROM app.fundamentals_quarterly q WHERE q.symbol = u.symbol)
           ) AS newest
) fresh ON TRUE
WHERE u.is_active
ON CONFLICT (snapshot_date, symbol) DO UPDATE
    SET status = EXCLUDED.status,
        detail = EXCLUDED.detail,
        recorded_at = now()
"""


def write_ledger(conn: psycopg.Connection, snapshot_date: date) -> dict[str, int]:
    """Classify every active symbol for `snapshot_date` and persist the ledger.

    Idempotent — re-running a snapshot overwrites its rows, so a re-scored week
    reconciles rather than duplicating. Returns the bucket counts.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_CLASSIFY_SQL, {"snap": snapshot_date})
        cur.execute(
            """
            SELECT status, COUNT(*)::int AS n
              FROM app.coverage_ledger
             WHERE snapshot_date = %s
             GROUP BY status
            """,
            (snapshot_date,),
        )
        counts = {r["status"]: r["n"] for r in cur.fetchall()}
    return {s: counts.get(s, 0) for s in STATUSES}


# ── The invariants ───────────────────────────────────────────────────────────

@dataclass
class CoverageResult:
    name: str
    passed: bool
    message: str

    def short(self) -> str:
        return f"{'✓' if self.passed else '✗'} {self.name:<40} {self.message}"


def check_partition(conn: psycopg.Connection, snapshot_date: date) -> list[CoverageResult]:
    """The two assertions that contain no tunable numbers.

    1. The ledger accounts for every active symbol — nothing vanished.
    2. Nothing landed in the residual bucket — nothing is unexplained.

    Deliberately NOT asserted here: that any particular bucket is small. Levels
    are reported by delta_report and judged by a human; baking a ceiling in is
    what turned the stale-financials alert into a thermostat that treated a
    permanent 25-stock hole as normal.
    """
    out: list[CoverageResult] = []
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT COUNT(*)::int AS n FROM app.universe WHERE is_active"
        )
        universe_n = cur.fetchone()["n"]
        cur.execute(
            "SELECT COUNT(*)::int AS n FROM app.coverage_ledger WHERE snapshot_date = %s",
            (snapshot_date,),
        )
        ledger_n = cur.fetchone()["n"]
        cur.execute(
            """SELECT COUNT(*)::int AS n FROM app.coverage_ledger
                WHERE snapshot_date = %s AND status = 'unclassified'""",
            (snapshot_date,),
        )
        unclassified_n = cur.fetchone()["n"]

    out.append(CoverageResult(
        name="coverage.ledger_accounts_for_universe",
        passed=(ledger_n == universe_n),
        message=(f"{ledger_n} ledger rows vs {universe_n} active symbols"
                 + ("" if ledger_n == universe_n
                    else f" — {abs(universe_n - ledger_n)} UNACCOUNTED FOR")),
    ))
    out.append(CoverageResult(
        name="coverage.no_unclassified",
        passed=(unclassified_n == 0),
        message=(f"{unclassified_n} symbols in the residual bucket"
                 + ("" if unclassified_n == 0
                    else " — the classifier has drifted from the pipeline")),
    ))
    return out


def delta_report(
    conn: psycopg.Connection,
    snapshot_date: date,
) -> tuple[list[dict], Optional[date]]:
    """Bucket counts for `snapshot_date` against the previous snapshot.

    This is the alerting surface. There is no threshold: a bucket that moves is
    reported with its movement, and a problem bucket that GROWS fails the run.
    Growth is the signal precisely because it needs no baseline — we do not have
    to know what "normal" is, only that it changed.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT MAX(snapshot_date) AS d FROM app.coverage_ledger
                WHERE snapshot_date < %s""",
            (snapshot_date,),
        )
        row = cur.fetchone()
        prev = row["d"] if row else None

        cur.execute(
            """
            SELECT s.status,
                   COALESCE(cur.n, 0)  AS n_now,
                   COALESCE(prv.n, 0)  AS n_prev
              FROM unnest(%(statuses)s::text[]) AS s(status)
              LEFT JOIN (SELECT status, COUNT(*)::int AS n FROM app.coverage_ledger
                          WHERE snapshot_date = %(snap)s GROUP BY status) cur
                     ON cur.status = s.status
              LEFT JOIN (SELECT status, COUNT(*)::int AS n FROM app.coverage_ledger
                          WHERE snapshot_date = %(prev)s GROUP BY status) prv
                     ON prv.status = s.status
            """,
            {"statuses": STATUSES, "snap": snapshot_date, "prev": prev},
        )
        rows = cur.fetchall()

    ordered = {r["status"]: r for r in rows}
    out = []
    for s in STATUSES:
        r = ordered.get(s, {"status": s, "n_now": 0, "n_prev": 0})
        r["delta"] = r["n_now"] - (r["n_prev"] if prev else r["n_now"])
        r["is_problem"] = s in PROBLEM_STATUSES
        out.append(r)
    return out, prev


def check_no_regression(
    conn: psycopg.Connection,
    snapshot_date: date,
) -> list[CoverageResult]:
    """Fail if a problem bucket grew since the previous snapshot.

    'scored' shrinking and 'never_attempted' growing are the two shapes of the
    outage we actually had. Neither is expressible as a fixed threshold — the
    absolute numbers were unremarkable both times (2,122 scored cleared a floor
    of 2,000; 25 stale cleared a ceiling of 40). The movement was the signal, and
    nothing was watching movement.
    """
    rows, prev = delta_report(conn, snapshot_date)
    if prev is None:
        return [CoverageResult(
            name="coverage.no_regression",
            passed=True,
            message="no prior snapshot to compare against (first run)",
        )]

    grew = [r for r in rows if r["is_problem"] and r["delta"] > 0]
    scored = next((r for r in rows if r["status"] == "scored"), None)

    out = [CoverageResult(
        name="coverage.problem_buckets_not_growing",
        passed=not grew,
        message=("no problem bucket grew since " + prev.isoformat()) if not grew else
                ("grew since " + prev.isoformat() + ": "
                 + ", ".join(f"{r['status']} {r['n_prev']}->{r['n_now']} (+{r['delta']})"
                             for r in grew)),
    )]
    if scored is not None:
        out.append(CoverageResult(
            name="coverage.scored_not_shrinking",
            passed=(scored["delta"] >= 0),
            message=f"scored {scored['n_prev']} -> {scored['n_now']} "
                    f"({scored['delta']:+d}) since {prev.isoformat()}",
        ))
    return out


def check_no_problems(
    conn: psycopg.Connection,
    snapshot_date: date,
) -> list[CoverageResult]:
    """Problem buckets must be EMPTY. Not small — empty.

    WHY ZERO AND NOT A THRESHOLD

    check_no_regression above only catches a bucket that GREW. Run it alone and
    a pre-existing hole passes forever: the 472 never-attempted symbols were
    static for months, so every week-over-week delta was +0 and a delta-only
    check would have called that healthy. That is the same failure as the old
    ceiling-of-40 thermostat, just arrived at from the other direction — one
    normalises a hole by drawing a band around it, the other by watching only
    the derivative.

    So the standing assertion is zero. Zero is the one number that is not a
    tunable constant and cannot rot as the universe grows: there is no defensible
    reading of "17 symbols we have never once attempted to scrape is fine". It
    stays red until the work is actually done, which is the entire point — an
    alert you can silence by getting used to it is not an alert.

    Gated buckets are NOT asserted here. The pipeline saw those symbols and
    deliberately withheld a score; they are a judgement, not a defect. They are
    reported in format_report so the cohort stays visible, and check_no_regression
    catches them growing, but they do not fail the run.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT status, COUNT(*)::int AS n
              FROM app.coverage_ledger
             WHERE snapshot_date = %s AND status = ANY(%s)
             GROUP BY status
            """,
            (snapshot_date, PROBLEM_STATUSES),
        )
        found = {r["status"]: r["n"] for r in cur.fetchall()}

    out: list[CoverageResult] = []
    for status in PROBLEM_STATUSES:
        n = found.get(status, 0)
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT symbol FROM app.coverage_ledger
                    WHERE snapshot_date = %s AND status = %s
                    ORDER BY symbol LIMIT 5""",
                (snapshot_date, status),
            )
            sample = [r["symbol"] for r in cur.fetchall()]
        msg = f"{n} symbols"
        if n:
            msg += " — e.g. " + ", ".join(sample) + ("…" if n > len(sample) else "")
        out.append(CoverageResult(
            name=f"coverage.{status}_is_empty",
            passed=(n == 0),
            message=msg,
        ))
    return out


def format_report(rows: list[dict], prev: Optional[date], snapshot_date: date) -> str:
    """The table a human reads in ten seconds, replacing 17 pass/fail lines."""
    head = f"Coverage ledger — {snapshot_date}"
    if prev:
        head += f"  (vs {prev})"
    lines = [head, "-" * len(head),
             f"{'status':<30}{'now':>8}{'prev':>8}{'delta':>8}"]
    total_now = 0
    for r in rows:
        total_now += r["n_now"]
        d = r["delta"]
        flag = ""
        if r["is_problem"] and d > 0:
            flag = "  <-- GREW"
        elif r["status"] == "scored" and d < 0:
            flag = "  <-- SHRANK"
        lines.append(
            f"{r['status']:<30}{r['n_now']:>8}{r['n_prev'] if prev else '-':>8}"
            f"{d:>+8}{flag}"
        )
    lines.append(f"{'TOTAL (= active universe)':<30}{total_now:>8}")
    return "\n".join(lines)
