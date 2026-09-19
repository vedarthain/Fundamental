#!/usr/bin/env python3
"""
check-freshness.py — alarm if production data is stale.

Checks run against Neon (production):

  1. app.scores           — MAX(snapshot_date) within 8 days?
                            Score ETL runs weekly; >8 days = a missed run.

  1a. app.scores cadence  — gap between the last two weekly snapshots ≤ 10 days?
                            Catches a SKIPPED WEEK even after a later run made
                            the latest date look fresh — a permanent hole in the
                            score archive (the moat). Self-clears once cadence
                            resumes, so it's loud when a hole forms, not forever.

  1b. app.scores coverage — scored/active-universe ≥ 97%?
                            A RATIO, never a row count. This was `>= 2000 rows`
                            with a comment saying "full universe ~2,150"; the
                            universe grew to 2,622, the constant did not, and a
                            472-symbol hole cleared the floor every week without
                            ever going red. Both sides are now read at run time
                            so the check cannot rot as the universe grows.

  1c. app.coverage_ledger — does every active symbol reconcile into exactly one
                            bucket, with the problem buckets empty? The check
                            with no tunable numbers at all: it asserts a
                            partition rather than a level, so there is nothing to
                            re-audit when the universe changes size. See
                            etl/src/fundamental_etl/coverage.py.

  2. golden.price_history — MAX(date) within 4 days?
                            refresh-ltp.py runs weekdays after close.
                            Fri close → Mon evening = 3 days, holidays
                            can push it to 4. >4 days = the bhavcopy
                            ingest is broken.

  3. app.cluster_stocks_panel_cache — has rows for the latest snapshot?
                            Catches the case where score ran but the
                            cache refresher silently failed.

  4. app.upstox_session   — is the stored Upstox token still valid?
  5. app.screener_meta.price_fetched_at — did the intraday pinger write
                            recently? Both are checked ONLY inside the market
                            window (weekdays 11:00-16:00 IST) and skipped
                            otherwise. These exist because the pinger soft-200s
                            on a dead token by design, so an outage is
                            completely silent without an external heartbeat
                            check.

USAGE:
  # Local dev (reads URLs from .env.local)
  scripts/check-freshness.py

  # CI / explicit URLs
  APP_DB_URL=$NEON_APP_URL GOLDEN_DB_URL=$NEON_GOLDEN_URL scripts/check-freshness.py

  # Override thresholds (useful for tuning)
  scripts/check-freshness.py --snapshot-max-days 10 --price-max-days 5

Exit codes:
  0 — all checks pass
  1 — at least one check failed (GitHub Actions emails repo notification settings)
  2 — could not connect to a DB (treated separately so connection vs data
      issues are distinguishable in logs)

Every check prints a one-line PASS/FAIL summary regardless of outcome, so
the GH Actions log is a complete diagnostic without needing to dig.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent


def env_url(name: str) -> str:
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        f"✗ {name} not set — pass as env var or add to .env.local"
    )


def mask(url: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:****@", url)


# Each check returns (passed: bool, summary_line: str).  The runner prints
# the line and tallies pass/fail at the end.


def check_snapshot_age(conn: psycopg.Connection, max_days: int) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(snapshot_date) FROM app.scores")
        row = cur.fetchone()
    snap = row[0] if row else None
    if snap is None:
        return False, "✗ snapshot_age: no rows in app.scores"
    age = (date.today() - snap).days
    ok = age <= max_days
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} snapshot_age: latest={snap.isoformat()} "
        f"({age}d ago, threshold={max_days}d)"
    )


def check_snapshot_cadence(conn: psycopg.Connection, max_gap_days: int) -> tuple[bool, str]:
    """Gap-proof the score archive (the moat): the week-over-week interval
    between the two most recent weekly snapshots must not exceed the cadence +
    slack. A larger gap means a WEEK WAS SKIPPED — a permanent hole in the
    archive that can never be backfilled (you can't recompute a past week's
    prices/fundamentals as they were).

    Why this is distinct from `check_snapshot_age`: age only looks at the NEWEST
    snapshot. If week N is skipped but week N+1 runs normally, age passes (latest
    is fresh) yet there's a permanent hole between N-1 and N+1. This check fires
    the moment that post-hole run lands, then self-clears once a normal weekly
    cadence resumes — so it's loud exactly when a hole forms, without nagging
    forever about an old, unfixable gap.

    Double-run robustness: a same-week re-run can leave two snapshots 1 day
    apart. We skip any snapshot within 3 days of the latest so we measure the
    true week-over-week gap, not the double-run sibling.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT snapshot_date
              FROM app.scores
             ORDER BY snapshot_date DESC
             LIMIT 6
        """)
        dates = [r[0] for r in cur.fetchall()]
    if len(dates) < 2:
        return True, "✓ snapshot_cadence: <2 snapshots yet — skipped (early archive)"
    latest = dates[0]
    prev = next((d for d in dates[1:] if (latest - d).days >= 3), None)
    if prev is None:
        return True, "✓ snapshot_cadence: only same-week snapshots — skipped"
    gap = (latest - prev).days
    ok = gap <= max_gap_days
    icon = "✓" if ok else "✗"
    suffix = "" if ok else (
        " — a WEEKLY SNAPSHOT WAS SKIPPED. This is a permanent hole in the score "
        "archive (the moat). Investigate the missed weekly-fetch/compute run."
    )
    return ok, (
        f"{icon} snapshot_cadence: {gap}d between last two weekly snapshots "
        f"({prev.isoformat()} → {latest.isoformat()}, max {max_gap_days}d){suffix}"
    )


def check_snapshot_completeness(conn: psycopg.Connection, min_ratio: float) -> tuple[bool, str]:
    """Verify the latest snapshot covers the universe as it is TODAY.

    THIS USED TO BE A CONSTANT, AND THE CONSTANT IS WHY WE MISSED 472 STOCKS.

    The previous version asserted `scored >= 2000`, with a docstring reading
    "full universe ~2,150". Both were accurate the day they were written.
    sync-universe-monthly then grew the universe to 2,622 while scored stayed at
    2,122 — so 472 symbols went missing and this check cleared its floor by 122
    rows every single week without ever going red.

    That is the general failure mode: an absolute threshold encodes a fact about
    the past, and it rots toward SILENCE. A stale floor does not error, it just
    keeps passing. So the threshold is now a RATIO against the live universe
    count. It cannot go stale, because both sides of the comparison are read at
    run time.

    Note the denominator is app.universe, not `scores JOIN universe` — joining
    through scores would exclude the unscored rows that are the entire thing
    being measured."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
            SELECT (SELECT COUNT(*)::int FROM app.scores s JOIN latest ON s.snapshot_date = latest.d),
                   (SELECT COUNT(*)::int FROM app.universe WHERE is_active)
        """)
        row = cur.fetchone()
    n = int(row[0]) if row else 0
    universe = int(row[1]) if row else 0
    ratio = (n / universe) if universe else 0.0
    ok = ratio >= min_ratio
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} snapshot_coverage: {n}/{universe} active symbols scored "
        f"({ratio:.1%}, expected ≥ {min_ratio:.0%})"
    )


def check_coverage_ledger(conn: psycopg.Connection) -> tuple[bool, str]:
    """Assert the per-symbol ledger reconciles — the check with no constants.

    Three things, none of which contains a tunable number:
      * the ledger has a row for every active symbol (nothing vanished),
      * nothing landed in the 'unclassified' residual bucket (nothing is
        unexplained), and
      * the problem buckets are EMPTY — not small, empty.

    Zero is the only threshold here because zero is the only value that cannot
    rot. Every number we have ever picked for "acceptable" ended up normalising a
    permanent hole: the stale-financials assertion was given a ceiling of 40
    against a baseline of 25, which turned an alert into a thermostat and made a
    23-stock gap officially fine for two months.

    See etl/src/fundamental_etl/coverage.py for the full reasoning."""
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(snapshot_date) FROM app.coverage_ledger")
        row = cur.fetchone()
        snap = row[0] if row else None
        if snap is None:
            return False, "✗ coverage_ledger: no rows — the score run never wrote a ledger"
        cur.execute("""
            SELECT (SELECT COUNT(*)::int FROM app.coverage_ledger WHERE snapshot_date = %s),
                   (SELECT COUNT(*)::int FROM app.universe WHERE is_active),
                   (SELECT COUNT(*)::int FROM app.coverage_ledger
                     WHERE snapshot_date = %s AND status = 'unclassified'),
                   (SELECT COUNT(*)::int FROM app.coverage_ledger
                     WHERE snapshot_date = %s
                       AND status IN ('never_attempted','fetch_failing','no_metrics'))
        """, (snap, snap, snap))
        ledger_n, universe_n, unclassified_n, problem_n = cur.fetchone()

    ok = (ledger_n == universe_n) and unclassified_n == 0 and problem_n == 0
    icon = "✓" if ok else "✗"
    bits = [f"{ledger_n}/{universe_n} accounted for"]
    if unclassified_n:
        bits.append(f"{unclassified_n} UNCLASSIFIED")
    if problem_n:
        bits.append(f"{problem_n} in problem buckets")
    return ok, f"{icon} coverage_ledger ({snap}): " + ", ".join(bits)


def check_price_age(conn: psycopg.Connection, max_days: int) -> tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(date) FROM golden.price_history "
            "WHERE interval = '1d' AND close IS NOT NULL"
        )
        row = cur.fetchone()
    d = row[0] if row else None
    if d is None:
        return False, "✗ price_age: no rows in golden.price_history"
    age = (date.today() - d).days
    ok = age <= max_days
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} price_age: latest={d.isoformat()} "
        f"({age}d ago, threshold={max_days}d)"
    )


def check_cookie_health(conn: psycopg.Connection) -> tuple[bool, str]:
    """Detect Screener cookie expiry — alert on EVEN ONE recent auth_failed.

    fetch-many runs with stop_on_auth_fail=True (the weekly workflow's
    default), so the *first* auth failure HALTS the whole run — recording just
    ONE auth_failed row before truncating and leaving the rest of the universe
    unscraped. So a single recent auth_failed is the real signal that the
    cookie expired and the weekly run was silently cut short.

    (The old threshold of ≥10 never fired in this mode — the halt meant the
    count never got past ~1 — so an expired cookie truncated the run with no
    alert. That's the gap this closes.)

    Window: 3 days — covers the weekly Saturday run plus the 12h check cadence,
    while ageing out so a fixed-and-re-run cookie clears the alert.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*)::int
              FROM app.screener_meta
             WHERE last_status = 'auth_failed'
               AND last_scraped_at > NOW() - INTERVAL '3 days'
        """)
        row = cur.fetchone()
    n = (row[0] or 0) if row else 0
    ok = n < 1
    icon = "✓" if ok else "✗"
    suffix = (
        "" if ok else
        " — Screener cookies likely expired; the run HALTED/truncated. Rotate "
        "SCREENER_SESSIONID + SCREENER_CSRFTOKEN (GitHub secrets + .env.local), "
        "then re-run the fetch."
    )
    return ok, (
        f"{icon} cookie_health: {n} auth_failed scrape(s) in last 3d "
        f"(alert if ≥ 1){suffix}"
    )


def check_panel_cache_populated(conn: psycopg.Connection) -> tuple[bool, str]:
    """Verify the stocks panel cache has rows for the latest snapshot.
    Detects the case where score_snapshot ran but the panel refresher
    failed — without this check, /sectors would render empty for up to
    a week before the next score run."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (SELECT MAX(snapshot_date) AS d FROM app.scores)
            SELECT (SELECT COUNT(*)::int FROM app.cluster_stocks_panel_cache c
                      JOIN latest ON c.snapshot_date = latest.d),
                   (SELECT COUNT(*)::int FROM app.scores s
                      JOIN latest ON s.snapshot_date = latest.d)
        """)
        row = cur.fetchone()
    n = int(row[0]) if row else 0
    scored = int(row[1]) if row else 0
    # The panel cache should mirror the scored set one-for-one — it IS the scored
    # set, denormalised for the client. So compare it to the scored count rather
    # than to a constant. The old threshold was `>= 500` with a comment reading
    # "we usually have ~2,150": it would have passed a refresh that dropped three
    # quarters of the panel, and like every other constant in this file it was
    # already describing a universe size that no longer exists.
    ok = scored > 0 and n >= scored
    icon = "✓" if ok else "✗"
    return ok, (
        f"{icon} panel_cache: {n} rows vs {scored} scored in latest snapshot"
        + ("" if ok else f" — {scored - n} missing from the panel")
    )


IST = timezone(timedelta(hours=5, minutes=30))


def _in_market_window(now_ist: datetime) -> bool:
    """Weekday, and late enough in the session that several pinger pulls should
    already have landed. Pulls fire at :30 past each hour 09:30–15:30 IST, so
    from 11:00 there have been at least two."""
    return now_ist.weekday() < 5 and 11 <= now_ist.hour < 16


def check_intraday_price_age(conn: psycopg.Connection, max_minutes: int) -> tuple[bool, str]:
    """Detect a dead intraday price pinger DURING the session.

    Why this check has to exist: /api/cron/intraday-equity maps a missing or
    expired Upstox token to a SOFT 200 no-op, deliberately, so a missed morning
    reauth can't trip the external pinger into a retry storm. The cost of that
    choice is that a dead pinger emits no signal anywhere — cron-job.org sees
    success, nothing throws, and every page just keeps rendering the last EOD
    close. It ran silently dead for four trading days in Sept 2026 (a token
    expiry bug) and the only reason it surfaced was someone noticing the price
    badge on a stock page hadn't moved.

    app.screener_meta.price_fetched_at is written ONLY by that route, so it is
    the pinger's heartbeat. Stale during market hours = the pinger is down.

    Holiday caveat: a trading holiday on a weekday has no pulls, so this fires
    a false alarm on those few days a year. Same tradeoff withinPingerWindow()
    already makes — excluding them needs an NSE calendar, and a handful of
    ignorable alerts beats missing a real multi-day outage.
    """
    now_ist = datetime.now(IST)
    if not _in_market_window(now_ist):
        return True, (
            f"✓ intraday_age: {now_ist:%a %H:%M} IST is outside the check window "
            "(weekdays 11:00–16:00 IST) — skipped"
        )
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(price_fetched_at) FROM app.screener_meta")
        row = cur.fetchone()
    ts = row[0] if row else None
    if ts is None:
        return False, "✗ intraday_age: app.screener_meta.price_fetched_at is entirely NULL"
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    mins = int((datetime.now(timezone.utc) - ts).total_seconds() // 60)
    ok = mins <= max_minutes
    icon = "✓" if ok else "✗"
    suffix = "" if ok else (
        " — the intraday pinger is DOWN and failing silently (it soft-200s on a "
        "dead token). Check app.upstox_session expiry and reauth at "
        "/api/upstox/login, then confirm cron-job.org is still firing."
    )
    return ok, (
        f"{icon} intraday_age: last pinger write {ts.astimezone(IST):%Y-%m-%d %H:%M} IST "
        f"({mins}m ago, threshold={max_minutes}m){suffix}"
    )


def check_upstox_token(conn: psycopg.Connection) -> tuple[bool, str]:
    """The root cause one level up from intraday_age: is the stored Upstox
    token usable right now? Checked only inside the market window, because an
    expired token overnight is normal and expected — you reauth in the morning."""
    now_ist = datetime.now(IST)
    if not _in_market_window(now_ist):
        return True, "✓ upstox_token: outside market window — skipped"
    with conn.cursor() as cur:
        cur.execute(
            "SELECT access_token IS NOT NULL, expires_at FROM app.upstox_session WHERE id = 1"
        )
        row = cur.fetchone()
    if not row:
        return False, "✗ upstox_token: no row in app.upstox_session"
    has_token, expires_at = row[0], row[1]
    if not has_token:
        return False, "✗ upstox_token: no access_token stored — reauth at /api/upstox/login"
    if expires_at is None:
        return True, "✓ upstox_token: present, no expiry recorded"
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    ok = expires_at > datetime.now(timezone.utc)
    icon = "✓" if ok else "✗"
    suffix = "" if ok else " — reauth at /api/upstox/login; intraday prices are frozen until you do."
    return ok, (
        f"{icon} upstox_token: expires {expires_at.astimezone(IST):%Y-%m-%d %H:%M} IST{suffix}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that production data on Neon is fresh.",
    )
    parser.add_argument("--snapshot-max-days", type=int, default=8,
        help="Alert if latest snapshot is older than this (default 8)")
    parser.add_argument("--price-max-days", type=int, default=4,
        help="Alert if latest price is older than this (default 4 — covers a long weekend + holiday)")
    # A RATIO, not a row count. The old `--snapshot-min-rows 2000` was frozen
    # when the universe was ~2,150; the universe grew to 2,622 and the floor did
    # not, so a 472-symbol hole cleared it every week. A ratio re-reads both
    # sides at run time and cannot go stale. 0.97 allows the handful of symbols
    # legitimately gated for short history without tolerating a real gap.
    parser.add_argument("--snapshot-min-coverage", type=float, default=0.97,
        help="Alert if scored/active-universe falls below this ratio (default 0.97)")
    parser.add_argument("--snapshot-max-gap-days", type=int, default=10,
        help="Alert if the gap between the two most recent weekly snapshots exceeds this (default 10 = 7d cadence + holiday slack; larger = a skipped week / archive hole)")
    parser.add_argument("--intraday-max-minutes", type=int, default=150,
        help="Alert if the intraday pinger's last write is older than this during market hours (default 150 = two missed hourly pulls of slack)")
    args = parser.parse_args()

    app_url = env_url("APP_DB_URL")
    golden_url = env_url("GOLDEN_DB_URL")
    print(f"App DB:    {mask(app_url)}")
    print(f"Golden DB: {mask(golden_url)}")
    print(f"Run at:    {datetime.now(timezone.utc).isoformat()}")
    print()

    results: list[tuple[bool, str]] = []

    # App DB checks
    try:
        with psycopg.connect(app_url) as conn:
            results.append(check_snapshot_age(conn, args.snapshot_max_days))
            results.append(check_snapshot_cadence(conn, args.snapshot_max_gap_days))
            results.append(check_snapshot_completeness(conn, args.snapshot_min_coverage))
            results.append(check_coverage_ledger(conn))
            results.append(check_panel_cache_populated(conn))
            results.append(check_cookie_health(conn))
            results.append(check_upstox_token(conn))
            results.append(check_intraday_price_age(conn, args.intraday_max_minutes))
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: could not connect to app DB — {e}", file=sys.stderr)
        return 2

    # Golden DB checks
    try:
        with psycopg.connect(golden_url) as conn:
            results.append(check_price_age(conn, args.price_max_days))
    except psycopg.OperationalError as e:
        print(f"✗ FATAL: could not connect to golden DB — {e}", file=sys.stderr)
        return 2

    for _, line in results:
        print(line)

    failed = [line for ok, line in results if not ok]
    print()
    if failed:
        print(f"FAIL — {len(failed)} of {len(results)} check(s) failed:")
        for line in failed:
            print(f"  {line}")
        return 1
    print(f"OK — all {len(results)} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
