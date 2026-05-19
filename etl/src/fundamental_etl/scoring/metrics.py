"""Metrics computation — for each stock, compute the metrics its scorecard requires.

Inputs (per stock):
  - app.fundamentals_annual (ordered period_end ascending)
  - app.fundamentals_quarterly (ordered ascending)
  - app.screener_meta (current_price, market_cap_cr if populated)
  - golden.indicators.daily_signals (latest row)
  - golden.price_history (252-day window for relative returns + above-200ema share)

Outputs:
  - One row in app.metrics_snapshot per (symbol, snapshot_date), holding:
      - The numeric value for every formula referenced by the stock's scorecard
        (stored in `cluster_metrics` JSONB)
      - The maturity_tier
      - market_cap, current_price for context
      - score_status flag
"""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import psycopg
from openpyxl import load_workbook

from .formulas import REGISTRY as FORMULAS
from .scorecards import get_scorecard, get_scorecard_from, load_db_overrides


# ----------------------- Loaders -------------------------------------------

def load_annual(conn: psycopg.Connection, symbol: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT period_end, sales, expenses, operating_profit, other_income, depreciation,
                   interest, profit_before_tax, tax, net_profit, dividend_amount,
                   equity_share_capital, reserves, borrowings, other_liabilities,
                   total_liabilities, net_block, cwip, investments, other_assets,
                   total_assets, receivables, inventory, cash_and_bank, no_of_equity_shares,
                   cash_from_operating, cash_from_investing, cash_from_financing, net_cash_flow,
                   annual_close_price
            FROM app.fundamentals_annual
            WHERE symbol = %s
            ORDER BY period_end ASC
        """, (symbol,))
        return [{k: (float(v) if v is not None and not isinstance(v, (str, date)) else v)
                 for k, v in r.items()}
                for r in cur.fetchall()]


def load_quarterly(conn: psycopg.Connection, symbol: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT period_end, sales, expenses, other_income, depreciation, interest,
                   profit_before_tax, tax, net_profit, operating_profit
            FROM app.fundamentals_quarterly
            WHERE symbol = %s
            ORDER BY period_end ASC
        """, (symbol,))
        return [{k: (float(v) if v is not None and not isinstance(v, (str, date)) else v)
                 for k, v in r.items()}
                for r in cur.fetchall()]


def load_signals(conn_golden: psycopg.Connection, symbol: str) -> Optional[dict]:
    """Latest indicators row for a symbol (NSE symbol w/ .NS suffix in golden_db)."""
    g_symbol = f"{symbol}.NS"
    with conn_golden.cursor() as cur:
        cur.execute("""
            SELECT * FROM indicators.daily_signals
            WHERE symbol = %s
            ORDER BY date DESC
            LIMIT 1
        """, (g_symbol,))
        row = cur.fetchone()
        if not row:
            return None
        return {k: (float(v) if isinstance(v, (int,)) and k not in ('date',) else v if not hasattr(v, '__float__') else float(v))
                for k, v in row.items()}


def load_price_history(conn_golden: psycopg.Connection, symbol: str) -> list[dict]:
    """1-year of daily closes for the symbol.

    Filters close IS NOT NULL — golden.price_history can have rows where the
    daily ingest wrote the row but failed to populate close (e.g. partial
    yfinance fetch). Including those would make the most-recent row a NULL,
    breaking every relative-return formula downstream.
    """
    g_symbol = f"{symbol}.NS"
    with conn_golden.cursor() as cur:
        cur.execute("""
            SELECT date, close
            FROM golden.price_history
            WHERE symbol = %s AND interval = '1d' AND close IS NOT NULL
            ORDER BY date DESC
            LIMIT 260
        """, (g_symbol,))
        rows = cur.fetchall()
        return [{"date": r["date"], "close": float(r["close"])} for r in rows]


def load_above_200ema(conn_golden: psycopg.Connection, symbol: str) -> Optional[float]:
    """% of last 252 trading days above 200 EMA."""
    g_symbol = f"{symbol}.NS"
    with conn_golden.cursor() as cur:
        cur.execute("""
            SELECT
              SUM(CASE WHEN above_200ema THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS pct
            FROM (
              SELECT above_200ema FROM indicators.daily_signals
              WHERE symbol = %s ORDER BY date DESC LIMIT 252
            ) x
        """, (g_symbol,))
        row = cur.fetchone()
        return float(row["pct"]) if row and row["pct"] is not None else None


def load_nifty_returns(conn_golden: psycopg.Connection) -> dict[str, float]:
    """Median NSE active-stock return over 3M / 6M / 12M.

    golden_db has no NIFTY index ticker; we compute a market-wide median benchmark
    instead. For relative-return scoring, only the location of the zero-line matters,
    and the median is more robust than the mean to outlier IPOs/penny stocks.
    """
    with conn_golden.cursor() as cur:
        # close IS NOT NULL throughout — a broken ingest day (rows present,
        # close blank) would otherwise corrupt every anchor date and median.
        cur.execute("""
            WITH latest AS (
              SELECT MAX(date) AS d FROM golden.price_history
               WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL
            ),
            windows AS (
              SELECT
                d AS today,
                d - INTERVAL '63 days'  AS d_3m,
                d - INTERVAL '126 days' AS d_6m,
                d - INTERVAL '252 days' AS d_12m
              FROM latest
            ),
            base AS (
              SELECT ph.symbol, ph.date, ph.close
              FROM golden.price_history ph
              JOIN golden.stocks s USING (symbol)
              JOIN windows w ON TRUE
              WHERE ph.interval='1d' AND s.exchange='NSE' AND s.is_active
                AND ph.close IS NOT NULL
                AND ph.date IN (
                  -- nearest available trading day to each anchor
                  (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL),
                  (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL AND date <= (SELECT d_3m FROM windows)),
                  (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL AND date <= (SELECT d_6m FROM windows)),
                  (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL AND date <= (SELECT d_12m FROM windows))
                )
            ),
            anchor_dates AS (
              SELECT
                (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL) AS d_now,
                (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL AND date <= (SELECT d_3m FROM windows)) AS d_3m,
                (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL AND date <= (SELECT d_6m FROM windows)) AS d_6m,
                (SELECT MAX(date) FROM golden.price_history WHERE interval='1d' AND symbol LIKE '%.NS' AND close IS NOT NULL AND date <= (SELECT d_12m FROM windows)) AS d_12m
            ),
            now AS (SELECT symbol, close FROM base, anchor_dates WHERE base.date = anchor_dates.d_now),
            d3  AS (SELECT symbol, close FROM base, anchor_dates WHERE base.date = anchor_dates.d_3m),
            d6  AS (SELECT symbol, close FROM base, anchor_dates WHERE base.date = anchor_dates.d_6m),
            d12 AS (SELECT symbol, close FROM base, anchor_dates WHERE base.date = anchor_dates.d_12m)
            SELECT
              percentile_cont(0.5) WITHIN GROUP (ORDER BY now.close/d3.close - 1)  AS r3,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY now.close/d6.close - 1)  AS r6,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY now.close/d12.close - 1) AS r12
            FROM now
              JOIN d3  USING (symbol)
              JOIN d6  USING (symbol)
              JOIN d12 USING (symbol)
            WHERE d3.close > 0 AND d6.close > 0 AND d12.close > 0
        """)
        r = cur.fetchone()
    if not r:
        return {}
    return {
        "3m":  float(r["r3"])  if r["r3"]  is not None else None,
        "6m":  float(r["r6"])  if r["r6"]  is not None else None,
        "12m": float(r["r12"]) if r["r12"] is not None else None,
    }


def compute_returns(prices: list[dict]) -> dict[str, Optional[float]]:
    """Compute 3M/6M/12M returns from a daily price list (newest-first)."""
    if not prices:
        return {"ret_3m": None, "ret_6m": None, "ret_12m": None}
    prices = list(reversed(prices))  # oldest first
    closes = [p["close"] for p in prices if p["close"] is not None]
    if not closes:
        return {"ret_3m": None, "ret_6m": None, "ret_12m": None}
    last = closes[-1]

    def _ret(window):
        if len(closes) <= window:
            return None
        return last / closes[-window - 1] - 1

    return {"ret_3m": _ret(63), "ret_6m": _ret(126), "ret_12m": _ret(252)}


# ----------------------- Meta from latest raw export ------------------------

def load_meta_from_raw(conn: psycopg.Connection, symbol: str) -> dict:
    """Read the most recent raw xlsx blob and pull mc / current_price / face_value etc."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT content FROM app.screener_export_raw
            WHERE symbol = %s ORDER BY fetched_at DESC LIMIT 1
        """, (symbol,))
        r = cur.fetchone()
        if not r:
            return {}
    wb = load_workbook(io.BytesIO(r["content"]), data_only=True, read_only=True)
    if "Data Sheet" not in wb.sheetnames:
        return {}
    ws = wb["Data Sheet"]
    out = {}
    for row in ws.iter_rows(min_row=1, max_row=20, values_only=True):
        if not row:
            continue
        label = (row[0] or "").strip() if isinstance(row[0], str) else None
        if label == "Current Price" and row[1] is not None:
            try: out["current_price"] = float(row[1])
            except: pass
        elif label == "Market Capitalization" and row[1] is not None:
            try: out["market_cap_cr"] = float(row[1])
            except: pass
        elif label == "Face Value" and row[1] is not None:
            try: out["face_value"] = float(row[1])
            except: pass
        elif label == "Number of shares" and row[1] is not None:
            try: out["no_of_shares"] = float(row[1])
            except: pass
    return out


# ----------------------- Compute -------------------------------------------

def compute_metrics_for_symbol(
    app_conn: psycopg.Connection,
    golden_conn: psycopg.Connection,
    symbol: str,
    cluster_id: str,
    tier: str,
    nifty_returns: dict,
    scorecard_overrides: dict | None = None,
) -> tuple[dict, dict, str]:
    """Compute all metrics for one stock. Returns (cluster_metrics, meta, score_status)."""
    annual = load_annual(app_conn, symbol)
    quarterly = load_quarterly(app_conn, symbol)
    meta = load_meta_from_raw(app_conn, symbol)

    # Update screener_meta with the freshly-extracted price/mc
    with app_conn.cursor() as cur:
        cur.execute("""
            UPDATE app.screener_meta
            SET current_price = %s, market_cap_cr = %s,
                face_value = %s, no_of_shares = %s
            WHERE symbol = %s
        """, (meta.get("current_price"), meta.get("market_cap_cr"),
              meta.get("face_value"), meta.get("no_of_shares"), symbol))

    signals = load_signals(golden_conn, symbol)
    pct_above = load_above_200ema(golden_conn, symbol)
    prices = load_price_history(golden_conn, symbol)
    rets = compute_returns(prices)
    meta_full = {
        **meta,
        **rets,
        "pct_above_200ema_252d": pct_above,
    }

    sc = (get_scorecard_from(scorecard_overrides, cluster_id, tier)
          if scorecard_overrides is not None else get_scorecard(cluster_id, tier))
    needed_formulas = set(sc.quality) | set(sc.valuation) | set(sc.momentum)
    # Always compute the loss-maker fallbacks too (cheap)
    for fname, _share in sc.loss_maker_val_fallback:
        needed_formulas.add(fname)

    out: dict[str, Optional[float]] = {}
    for fname in needed_formulas:
        fn = FORMULAS.get(fname)
        if fn is None:
            out[fname] = None
            continue
        try:
            v = fn(annual, quarterly, meta_full, signals, nifty_returns)
            out[fname] = float(v) if v is not None else None
        except Exception:
            out[fname] = None

    # score_status: count what fraction of expected metrics came back null
    nonnull = sum(1 for v in out.values() if v is not None)
    if not needed_formulas:
        return out, meta_full, "no_scorecard"
    nonnull_share = nonnull / len(needed_formulas)
    if nonnull_share == 0:
        status = "insufficient_data"
    elif nonnull_share < 0.5:
        status = "partial-data"
    else:
        status = "full"
    return out, meta_full, status


def persist_metrics(
    conn: psycopg.Connection,
    symbol: str,
    snapshot_date: date,
    cluster_metrics: dict,
    meta: dict,
    tier: str,
    score_status: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO app.metrics_snapshot
              (symbol, snapshot_date, market_cap, score_status, maturity_tier, cluster_metrics)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (symbol, snapshot_date) DO UPDATE
              SET market_cap = EXCLUDED.market_cap,
                  score_status = EXCLUDED.score_status,
                  maturity_tier = EXCLUDED.maturity_tier,
                  cluster_metrics = EXCLUDED.cluster_metrics
        """, (
            symbol, snapshot_date, meta.get("market_cap_cr"), score_status, tier,
            psycopg.types.json.Json(cluster_metrics),
        ))
