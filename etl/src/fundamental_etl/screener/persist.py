"""Persist Screener exports + parsed fundamentals into fundamental_app."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import psycopg

from .parser import ParsedExport

ANNUAL_COLUMNS = [
    "sales", "expenses", "operating_profit", "other_income", "depreciation",
    "interest", "profit_before_tax", "tax", "net_profit", "dividend_amount",
    "equity_share_capital", "reserves", "borrowings", "other_liabilities",
    "total_liabilities", "net_block", "cwip", "investments", "other_assets",
    "total_assets", "receivables", "inventory", "cash_and_bank", "no_of_equity_shares",
    "cash_from_operating", "cash_from_investing", "cash_from_financing", "net_cash_flow",
    "annual_close_price",
]

QUARTERLY_COLUMNS = [
    "sales", "expenses", "other_income", "depreciation", "interest",
    "profit_before_tax", "tax", "net_profit", "operating_profit",
]


def save_raw_export(conn: psycopg.Connection, symbol: str, content: bytes) -> datetime:
    """Insert raw xlsx blob; returns fetched_at timestamp."""
    fetched_at = datetime.now(timezone.utc)
    sha = hashlib.sha256(content).hexdigest()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app.screener_export_raw (symbol, fetched_at, content, content_sha256)
            VALUES (%s, %s, %s, %s)
            """,
            (symbol, fetched_at, content, sha),
        )
    return fetched_at


def save_parsed(conn: psycopg.Connection, symbol: str, parsed: ParsedExport, fetched_at: datetime) -> tuple[int, int]:
    """Upsert annual + quarterly rows. Returns (annual_rows, quarterly_rows)."""
    annual_n = 0
    quarter_n = 0
    with conn.cursor() as cur:
        for period_end, fields in parsed.annual.items():
            cols = ["symbol", "period_end"] + ANNUAL_COLUMNS + ["source_fetched_at"]
            vals = [symbol, period_end] + [fields.get(c) for c in ANNUAL_COLUMNS] + [fetched_at]
            placeholders = ",".join(["%s"] * len(cols))
            updates = ",".join(f"{c}=EXCLUDED.{c}" for c in ANNUAL_COLUMNS + ["source_fetched_at"])
            cur.execute(
                f"""
                INSERT INTO app.fundamentals_annual ({','.join(cols)})
                VALUES ({placeholders})
                ON CONFLICT (symbol, period_end) DO UPDATE SET {updates}
                """,
                vals,
            )
            annual_n += 1

        for period_end, fields in parsed.quarterly.items():
            cols = ["symbol", "period_end"] + QUARTERLY_COLUMNS + ["source_fetched_at"]
            vals = [symbol, period_end] + [fields.get(c) for c in QUARTERLY_COLUMNS] + [fetched_at]
            placeholders = ",".join(["%s"] * len(cols))
            updates = ",".join(f"{c}=EXCLUDED.{c}" for c in QUARTERLY_COLUMNS + ["source_fetched_at"])
            cur.execute(
                f"""
                INSERT INTO app.fundamentals_quarterly ({','.join(cols)})
                VALUES ({placeholders})
                ON CONFLICT (symbol, period_end) DO UPDATE SET {updates}
                """,
                vals,
            )
            quarter_n += 1

    return annual_n, quarter_n


DIVIDEND_ONLY_ANNUAL_COLUMNS = [
    "dividend_amount", "no_of_equity_shares", "annual_close_price",
]


def save_dividend_only_annual(
    conn: psycopg.Connection, symbol: str, parsed: ParsedExport, fetched_at: datetime,
) -> int:
    """Write per-FY dividend rows to app.dividend_only_annual (FK-free of
    app.universe). Only the three columns the Dividend Scanner needs are
    persisted; the rest of the parse is discarded. Returns rows written."""
    n = 0
    with conn.cursor() as cur:
        for period_end, fields in parsed.annual.items():
            cols = ["symbol", "period_end"] + DIVIDEND_ONLY_ANNUAL_COLUMNS + ["source_fetched_at"]
            vals = [symbol, period_end] + [fields.get(c) for c in DIVIDEND_ONLY_ANNUAL_COLUMNS] + [fetched_at]
            placeholders = ",".join(["%s"] * len(cols))
            updates = ",".join(f"{c}=EXCLUDED.{c}" for c in DIVIDEND_ONLY_ANNUAL_COLUMNS + ["source_fetched_at"])
            cur.execute(
                f"""
                INSERT INTO app.dividend_only_annual ({','.join(cols)})
                VALUES ({placeholders})
                ON CONFLICT (symbol, period_end) DO UPDATE SET {updates}
                """,
                vals,
            )
            n += 1
    return n


def save_dividend_only_meta(
    conn: psycopg.Connection,
    symbol: str,
    company_name: str | None,
    sector: str,
    industry: str,
    current_price: float | None,
    fetched_at: datetime,
) -> None:
    """Upsert the display-metadata + LTP-snapshot row for a dividend-only
    (InvIT/REIT) name. Dividend history itself is written to
    app.fundamentals_annual via save_parsed; this row only carries what the
    Dividend Scanner needs that the export doesn't put in fundamentals_annual:
    a coarse sector/industry for tree grouping and a current price (golden has
    no bars for these symbols, so LTP comes from the export)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app.dividend_only
                (symbol, company_name, sector, industry, current_price, price_fetched_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol) DO UPDATE SET
                company_name = EXCLUDED.company_name,
                sector = EXCLUDED.sector,
                industry = EXCLUDED.industry,
                current_price = EXCLUDED.current_price,
                price_fetched_at = EXCLUDED.price_fetched_at,
                updated_at = EXCLUDED.updated_at
            """,
            (symbol, company_name, sector, industry, current_price, fetched_at, fetched_at),
        )


# ── screener_meta writers ────────────────────────────────────────────────────
#
# BOTH OF THESE MUST UPSERT. They were plain UPDATEs until 2026-09-19, and that
# single omission is the root cause of the largest data gap this project has had.
#
# There is no INSERT into app.screener_meta anywhere in the codebase — not in the
# ETL, not in a migration. The rows that exist were created by a one-off seed when
# the universe was ~2,150. `sync-universe` has onboarded 472 new NSE listings
# since. For every one of them:
#
#   1. fetch-many queues them FIRST (ORDER BY ... last_scraped_at NULLS FIRST),
#      correctly treating a missing row as "never scraped".
#   2. The scrape runs. Success or failure, the result is written with
#      `UPDATE ... WHERE symbol = %s`, which matches ZERO rows.
#   3. psycopg raises nothing. cur.rowcount is 0 and nobody looked. The result
#      evaporates.
#   4. last_scraped_at stays NULL, so next week they are queued first again.
#
# So 472 symbols were re-scraped at the head of the queue every single week,
# burning the 180-minute budget, and could never record that it had happened.
# They also stayed invisible to every coverage check, because those all did
# `screener_meta JOIN universe` — an INNER JOIN onto the table whose absence was
# the bug, so the missing rows were filtered out before the percentage was
# computed. The weekly report said 99.8% coverage while it was 81.8%.
#
# The rowcount assertion below is not defensive padding; it is the specific thing
# whose absence made this silent for five months. A write that affects no rows is
# a failed write and must say so.

def _assert_wrote(cur, symbol: str, op: str) -> None:
    """A meta write that touched no rows is a failure, not a no-op.

    This is the tripwire that was missing. Raising here is deliberate: the caller
    in cli.py already wraps each symbol in try/except and routes the exception to
    the failure counter, so one bad symbol is contained — but it can no longer
    pass as success.
    """
    if cur.rowcount != 1:
        raise RuntimeError(
            f"screener_meta {op} for {symbol} affected {cur.rowcount} rows, expected 1"
        )


def update_meta_success(conn: psycopg.Connection, symbol: str, export_id: str, size: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app.screener_meta
                (symbol, export_id, last_scraped_at, last_export_size_bytes,
                 last_status, last_error, consecutive_failures)
            VALUES (%s, %s, NOW(), %s, 'ok', NULL, 0)
            ON CONFLICT (symbol) DO UPDATE
            SET export_id              = EXCLUDED.export_id,
                last_scraped_at        = EXCLUDED.last_scraped_at,
                last_export_size_bytes = EXCLUDED.last_export_size_bytes,
                last_status            = 'ok',
                last_error             = NULL,
                consecutive_failures   = 0
            """,
            (symbol, export_id, size),
        )
        _assert_wrote(cur, symbol, "success")


def update_meta_failure(conn: psycopg.Connection, symbol: str, status: str, error: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app.screener_meta
                (symbol, last_scraped_at, last_status, last_error, consecutive_failures)
            VALUES (%s, NOW(), %s, %s, 1)
            ON CONFLICT (symbol) DO UPDATE
            SET last_scraped_at      = EXCLUDED.last_scraped_at,
                last_status          = EXCLUDED.last_status,
                last_error           = EXCLUDED.last_error,
                -- Increment the EXISTING counter, not EXCLUDED's literal 1 —
                -- consecutive_failures is what drives the retry ordering and the
                -- cookie-health alarm, so it has to keep climbing across runs.
                consecutive_failures = app.screener_meta.consecutive_failures + 1
            """,
            (symbol, status, error[:500]),
        )
        _assert_wrote(cur, symbol, "failure")


def backfill_company_name(conn: psycopg.Connection, symbol: str, company_name: str | None) -> bool:
    """Fill app.universe.company_name from the Screener export, if it is missing.

    sync-universe inserts new NSE listings with
        (live[s]["company_name"] or s)
    — the symbol itself as a fallback when golden has no name for the instrument.
    Nothing ever revisited that fallback, so on 2026-09-19 all 472 symbols in the
    'never_attempted' coverage bucket had company_name = symbol. The overlap was
    exact, because both facts have the same cause: these are the listings
    onboarded after the original seed, and neither their name nor their scrape
    result was ever written.

    The name is not cosmetic. Theme membership resolves by matching an editorial
    catalogue against universe.company_name (see migration 0067), so a row whose
    name is 'A2ZINFRA' can never match 'A2Z Infra Engineering' and is parked in
    the review queue forever — 0067's header calls this out explicitly as a
    defect it could not fix from its side.

    Every Screener export already carries the real name; parse_export has been
    returning it as ParsedExport.company_name the whole time, and the fetch path
    simply discarded it. This writes it back.

    NARROWED ON PURPOSE: the WHERE clause only matches rows still holding the
    fallback. A name a human curated, or one golden supplied, is never
    overwritten by a scrape — Screener's naming is not authoritative over ours,
    it is only better than nothing. That makes this safe to run on every fetch
    of every symbol forever, and it self-terminates: once a name is real, the
    UPDATE stops matching.

    Returns True if a row was filled, so the caller can count repairs.
    """
    if not company_name or not company_name.strip():
        return False
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE app.universe
               SET company_name = %s
             WHERE symbol = %s
               AND company_name = symbol
            """,
            (company_name.strip(), symbol),
        )
        return cur.rowcount == 1
