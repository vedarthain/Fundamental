"""Data-quality assertions.

Catches regressions where a parser change, schema migration, or ETL bug
silently leaves critical columns mostly-NULL.  We discovered the
operating_profit-NULL bug (all 19,873 fundamentals_annual rows) only
when a user spotted blank columns on a stock page — these checks would
have caught it at the source.

Each assertion is a simple "≥ X% of rows in scope have a non-null value
for column Y".  Thresholds were calibrated against the current healthy
state of the DB; if they trip in the future, either the data is broken
OR the threshold needs updating (decide explicitly).

This module is callable from two places:
  1. cli.score_cmd       — at the end of every weekly score run, logs
                           warnings via structlog.  Doesn't block.
  2. scripts/check-dq.py — standalone, prints human-readable summary,
                           exits non-zero on any failure (for cron/CI).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import psycopg
from psycopg.rows import dict_row


@dataclass
class AssertionResult:
    name: str            # short identifier, e.g. "fundamentals_annual.operating_profit"
    passed: bool
    actual_pct: float    # 0-100 (or row count when shape="count")
    threshold_pct: float
    populated: int       # numerator
    total: int           # denominator
    shape: str = "pct"   # "pct" or "count"

    def short(self) -> str:
        """One-line human-readable summary."""
        icon = "✓" if self.passed else "✗"
        if self.shape == "count":
            return (
                f"{icon} {self.name:<55} {self.total} rows "
                f"(expected ≥ {int(self.threshold_pct)})"
            )
        if self.shape == "count_max":
            return (
                f"{icon} {self.name:<55} {self.total} rows "
                f"(expected ≤ {int(self.threshold_pct)})"
            )
        return (
            f"{icon} {self.name:<55} {self.actual_pct:5.1f}% "
            f"({self.populated}/{self.total}, threshold ≥ {self.threshold_pct}%)"
        )


# ── Assertion definitions ────────────────────────────────────────────────────
#
# Each entry is one assertion.  The function below dispatches each to the
# appropriate runner (pct of NOT NULL, or row count above a floor).
#
# Thresholds calibrated 2026-05-22 against the current healthy DB:
#   fundamentals_annual.sales              ≈ 95% populated
#   fundamentals_annual.operating_profit   ≈ 90% populated (post-fix)
#   fundamentals_quarterly.sales           ≈ 95% populated
#   scores (latest snapshot)               ≈ 100% populated
#   screener_meta (active universe)        ≈ 100% populated
#
# Set thresholds with margin: aim for "would catch a 20pp regression but
# not flake on normal variance".
_PCT_ASSERTIONS = [
    # Annual fundamentals — covers the core P&L + balance sheet rows we
    # surface on stock pages and use in the scorer.
    # Scope: last 5 years of period_end so we don't include ancient/sparse
    # historical rows that drag the ratio down.
    ("fundamentals_annual.sales",            "app.fundamentals_annual",
        "period_end >= CURRENT_DATE - INTERVAL '5 years'",  "sales",            70.0),
    ("fundamentals_annual.operating_profit", "app.fundamentals_annual",
        "period_end >= CURRENT_DATE - INTERVAL '5 years'",  "operating_profit", 70.0),
    ("fundamentals_annual.net_profit",       "app.fundamentals_annual",
        "period_end >= CURRENT_DATE - INTERVAL '5 years'",  "net_profit",       70.0),
    ("fundamentals_annual.equity_share_capital",  "app.fundamentals_annual",
        "period_end >= CURRENT_DATE - INTERVAL '5 years'",  "equity_share_capital", 70.0),
    ("fundamentals_annual.no_of_equity_shares",   "app.fundamentals_annual",
        "period_end >= CURRENT_DATE - INTERVAL '5 years'",  "no_of_equity_shares",  70.0),

    # Quarterly fundamentals
    ("fundamentals_quarterly.sales",            "app.fundamentals_quarterly",
        "period_end >= CURRENT_DATE - INTERVAL '2 years'",  "sales",            70.0),
    ("fundamentals_quarterly.operating_profit", "app.fundamentals_quarterly",
        "period_end >= CURRENT_DATE - INTERVAL '2 years'",  "operating_profit", 70.0),
    ("fundamentals_quarterly.net_profit",       "app.fundamentals_quarterly",
        "period_end >= CURRENT_DATE - INTERVAL '2 years'",  "net_profit",       70.0),

    # Scores at the latest snapshot — should be essentially complete.
    #
    # THESE FOUR HAD THE SURVIVOR BUG, in the same shape the screener_meta note
    # below describes. `FROM app.scores WHERE snapshot_date = MAX(...)` counts
    # only symbols that GOT a score row. A symbol the scorer never reached has
    # no row at all, so it never enters the denominator — the check asked "of
    # the stocks we scored, how many did we score?" and the answer is always
    # ~100%. Scoring could have silently dropped a third of the universe and
    # every one of these would still have reported green.
    #
    # Anchored on app.universe with a LEFT JOIN, a missing score row now counts
    # as a missing value, which is what it is.
    ("scores.composite_pct (active)",
        "app.universe u LEFT JOIN app.scores s ON s.symbol = u.symbol "
        "AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)",
        "u.is_active",                                       "composite_pct",  90.0),
    ("scores.quality_pct (active)",
        "app.universe u LEFT JOIN app.scores s ON s.symbol = u.symbol "
        "AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)",
        "u.is_active",                                       "quality_pct",    90.0),
    ("scores.valuation_pct (active)",
        "app.universe u LEFT JOIN app.scores s ON s.symbol = u.symbol "
        "AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)",
        "u.is_active",                                       "valuation_pct",  90.0),
    ("scores.momentum_pct (active)",
        "app.universe u LEFT JOIN app.scores s ON s.symbol = u.symbol "
        "AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)",
        "u.is_active",                                       "momentum_pct",   90.0),

    # Screener meta — required for the LTP + market cap on cards.
    #
    # THE JOIN DIRECTION HERE IS THE WHOLE POINT. These two were
    #     app.screener_meta sm JOIN app.universe u USING (symbol)
    # an INNER JOIN, which silently made them unable to fail. 472 active symbols
    # had no screener_meta row at all, so the inner join dropped them BEFORE the
    # percentage was computed: the denominator was 2,150 instead of 2,622 and
    # these assertions reported 99.8% every week while true coverage was 81.8%.
    #
    # A coverage check must start at the source of truth (app.universe) and LEFT
    # JOIN outward, so a missing row counts as missing instead of vanishing from
    # the population. If you add an assertion here, start its FROM at
    # app.universe or it is not measuring coverage — it is measuring survivors.
    ("screener_meta.market_cap_cr (active)",
        "app.universe u LEFT JOIN app.screener_meta sm USING (symbol)",
        "u.is_active",                                       "market_cap_cr",   90.0),
    ("screener_meta.current_price (active)",
        "app.universe u LEFT JOIN app.screener_meta sm USING (symbol)",
        "u.is_active",                                       "current_price",   90.0),
]

# Row-count assertions — sanity checks that the materialised caches
# actually populated for the latest snapshot.  Catches the case where
# score_snapshot ran but a refresher silently failed.
_COUNT_ASSERTIONS = [
    # (name, table, where, minimum_row_count)
    ("cluster_composite_cache (latest snapshot)",
        "app.cluster_composite_cache",
        "snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", 30),
    ("cluster_stocks_panel_cache (latest snapshot)",
        "app.cluster_stocks_panel_cache",
        "snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", 2000),
]


# Upper-bound count assertions — fail when a count EXCEEDS a ceiling (the
# OPPOSITE direction of _COUNT_ASSERTIONS above, which fails when a count falls
# below a floor). For failure modes that should stay small.
#
# DELIBERATELY EMPTY. Read this before adding an entry.
#
# This list held exactly one assertion, "screener_export_stale_financials
# (price-fresh)": symbols Screener returns with a CURRENT price but STALE
# financials, which the scorer's 15-month gate then drops from the scored
# universe. It was written with baseline 25 / ceiling 40 so a "~1.6x jump"
# would fire.
#
# It never fired, and it could not have. A ceiling drawn around a known defect
# cohort is a thermostat, not an alarm: it encodes "25 broken symbols is the
# normal operating temperature" and then reports green for as long as the
# breakage stays the size it was on the day someone measured it. The 23 stale
# names sat under that ceiling for months while the weekly report said PASS.
#
# The same cohort is now a named bucket in app.coverage_ledger
# ('gated_stale_financials', see coverage.py). That replacement is strictly
# better in three ways and involves no tuned number:
#   • the bucket is part of an exhaustive partition, so the symbols are counted
#     whether or not anyone anticipated their failure mode;
#   • check_no_regression fails on week-over-week GROWTH, so a systemic Screener
#     regression is caught at +1, not at +15;
#   • the per-symbol rows are retained, so "which names and since when" is a
#     query instead of an investigation.
#
# If you are about to add a ceiling here, first check whether the thing you want
# to bound is a coverage bucket. If it is, put it in coverage.py where zero is
# the assertion and the delta is the alarm. A ceiling is only defensible for a
# quantity with no healthy value of zero — and there is no such quantity in this
# module today, which is why the list is empty.
_MAX_COUNT_ASSERTIONS: list[tuple[str, str, int]] = []


def _run_pct(conn, name, table_clause, where_clause, column, threshold) -> AssertionResult:
    # Force dict_row at the cursor level so this module works regardless of
    # the caller's default row factory (cli.py uses dict_row via app_conn();
    # scripts/check-dq.py uses the psycopg default tuple_row).
    with conn.cursor(row_factory=dict_row) as cur:
        # SQL identifiers (table, column, where) are NOT parameterised here —
        # this module is internal and the inputs come from the constants
        # defined above, never from user input.  Using f-string interpolation
        # keeps the queries readable without taking on injection risk.
        cur.execute(f"""
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE {column} IS NOT NULL)::int AS populated
              FROM {table_clause}
             WHERE {where_clause}
        """)
        row = cur.fetchone()
    total = (row["total"] or 0) if row else 0
    populated = (row["populated"] or 0) if row else 0
    pct = (100.0 * populated / total) if total > 0 else 0.0
    return AssertionResult(
        name=name,
        passed=(total > 0 and pct >= threshold),
        actual_pct=pct,
        threshold_pct=threshold,
        populated=populated,
        total=total,
        shape="pct",
    )


def _run_count(conn, name, table, where_clause, minimum) -> AssertionResult:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT COUNT(*)::int AS n FROM {table} WHERE {where_clause}")
        row = cur.fetchone()
    n = (row["n"] or 0) if row else 0
    return AssertionResult(
        name=name,
        passed=(n >= minimum),
        actual_pct=float(n),
        threshold_pct=float(minimum),
        populated=n,
        total=n,
        shape="count",
    )


def _run_max_count(conn, name, sql, maximum) -> AssertionResult:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        row = cur.fetchone()
    n = (row["n"] or 0) if row else 0
    return AssertionResult(
        name=name,
        passed=(n <= maximum),
        actual_pct=float(n),
        threshold_pct=float(maximum),
        populated=n,
        total=n,
        shape="count_max",
    )


# ── Golden price-feed assertions ─────────────────────────────────────────────
#
# golden.price_history is the read-only upstream EOD mirror — it is NOT written
# by this repo (the bhav-copy import lives upstream). The failure mode this
# guards against: the bhav import "passes" (exit 0) but zero stocks actually
# updated — an empty/short file parsed to 0 rows, a rolled-back transaction, an
# ON CONFLICT DO NOTHING re-run that touched nothing, or a wrong-date write.
# Every one of those leaves MAX(date) stuck, and every app.* check above would
# sail straight past it.
#
# All three checks measure STATE, never rows-affected — an upsert-do-nothing
# re-run reports "success, 0 rows touched", indistinguishable from a real
# no-op unless you look at what's actually present:
#   1. freshness — the newest 1d bar is within N calendar days of today.
#                  Catches every silent no-op (max-date can't advance).
#   2. coverage  — the whole liquid universe landed on that newest bar, not a
#                  truncated slice.
#   3. sentinels — a handful of always-liquid large caps carry a real (>0)
#                  close, catching "rows present but null/zero prices".
#
# Requires a golden_db connection (a separate DB from app), so these live in a
# dedicated runner rather than the app-only run_assertions above.

_GOLDEN_FRESHNESS_MAX_DAYS = 4   # tolerates a long weekend / a single holiday
_GOLDEN_COVERAGE_MIN = 1500      # ~1900 liquid NSE symbols on a normal session
_GOLDEN_SENTINELS = (
    "RELIANCE.NS", "HDFCBANK.NS", "TCS.NS", "INFY.NS", "ICICIBANK.NS",
)


def run_golden_assertions(golden: psycopg.Connection) -> list[AssertionResult]:
    """Freshness / coverage / sanity checks on the golden EOD price feed.

    Requires a golden_db connection. Never raises on empty data — an empty or
    stuck feed simply FAILS the checks loudly (which is the whole point).
    """
    out: list[AssertionResult] = []
    with golden.cursor(row_factory=dict_row) as cur:
        # 1. Feed freshness — calendar days behind today. count_max: fail if the
        #    newest bar is more than the ceiling of days old. A stuck feed (the
        #    "0 stocks updated" no-op, repeated across sessions) trips this.
        cur.execute(
            """
            SELECT COALESCE(CURRENT_DATE - MAX(date), 99999)::int AS n
              FROM golden.price_history WHERE interval = '1d'
            """
        )
        days_behind = (cur.fetchone() or {}).get("n") or 99999
        out.append(AssertionResult(
            name="golden.price_feed_days_behind",
            passed=(days_behind <= _GOLDEN_FRESHNESS_MAX_DAYS),
            actual_pct=float(days_behind),
            threshold_pct=float(_GOLDEN_FRESHNESS_MAX_DAYS),
            populated=days_behind, total=days_behind, shape="count_max",
        ))

        # 2. Coverage — distinct symbols on the newest bar. count: fail below a
        #    floor. Catches a partial import (file truncated, only N symbols).
        cur.execute(
            """
            SELECT COUNT(DISTINCT symbol)::int AS n
              FROM golden.price_history
             WHERE interval = '1d'
               AND date = (SELECT MAX(date) FROM golden.price_history WHERE interval = '1d')
            """
        )
        cov = (cur.fetchone() or {}).get("n") or 0
        out.append(AssertionResult(
            name="golden.latest_bar_symbol_coverage",
            passed=(cov >= _GOLDEN_COVERAGE_MIN),
            actual_pct=float(cov),
            threshold_pct=float(_GOLDEN_COVERAGE_MIN),
            populated=cov, total=cov, shape="count",
        ))

        # 3. Sentinels — always-liquid large caps with a real (>0) close on the
        #    newest bar. Catches "rows landed but prices are null/zero" (garbage
        #    file), which the count checks above would happily pass.
        cur.execute(
            """
            SELECT COUNT(DISTINCT symbol)::int AS n
              FROM golden.price_history
             WHERE interval = '1d'
               AND date = (SELECT MAX(date) FROM golden.price_history WHERE interval = '1d')
               AND COALESCE(adj_close, close) > 0
               AND symbol = ANY(%s)
            """,
            (list(_GOLDEN_SENTINELS),),
        )
        hits = (cur.fetchone() or {}).get("n") or 0
        out.append(AssertionResult(
            name="golden.sentinel_largecaps_priced",
            passed=(hits >= len(_GOLDEN_SENTINELS)),
            actual_pct=float(hits),
            threshold_pct=float(len(_GOLDEN_SENTINELS)),
            populated=hits, total=hits, shape="count",
        ))
    return out


def run_assertions(conn: psycopg.Connection) -> list[AssertionResult]:
    """Run all DQ assertions against the given app DB connection.

    Returns the full list of results (passing AND failing) so callers can
    decide what to do — log them all, only warn on failures, exit non-zero, etc.
    """
    out: list[AssertionResult] = []
    for name, table, where, col, threshold in _PCT_ASSERTIONS:
        out.append(_run_pct(conn, name, table, where, col, threshold))
    for name, table, where, minimum in _COUNT_ASSERTIONS:
        out.append(_run_count(conn, name, table, where, minimum))
    for name, sql, maximum in _MAX_COUNT_ASSERTIONS:
        out.append(_run_max_count(conn, name, sql, maximum))
    return out


# ── Portfolio anchor assertions ──────────────────────────────────────────────
#
# THE BUG THIS EXISTS FOR
#
# The watchlist chart draws a green "B" marker for every held name and captions
# it "Bought <qty> @ ₹<avg cost> · <date>". The quantity and cost come from
# app.portfolio_holding (what you hold today); the DATE came from the trade log.
# For KARURVYSYA the caption read "Bought 45 @ ₹346 · 02 Jun 2025" — a lot that
# was bought in SEPTEMBER 2026, stamped with the date of a position that had
# been sold out entirely in February 2026. The marker landed on the chart at
# ₹168, fifteen months before the purchase it described.
#
# It was found by a human looking at a chart and saying "that doesn't match".
# 36 held symbols were affected. Nothing in the codebase could have told him.
#
# WHY NO EXISTING CHECK CAUGHT IT
#
# Every check in this file asks "is this column populated?". The column WAS
# populated. It held a real date, of a real trade, for the right symbol — just
# not the trade the rest of the sentence was about. Null-rate assertions are
# structurally blind to a value that is present and wrong, and that is the
# larger share of the bugs this platform has actually shipped.
#
# THE CHECK
#
# A date and a price that claim to describe the same purchase must agree with
# the market. Take each held position's average cost and the anchor date shown
# beside it, look up what the stock actually traded at on that date, and assert
# they are within a factor. They cannot drift far apart for any innocent reason:
#
#   • wrong leg (the bug above)        → cost and price are years apart
#   • unadjusted split/bonus           → off by exactly the ratio
#   • wrong symbol after a rename      → off by anything
#   • stale or unadjusted avg_cost     → off in one direction
#
# Note what it does NOT do: it never recomputes the anchor with the same leg
# logic the app uses. A check that re-implements the thing it is testing agrees
# with the bug. This one asks the market instead, which has no opinion about
# our code.
#
# THE TOLERANCE
#
# 1.5× — and the number matters more than it looks, because the first attempt
# at this check got it wrong in exactly the way §5 of CLAUDE.md warns about.
#
# 2.0× was picked by intuition and felt safely loose. Then the ratios were
# measured. KARURVYSYA — the bug this whole check exists for — is ₹346 average
# cost against a ₹197.7 close on the date it wrongly displayed: **1.75×**. The
# tripwire would have sat underneath the very thing it was written to catch and
# reported a green tick. A check that cannot fail on its own originating bug is
# decoration.
#
# The distribution over the live portfolio decides it. Old (buggy) anchors:
#   >1.25× 12   >1.4× 6   >1.5× 5   >1.75× 2   >2.0× 2
# Fixed anchors:
#   >1.25×  5   >1.4× 2   >1.5× 1   >1.75× 1   >2.0× 1
# 1.5× is where the two distributions separate: it catches all five pre-fix
# outliers (NATIONALUM 2.66, GODFRYPHLP 2.50, KARURVYSYA 1.75, BSOFT 1.64,
# LLOYDSME 1.62) and leaves exactly one survivor after the fix. Going tighter
# (1.4×) pulls in MUTHOOTFIN and MCX, which are merely mediocre entries — and a
# check that cries wolf gets ignored, which is the only way a check truly dies.
#
# The single survivor is GODFRYPHLP, and it is real rather than noise: it is
# held via shares that predate the tradebook, so its anchor genuinely belongs to
# a leg that does not contain the shares on the screen. The ceiling below is set
# to today's count so any NEW one fails immediately; lowering it to 0 once that
# position is reconciled is the intended maintenance, not a TODO to forget.
_PORTFOLIO_ANCHOR_MAX_RATIO = 1.5
_PORTFOLIO_ANCHOR_MAX_BAD = 1


def run_portfolio_assertions(
    app: psycopg.Connection, golden: psycopg.Connection
) -> list[AssertionResult]:
    """Assert that every displayed buy anchor agrees with the market price on
    the date it claims. Needs BOTH connections — the anchors live in app, the
    prices in golden — so this cannot be one SQL statement and does not try."""
    # Anchor per held symbol, computed EXACTLY as the app displays it (first
    # buy of the current leg). The point is to test the number on the screen,
    # not an idealised one.
    with app.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            WITH daily AS (
              SELECT user_id, symbol, trade_date,
                     SUM(CASE WHEN side='buy' THEN quantity ELSE -quantity END) AS net
                FROM app.portfolio_transaction
               WHERE symbol IS NOT NULL
               GROUP BY 1,2,3
            ),
            running AS (
              SELECT user_id, symbol, trade_date,
                     SUM(net) OVER (PARTITION BY user_id, symbol ORDER BY trade_date) AS bal
                FROM daily
            ),
            base AS (
              SELECT user_id, symbol, GREATEST(0, -MIN(bal)) AS qty0
                FROM running GROUP BY 1,2
            ),
            adj AS (
              SELECT r.user_id, r.symbol, r.trade_date, r.bal + b.qty0 AS bal
                FROM running r JOIN base b USING (user_id, symbol)
            ),
            legs AS (
              SELECT user_id, symbol, trade_date,
                     COALESCE(SUM(CASE WHEN bal <= 0.000001 THEN 1 ELSE 0 END) OVER (
                       PARTITION BY user_id, symbol ORDER BY trade_date
                       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS leg
                FROM adj
            ),
            cur_leg AS (SELECT user_id, symbol, MAX(leg) AS leg FROM legs GROUP BY 1,2),
            anchor AS (
              SELECT t.user_id, t.symbol, MIN(t.trade_date) AS d
                FROM app.portfolio_transaction t
                JOIN legs l     ON l.user_id=t.user_id AND l.symbol=t.symbol
                                AND l.trade_date=t.trade_date
                JOIN cur_leg c  ON c.user_id=t.user_id AND c.symbol=t.symbol AND c.leg=l.leg
               WHERE t.symbol IS NOT NULL AND t.side='buy'
               GROUP BY 1,2
            ),
            held AS (
              SELECT user_id, symbol, SUM(quantity) AS q,
                     SUM(quantity*avg_cost)/NULLIF(SUM(quantity),0) AS avg_cost
                FROM app.portfolio_holding
               WHERE symbol IS NOT NULL
               GROUP BY 1,2
            )
            SELECT h.symbol, h.avg_cost::float8 AS avg_cost, a.d::text AS d
              FROM held h JOIN anchor a USING (user_id, symbol)
             WHERE h.q > 0 AND h.avg_cost > 0
            """
        )
        anchors = cur.fetchall()

    bad = 0
    with golden.cursor(row_factory=dict_row) as gcur:
        for row in anchors:
            gcur.execute(
                """
                SELECT close::float8 AS c
                  FROM golden.price_history_1d
                 WHERE symbol = %s AND date <= %s AND close > 0
                 ORDER BY date DESC LIMIT 1
                """,
                (f"{row['symbol']}.NS", row["d"]),
            )
            p = gcur.fetchone()
            # No bar on or before the anchor is NOT a pass and NOT a failure of
            # this check — it is a price-coverage gap, which the golden
            # freshness/coverage assertions above are responsible for. Counting
            # it here would let a missing price silently satisfy a price check.
            if not p or not p["c"]:
                continue
            ratio = max(p["c"] / row["avg_cost"], row["avg_cost"] / p["c"])
            if ratio > _PORTFOLIO_ANCHOR_MAX_RATIO:
                bad += 1

    return [
        AssertionResult(
            name="portfolio.buy_anchor_matches_market_price",
            passed=(bad <= _PORTFOLIO_ANCHOR_MAX_BAD),
            actual_pct=float(bad),
            threshold_pct=float(_PORTFOLIO_ANCHOR_MAX_BAD),
            populated=bad,
            total=bad,
            shape="count_max",
        )
    ]


def summarize(results: list[AssertionResult]) -> tuple[int, int]:
    """Return (passed_count, failed_count)."""
    passed = sum(1 for r in results if r.passed)
    return passed, len(results) - passed
