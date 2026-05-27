#!/usr/bin/env python3
"""
build-market-snapshot.py — precompute the /market dashboard.

Computes the entire /api/market/overview response shape (indices,
sparklines, hero series, movers, advance/decline, 52W H/L, sector heat,
FII/DII) and upserts it into app.market_snapshot_cache as a single JSONB
row. The page then reads ONE row at request time — sub-100ms even on
cold Neon compute, vs. 15-21s for the live aggregation path.

Mirrors the SQL in web/src/app/api/market/overview/route.ts. When the
route's logic changes, this script must change in lockstep — there is
NO test guarding the parity yet, so review carefully on UI changes.

USAGE:
  # Local (defaults to APP_DB_URL + GOLDEN_DB_URL from .env.local)
  etl/.venv/bin/python scripts/build-market-snapshot.py

  # Prod
  etl/.venv/bin/python scripts/build-market-snapshot.py \\
      --url "$APP_DB_URL_PROD" \\
      --golden-url "$GOLDEN_DB_URL_PROD"

  # Custom retention window (default: 365 days)
  etl/.venv/bin/python scripts/build-market-snapshot.py --retain-days 90

COST (Rule #1):
  - 1 medium golden scan (today close + prev close + 52W MAX/MIN per symbol)
  - ~6 small app reads
  - 1 INSERT/UPDATE into market_snapshot_cache
  - 1 DELETE for rows older than --retain-days
  Total ~2s on Neon prod. Run once per day after refresh-ltp.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


# ----------------------- env helpers --------------------------------------

def env_url(name: str, required: bool = True) -> str | None:
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
            f"{name} not set — pass as env var, or add to .env.local."
        )
    return None


# ----------------------- load helpers -------------------------------------

INDEX_DISPLAY_ORDER = {
    "NIFTY50": 0, "NIFTYBANK": 1, "NIFTYMIDCAP100": 2,
    "NIFTYSMALLCAP100": 3, "NIFTYNEXT50": 4, "NIFTY100": 5,
    "NIFTY500": 6,
}
HERO_INDEX_CODES = ["NIFTY50", "NIFTYBANK"]
DEFAULT_LIMIT_PER_BUCKET = 7
# Pool retains every ranked candidate.  Slicing per-universe applies the
# final top-N filter, so on small-cap-led days the Nifty 50 universe
# still surfaces the top 7 N50 names instead of being padded with 2 that
# happened to make a 300-row pool.
MOVER_POOL_LIMIT = 5000


def fetchall_dict(cur, sql: str, args=()):
    """Run a query and return list of dicts (psycopg row_factory equivalent)."""
    cur.execute(sql, args)
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_indices(app_conn) -> list[dict]:
    """Latest index close + 1D/1W/1M/1Y pct + 90-day sparkline per code."""
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            WITH latest_date AS (
              SELECT MAX(date) AS d FROM app.market_index_history
            ),
            today AS (
              SELECT h.index_code, h.display_name AS name, h.close::float, h.date AS date,
                     h.pct_change::float AS pct_change_1d
                FROM app.market_index_history h
                JOIN latest_date l ON l.d = h.date
            )
            SELECT t.index_code AS code, t.name, t.close, t.pct_change_1d,
                   CASE WHEN w.close > 0 THEN ((t.close - w.close::float) / w.close::float * 100)::float ELSE NULL END AS pct_change_1w,
                   CASE WHEN m.close > 0 THEN ((t.close - m.close::float) / m.close::float * 100)::float ELSE NULL END AS pct_change_1m,
                   CASE WHEN y.close > 0 THEN ((t.close - y.close::float) / y.close::float * 100)::float ELSE NULL END AS pct_change_1y,
                   t.date::text AS date
              FROM today t
              LEFT JOIN LATERAL (
                SELECT close FROM app.market_index_history h2
                 WHERE h2.index_code = t.index_code AND h2.date <= (t.date - INTERVAL '7 days')
                 ORDER BY h2.date DESC LIMIT 1
              ) w ON TRUE
              LEFT JOIN LATERAL (
                SELECT close FROM app.market_index_history h2
                 WHERE h2.index_code = t.index_code AND h2.date <= (t.date - INTERVAL '30 days')
                 ORDER BY h2.date DESC LIMIT 1
              ) m ON TRUE
              LEFT JOIN LATERAL (
                SELECT close FROM app.market_index_history h2
                 WHERE h2.index_code = t.index_code AND h2.date <= (t.date - INTERVAL '365 days')
                 ORDER BY h2.date DESC LIMIT 1
              ) y ON TRUE
             ORDER BY (CASE t.index_code
                         WHEN 'NIFTY50' THEN 0 WHEN 'NIFTYBANK' THEN 1
                         WHEN 'NIFTYMIDCAP100' THEN 2 WHEN 'NIFTYSMALLCAP100' THEN 3
                         WHEN 'NIFTYNEXT50' THEN 4 WHEN 'NIFTY100' THEN 5
                         WHEN 'NIFTY500' THEN 6 ELSE 100 END),
                      t.name
        """)
        # Sparklines: 90 most recent closes per index, ordered ASC for chart consumption.
        sparks = fetchall_dict(cur, """
            WITH ranked AS (
              SELECT index_code, date, close::float AS close,
                     ROW_NUMBER() OVER (PARTITION BY index_code ORDER BY date DESC) AS rn
                FROM app.market_index_history
            )
            SELECT index_code, date::text AS date, close
              FROM ranked WHERE rn <= 90
             ORDER BY index_code, date
        """)
    spark_by_code: dict[str, list[dict]] = {}
    for r in sparks:
        spark_by_code.setdefault(r["index_code"], []).append({
            "date": r["date"], "close": r["close"],
        })
    for r in rows:
        r["sparkline"] = spark_by_code.get(r["code"], [])
    return rows


def load_hero_series(app_conn) -> dict[str, list[dict]]:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT index_code, date::text AS date, close::float AS close
              FROM app.market_index_history
             WHERE index_code = ANY(%s)
             ORDER BY index_code, date
        """, (HERO_INDEX_CODES,))
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["index_code"], []).append({"date": r["date"], "close": r["close"]})
    return out


def load_golden_snapshot(golden_conn) -> dict[str, dict]:
    """Single golden query — (today, prev, pct_1d, hi_52w, lo_52w) per symbol."""
    with golden_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            WITH bounds AS (
              SELECT date AS latest FROM golden.price_history WHERE interval='1d'
               ORDER BY date DESC LIMIT 1
            ),
            prev AS (
              SELECT MAX(date) AS d FROM golden.price_history
               WHERE interval='1d' AND date < (SELECT latest FROM bounds)
            ),
            horizon AS (
              SELECT (SELECT latest FROM bounds) - INTERVAL '370 days' AS cutoff
            ),
            yearly AS (
              SELECT REPLACE(p.symbol, '.NS', '') AS symbol,
                     MAX(p.close) AS hi, MIN(p.close) AS lo
                FROM golden.price_history p, horizon h
               WHERE p.interval='1d' AND p.date >= h.cutoff
               GROUP BY 1
            ),
            today_close AS (
              SELECT REPLACE(symbol, '.NS', '') AS symbol, close
                FROM golden.price_history, bounds
               WHERE interval='1d' AND date = bounds.latest
            ),
            prev_close AS (
              SELECT REPLACE(symbol, '.NS', '') AS symbol, close
                FROM golden.price_history, prev
               WHERE interval='1d' AND date = prev.d
            )
            SELECT t.symbol,
                   t.close::float                                  AS today_close,
                   p.close::float                                  AS prev_close,
                   CASE WHEN p.close IS NOT NULL AND p.close > 0
                        THEN ((t.close - p.close) / p.close)::float ELSE NULL END AS pct_1d,
                   y.hi::float AS hi_52w,
                   y.lo::float AS lo_52w
              FROM today_close t
              LEFT JOIN prev_close p ON p.symbol = t.symbol
              LEFT JOIN yearly y     ON y.symbol = t.symbol
        """)
    return {r["symbol"]: r for r in rows}


def load_panel_context(app_conn) -> dict[str, dict]:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT
              c.symbol,
              c.company_name,
              mc.name AS sector_name,
              cl.name AS industry_name,
              c.current_price::float AS current_price,
              c.market_cap_cr::float AS market_cap_cr,
              c.composite_pct::float AS composite_pct,
              c.quality_pct::float   AS quality_pct,
              c.maturity_tier,
              COALESCE(u.is_nifty50,  false) AS is_nifty50,
              COALESCE(u.is_nifty200, false) AS is_nifty200
            FROM app.cluster_stocks_panel_cache c
            JOIN app.cluster cl      ON cl.id = c.cluster_id
            JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
            LEFT JOIN app.universe u ON u.symbol = c.symbol
            WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
              AND c.market_cap_cr >= 500
        """)
    return {r["symbol"]: r for r in rows}


def load_movers_1w_pool(app_conn, direction: str, limit: int) -> list[dict]:
    order = "DESC" if direction == "up" else "ASC"
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, f"""
            SELECT
              c.symbol, c.company_name,
              mc.name AS sector_name, cl.name AS industry_name,
              c.current_price::float AS current_price,
              c.market_cap_cr::float AS market_cap_cr,
              c.ret_1w::float        AS ret,
              c.composite_pct::float AS composite_pct,
              c.quality_pct::float   AS quality_pct,
              c.maturity_tier,
              COALESCE(u.is_nifty50,  false) AS is_nifty50,
              COALESCE(u.is_nifty200, false) AS is_nifty200
            FROM app.cluster_stocks_panel_cache c
            JOIN app.cluster cl       ON cl.id = c.cluster_id
            JOIN app.meta_cluster mc  ON mc.id = cl.meta_cluster_id
            LEFT JOIN app.universe u  ON u.symbol = c.symbol
            WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
              AND c.ret_1w IS NOT NULL
              AND c.market_cap_cr >= 500
            ORDER BY c.ret_1w {order}
            LIMIT {int(limit)}
        """)
    return rows


def load_sector_1w(app_conn) -> list[dict]:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT
              mc.name AS sector_name,
              mc.display_order,
              COUNT(DISTINCT c.cluster_id)::int AS industry_count,
              COUNT(c.symbol)::int              AS stocks_count,
              AVG(c.ret_1w)::float              AS avg_ret_1w,
              AVG(c.composite_pct)::float       AS avg_composite_pct
            FROM app.cluster_stocks_panel_cache c
            JOIN app.cluster cl      ON cl.id = c.cluster_id
            JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
            WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
              AND c.ret_1w IS NOT NULL
            GROUP BY mc.name, mc.display_order
            ORDER BY mc.display_order, mc.name
        """)
    return rows


def load_sector_map(app_conn) -> dict[str, str]:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT c.symbol, mc.name AS sector_name
              FROM app.cluster_stocks_panel_cache c
              JOIN app.cluster cl      ON cl.id = c.cluster_id
              JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
             WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
        """)
    return {r["symbol"]: r["sector_name"] for r in rows}


def load_ad_1w(app_conn) -> dict:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT CASE WHEN ret_1w > 0.005 THEN 'up'
                        WHEN ret_1w < -0.005 THEN 'down'
                        ELSE 'flat' END AS direction,
                   COUNT(*)::int AS n
              FROM app.cluster_stocks_panel_cache
             WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
               AND ret_1w IS NOT NULL
             GROUP BY 1
        """)
    out = {"up": 0, "flat": 0, "down": 0}
    for r in rows:
        out[r["direction"]] = r["n"]
    return out


def load_fii(app_conn) -> dict:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT date::text, fii_net::float, dii_net::float
              FROM app.fii_dii_flow
             ORDER BY date DESC LIMIT 5
        """)
    rows.reverse()
    latest = rows[-1] if rows else None
    return {"latest": latest, "series": rows}


def load_snapshot_dates(app_conn) -> dict:
    with app_conn.cursor() as cur:
        rows = fetchall_dict(cur, """
            SELECT
              (SELECT MAX(snapshot_date)::text FROM app.cluster_stocks_panel_cache) AS snapshot_date,
              (SELECT MAX(date)::text          FROM app.market_index_history)       AS ltp_date
        """)
    return rows[0] if rows else {"snapshot_date": None, "ltp_date": None}


# ----------------------- derivations -------------------------------------

def derive_ad_1d(snap: dict) -> dict:
    out = {"up": 0, "flat": 0, "down": 0}
    for s in snap.values():
        p = s["pct_1d"]
        if p is None:
            continue
        if p > 0.005: out["up"] += 1
        elif p < -0.005: out["down"] += 1
        else: out["flat"] += 1
    return out


def derive_week_range(snap: dict) -> dict:
    at_high = at_low = near_high = near_low = total = 0
    for s in snap.values():
        hi, lo = s["hi_52w"], s["lo_52w"]
        if hi is None or lo is None or hi <= 0 or lo <= 0:
            continue
        c = s["today_close"]
        total += 1
        if c >= hi * 0.995: at_high += 1
        elif c >= hi * 0.95: near_high += 1
        if c <= lo * 1.005: at_low += 1
        elif c <= lo * 1.05: near_low += 1
    return {
        "at_high": at_high, "at_low": at_low,
        "near_high": near_high, "near_low": near_low, "total": total,
    }


def derive_sector_heat(sector_1w: list[dict], snap: dict, sector_by_sym: dict) -> list[dict]:
    sum_1d: dict[str, list[float]] = {}
    for sym, s in snap.items():
        sec = sector_by_sym.get(sym)
        if not sec or s["pct_1d"] is None:
            continue
        sum_1d.setdefault(sec, []).append(s["pct_1d"])
    out = []
    for s in sector_1w:
        arr = sum_1d.get(s["sector_name"], [])
        out.append({
            "sector_name":       s["sector_name"],
            "industry_count":    s["industry_count"],
            "stocks_count":      s["stocks_count"],
            "avg_ret_1d":        (sum(arr) / len(arr)) if arr else None,
            "avg_ret_1w":        s["avg_ret_1w"],
            "avg_composite_pct": s["avg_composite_pct"],
        })
    return out


def derive_movers_1d_pool(direction: str, limit: int, snap: dict, panel: dict) -> list[dict]:
    cands = []
    for sym, s in snap.items():
        if s["pct_1d"] is None: continue
        if sym not in panel: continue
        cands.append((sym, s["pct_1d"], s["today_close"]))
    cands.sort(key=lambda c: c[1], reverse=(direction == "up"))
    # `limit` is effectively the pool ceiling. Set high enough above that
    # every universe (Nifty 50 has 50 candidates) gets a chance to fill 7.
    out = []
    for sym, pct, today in cands[:limit]:
        ctx = panel[sym]
        out.append({
            "symbol":        sym,
            "company_name":  ctx["company_name"],
            "sector_name":   ctx["sector_name"],
            "industry_name": ctx["industry_name"],
            "current_price": ctx["current_price"] if ctx["current_price"] is not None else today,
            "market_cap_cr": ctx["market_cap_cr"],
            "ret":           pct,
            "composite_pct": ctx["composite_pct"],
            "quality_pct":   ctx["quality_pct"],
            "maturity_tier": ctx["maturity_tier"],
            "is_nifty50":    ctx["is_nifty50"],
            "is_nifty200":   ctx["is_nifty200"],
        })
    return out


def slice_movers(pools: dict, limit: int) -> dict:
    """Partition the 4 pools into 3 universes × 2 periods × 2 directions × top N."""
    def strip(rows: list[dict]) -> list[dict]:
        return [{k: v for k, v in r.items() if k not in ("is_nifty50", "is_nifty200")} for r in rows]

    def pick(rows: list[dict], universe: str) -> list[dict]:
        if universe == "NIFTY50":
            filtered = [r for r in rows if r.get("is_nifty50")]
        elif universe == "NIFTY200":
            filtered = [r for r in rows if r.get("is_nifty200")]
        else:
            filtered = rows
        return strip(filtered[:limit])

    out = {}
    for u in ["NIFTY50", "NIFTY200", "FULL"]:
        out[u] = {
            "1D": {"up": pick(pools["1Du"], u), "down": pick(pools["1Dd"], u)},
            "1W": {"up": pick(pools["1Wu"], u), "down": pick(pools["1Wd"], u)},
        }
    return out


# ----------------------- holidays helper ----------------------------------

NSE_HOLIDAYS_2026 = [
    ("2026-01-26", "Republic Day"),
    ("2026-03-04", "Mahashivratri"),
    ("2026-03-17", "Holi"),
    ("2026-03-21", "Eid-Ul-Fitr (Ramzan ID)"),
    ("2026-04-03", "Good Friday"),
    ("2026-04-14", "Dr Baba Saheb Ambedkar Jayanti"),
    ("2026-04-21", "Shri Mahavir Jayanti"),
    ("2026-05-01", "Maharashtra Day"),
    ("2026-05-27", "Bakri Eid"),
    ("2026-08-15", "Independence Day"),
    ("2026-09-25", "Ganesh Chaturthi"),
    ("2026-10-02", "Mahatma Gandhi Jayanti"),
    ("2026-10-21", "Diwali Laxmi Pujan"),
    ("2026-10-22", "Diwali Balipratipada"),
    ("2026-11-04", "Guru Nanak Jayanti"),
    ("2026-12-25", "Christmas"),
]

def upcoming_holidays(today: date, n: int = 5) -> list[dict]:
    iso = today.isoformat()
    return [{"date": d, "name": name} for (d, name) in NSE_HOLIDAYS_2026 if d >= iso][:n]


# ----------------------- main ---------------------------------------------

def build_snapshot(app_conn, golden_conn) -> dict:
    """Run every loader/derivation and assemble the JSON payload."""
    # App-side reads (single round-trip each, sequential is fine on local conn).
    indices       = load_indices(app_conn)
    hero_series   = load_hero_series(app_conn)
    sector_1w     = load_sector_1w(app_conn)
    sector_map    = load_sector_map(app_conn)
    panel         = load_panel_context(app_conn)
    movers_1w_up  = load_movers_1w_pool(app_conn, "up",   MOVER_POOL_LIMIT)
    movers_1w_dn  = load_movers_1w_pool(app_conn, "down", MOVER_POOL_LIMIT)
    ad_1w         = load_ad_1w(app_conn)
    fii           = load_fii(app_conn)
    dates         = load_snapshot_dates(app_conn)

    # Golden-side single query.
    snap          = load_golden_snapshot(golden_conn)

    # Derivations — pure Python.
    ad_1d         = derive_ad_1d(snap)
    week_range    = derive_week_range(snap)
    sector_heat   = derive_sector_heat(sector_1w, snap, sector_map)
    movers_1d_up  = derive_movers_1d_pool("up",   MOVER_POOL_LIMIT, snap, panel)
    movers_1d_dn  = derive_movers_1d_pool("down", MOVER_POOL_LIMIT, snap, panel)

    movers = slice_movers(
        {"1Du": movers_1d_up, "1Dd": movers_1d_dn,
         "1Wu": movers_1w_up, "1Wd": movers_1w_dn},
        limit=DEFAULT_LIMIT_PER_BUCKET,
    )

    return {
        "indices":        indices,
        "heroSeries":     hero_series,
        "movers":         movers,
        "advanceDecline": {"1D": ad_1d, "1W": ad_1w},
        "weekRange":      week_range,
        "sectorHeat":     sector_heat,
        "fii":            fii,
        "holidays":       upcoming_holidays(date.today()),
        "snapshotDate":   dates.get("snapshot_date"),
        "ltpDate":        dates.get("ltp_date"),
    }


def upsert_snapshot(app_conn, payload: dict, retain_days: int) -> None:
    today = date.today()
    with app_conn.cursor() as cur:
        cur.execute("""
            INSERT INTO app.market_snapshot_cache (date, data, computed_at)
            VALUES (%s, %s, now())
            ON CONFLICT (date) DO UPDATE
              SET data = EXCLUDED.data,
                  computed_at = EXCLUDED.computed_at
        """, (today, Jsonb(payload)))
        cur.execute(
            "DELETE FROM app.market_snapshot_cache WHERE date < %s",
            (today - timedelta(days=retain_days),),
        )


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="App Postgres URL (defaults to APP_DB_URL env)")
    p.add_argument("--golden-url", help="Golden Postgres URL (defaults to GOLDEN_DB_URL or NEON_GOLDEN_URL)")
    p.add_argument("--retain-days", type=int, default=365,
                   help="Retention window for snapshot rows (default: 365).")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    app_url    = args.url        or env_url("APP_DB_URL", required=True)
    golden_url = args.golden_url or env_url("GOLDEN_DB_URL", required=False) \
                                 or env_url("NEON_GOLDEN_URL", required=True)
    assert app_url is not None and golden_url is not None

    started = datetime.now()
    with psycopg.connect(app_url) as app_conn, psycopg.connect(golden_url) as golden_conn:
        payload = build_snapshot(app_conn, golden_conn)
        upsert_snapshot(app_conn, payload, retain_days=args.retain_days)
        app_conn.commit()
    took = (datetime.now() - started).total_seconds()
    print(f"snapshot built in {took:.1f}s — indices={len(payload['indices'])}, "
          f"movers/N50/1D/up={len(payload['movers']['NIFTY50']['1D']['up'])}, "
          f"sectorHeat={len(payload['sectorHeat'])}, "
          f"fii.series={len(payload['fii']['series'])}")
    print(f"jsonb size ≈ {len(json.dumps(payload)) // 1024} KB")


if __name__ == "__main__":
    main()
