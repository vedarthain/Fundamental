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


def update_meta_success(conn: psycopg.Connection, symbol: str, export_id: str, size: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE app.screener_meta
            SET export_id = %s,
                last_scraped_at = NOW(),
                last_export_size_bytes = %s,
                last_status = 'ok',
                last_error = NULL,
                consecutive_failures = 0
            WHERE symbol = %s
            """,
            (export_id, size, symbol),
        )


def update_meta_failure(conn: psycopg.Connection, symbol: str, status: str, error: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE app.screener_meta
            SET last_scraped_at = NOW(),
                last_status = %s,
                last_error = %s,
                consecutive_failures = consecutive_failures + 1
            WHERE symbol = %s
            """,
            (status, error[:500], symbol),
        )
