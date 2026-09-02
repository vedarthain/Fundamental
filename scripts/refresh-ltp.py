#!/usr/bin/env python3
"""
refresh-ltp.py — fetch the latest NSE bhavcopy and refresh four things
from the same single CSV download:

  1. app.screener_meta.current_price             — today's LTP for header/cards
  2. app.screener_meta.market_cap_cr             — recomputed = LTP × shares
                                                   (replaces Screener's mcap
                                                    field, which is buggy for
                                                    some post-merger entities
                                                    like HDFCBANK)
  3. app.cluster_stocks_panel_cache              — latest snapshot's price +
                                                   mcap refreshed from (1)+(2)
                                                   so /sectors stays current
                                                   without a weekly score run
  4. golden.price_history (interval='1d')        — today's OHLC bar for
                                                   /sectors 1W/1M/1Y returns
                                                   and scoring

Designed to run as a GitHub Action every weekday after market close +
bhavcopy publish time (cron 13:00 UTC = 18:30 IST). Also runnable manually:

    APP_DB_URL=postgres://...        \\
    NEON_GOLDEN_URL=postgres://...   \\
    etl/.venv/bin/python scripts/refresh-ltp.py

If invoked with no APP_DB_URL env var, falls back to reading it from
.env.local at the repo root (so local dev runs work the same way as CI).
NEON_GOLDEN_URL is optional — if not set, only LTP is updated and the
OHLC INSERT step is skipped (with a notice). This lets the script keep
working for local dev where you may only have a local golden_db.

Why one script instead of two:
  - One bhavcopy fetch covers both jobs — no duplicate NSE traffic
  - LTP and historical OHLC are conceptually "today's market data" — they
    travel together
  - Replaces the yfinance-based refresh-ohlc.py which had rate-limit
    risk and was slower (~30 min vs ~30 sec for bhavcopy)

Scope note: golden (steps 4 + its FK parent golden.stocks) mirrors the FULL
equity bhavcopy — every EQ/BE/BZ/BL scrip, tracked or not — so new NSE listings
land in golden the day they list and sync-universe can onboard them. The
app-side write (step 1, screener_meta) stays gated to the tracked universe.

What it does NOT do:
  - Doesn't add new rows to screener_meta (only updates existing symbols)
  - Doesn't fetch longer intervals (1wk / 1mo / 3mo). The web app's
    1W/1M/1Y return columns are derived from 1d data on the fly, so
    storing those intervals separately on Neon is not needed.
  - Doesn't recompute scores or metrics — those are weekly via ./snap
"""
from __future__ import annotations

import csv
import io
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


# ----------------------- Config -------------------------------------------

# NSE bhavcopy URLs. NSE has migrated archives a few times — we try both.
# `sec_bhavdata_full_DDMMYYYY.csv` is a plain CSV that includes OPEN, HIGH,
# LOW, CLOSE, LTP, PREV_CLOSE, volume, etc. for every equity scrip that day.
BHAVCOPY_URL_TEMPLATES = [
    "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
    "https://archives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
]

# NSE returns 403 to default User-Agents. These mimic a real browser request
# closely enough to get through their bot filter.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

# How many calendar days to walk back before giving up. Covers a long weekend
# plus a national holiday plus a Sunday — 5 is generous.
MAX_DAYS_BACK = 5

# NSE intermittently times out / resets connections from datacenter IPs (like
# GitHub Actions runners). A bare read-timeout used to escape fetch_bhavcopy
# and crash the whole EOD pipeline before indices/FII/snapshot could run
# (see the 2026-08-07 job failure). Retry the SAME URL a few times with
# backoff so a transient blip self-heals instead of aborting everything.
FETCH_RETRY_BACKOFF = (3, 8, 20)  # seconds between attempts; len = retry count

# We only update prices for equity scrips. T2T (BE/BZ) and limited-trading
# (BL) are still equities, just with stricter settlement. Exclude bonds,
# preference shares, ETFs, etc.
ALLOWED_SERIES = {"EQ", "BE", "BZ", "BL"}

# Yahoo Finance suffix — golden.price_history stores symbols as 'SBIN.NS'
# (matches the format used by the local yfinance ingest and sync-neon.sh).
YF_SUFFIX = ".NS"

# Data source label written to golden.price_history.data_source for rows
# inserted by this script — lets you tell bhavcopy-sourced rows apart from
# yfinance-sourced ones in audit queries.
DATA_SOURCE = "nse_bhavcopy"


# ----------------------- Helpers ------------------------------------------

def env_url(name: str, required: bool = True) -> str | None:
    """Read a Postgres URL from env, fall back to .env.local for local runs."""
    v = os.environ.get(name)
    if v:
        return v
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if required:
        raise SystemExit(
            f"{name} not set — pass as env var, or add to .env.local for local runs."
        )
    return None


def connect_with_retry(
    url: str, *, attempts: int = 4, base_delay: float = 1.5
) -> psycopg.Connection:
    """Open a psycopg connection, retrying transient drops.

    Neon scales serverless compute to zero when idle, so this infrequent
    nightly job routinely hits a cold start: connect() succeeds but the
    freshly established socket is closed by the proxy while the compute wakes,
    and the first query dies with "SSL connection has been closed
    unexpectedly". We defend against that by opening the connection AND
    running a warm-up `SELECT 1` inside the retry loop — a bad connection is
    discarded and re-dialled with exponential backoff instead of failing the
    whole run. Only OperationalError (transient/network) is retried; a real
    error (bad credentials, missing table) still surfaces immediately.
    """
    last_exc: Exception | None = None
    for i in range(attempts):
        conn: psycopg.Connection | None = None
        try:
            conn = psycopg.connect(url)
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            return conn
        except psycopg.OperationalError as exc:
            last_exc = exc
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
            if i == attempts - 1:
                break
            delay = base_delay * (2 ** i)
            print(f"  ⚠ DB connect attempt {i + 1}/{attempts} failed "
                  f"({exc}); retrying in {delay:.1f}s")
            time.sleep(delay)
    raise SystemExit(
        f"✗ could not establish a usable DB connection after {attempts} "
        f"attempts: {last_exc}"
    )


def fetch_bhavcopy(d: date) -> str | None:
    """Try to fetch the bhavcopy CSV for date `d`. Returns CSV text, or None
    if the file isn't published for that date (404, weekend, holiday).

    A transient network error (read timeout, connection reset — common from
    cloud IPs against NSE) is retried on the SAME URL with backoff rather than
    propagating: a bare TimeoutError here previously crashed the whole EOD
    pipeline. A genuine 404 still means "not published", so we fall through to
    the next URL template / older date as before.
    """
    ddmmyyyy = d.strftime("%d%m%Y")
    # attempts = initial try + one per backoff interval.
    max_attempts = len(FETCH_RETRY_BACKOFF) + 1
    for url_tmpl in BHAVCOPY_URL_TEMPLATES:
        url = url_tmpl.format(ddmmyyyy=ddmmyyyy)
        for attempt in range(max_attempts):
            try:
                req = Request(url, headers=HEADERS)
                with urlopen(req, timeout=45) as r:
                    body = r.read().decode("utf-8", errors="replace")
                    # Sanity: NSE sometimes returns an HTML error page with a
                    # 200 status. Real bhavcopy CSVs have CLOSE_PRICE in header.
                    if "CLOSE_PRICE" in body[:300].upper():
                        return body
                break  # 200 but not a real CSV — try the next URL template.
            except HTTPError as e:
                if e.code == 404:
                    break  # not published for this template — next template.
                print(f"  http error {e.code} for {url}: {e.reason}", file=sys.stderr)
                break
            except (TimeoutError, URLError, OSError) as e:
                # Transient. Back off and retry the same URL; give up (→ next
                # template) only after exhausting the backoff schedule.
                if attempt < len(FETCH_RETRY_BACKOFF):
                    wait = FETCH_RETRY_BACKOFF[attempt]
                    print(
                        f"  transient error for {url} "
                        f"(attempt {attempt + 1}/{max_attempts}): {e}; retry in {wait}s",
                        file=sys.stderr,
                    )
                    time.sleep(wait)
                else:
                    print(f"  giving up on {url} after {max_attempts} attempts: {e}", file=sys.stderr)
    return None


def _f(v: str) -> float | None:
    """Float-or-None parse helper for bhavcopy fields."""
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _i(v: str) -> int | None:
    """Int-or-None parse helper for bhavcopy volume column."""
    if not v:
        return None
    try:
        # Volume can come through as "12345.0" if NSE feeds it as decimal
        return int(float(v))
    except ValueError:
        return None


def parse_bhavcopy(csv_text: str) -> dict[str, dict]:
    """Parse CSV → {symbol: {open, high, low, close, volume}} for allowed series.

    Used by both the LTP update and the OHLC insert paths — single pass over
    the CSV produces everything we need.

    NSE bhavcopy quirks handled here:
      - Header column names have leading whitespace (" SERIES", " OPEN_PRICE")
      - Row values also have leading whitespace
      - SERIES filter excludes bonds, preference shares, ETFs, mutual funds
      - Some rows have empty/blank price fields when no trade happened
    """
    out: dict[str, dict] = {}
    reader = csv.DictReader(io.StringIO(csv_text), skipinitialspace=True)
    fieldnames = [(f or "").strip() for f in (reader.fieldnames or [])]
    required = {"SYMBOL", "SERIES", "OPEN_PRICE", "HIGH_PRICE",
                "LOW_PRICE", "CLOSE_PRICE", "TTL_TRD_QNTY"}
    if not required.issubset(set(fieldnames)):
        return out
    for raw in reader:
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k is not None}
        if row.get("SERIES") not in ALLOWED_SERIES:
            continue
        symbol = row.get("SYMBOL")
        if not symbol:
            continue
        close = _f(row.get("CLOSE_PRICE", ""))
        if close is None:
            # No close = no useful data for either LTP or OHLC; skip.
            continue
        out[symbol.upper()] = {
            "open":   _f(row.get("OPEN_PRICE", "")),
            "high":   _f(row.get("HIGH_PRICE", "")),
            "low":    _f(row.get("LOW_PRICE", "")),
            "close":  close,
            "volume": _i(row.get("TTL_TRD_QNTY", "")),
        }
    return out


def find_latest_bhavcopy(today: date) -> tuple[date, str] | None:
    """Walk back from today looking for the most recent published bhavcopy.
    NSE doesn't publish on weekends or trading holidays."""
    for delta in range(MAX_DAYS_BACK + 1):
        d = today - timedelta(days=delta)
        # Skip Saturday/Sunday — bhavcopy never exists for those.
        if d.weekday() >= 5:
            continue
        print(f"  trying {d.isoformat()}")
        body = fetch_bhavcopy(d)
        if body:
            return d, body
    return None


def fetch_known_symbols(conn: psycopg.Connection) -> dict[str, str]:
    """Return {symbol: company_name} for every tracked active stock.

    Used ONLY to gate the app-side write (update_ltps → screener_meta, which
    legitimately has rows only for tracked stocks). The golden writers
    (upsert_golden_stocks, insert_ohlc) deliberately do NOT gate on this —
    golden is the raw lake and mirrors the full equity bhavcopy so new NSE
    listings land the day they list (see the module docstring).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT u.symbol, COALESCE(u.company_name, u.symbol) AS company_name
              FROM app.universe u
             WHERE u.is_active
        """)
        return {r[0]: r[1] for r in cur.fetchall()}


def update_ltps(conn: psycopg.Connection, bars: dict[str, dict],
                known: dict[str, str]) -> tuple[int, int]:
    """UPDATE app.screener_meta.current_price for symbols we already track.

    Returns (rows_updated, symbols_in_bhavcopy_not_in_db). We deliberately
    don't INSERT new rows — keeps the update strictly additive in value,
    never additive in scope.
    """
    if not bars:
        return 0, 0
    rows = [(sym, b["close"]) for sym, b in bars.items() if sym in known]
    missing = sum(1 for sym in bars if sym not in known)
    if not rows:
        return 0, missing
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE app.screener_meta SET current_price = %s WHERE symbol = %s",
            [(price, sym) for sym, price in rows],
        )
    conn.commit()
    return len(rows), missing


def recompute_market_cap_and_panel(conn: psycopg.Connection) -> tuple[int, int]:
    """Recompute screener_meta.market_cap_cr and refresh
    cluster_stocks_panel_cache from the freshly-updated current_price.

    Two updates, run in this order:
      1. screener_meta.market_cap_cr = current_price × no_of_equity_shares / 10^7
         (formula uses the latest no_of_equity_shares from fundamentals_annual;
         skips symbols missing that field — ~17 of ~2,150 today).
      2. cluster_stocks_panel_cache.current_price + market_cap_cr ← screener_meta
         for the latest snapshot only. This is the materialised table that
         /sectors reads, so without this step the /sectors page would
         continue showing pre-refresh values until the next weekly score run.

    Same logic as sync-ltp-from-golden.py (the local-DB equivalent), running
    here against Neon so production auto-corrects every weekday after the
    bhavcopy LTP refresh. Means production never relies on a manual
    sync-neon.sh to surface today's prices/caps.

    Returns (n_meta_mcap_updated, n_panel_rows_updated).
    """
    with conn.cursor() as cur:
        # Step A: recompute market_cap_cr in screener_meta
        cur.execute("""
            WITH latest_shares AS (
                SELECT DISTINCT ON (symbol) symbol, no_of_equity_shares
                  FROM app.fundamentals_annual
                 WHERE no_of_equity_shares IS NOT NULL
                 ORDER BY symbol, period_end DESC
            )
            UPDATE app.screener_meta sm
               SET market_cap_cr = ROUND(
                       (sm.current_price * ls.no_of_equity_shares / 10000000.0)::numeric, 2
                   )
              FROM latest_shares ls
             WHERE sm.symbol = ls.symbol
               AND sm.current_price IS NOT NULL
        """)
        n_mcap = cur.rowcount

        # Step B: refresh cluster_stocks_panel_cache (latest snapshot only).
        # Older snapshots are historical archives — leave them keyed to their
        # snapshot date's values.
        cur.execute("""
            UPDATE app.cluster_stocks_panel_cache c
               SET current_price = sm.current_price,
                   market_cap_cr = sm.market_cap_cr
              FROM app.screener_meta sm
             WHERE c.symbol = sm.symbol
               AND c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
               AND sm.current_price IS NOT NULL
               AND (
                     c.current_price IS DISTINCT FROM sm.current_price
                  OR c.market_cap_cr IS DISTINCT FROM sm.market_cap_cr
               )
        """)
        n_panel = cur.rowcount
    conn.commit()
    return n_mcap, n_panel


def upsert_golden_stocks(
    conn: psycopg.Connection,
    bars: dict[str, dict],
    known: dict[str, str],
) -> int:
    """Upsert EVERY equity symbol in today's bhavcopy into golden.stocks.

    golden.price_history has a FK to golden.stocks(symbol), so we have to
    ensure the parent row exists before its price row. We insert ALL parsed
    symbols (not just the tracked universe) so a brand-new IPO lands in golden
    the day it lists — that's what lets sync-universe onboard it into
    app.universe on the next weekly run. Gating this on the tracked universe
    was a self-locking deadlock: golden only got what was already tracked, and
    onboarding only saw what was in golden.

    Idempotent — ON CONFLICT DO NOTHING means existing rows are unchanged.
    Only fills the minimum required (NOT NULL) columns: symbol, exchange,
    company_name, is_active. For an untracked symbol company_name falls back to
    the ticker; richer metadata (ISIN, listing_date, sector) comes via the
    weekly sync-neon.sh.
    """
    rows = [
        (sym + YF_SUFFIX, "NSE", known.get(sym, sym), True)
        for sym in bars
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO golden.stocks (symbol, exchange, company_name, is_active)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (symbol) DO NOTHING
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def insert_ohlc(
    conn: psycopg.Connection,
    bars: dict[str, dict],
    known: dict[str, str],
    trade_date: date,
) -> int:
    """INSERT today's OHLC bar (interval='1d') into golden.price_history.

    Writes EVERY equity symbol in the bhavcopy (not just the tracked universe);
    golden.stocks has been pre-populated for all of them by upsert_golden_stocks.
    Uses ON CONFLICT DO NOTHING — re-running the script later in the day, or
    after a missed-day backfill, is harmless.
    """
    if not bars:
        return 0
    # adj_close := close. NSE bhavcopy doesn't separate split/dividend-adjusted
    # closes; we'd need a separate corporate-action feed. For 1W/1M/1Y returns
    # (the main consumer) this is fine — those are short horizons where
    # corporate actions are rare and adj_close ≈ close to within a few %.
    rows = [
        (
            sym + YF_SUFFIX,
            "1d",
            trade_date,
            b["open"], b["high"], b["low"], b["close"], b["close"], b["volume"],
            DATA_SOURCE,
        )
        for sym, b in bars.items()
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO golden.price_history
                (symbol, interval, date, open, high, low, close, adj_close, volume, data_source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, interval, date) DO NOTHING
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def main() -> None:
    today = date.today()
    print(f"refresh-ltp: looking for latest bhavcopy from {today.isoformat()}")
    result = find_latest_bhavcopy(today)
    if not result:
        print(f"✗ no bhavcopy found within {MAX_DAYS_BACK} days — exiting non-zero")
        sys.exit(1)
    trade_date, csv_text = result
    print(f"✓ fetched bhavcopy for {trade_date.isoformat()} ({len(csv_text):,} bytes)")
    bars = parse_bhavcopy(csv_text)
    if not bars:
        print("✗ parser returned 0 rows — bhavcopy format may have changed")
        sys.exit(2)
    print(f"  parsed {len(bars):,} equity rows")

    # Step 1: update screener_meta.current_price (always)
    # Same DB connection produces the `known` filter we'll reuse for OHLC.
    # Step 1b (in the same connection): derive market_cap_cr from the fresh
    # LTP × shares, then cascade both fields into cluster_stocks_panel_cache.
    # Without 1b the /sectors page keeps showing stale prices + the buggy
    # Screener-sourced market cap until the next weekly score run.
    app_url = env_url("APP_DB_URL", required=True)
    with connect_with_retry(app_url) as conn:
        known = fetch_known_symbols(conn)
        updated, missing = update_ltps(conn, bars, known)
        n_mcap, n_panel = recompute_market_cap_and_panel(conn)
    print(f"✓ updated current_price for {updated:,} symbols")
    if missing:
        print(f"  {missing:,} bhavcopy symbols not in our universe (ignored)")
    print(f"✓ recomputed market_cap_cr for {n_mcap:,} symbols")
    print(f"✓ refreshed {n_panel:,} cluster_stocks_panel_cache rows (latest snapshot)")

    # Step 2: insert today's OHLC bar into golden.price_history (if configured)
    # The OHLC write is optional so local dev still works without a Neon golden
    # URL configured. In CI, NEON_GOLDEN_URL is always set as a repo secret.
    golden_url = env_url("NEON_GOLDEN_URL", required=False)
    if not golden_url:
        print("  NEON_GOLDEN_URL not set — skipping OHLC INSERT into golden.price_history")
        return
    with connect_with_retry(golden_url) as conn:
        # Pre-step: ensure EVERY bhavcopy symbol exists in golden.stocks. This
        # auto-registers brand-new IPOs the day they list so the price_history
        # FK doesn't fail — and so sync-universe can onboard them. Idempotent.
        stocks_seen = upsert_golden_stocks(conn, bars, known)
        print(f"  ensured {stocks_seen:,} symbols in golden.stocks (FK parent)")
        submitted = insert_ohlc(conn, bars, known, trade_date)
    print(f"✓ submitted {submitted:,} OHLC rows to golden.price_history "
          f"(date={trade_date.isoformat()}, conflicts ignored)")


if __name__ == "__main__":
    main()
