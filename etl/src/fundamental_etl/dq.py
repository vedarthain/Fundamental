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
    return out


def summarize(results: list[AssertionResult]) -> tuple[int, int]:
    """Return (passed_count, failed_count)."""
    passed = sum(1 for r in results if r.passed)
    return passed, len(results) - passed
