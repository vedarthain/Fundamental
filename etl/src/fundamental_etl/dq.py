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
    ("scores.composite_pct",  "app.scores",
        "snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", "composite_pct",  90.0),
    ("scores.quality_pct",    "app.scores",
        "snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", "quality_pct",    90.0),
    ("scores.valuation_pct",  "app.scores",
        "snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", "valuation_pct",  90.0),
    ("scores.momentum_pct",   "app.scores",
        "snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)", "momentum_pct",   90.0),

    # Screener meta — required for the LTP + market cap on cards.
    ("screener_meta.market_cap_cr (active)", "app.screener_meta sm JOIN app.universe u USING (symbol)",
        "u.is_active",                                       "market_cap_cr",   90.0),
    ("screener_meta.current_price (active)", "app.screener_meta sm JOIN app.universe u USING (symbol)",
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
_MAX_COUNT_ASSERTIONS = [
    # (name, sql_returning_single_int_column_n, maximum)
    #
    # Screener-export warehouse lag: names Screener returns with a CURRENT price
    # (freshly fetched, last_status='ok') but STALE financials — its downloadable
    # xlsx export lags its own live company page. The scorer's 15-month freshness
    # gate (see scoring/metrics.py: (snapshot - freshest_period_end).days > 458)
    # then correctly drops these from the scored universe, silently shrinking
    # "All stocks". This watches the size of that cohort so a systemic Screener
    # regression (or a fetch bug reintroducing stale content) is caught loudly
    # instead of surfacing months later as an unexplained coverage gap.
    #
    # Baseline was 25 on 2026-08-19 (JYOTHYLAB, MANYAVAR, HDBFS, SBFC, CAMPUS,
    # KENNAMET, …). Ceiling 40 catches a ~1.6x jump without flaking on the normal
    # churn of a few names sliding in/out around FY-result season.
    ("screener_export_stale_financials (price-fresh)",
        """
        SELECT COUNT(*)::int AS n
          FROM app.universe u
          JOIN app.screener_meta sm USING (symbol)
         WHERE u.is_active
           AND sm.current_price IS NOT NULL
           AND sm.last_status = 'ok'
           AND sm.last_scraped_at >= NOW() - INTERVAL '10 days'
           AND GREATEST(
                 COALESCE((SELECT MAX(period_end) FROM app.fundamentals_annual a
                            WHERE a.symbol = u.symbol), DATE '1900-01-01'),
                 COALESCE((SELECT MAX(period_end) FROM app.fundamentals_quarterly q
                            WHERE q.symbol = u.symbol), DATE '1900-01-01')
               ) < CURRENT_DATE - INTERVAL '15 months'
        """,
        40),
]


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


def summarize(results: list[AssertionResult]) -> tuple[int, int]:
    """Return (passed_count, failed_count)."""
    passed = sum(1 for r in results if r.passed)
    return passed, len(results) - passed
