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

    # ADVISORY — reported, never fatal.
    #
    # An assertion is advisory when the condition it detects is real and worth
    # seeing, but is resolved by a HUMAN decision rather than by a pipeline
    # rerun. Making such a check fatal does not speed up the decision; it just
    # exits 1, and on 2026-10-04 an exit 1 after a completed scoring run skipped
    # the snapshot rebuild and the cache purge, leaving 479 freshly scored
    # symbols off the site. The check was right and the blast radius was wrong.
    #
    # This is NOT a backdoor for muting inconvenient checks. A data-integrity
    # failure — a column that stopped populating, a feed that went stale, a
    # count that collapsed — means the run's OUTPUT is untrustworthy, and
    # publishing it is the harm. Those stay fatal. Advisory is only for "a
    # person needs to look at this eventually", where the run's output is fine.
    advisory: bool = False

    def short(self) -> str:
        """One-line human-readable summary."""
        icon = "✓" if self.passed else ("!" if self.advisory else "✗")
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
    # SME EXCLUSION — TEMPORARY, AND THE TEMPORARINESS IS ENFORCED BELOW.
    #
    # On 2026-10-04 sync-universe onboarded 475 NSE EMERGE (SME) names in one
    # go. They arrive with no Screener scrape and no price history, so on the
    # morning they land momentum coverage is 9.5% on the SME side and 96.8% on
    # the main board — and the blended figure (83.3%) trips a 90% floor that is
    # measuring onboarding lag, not a defect. That red run cost more than a
    # false alarm: exit 1 skipped the snapshot rebuild and the cache purge, so
    # 479 freshly scored symbols never reached the site.
    #
    # Excluding them is honest — the assertion's job is to catch main-board
    # coverage rotting, and that signal was being swamped. What is NOT honest is
    # an exclusion that outlives its reason, which is exactly §5's "seeded once
    # and nothing maintains it". So the exclusion carries an expiry in code:
    # see sme_momentum_still_absent in _COUNT_ASSERTIONS, which goes RED the
    # moment SME momentum coverage is good enough that this line should be
    # deleted. Do not remove the exclusion without removing that assertion, or
    # the other way round — they are one mechanism.
    #
    # THE EXPIRY WAS KEYED TO THE WRONG COLUMN UNTIL 2026-10-08. It counted
    # active SME rows with no Screener `current_price`, on the assumption that
    # "the SME backfill" was one event. It is not. The Screener price filled in
    # within four days (475/475) while golden.price_history still holds ZERO
    # daily bars for all 475 — and momentum is computed from price history, not
    # from the Screener price. So the tripwire hit 0 against a floor of 48 and
    # was about to go red demanding the deletion of an exclusion that is still
    # completely warranted. A red DQ run is not a harmless false alarm here: it
    # exits 1, which skips the snapshot rebuild and the cache purge, which is
    # how 479 scored symbols failed to reach the site on 2026-10-04.
    #
    # The lesson is narrower than "be careful": an expiry must be keyed to the
    # exact quantity its exclusion hides, not to a proxy that merely arrived at
    # the same time. This one now reads momentum_pct itself.
    ("scores.momentum_pct (active, main board)",
        "app.universe u LEFT JOIN app.scores s ON s.symbol = u.symbol "
        "AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)",
        "u.is_active AND NOT COALESCE(u.is_sme, false)",      "momentum_pct",   90.0),

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
    # THIS ONE HAD AN SME EXCLUSION AND NO LONGER NEEDS IT — 2026-10-08.
    #
    # When the 475 EMERGE names landed on 2026-10-04 they had a market cap and
    # no price, so `NOT COALESCE(u.is_sme, false)` was added here alongside the
    # momentum one. Four days later, measured: SME current_price is 475/475 and
    # the blended figure is 3082/3082 = 100.0%. The exclusion was therefore
    # buying nothing and costing the one thing that matters — 475 symbols whose
    # LTP could go stale without this check noticing. Removed.
    #
    # It is removed SEPARATELY from the momentum exclusion on purpose. The two
    # were added together and read as one decision, but they depend on two
    # unrelated pipelines: this one on the Screener/NSE price write into
    # app.screener_meta, momentum on golden.price_history. The first filled in;
    # the second is still empty (0 bars for all 475). Lifting both because
    # "the SME backfill finished" would have been exactly the cargo-culting the
    # old comment warned about, one level up.
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

    # THE EXPIRY ON THE SME MOMENTUM EXCLUSION. Read the comment on
    # scores.momentum_pct (active, main board) first — including the part about
    # this check having been keyed to the wrong column until 2026-10-08.
    #
    # This is an assertion written to FAIL ON SUCCESS, which is why it looks
    # backwards. It counts active SME symbols that still have no momentum_pct at
    # the latest scores snapshot — the exact population the exclusion one
    # section up removes from the denominator — and demands that count stay at
    # or ABOVE 48 (10% of the 475 onboarded on 2026-10-04). While SME momentum
    # is genuinely absent it passes silently. The moment coverage climbs past
    # 90% this goes RED with a name that says what to do: the exclusion has
    # served its purpose, delete it and delete this.
    #
    # Measured 2026-10-08: 475 of 475, because golden.price_history has zero
    # daily bars for every EMERGE symbol. Momentum cannot populate until the
    # price feed covers them, which is a different pipeline from the Screener
    # scrape that filled current_price — and confusing the two is what broke
    # the previous version of this check.
    #
    # The LEFT JOIN matters: an SME symbol the scorer never reached has no
    # app.scores row at all, and must count as "no momentum" rather than
    # dropping out of the population. Same survivor bug as the pct assertions.
    #
    # Why bother, instead of a note in a doc or a reminder: §5 of CLAUDE.md is
    # about exactly this failure. An exclusion added "temporarily" has no force
    # that removes it; it survives as a permanently blinded check that reports
    # green forever. A TODO cannot fail. This can, and it fails precisely when
    # the reason for the exclusion stops being true, so the assertion gets its
    # 475 symbols back whether or not anyone remembered.
    #
    # It also fails if the SME names are DELISTED or deactivated rather than
    # covered — the count drops below 48 either way. That is correct: in both
    # worlds the exclusion is no longer warranted and should be re-examined.
    ("sme_momentum_still_absent (delete the SME exclusion when this fails)",
        "app.universe u LEFT JOIN app.scores s ON s.symbol = u.symbol "
        "AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)",
        "u.is_active AND COALESCE(u.is_sme, false) AND s.momentum_pct IS NULL", 48),
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
_MAX_COUNT_ASSERTIONS: list[tuple[str, str, int, bool]] = [
    # THE EXPIRY ON THE 'Unclassified' SECTOR BUCKET.
    #
    # classification.py parks symbols Screener has not classified under
    # UNCLASSIFIED_SECTOR rather than leaving sector NULL, because a null
    # vanishes from every aggregate that would have found it. The cost of a
    # named bucket is that it looks settled — a row sitting in a labelled group
    # reads as classified to anyone skimming, and nothing forces it out.
    #
    # This is that force. A brand-new listing with no breadcrumb is NORMAL —
    # Screener classifies these names once they mature, and all three symbols
    # in the bucket on 2026-10-04 (ARMEE, QUALIANCE, GENXAI) listed within four
    # months. So the clock is the symbol's own listing_date, not the run date:
    # the assertion ignores recent listings entirely and fires only on a symbol
    # that is still unclassified 30 days after listing, which is a real hole
    # someone has to resolve by hand.
    #
    # The ceiling is ZERO, which is why this does not contradict the argument
    # above. The objection there is to NONZERO ceilings: a ceiling of 25 encodes
    # "25 broken rows is the normal operating temperature" and reports green for
    # as long as the breakage stays the size it was when someone measured it.
    # Zero encodes nothing. It cannot drift, it cannot be tuned, and there is no
    # baseline to go stale — the first aged symbol fails it.
    ("unclassified_sector_aged (>30d since listing)",
        "SELECT COUNT(*)::int AS n FROM app.universe "
        " WHERE is_active AND sector = 'Unclassified' "
        "   AND listing_date IS NOT NULL "
        "   AND listing_date < CURRENT_DATE - INTERVAL '30 days'", 0,
     # ADVISORY. Resolving this means a human deciding what GENXAI actually
     # does and assigning it a sector by hand — no rerun fixes it. Meanwhile the
     # scoring output is completely sound: the symbol is scored, priced and
     # clustered, it just sits in a named bucket instead of a real one. Blocking
     # the snapshot rebuild and the cache purge over that would withhold the
     # whole site's refresh to protest one unlabelled microcap.
     True),
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


def _run_max_count(conn, name, sql, maximum, advisory=False) -> AssertionResult:
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
        advisory=advisory,
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
        # `or 99999` here, and it was the one value this check must never
        # reject: a feed imported TODAY gives CURRENT_DATE - MAX(date) = 0,
        # which is falsy, so the freshest possible feed scored as "no data at
        # all" and aborted scoring. That is what killed the 7 Oct weekly run
        # 17 seconds after a clean 3,082-symbol compute-metrics pass, leaving
        # app.scores three days behind app.metrics_snapshot on production. The
        # COALESCE in the SQL already supplies the sentinel for a genuinely
        # empty table; the only case Python has to cover is a missing row.
        _n = (cur.fetchone() or {}).get("n")
        days_behind = 99999 if _n is None else int(_n)
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
    for name, sql, maximum, advisory in _MAX_COUNT_ASSERTIONS:
        out.append(_run_max_count(conn, name, sql, maximum, advisory))
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
