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

from .clusters.assigner import SCORED_TIERS

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

        -- 5. Excluded from the metrics plan by maturity_tier, so there is no
        --    metrics row to carry a score_status and arm 2 can never see it.
        --    This is the SAME judgement as arm 2's 'insufficient_data' —
        --    too little history to score — reached one step earlier, and it
        --    gets the same bucket.
        --
        --    Tested AFTER never_attempted and fetch_failing on purpose. A
        --    symbol has 0 annuals either because it is genuinely too young or
        --    because we never successfully scraped it, and those must not be
        --    allowed to wear the same label: the fetch holes are found first,
        --    and only a symbol we scraped cleanly can land here.
        WHEN u.maturity_tier IS NULL
          OR NOT (u.maturity_tier = ANY(%(scored_tiers)s))
            THEN 'gated_insufficient_history'

        -- 6. Scraped clean, in a scored tier, and still absent from this
        --    snapshot's metrics — typically no cluster assignment, so
        --    peer-relative percentiles are undefined.
        WHEN m.symbol IS NULL THEN 'no_metrics'

        -- 7. Residual. Asserted to be zero elsewhere in this module. If this
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
        WHEN u.maturity_tier IS NULL
          OR NOT (u.maturity_tier = ANY(%(scored_tiers)s)) THEN
            'maturity_tier=' || COALESCE(u.maturity_tier, 'null')
            || ' — excluded from the metrics plan, '
            || COALESCE((SELECT COUNT(DISTINCT period_end)::text
                           FROM app.fundamentals_annual a WHERE a.symbol = u.symbol), '0')
            || ' annual periods'
        -- Name WHICH of the two no_metrics causes this is. They need different
        -- remedies and the bucket cannot tell them apart on its own.
        WHEN m.symbol IS NULL THEN
            CASE WHEN ca.symbol IS NULL
                 THEN 'no cluster assignment — percentiles undefined'
                 ELSE 'no metrics row at this snapshot' END
        ELSE NULL
    END AS detail
FROM app.universe u
LEFT JOIN app.screener_meta sm
       ON sm.symbol = u.symbol
LEFT JOIN app.metrics_snapshot m
       ON m.symbol = u.symbol AND m.snapshot_date = %(snap)s::date
LEFT JOIN app.scores sc
       ON sc.symbol = u.symbol AND sc.snapshot_date = %(snap)s::date
LEFT JOIN app.cluster_assignment ca
       ON ca.symbol = u.symbol
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
        # Evict symbols that are no longer active BEFORE reclassifying.
        #
        # _CLASSIFY_SQL is an INSERT ... ON CONFLICT DO UPDATE scoped to
        # `WHERE u.is_active`, which makes it incapable of removing anything: a
        # symbol retired after the ledger was first written is simply no longer
        # SELECTed, so its stale row survives every subsequent rewrite. The
        # ledger then permanently exceeds the active universe and
        # check_partition reports "N UNACCOUNTED FOR" forever — an assertion
        # that can never be satisfied again, which trains you to ignore it.
        #
        # Observed live: retiring 40 ETFs on 2026-09-20 left 2,634 ledger rows
        # against 2,594 active symbols, and re-running --write did not clear it.
        # An upsert is not a reconciliation; a partition has to be able to lose
        # members as well as gain them.
        cur.execute(
            """
            DELETE FROM app.coverage_ledger cl
             WHERE cl.snapshot_date = %(snap)s
               AND NOT EXISTS (SELECT 1 FROM app.universe u
                                WHERE u.symbol = cl.symbol AND u.is_active)
            """,
            {"snap": snapshot_date},
        )
        evicted = cur.rowcount
        if evicted:
            log.info("coverage_ledger_evicted", n=evicted,
                     snapshot=snapshot_date.isoformat(),
                     reason="symbols no longer active")
        cur.execute(_CLASSIFY_SQL,
                    {"snap": snapshot_date, "scored_tiers": list(SCORED_TIERS)})
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
    # A check that could not RUN is not a check that PASSED. Without this the
    # two render identically as a green tick, and "I compared nothing" reads
    # exactly like "I compared everything and it was fine". `passed` stays True
    # so a skip never fails the job — the distinction is for the human reading
    # the log, which is the only place it was ever going to matter.
    skipped: bool = False

    def short(self) -> str:
        icon = "⊘" if self.skipped else ("✓" if self.passed else "✗")
        return f"{icon} {self.name:<40} {self.message}"


def unaccounted_split(
    conn: psycopg.Connection,
    snapshot_date: date,
) -> tuple[list[str], list[str]]:
    """Active symbols with no ledger row at `snapshot_date`, split by blame.

    Returns (missing_known, missing_new).

    The ledger is written once per weekly snapshot; the universe is synced on a
    different schedule. So between a classification and the next one, every
    newly listed symbol is legitimately absent from the newest ledger — it did
    not exist when the partition was taken. Counting the ledger at
    snapshot_date against `COUNT(*) FROM app.universe WHERE is_active` read at
    CHECK time compares two different days and fails on ordinary growth: on
    2026-10-10 a universe sync added 83 symbols and the assertion read
    "3082 ledger rows vs 3165 active symbols — 83 UNACCOUNTED FOR" against a
    ledger that was exhaustive when it was written.

    That is worse than a false alarm. The assertion's whole claim is that it
    contains no tunable number and therefore cannot rot — so when it goes red
    for a benign reason, the only available response is to stop believing it,
    and it was the one check capable of catching a symbol that silently fell
    out of the pipeline.

    The split restores the teeth. `app.universe_event` is the append-only log of
    when each symbol entered (migration 0055), so arrival is a fact we own
    rather than something inferred from `universe.synced_at` — which is
    overwritten on every retire and would quietly re-date old symbols as new.

      * missing_new   — first 'added' event is AFTER the snapshot. Pending the
                        next classification. Not a defect.
      * missing_known — everything else, INCLUDING symbols with no 'added' event
                        at all. A symbol we cannot prove is new is treated as
                        lost, because the alternative is a bucket that excuses
                        anything it cannot explain.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT u.symbol,
                   (ev.first_add IS NOT NULL
                    AND ev.first_add::date > %(snap)s::date) AS arrived_after
              FROM app.universe u
              LEFT JOIN app.coverage_ledger cl
                     ON cl.symbol = u.symbol AND cl.snapshot_date = %(snap)s
              LEFT JOIN (SELECT symbol, MIN(event_at) AS first_add
                           FROM app.universe_event
                          WHERE event = 'added'
                          GROUP BY symbol) ev
                     ON ev.symbol = u.symbol
             WHERE u.is_active AND cl.symbol IS NULL
             ORDER BY u.symbol
            """,
            {"snap": snapshot_date},
        )
        rows = cur.fetchall()
    missing_new = [r["symbol"] for r in rows if r["arrived_after"]]
    missing_known = [r["symbol"] for r in rows if not r["arrived_after"]]
    return missing_known, missing_new


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

    # Symbols that arrived after the snapshot are not a hole in the partition —
    # see unaccounted_split. A ledger holding MORE rows than the active universe
    # is still a failure outright: eviction is the one thing the classifier's
    # upsert cannot do on its own (see write_ledger), so a surplus means stale
    # rows survived, and no arrival can explain it.
    missing_known, missing_new = unaccounted_split(conn, snapshot_date)
    surplus = max(0, ledger_n - universe_n)
    bits = [f"{ledger_n} ledger rows vs {universe_n} active symbols"]
    if missing_known:
        bits.append(f"{len(missing_known)} UNACCOUNTED FOR "
                    f"({', '.join(missing_known[:5])}"
                    f"{'…' if len(missing_known) > 5 else ''})")
    if surplus:
        bits.append(f"{surplus} stale ledger rows not evicted")
    if missing_new:
        bits.append(f"{len(missing_new)} added since the snapshot, "
                    "pending the next classification")
    out.append(CoverageResult(
        name="coverage.ledger_accounts_for_universe",
        passed=(not missing_known and surplus == 0),
        message=" — ".join(bits),
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
        # No history, so the movement checks genuinely cannot run — but the old
        # behaviour returned a single green tick, which is a lie of omission:
        # a first run was the one case where NOTHING was verified and the log
        # said everything was fine.
        #
        # Two changes. The skip is MARKED as a skip (⊘, not ✓), and it is
        # replaced by the strongest assertion that needs no history: something
        # got scored. A first snapshot where the scored bucket is empty is a
        # total failure of the run, and it is detectable without a baseline.
        # That is a weaker check than the delta pair, and deliberately so —
        # the point is that it is not ZERO checks.
        scored_now = next((r["n_now"] for r in rows if r["status"] == "scored"), 0)
        return [
            CoverageResult(
                name="coverage.no_regression",
                passed=True,
                skipped=True,
                message="SKIPPED — no prior snapshot to compare against (first run); "
                        "movement checks will arm on the next run",
            ),
            CoverageResult(
                name="coverage.scored_non_empty",
                passed=scored_now > 0,
                message=f"scored={scored_now} on the first snapshot"
                        + ("" if scored_now > 0 else " — nothing scored at all"),
            ),
        ]

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


# ── Portfolio invariants ─────────────────────────────────────────────────────
#
# WHY THESE LIVE HERE AND NOT IN A UNIT TEST
#
# Every portfolio defect found in the 2026-09-26 session was a DATA defect, not
# a logic defect: 144 trades double-counted because two writers hashed the same
# fill into different dedup keyspaces, 4 more that no key-based cleanup could
# see, and held positions with no transaction history because the broker's
# tradebook was never uploaded. web/src/lib/portfolio.ts was correct throughout
# and every unit test over it passed. A test cannot catch these; only a query
# against the live table can.
#
# They are written to the same rule as the rest of this module: no tunable
# numbers. One zero-assertion and one partition. A partial tradebook is
# REPORTED, not failed — it is a fact about what the user has uploaded, not a
# defect in the pipeline, and an alert you can only silence by doing someone
# else's paperwork is an alert you learn to ignore.


def check_portfolio(conn: psycopg.Connection) -> list[CoverageResult]:
    """Invariants over app.portfolio_transaction / app.portfolio_holding.

    1. NO CONTENT DUPLICATES — zero, across every user.

       Matched on (user, broker, date, symbol, side, quantity, price): what the
       fill IS, never how it was hashed. Two importers wrote the same trades
       under three different dedup keyspaces over the project's life, and each
       cutover ADDED a keyspace rather than replacing one, so every re-import
       silently re-inserted everything written under the earlier shapes. A check
       keyed on dedup_key is structurally incapable of seeing that — it would
       have passed green through all 148 duplicate rows. Content cannot be
       changed by a storage decision, so this check survives the next cutover.

       CONTENT ALONE IS NOT ENOUGH, and the first version of this check learned
       that in one run: it reported 40 surplus rows across 31 groups on a table
       that was clean. Zerodha slices an order into separate fills, so "1 share
       of GVT&D sold at 2050.55 on 2025-01-01" legitimately appears four times —
       four distinct broker trade_ids, four real trades. A check that is red on
       day one for correct data is the alert you learn to silence: the same
       failure as a rotten threshold, reached faster.

       So surplus counts only what cannot be a distinct fill:
         * the same broker trade_id on file more than once — the 144-row bug,
           one fill written under two dedup keyspaces. Unambiguous; the broker
           issued that id exactly once.
         * a keyless row whose content is already in the group. If the group has
           keyed rows, every keyless row in it is a re-import of one (ids
           2711-2714); if it has none, all but one are surplus.

       Proven against both historical shapes injected into the aggregation:
       0 on the live table, and it reports them when either is present.

       The residual false positive is a broker that ships no trade_id AND
       genuinely slices fills — 5paisa, three rows today. Accepted: a false
       positive costs a minute of looking; the false negative doubled a position
       and was caught only because Deb asked.

    2. HELD POSITIONS ARE ACCOUNTED FOR — a partition, asserted at zero on the
       residual bucket only.

       Every mapped, non-derived holding lands in exactly one of:
         has_trades      — transactions exist for the symbol
         broker_silent   — the symbol has none AND its broker has uploaded no
                           tradebook at all. Explained, not a defect: holdings
                           and tradebooks are separate uploads, and a holdings
                           import creates zero transactions by design.
         broker_partial  — the symbol has none but its broker HAS transactions.
                           This is the interesting bucket: it means a tradebook
                           was uploaded and does not cover everything held
                           there, so the anchor for those rows is a tracked-since
                           proxy and nothing will ever fix it but a wider export.
         unclassified    — impossible by construction; if it is ever non-zero
                           the classifier has drifted from the schema.

       Only `unclassified` fails. The other three are levels, and this module's
       whole thesis is that levels get judged by a human and thresholds rot.
    """
    out: list[CoverageResult] = []
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT COUNT(*) FILTER (WHERE surplus > 0)::int AS groups,
                   COALESCE(SUM(surplus), 0)::int AS extra
              FROM (
                SELECT (COUNT(*) FILTER (WHERE trade_id IS NOT NULL AND trade_id <> '')
                        - COUNT(DISTINCT NULLIF(trade_id, '')))
                       + GREATEST(COUNT(*) FILTER (WHERE trade_id IS NULL OR trade_id = '')
                                  - CASE WHEN COUNT(DISTINCT NULLIF(trade_id, '')) = 0
                                         THEN 1 ELSE 0 END, 0) AS surplus
                  FROM app.portfolio_transaction
                 GROUP BY user_id, broker, trade_date, symbol, side,
                          ROUND(quantity::numeric, 4), ROUND(price::numeric, 2)
              ) d
            """
        )
        dup = cur.fetchone()

        cur.execute(
            """
            WITH held AS (
              SELECT DISTINCT h.user_id, h.broker, h.symbol
                FROM app.portfolio_holding h
               WHERE h.is_mapped AND h.broker <> 'derived' AND h.symbol IS NOT NULL
            ),
            broker_has_trades AS (
              SELECT DISTINCT user_id, broker FROM app.portfolio_transaction
            )
            SELECT CASE
                     WHEN EXISTS (SELECT 1 FROM app.portfolio_transaction t
                                   WHERE t.user_id = held.user_id AND t.symbol = held.symbol)
                       THEN 'has_trades'
                     WHEN NOT EXISTS (SELECT 1 FROM broker_has_trades b
                                       WHERE b.user_id = held.user_id AND b.broker = held.broker)
                       THEN 'broker_silent'
                     WHEN held.broker IS NOT NULL THEN 'broker_partial'
                     ELSE 'unclassified'
                   END AS bucket,
                   COUNT(*)::int AS n
              FROM held GROUP BY 1
            """
        )
        buckets = {r["bucket"]: r["n"] for r in cur.fetchall()}

    extra = dup["extra"] if dup else 0
    groups = dup["groups"] if dup else 0
    out.append(CoverageResult(
        name="portfolio.no_duplicate_trades",
        passed=(extra == 0),
        message=(f"{extra} surplus row(s) across {groups} content group(s)"
                 + ("" if extra == 0
                    else " — a fill is on file more than once; the position is overstated")),
    ))

    total = sum(buckets.values())
    unclassified = buckets.get("unclassified", 0)
    out.append(CoverageResult(
        name="portfolio.holdings_accounted_for",
        passed=(unclassified == 0),
        message=(
            f"{total} mapped holding(s): "
            f"{buckets.get('has_trades', 0)} with trades, "
            f"{buckets.get('broker_silent', 0)} awaiting a first tradebook, "
            f"{buckets.get('broker_partial', 0)} beyond their tradebook's window"
            + ("" if unclassified == 0
               else f", {unclassified} UNCLASSIFIED — the classifier has drifted")
        ),
    ))
    return out


def check_evidence_sheets(
    conn: psycopg.Connection,
    snapshot_date: date,
) -> list[CoverageResult]:
    """Invariants over app.stock_evidence_sheet (migration 0088).

    A sheet is not maintained, it is REBUILT — that is the only thing it has
    that a hand-written verdict does not, and these two assertions are what
    turn that sentence from an intention into a property. Both are phrased so
    they CAN fail; §5's "checks that cannot fail" is the specific trap here,
    because the obvious phrasings of both are vacuous.

    1. STALENESS, ON THE NEWEST SHEET PER SYMBOL.

       The table is append-only, so older rows legitimately carry older
       snapshot dates — that history is the point. "Every row behind the newest
       snapshot" would therefore be red by the table's own design, growing
       monotonically with every rebuild, which is the alert you learn to
       silence. The newest sheet per symbol is the one that renders, so it is
       the one that has to be current.

       Counted, never sampled. One fresh row proves nothing about the other
       2,772, and a sampled staleness check is how 379 drifting verdicts went
       unnoticed.

    2. COVERAGE, WITH A DENOMINATOR THAT CAN BE SHORT.

       The vacuous phrasing is "of the symbols that have a sheet, how many have
       a current sheet" — always 100%, the same mistake as a DQ assertion that
       starts FROM app.scores. The denominator here is every SCORED symbol with
       no hand-written verdict: the population a sheet exists for.

       SCOPED TO THE CLUSTER x MATURITY_TIER PAIRS THE BACKFILL HAS REACHED, which is a deliberate
       departure from PLAN-sheet-main-session.md. The plan wanted the whole
       universe in the denominator so the check stays red until the backfill
       finishes. That is a check that is red on day one for correct data, and
       this file already records what that costs — the first duplicate-trade
       check reported 40 surplus rows on a clean table and the lesson was that
       such an alert gets silenced along with the one that matters. Scoping to
       started clusters keeps the teeth where they bite: the day a cluster is
       backfilled and a NEWLY SCORED symbol in it never gets a sheet, this goes
       red, which is the §5 failure (seeded once, maintained by nothing) in its
       exact form. The unstarted backlog is still reported — as a number to
       work through, not as a failure.

    Both SKIP, visibly, while the table is empty. A green tick over zero rows
    is the comfortable untruth CoverageResult.skipped exists for.
    """
    out: list[CoverageResult] = []
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM app.stock_evidence_sheet")
        total = cur.fetchone()["n"]

    if total == 0:
        return [CoverageResult(
            name="coverage.evidence_sheets",
            passed=True,
            skipped=True,
            message="SKIPPED — no sheets loaded yet; both assertions arm with "
                    "the first cluster backfilled",
        )]

    with conn.cursor() as cur:
        # Newest sheet per symbol, and whether its snapshot is the current one.
        cur.execute(
            """WITH newest AS (
                 SELECT DISTINCT ON (symbol) symbol, snapshot_date
                   FROM app.stock_evidence_sheet
                  ORDER BY symbol, generated_at DESC
               )
               SELECT count(*) AS n,
                      count(*) FILTER (WHERE snapshot_date < %s) AS stale,
                      min(snapshot_date) AS oldest
                 FROM newest""",
            (snapshot_date,),
        )
        r = cur.fetchone()
        n_sheets, stale, oldest = r["n"], r["stale"], r["oldest"]

        # The population a sheet is FOR: scored at this snapshot, no verdict.
        # The verdict side is EXISTS on the symbol rather than on a date — one
        # verdict ever written means the stock page renders prose, so a sheet
        # for it would never be seen.
        cur.execute(
            """WITH eligible AS (
                 SELECT s.symbol, s.cluster_id, s.maturity_tier
                   FROM app.scores s
                  WHERE s.snapshot_date = %s
                    AND NOT EXISTS (SELECT 1 FROM app.stock_verdict v
                                     WHERE v.symbol = s.symbol)
               ),
               newest AS (
                 SELECT DISTINCT ON (symbol) symbol, snapshot_date
                   FROM app.stock_evidence_sheet
                  ORDER BY symbol, generated_at DESC
               ),
               started AS (
                 SELECT DISTINCT e.cluster_id, e.maturity_tier
                   FROM eligible e JOIN newest sh ON sh.symbol = e.symbol
               ),
               scoped AS (
                 SELECT e.symbol, sh.symbol AS sheet,
                        (st.cluster_id IS NOT NULL) AS in_scope
                   FROM eligible e
                   LEFT JOIN newest sh ON sh.symbol = e.symbol
                   LEFT JOIN started st
                          ON st.cluster_id = e.cluster_id
                         AND st.maturity_tier IS NOT DISTINCT FROM e.maturity_tier
               )
               SELECT count(*) FILTER (WHERE in_scope) AS in_scope,
                      count(*) FILTER (WHERE in_scope AND sheet IS NULL)
                        AS missing_in_scope,
                      count(*) FILTER (WHERE sheet IS NULL) AS missing_total,
                      (SELECT count(*) FROM started) AS n_started
                 FROM scoped""",
            (snapshot_date,),
        )
        c = cur.fetchone()

    out.append(CoverageResult(
        name="coverage.evidence_sheets_current",
        passed=(stale == 0),
        message=(f"{n_sheets} symbol(s) with a sheet, all on {snapshot_date}"
                 if stale == 0 else
                 f"{stale} of {n_sheets} newest sheet(s) behind {snapshot_date} "
                 f"(oldest {oldest}) — nothing rebuilt them, so the figures "
                 f"shown are from a prior snapshot"),
    ))
    out.append(CoverageResult(
        name="coverage.evidence_sheets_complete",
        passed=(c["missing_in_scope"] == 0),
        message=(f"{c['in_scope'] - c['missing_in_scope']}/{c['in_scope']} "
                 f"eligible symbol(s) covered across {c['n_started']} started "
                 f"cluster-tier(s); {c['missing_total']} eligible symbol(s) not "
                 f"yet reached"
                 + ("" if c["missing_in_scope"] == 0 else
                    f" — {c['missing_in_scope']} symbol(s) in a cluster-tier "
                    f"that WAS backfilled have no sheet, so the backfill is no "
                    f"longer keeping up with the universe")),
    ))
    return out
