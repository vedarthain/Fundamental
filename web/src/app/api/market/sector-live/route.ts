/**
 * GET /api/market/sector-live — live intraday sector 1D returns.
 *
 * WHY this exists:
 *   /api/market/overview serves from market_snapshot_cache, a blob rebuilt
 *   once per day at EOD. So its sector heatmap always shows yesterday's 1D
 *   return, even after the equity pinger has pushed fresh current_prices.
 *   This tiny endpoint computes sector 1D returns live from
 *   screener_meta.current_price vs the last golden EOD close — the same
 *   two-DB pattern used by the overview fallback, but scoped to just the
 *   sector aggregation so it's fast enough to poll frequently.
 *
 * HOW it works:
 *   1. Golden DB: load the latest daily close per symbol (= yesterday EOD,
 *      the baseline for today's intraday move).
 *   2. App DB: load current_price + sector mapping from screener_meta JOIN
 *      scores JOIN cluster JOIN meta_cluster.
 *   3. In Node: compute (current_price - prev_close) / prev_close per symbol,
 *      then average per sector.
 *
 * Caching: 60s s-maxage — same as index-live. The equity pinger writes
 *   current_price every ~10 min, so a 60s CDN window keeps data at most
 *   ~11 min stale during market hours. No revalidate tag needed; it just
 *   ages out on its own clock.
 */
import { NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SectorLiveRow = {
  avg_pct_1d: number;   // fraction e.g. -0.012 = -1.2%
  stock_count: number;
  fetched_at: string;   // ISO timestamp of the newest price_fetched_at in this sector
};

export async function GET() {
  // 1. Yesterday's EOD close per symbol from golden (the baseline).
  const goldenRows = await golden<{ symbol: string; prev_close: number }[]>`
    WITH latest AS (
      SELECT MAX(date) AS d FROM golden.price_history WHERE interval = '1d'
    )
    SELECT REPLACE(symbol, '.NS', '') AS symbol,
           close::float               AS prev_close
      FROM golden.price_history, latest
     WHERE interval = '1d' AND date = latest.d AND close > 0
  `;
  const prevClose = new Map(goldenRows.map((r) => [r.symbol, r.prev_close]));

  // 2. Live current_price + sector mapping from app DB.
  //    Use latest snapshot scores for sector assignment.
  const liveRows = await sql<{
    symbol: string;
    sector_name: string;
    current_price: number;
    price_fetched_at: string | null;
  }[]>`
    SELECT sm.symbol,
           mc.name           AS sector_name,
           sm.current_price::float,
           sm.price_fetched_at::text
      FROM app.screener_meta sm
      JOIN app.scores sc ON sc.symbol = sm.symbol
        AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      JOIN app.cluster cl      ON cl.id = sc.cluster_id
      JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
     WHERE sm.current_price IS NOT NULL
  `;

  // 3. Aggregate per sector in Node.
  const bysector = new Map<string, {
    total: number; n: number; latestTs: string | null
  }>();

  for (const row of liveRows) {
    const base = prevClose.get(row.symbol);
    if (!base || base <= 0) continue;
    const pct = (row.current_price - base) / base;
    if (!isFinite(pct)) continue;

    const cur = bysector.get(row.sector_name) ?? { total: 0, n: 0, latestTs: null };
    cur.total += pct;
    cur.n     += 1;
    if (row.price_fetched_at && (!cur.latestTs || row.price_fetched_at > cur.latestTs)) {
      cur.latestTs = row.price_fetched_at;
    }
    bysector.set(row.sector_name, cur);
  }

  const result: Record<string, SectorLiveRow> = {};
  for (const [sector, { total, n, latestTs }] of bysector) {
    if (n === 0) continue;
    result[sector] = {
      avg_pct_1d:  total / n,
      stock_count: n,
      fetched_at:  latestTs ?? new Date().toISOString(),
    };
  }

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
