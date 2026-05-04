"""Assign cluster_id + maturity_tier to every active stock.

Idempotent — re-running upserts. Recomputes maturity_tier from fundamentals coverage
plus listing_date (so an old company with sparse data isn't tagged 'new').
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

import psycopg

from .rules import StockMeta, assign


def _years_since(d: Optional[date]) -> Optional[float]:
    if d is None:
        return None
    delta = (date.today() - d).days
    return delta / 365.25


def _maturity_tier(years_of_data: int, listing: Optional[date]) -> str:
    """Tier from data depth, with 'new' reserved for stocks listed within ~2 years.

    Rationale: 'New Listing' should mean a recent IPO, not just a stock with
    sparse Screener history (which often happens after corporate-event
    restructurings on companies that have been around for decades).
    """
    age = _years_since(listing)
    if years_of_data >= 10:
        return "veteran"
    if years_of_data >= 7:
        return "mature"
    if years_of_data >= 3:
        return "mid"
    if years_of_data >= 1:
        # 1-2 years of data → tier depends on whether the listing is also recent
        if age is None or age <= 2.0:
            return "new"
        return "mid"  # old company with sparse Screener coverage
    return "insufficient"


def assign_all(conn: psycopg.Connection) -> dict[str, int]:
    """Assign clusters + tiers for the entire active universe. Returns counts."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT u.symbol, u.sector, u.industry, u.market_cap_category, u.listing_date,
                   COALESCE(c.years, 0) AS years
            FROM app.universe u
            LEFT JOIN (
                SELECT symbol, COUNT(DISTINCT period_end) AS years
                FROM app.fundamentals_annual
                GROUP BY symbol
            ) c ON c.symbol = u.symbol
            WHERE u.is_active
        """)
        rows = cur.fetchall()

    counts = {"assigned": 0, "unclassified": 0, "by_cluster": {}, "by_tier": {}}
    now = datetime.now(timezone.utc)

    with conn.cursor() as cur:
        for r in rows:
            stock = StockMeta(
                symbol=r["symbol"],
                sector=r["sector"],
                industry=r["industry"],
                market_cap_category=r["market_cap_category"],
            )
            cluster_id, _ = assign(stock)
            tier = _maturity_tier(int(r["years"]), r.get("listing_date"))

            cur.execute(
                """
                INSERT INTO app.cluster_assignment (symbol, cluster_id, assigned_at, method)
                VALUES (%s, %s, %s, 'rule')
                ON CONFLICT (symbol) DO UPDATE
                  SET cluster_id  = EXCLUDED.cluster_id,
                      assigned_at = EXCLUDED.assigned_at,
                      method      = 'rule'
                """,
                (r["symbol"], cluster_id, now),
            )
            cur.execute(
                """
                UPDATE app.universe
                SET maturity_tier = %s,
                    years_of_data = %s,
                    maturity_tier_at = %s
                WHERE symbol = %s
                """,
                (tier, int(r["years"]), now, r["symbol"]),
            )
            counts["assigned"] += 1
            if cluster_id == "unclassified":
                counts["unclassified"] += 1
            counts["by_cluster"][cluster_id] = counts["by_cluster"].get(cluster_id, 0) + 1
            counts["by_tier"][tier] = counts["by_tier"].get(tier, 0) + 1

    return counts
