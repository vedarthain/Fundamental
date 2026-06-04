/**
 * GET /api/indices/constituents?code=NIFTYIT — an index's members with live
 * price, today's 1D move, and the REAL NSE index weight (top constituents).
 *
 * Weights come from src/lib/indexWeights.ts — pasted by hand from NSE's
 * monthly index factsheets ("Top constituents by weightage"), because NSE /
 * niftyindices block server-side fetches and publish only the top ~10 by
 * weight (monthly PDF). So weighted leaders carry their true free-float
 * weight; the long tail shows null (NSE doesn't publish it). We deliberately
 * do NOT recompute the index level from members.
 *
 * HOW (same two-DB pattern as /api/market/sector-live):
 *   1. App DB: index_constituent ⋈ screener_meta (live current_price) ⋈
 *      panel cache (snapshot market_cap_cr, for tail ordering) ⋈
 *      scores→cluster→meta_cluster (sector label). Members not in our scored
 *      universe come back null price — surfaced as "—" by the UI.
 *   2. Golden DB: latest daily close per symbol = the 1D baseline.
 *   3. Node: pct_1d = (current_price - prev_close)/prev_close; weight_pct =
 *      curated factsheet weight. Sorted weight desc, then market cap, symbol.
 *
 * Caching: 60s s-maxage — same cadence as the equity pinger's effect on
 * current_price; membership + weights change only at NSE rebalances.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";
import { weightsForIndex, INDEX_WEIGHTS_AS_OF } from "@/lib/indexWeights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConstituentRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  pct_1d: number | null;     // fraction, e.g. -0.012 = -1.2%
  market_cap_cr: number | null;
  weight_pct: number | null; // REAL NSE free-float index weight (from the
                             // factsheet, top constituents only). null = not
                             // published for this name (long tail).
};

export type ConstituentsResponse = {
  code: string;
  count: number;
  total_mcap_cr: number;
  fetched_at: string | null;
  weights_as_of: string | null; // factsheet date for the curated weights
  constituents: ConstituentRow[];
};

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "missing ?code" }, { status: 400 });
  }

  // 1. Members + live price + (snapshot) market cap + sector label.
  const rows = await sql<{
    symbol: string;
    company_name: string | null;
    sector: string | null;
    current_price: number | null;
    market_cap_cr: number | null;
    price_fetched_at: string | null;
  }[]>`
    SELECT ic.symbol,
           ic.company_name,
           mc.name                  AS sector,
           sm.current_price::float  AS current_price,
           pc.market_cap_cr::float  AS market_cap_cr,
           sm.price_fetched_at::text AS price_fetched_at
      FROM app.index_constituent ic
      LEFT JOIN app.screener_meta sm ON sm.symbol = ic.symbol
      LEFT JOIN app.cluster_stocks_panel_cache pc ON pc.symbol = ic.symbol
        AND pc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      LEFT JOIN app.scores sc ON sc.symbol = ic.symbol
        AND sc.snapshot_date = (SELECT MAX(snapshot_date) FROM app.scores)
      LEFT JOIN app.cluster cl      ON cl.id = sc.cluster_id
      LEFT JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
     WHERE ic.index_code = ${code}
  `;

  if (rows.length === 0) {
    return NextResponse.json<ConstituentsResponse>({
      code, count: 0, total_mcap_cr: 0, fetched_at: null, weights_as_of: null, constituents: [],
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  }

  // 2. Yesterday's EOD close per symbol from golden (1D baseline).
  const keys = rows.map((r) => `${r.symbol}.NS`);
  const goldenRows = await golden<{ symbol: string; prev_close: number }[]>`
    WITH latest AS (
      SELECT MAX(date) AS d FROM golden.price_history WHERE interval = '1d'
    )
    SELECT REPLACE(symbol, '.NS', '') AS symbol,
           close::float               AS prev_close
      FROM golden.price_history, latest
     WHERE interval = '1d' AND date = latest.d AND close > 0
       AND symbol = ANY(${keys})
  `;
  const prevClose = new Map(goldenRows.map((r) => [r.symbol, r.prev_close]));

  // 3. Compute 1D in Node; weights come from the curated factsheet table.
  //    Market cap is kept only to order the long tail (names with no
  //    published weight) sensibly under the weighted leaders.
  const curatedWeights = weightsForIndex(code);
  let totalCap = 0;
  let latestTs: string | null = null;
  for (const r of rows) {
    if (r.market_cap_cr != null && isFinite(r.market_cap_cr) && r.market_cap_cr > 0) {
      totalCap += r.market_cap_cr;
    }
    if (r.price_fetched_at && (!latestTs || r.price_fetched_at > latestTs)) {
      latestTs = r.price_fetched_at;
    }
  }

  const constituents: ConstituentRow[] = rows.map((r) => {
    const base = prevClose.get(r.symbol);
    const pct =
      r.current_price != null && base && base > 0
        ? (r.current_price - base) / base
        : null;
    return {
      symbol: r.symbol,
      company_name: r.company_name,
      sector: r.sector,
      price: r.current_price,
      pct_1d: pct != null && isFinite(pct) ? pct : null,
      market_cap_cr: r.market_cap_cr,
      weight_pct: curatedWeights.get(r.symbol) ?? null,
    };
  });

  // Sort by published weight desc (leaders first), then by market cap desc
  // for the unweighted tail, then symbol.
  constituents.sort((a, b) => {
    const aw = a.weight_pct ?? -1;
    const bw = b.weight_pct ?? -1;
    if (bw !== aw) return bw - aw;
    const ac = a.market_cap_cr ?? -1;
    const bc = b.market_cap_cr ?? -1;
    if (bc !== ac) return bc - ac;
    return a.symbol.localeCompare(b.symbol);
  });

  return NextResponse.json<ConstituentsResponse>({
    code,
    count: constituents.length,
    total_mcap_cr: totalCap,
    fetched_at: latestTs,
    weights_as_of: INDEX_WEIGHTS_AS_OF[code] ?? null,
    constituents,
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
