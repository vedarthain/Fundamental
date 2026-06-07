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
 *   2. App DB: load current_price + sector mapping + market_cap_cr from
 *      screener_meta JOIN scores JOIN cluster JOIN meta_cluster, with a LEFT
 *      JOIN to the panel cache for the (snapshot) market cap used as weight.
 *   3. In Node: compute (current_price - prev_close) / prev_close per symbol,
 *      then take a CAP-WEIGHTED mean per sector — Σ(cap·ret)/Σ(cap) — so each
 *      tile reflects what the sector's large caps did, directionally aligned
 *      with the cap-weighted sectoral indices rather than an equal-weight mean
 *      dominated by micro-caps. (Full cap, not free-float, so it's a close
 *      proxy, not an exact index replica.)
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

/** IST calendar date ("YYYY-MM-DD") for a timestamp — works directly as a
 *  Postgres ::date literal. */
function istDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export async function GET() {
  // 1. Live current_price + sector mapping + market cap from app DB. Run this
  //    FIRST — the 1D baseline depends on which trading day these prices belong
  //    to (step 2). Latest snapshot scores give the sector; panel-cache
  //    market_cap_cr cap-weights the aggregation.
  const liveRows = await sql<{
    symbol: string;
    sector_name: string;
    current_price: number;
    market_cap_cr: number | null;
    price_fetched_at: string | null;
  }[]>`
    SELECT sm.symbol,
           mc.name           AS sector_name,
           sm.current_price::float,
           pc.market_cap_cr::float,
           sm.price_fetched_at::text
      FROM app.screener_meta sm
      JOIN app.scores sc ON sc.symbol = sm.symbol
        AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      JOIN app.cluster cl      ON cl.id = sc.cluster_id
      JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
      LEFT JOIN app.cluster_stocks_panel_cache pc ON pc.symbol = sm.symbol
        AND pc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
     WHERE sm.current_price IS NOT NULL
  `;

  // The IST day the live prices belong to (freshest price_fetched_at).
  let freshestTs: string | null = null;
  for (const r of liveRows) {
    if (r.price_fetched_at && (!freshestTs || r.price_fetched_at > freshestTs)) {
      freshestTs = r.price_fetched_at;
    }
  }
  const priceDay = istDateKey(freshestTs ?? new Date().toISOString());

  // 2. Baseline = latest golden close STRICTLY BEFORE the price day. Using
  //    golden's ABSOLUTE latest is wrong: once today's EOD close is ingested,
  //    current_price (~today's close) is compared to the SAME day → every
  //    sector collapses to 0% (seen all weekend and after each EOD). The day
  //    BEFORE the price day yields the true 1D move whether the price is live
  //    intraday or the settled close.
  const goldenRows = await golden<{ symbol: string; prev_close: number }[]>`
    WITH base AS (
      SELECT MAX(date) AS d FROM golden.price_history
       WHERE interval = '1d' AND date < ${priceDay}::date
    )
    SELECT REPLACE(symbol, '.NS', '') AS symbol,
           close::float               AS prev_close
      FROM golden.price_history, base
     WHERE interval = '1d' AND date = base.d AND close > 0
  `;
  const prevClose = new Map(goldenRows.map((r) => [r.symbol, r.prev_close]));

  // 3. Aggregate per sector in Node — CAP-WEIGHTED so the tile reflects what
  //    the sector's large caps did (directionally aligned with the cap-
  //    weighted sectoral indices), not an equal-weight mean dominated by
  //    micro-caps. sector_return = Σ(cap·ret) / Σ(cap). Symbols without a
  //    usable market cap are skipped from the weighted sum (rare; they'd add
  //    an undefined weight). MIN_CAP_CR drops illiquid micro-cap noise — same
  //    ₹500cr floor the movers panel uses.
  const MIN_CAP_CR = 500;
  const bysector = new Map<string, {
    weighted: number; weight: number; n: number; latestTs: string | null
  }>();

  for (const row of liveRows) {
    const base = prevClose.get(row.symbol);
    if (!base || base <= 0) continue;
    const pct = (row.current_price - base) / base;
    if (!isFinite(pct)) continue;
    const cap = row.market_cap_cr;
    if (cap == null || !isFinite(cap) || cap < MIN_CAP_CR) continue;

    const cur = bysector.get(row.sector_name) ?? { weighted: 0, weight: 0, n: 0, latestTs: null };
    cur.weighted += pct * cap;
    cur.weight   += cap;
    cur.n        += 1;
    if (row.price_fetched_at && (!cur.latestTs || row.price_fetched_at > cur.latestTs)) {
      cur.latestTs = row.price_fetched_at;
    }
    bysector.set(row.sector_name, cur);
  }

  const result: Record<string, SectorLiveRow> = {};
  for (const [sector, { weighted, weight, n, latestTs }] of bysector) {
    if (n === 0 || weight <= 0) continue;
    result[sector] = {
      avg_pct_1d:  weighted / weight,
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
