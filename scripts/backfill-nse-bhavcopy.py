#!/usr/bin/env python3
"""
backfill-nse-bhavcopy.py — bulk-backfill golden.price_history from NSE's
daily bhavcopy archive.

Use this when:
  - A stock has a gap in golden_db (e.g. just added to universe)
  - A ticker rename broke yfinance continuity (e.g. LTIM → LTM)
  - yfinance returned sparse/wrong data for a symbol
  - You want a full offline archive for a date range

Two NSE archive formats are handled automatically:
  NEW (2020-12-31+)  sec_bhavdata_full_DDMMYYYY.csv       plain CSV
  OLD (before 2021)  cm{DD}{MON}{YYYY}bhav.csv.zip         zipped CSV

Symbol renames are handled via SYMBOL_RENAMES below. When a bhavcopy row
has an old symbol name, it is stored under the current (canonical) symbol.

Usage:
    # Backfill one renamed stock across its full symbol history
    scripts/backfill-nse-bhavcopy.py --symbol LTM --start 2016-07-01

    # Backfill all active universe stocks for a date range
    scripts/backfill-nse-bhavcopy.py --start 2020-01-01 --end 2023-12-31

    # Dry-run (shows what would be inserted without writing)
    scripts/backfill-nse-bhavcopy.py --symbol LTM --start 2016-07-01 --dry-run

Env vars (or .env.local at repo root):
    APP_DB_URL     — local Postgres for app.universe symbol list
    GOLDEN_DB_URL  — local golden_db for price_history inserts

Cost: $0 — NSE bhavcopy is a public, free-to-use data source.
"""
from __future__ import annotations

import csv
import io
import os
import sys
import time
import zipfile
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg
import psycopg.rows

# ── Repo root / env ──────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent


def _env(name: str, required: bool = True) -> str | None:
    v = os.environ.get(name)
    if v:
        return v
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    if required:
        raise SystemExit(f"{name} not set — add to .env.local or pass as env var.")
    return None


# ── Symbol rename registry ───────────────────────────────────────────────────
#
# Maps CURRENT NSE symbol → list of HISTORICAL NSE symbols that the same
# company traded under.  When the backfill sees an old symbol in a bhavcopy
# it stores the row under the current symbol so the web app only needs to
# look up one ticker.
#
# Add new entries here when you discover a renamed stock with a gap.
# Format: "CURRENT": ["OLD1", "OLD2", ...]  (oldest last is fine; order
# doesn't matter — they're used as a lookup set).
SYMBOL_RENAMES: dict[str, list[str]] = {
    # LTIMindtree: listed as LTI (Jul 2016 → Nov 2022),
    #              renamed to LTIM (Nov 2022 → Feb 2026),
    #              renamed again to LTM (Feb 2026+).
    "LTM": ["LTIM", "LTI"],

    # Add more as discovered, e.g.:
    # "MOTHERSON": ["SAMIL"],
    # "WIPRO": [],  # stable symbol, no rename needed
}

# Build reverse lookup: old_symbol → canonical_symbol (current)
_ALIAS_TO_CANONICAL: dict[str, str] = {}
for _canon, _aliases in SYMBOL_RENAMES.items():
    for _alias in _aliases:
        _ALIAS_TO_CANONICAL[_alias.upper()] = _canon.upper()


# ── NSE bhavcopy config ───────────────────────────────────────────────────────

# Format A — used from roughly Dec 2020 onwards.
# Plain CSV, downloaded directly.
_BHAVCOPY_NEW_URLS = [
    "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
    "https://archives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv",
]

# Format B — used for dates before Dec 2020.
# Zipped CSV with a different column layout.
_BHAVCOPY_OLD_URL = (
    "https://archives.nseindia.com/content/historical/EQUITIES"
    "/{yyyy}/{mon}/cm{dd}{mon}{yyyy}bhav.csv.zip"
)

# NSE returns 403 to default UAs — mimic Chrome.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

# Only equity series — excludes bonds, ETFs, preference shares, etc.
ALLOWED_SERIES = {"EQ", "BE", "BZ", "BL"}

# NSE format A switched to the new URL somewhere around this date.
# We try Format A first for ALL dates; fall back to Format B on 404.
_NEW_FORMAT_SINCE = date(2020, 12, 31)

DATA_SOURCE = "nse_bhavcopy"
YF_SUFFIX = ".NS"


# ── Bhavcopy fetch ────────────────────────────────────────────────────────────

def _get(url: str, binary: bool = False) -> bytes | str | None:
    """HTTP GET with browser headers. Returns bytes/str or None on 404."""
    try:
        req = Request(url, headers=_HEADERS)
        with urlopen(req, timeout=30) as r:
            return r.read() if binary else r.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        if e.code == 404:
            return None
        print(f"  ⚠ HTTP {e.code}: {url}", file=sys.stderr)
        return None
    except URLError as e:
        print(f"  ⚠ URLError: {url} — {e.reason}", file=sys.stderr)
        return None
    except (TimeoutError, OSError) as e:
        # SSL/socket-level timeout — NSE occasionally drops connections on
        # sustained archive downloads. Treat as a transient miss; the date
        # will be retried on the next run (covered-dates check skips already
        # inserted rows so re-runs are safe and cheap).
        print(f"  ⚠ timeout/socket: {url} — {e}", file=sys.stderr)
        return None


def _parse_new_csv(text: str) -> dict[str, dict] | None:
    """Parse Format-A bhavcopy CSV.
    Columns include SYMBOL, SERIES, OPEN_PRICE, HIGH_PRICE, LOW_PRICE,
    CLOSE_PRICE, TTL_TRD_QNTY (volume).  Returns None if the text doesn't
    look like a valid bhavcopy (e.g. NSE returned an HTML error page)."""
    if "CLOSE_PRICE" not in text[:400].upper():
        return None
    out: dict[str, dict] = {}
    reader = csv.DictReader(io.StringIO(text), skipinitialspace=True)
    fieldnames = {(f or "").strip() for f in (reader.fieldnames or [])}
    required = {"SYMBOL", "SERIES", "OPEN_PRICE", "HIGH_PRICE",
                "LOW_PRICE", "CLOSE_PRICE", "TTL_TRD_QNTY"}
    if not required.issubset(fieldnames):
        return None
    for raw in reader:
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        if row.get("SERIES") not in ALLOWED_SERIES:
            continue
        sym = (row.get("SYMBOL") or "").strip().upper()
        if not sym:
            continue
        close = _flt(row.get("CLOSE_PRICE", ""))
        if close is None:
            continue
        out[sym] = {
            "open":   _flt(row.get("OPEN_PRICE", "")),
            "high":   _flt(row.get("HIGH_PRICE", "")),
            "low":    _flt(row.get("LOW_PRICE", "")),
            "close":  close,
            "volume": _int(row.get("TTL_TRD_QNTY", "")),
        }
    return out


def _parse_old_zip(raw_bytes: bytes) -> dict[str, dict] | None:
    """Parse Format-B zipped bhavcopy.
    CSV columns: SYMBOL, SERIES, OPEN, HIGH, LOW, CLOSE, LAST, PREVCLOSE,
    TOTTRDQTY, TOTTRDVAL, TIMESTAMP, TOTALTRADES, ISIN"""
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            name = zf.namelist()[0]
            text = zf.read(name).decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ⚠ zip error: {e}", file=sys.stderr)
        return None
    out: dict[str, dict] = {}
    reader = csv.DictReader(io.StringIO(text), skipinitialspace=True)
    fieldnames = {(f or "").strip() for f in (reader.fieldnames or [])}
    required = {"SYMBOL", "SERIES", "OPEN", "HIGH", "LOW", "CLOSE", "TOTTRDQTY"}
    if not required.issubset(fieldnames):
        return None
    for raw in reader:
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        if row.get("SERIES") not in ALLOWED_SERIES:
            continue
        sym = (row.get("SYMBOL") or "").strip().upper()
        if not sym:
            continue
        close = _flt(row.get("CLOSE", ""))
        if close is None:
            continue
        out[sym] = {
            "open":   _flt(row.get("OPEN", "")),
            "high":   _flt(row.get("HIGH", "")),
            "low":    _flt(row.get("LOW", "")),
            "close":  close,
            "volume": _int(row.get("TOTTRDQTY", "")),
        }
    return out


def fetch_bhavcopy_for_date(d: date) -> dict[str, dict] | None:
    """Download and parse the bhavcopy for a given date.
    Returns {NSE_SYMBOL: {open,high,low,close,volume}} or None if no
    trading happened (holiday/weekend/date too old for any archive)."""
    ddmmyyyy = d.strftime("%d%m%Y")

    # Try Format A (new plain CSV) first for all dates.
    for url_tmpl in _BHAVCOPY_NEW_URLS:
        text = _get(url_tmpl.format(ddmmyyyy=ddmmyyyy))
        if text:
            parsed = _parse_new_csv(text)
            if parsed is not None:
                return parsed

    # Format A gave nothing — try Format B (old ZIP) for older dates.
    if d < _NEW_FORMAT_SINCE:
        mon = d.strftime("%b").upper()   # e.g. "JAN", "APR"
        dd = d.strftime("%d")
        yyyy = d.strftime("%Y")
        url = _BHAVCOPY_OLD_URL.format(yyyy=yyyy, mon=mon, dd=dd)
        raw = _get(url, binary=True)
        if raw:
            return _parse_old_zip(raw)

    return None  # Holiday / weekend / archive gap


# ── Helpers ───────────────────────────────────────────────────────────────────

def _flt(v: str) -> float | None:
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _int(v: str) -> int | None:
    if not v:
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def _iter_weekdays(start: date, end: date):
    """Yield every Mon-Fri in [start, end]."""
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


# ── DB helpers ────────────────────────────────────────────────────────────────

def load_universe_symbols(app_conn: psycopg.Connection) -> set[str]:
    """Return the set of active NSE symbols from app.universe."""
    with app_conn.cursor() as cur:
        cur.execute("SELECT symbol FROM app.universe WHERE is_active")
        return {r["symbol"] for r in cur.fetchall()}


def upsert_golden_stocks(golden_conn: psycopg.Connection, symbols: list[str]) -> None:
    """Ensure each symbol has a row in golden.stocks (FK requirement)."""
    if not symbols:
        return
    with golden_conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO golden.stocks (symbol, exchange, company_name)
            VALUES (%s, 'NSE', %s)
            ON CONFLICT (symbol) DO NOTHING
            """,
            [(s, s.replace(YF_SUFFIX, "")) for s in symbols],
        )
    golden_conn.commit()


def insert_ohlc_batch(
    golden_conn: psycopg.Connection,
    rows: list[tuple],
    repair: bool = False,
) -> int:
    """Write rows into golden.price_history.
    Each row: (symbol_with_suffix, date, open, high, low, close, volume).

    Modes:
      repair=False (default) — ON CONFLICT DO NOTHING.  Safe for filling
        gaps; never overwrites an existing row.
      repair=True            — ON CONFLICT DO UPDATE SET ... only if the
        existing close IS NULL.  Heals yfinance's "non-null volume but
        null OHLC" rows (a known data-quality glitch — see
        scripts/repair-null-ohlc usage in the README).

    Returns number of rows affected (caller must commit).
    """
    if not rows:
        return 0
    if repair:
        # Conditional UPSERT: only overwrite when the existing row's close
        # is NULL.  Preserves the integrity of rows that have valid data.
        # SET LOCAL golden.allow_repair = 'on' opts into the append-only
        # trigger's repair escape hatch (see migration 0019); the LOCAL
        # ensures the flag dies at COMMIT, so it can't leak.
        with golden_conn.cursor() as cur:
            cur.execute("SET LOCAL golden.allow_repair = 'on'")
        sql = """
            INSERT INTO golden.price_history
                (symbol, interval, date, open, high, low, close, adj_close,
                 volume, data_source)
            VALUES (%s, '1d', %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, interval, date) DO UPDATE SET
                open        = EXCLUDED.open,
                high        = EXCLUDED.high,
                low         = EXCLUDED.low,
                close       = EXCLUDED.close,
                adj_close   = EXCLUDED.adj_close,
                volume      = EXCLUDED.volume,
                data_source = EXCLUDED.data_source
            WHERE golden.price_history.close IS NULL
        """
    else:
        sql = """
            INSERT INTO golden.price_history
                (symbol, interval, date, open, high, low, close, adj_close,
                 volume, data_source)
            VALUES (%s, '1d', %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, interval, date) DO NOTHING
        """
    with golden_conn.cursor() as cur:
        cur.executemany(
            sql,
            [
                (sym, dt, o, h, l, c, c, vol, DATA_SOURCE)  # adj_close = close (no adj)
                for sym, dt, o, h, l, c, vol in rows
            ],
        )
        return cur.rowcount


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Backfill golden.price_history from NSE bhavcopy archives.",
    )
    parser.add_argument("--symbol", metavar="SYM",
        help="Canonical (current) NSE symbol to backfill, e.g. LTM. "
             "If omitted, backfills all active universe stocks.")
    parser.add_argument("--also", nargs="*", metavar="OLD_SYM",
        help="Historical symbol names for --symbol (e.g. --also LTIM LTI). "
             "Overrides SYMBOL_RENAMES for this run.")
    parser.add_argument("--start", required=True, metavar="YYYY-MM-DD",
        help="Start date (inclusive).")
    parser.add_argument("--end", metavar="YYYY-MM-DD",
        default=date.today().isoformat(),
        help="End date (inclusive, default: today).")
    parser.add_argument("--throttle", type=float, default=0.4,
        help="Seconds to sleep between NSE requests (default 0.4).")
    parser.add_argument("--dry-run", action="store_true",
        help="Parse and count rows but don't write to DB.")
    parser.add_argument("--repair", action="store_true",
        help="Repair mode: OVERWRITE existing rows where close IS NULL "
             "(yfinance occasionally writes volume+null-OHLC rows; this "
             "heals them from NSE bhavcopy data). Default behaviour skips "
             "any existing row.")
    args = parser.parse_args()

    start = date.fromisoformat(args.start)
    end   = date.fromisoformat(args.end)
    if start > end:
        raise SystemExit("--start must be ≤ --end")

    dry = args.dry_run
    if dry:
        print("DRY RUN — nothing will be written to the DB.")

    # Build the set of symbols we care about and the rename map for this run.
    # rename_map: {nse_symbol_in_bhavcopy → canonical_symbol_stored_in_golden}
    app_url = _env("APP_DB_URL")
    # GOLDEN_DB_URL in .env.local is the read-only ETL user — insufficient for
    # writes.  Prefer GOLDEN_DB_WRITE_URL if set; otherwise fall back to the
    # local-socket connection (connects as the OS user = superuser on dev
    # machines, which owns golden_db).
    golden_url = (
        _env("GOLDEN_DB_WRITE_URL", required=False)
        or _env("GOLDEN_DB_URL", required=False)
        or "postgresql:///golden_db"
    )

    with psycopg.connect(app_url,    row_factory=psycopg.rows.dict_row) as app_conn, \
         psycopg.connect(golden_url, row_factory=psycopg.rows.dict_row) as golden_conn:

        universe = load_universe_symbols(app_conn)
        print(f"Universe: {len(universe)} active stocks")

        if args.symbol:
            canonical = args.symbol.upper()
            if canonical not in universe:
                print(f"⚠ {canonical} not in app.universe — proceeding anyway.")
            # Build rename map for just this symbol
            aliases = [a.upper() for a in (args.also or [])] \
                      or [a.upper() for a in SYMBOL_RENAMES.get(canonical, [])]
            rename_map: dict[str, str] = {canonical: canonical}
            for alias in aliases:
                rename_map[alias] = canonical
            target_symbols = {canonical}  # what we ultimately store
            print(f"Symbol:  {canonical} (also checking: {aliases or 'none'})")
        else:
            # Bulk mode: all active universe + their known aliases
            rename_map = {sym: sym for sym in universe}
            for canon, aliases in SYMBOL_RENAMES.items():
                if canon in universe:
                    for alias in aliases:
                        rename_map[alias.upper()] = canon.upper()
            target_symbols = universe

        # Pre-register all canonical symbols in golden.stocks
        golden_syms = [s + YF_SUFFIX for s in target_symbols]
        if not dry:
            upsert_golden_stocks(golden_conn, golden_syms)

        print(f"Date range: {start} → {end}")
        print(f"Throttle:   {args.throttle}s between requests")
        print()

        # Optional: find dates already fully covered so we can skip them
        # (optimisation — ON CONFLICT handles duplicates anyway, but this
        # avoids unnecessary NSE traffic for date ranges that are complete).
        covered: set[date] = set()
        if args.symbol and not dry:
            sym_ns = canonical + YF_SUFFIX
            with golden_conn.cursor() as cur:
                cur.execute(
                    "SELECT date FROM golden.price_history "
                    "WHERE symbol = %s AND interval = '1d' "
                    "  AND date BETWEEN %s AND %s",
                    (sym_ns, start, end),
                )
                covered = {r["date"] for r in cur.fetchall()}
            if covered:
                print(f"  {len(covered)} dates already in DB — will skip them.")

        total_inserted = 0
        total_holidays = 0
        total_skipped  = 0
        total_dates    = 0

        all_dates = list(_iter_weekdays(start, end))
        n = len(all_dates)
        print(f"Processing {n} weekdays...")
        print()

        batch_rows: list[tuple] = []
        BATCH_COMMIT = 50  # flush to DB every N dates

        for i, d in enumerate(all_dates, 1):
            if d in covered:
                total_skipped += 1
                continue

            bars = fetch_bhavcopy_for_date(d)
            if bars is None:
                total_holidays += 1
                if i % 50 == 0 or i == n:
                    _progress(i, n, total_inserted, total_holidays, total_skipped)
                time.sleep(args.throttle)
                continue

            total_dates += 1

            # Filter bars to only symbols we care about (via rename_map)
            for nse_sym, ohlc in bars.items():
                canonical_sym = rename_map.get(nse_sym)
                if canonical_sym is None:
                    continue
                batch_rows.append((
                    canonical_sym + YF_SUFFIX,
                    d,
                    ohlc["open"],
                    ohlc["high"],
                    ohlc["low"],
                    ohlc["close"],
                    ohlc["volume"],
                ))

            # Flush batch every BATCH_COMMIT dates
            if len(batch_rows) >= BATCH_COMMIT * len(rename_map) or i == n:
                if not dry and batch_rows:
                    inserted = insert_ohlc_batch(golden_conn, batch_rows, repair=args.repair)
                    golden_conn.commit()
                    total_inserted += max(inserted, 0)
                elif dry:
                    total_inserted += len(batch_rows)  # would-be count
                batch_rows = []

            if i % 50 == 0 or i == n:
                _progress(i, n, total_inserted, total_holidays, total_skipped)

            time.sleep(args.throttle)

        print()
        print(f"{'DRY RUN — ' if dry else ''}Done.")
        print(f"  trading days processed : {total_dates}")
        print(f"  holidays/weekends skipped: {total_holidays}")
        print(f"  already-in-DB skipped  : {total_skipped}")
        print(f"  rows {'would-insert' if dry else 'inserted'}      : {total_inserted}")


def _progress(i: int, n: int, inserted: int, holidays: int, skipped: int) -> None:
    pct = 100 * i // n
    print(f"  [{pct:3d}%] {i}/{n} dates  "
          f"rows={inserted}  holidays={holidays}  skipped={skipped}")


if __name__ == "__main__":
    main()
