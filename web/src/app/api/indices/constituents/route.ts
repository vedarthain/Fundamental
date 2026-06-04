/**
 * GET /api/indices/constituents?code=NIFTYIT — an index's members with live
 * price, today's 1D move, and an APPROX weight by market cap.
 *
 * WHY this exists / what it is NOT:
 *   We have the official index LEVEL (from Upstox, exact) on the board. We do
 *   NOT have NSE's free-float index weights. So this lists each constituent's
 *   own live move (accurate per stock) and an APPROX weight = market_cap /
 *   Σ(market_cap) within the index — clearly an approximation, not the index
 *   weight, and we do NOT recompute the index level from these (free-float
 *   weighting means it wouldn't match the official tick).
 *
 * HOW (same two-DB pattern as /api/market/sector-live):
 *   1. App DB: index_constituent ⋈ screener_meta (live current_price) ⋈
 *      panel cache (snapshot market_cap_cr) ⋈ scores→cluster→meta_cluster
 *      (sector label). Members not in our scored universe come back with
 *      null price/cap — surfaced as "—" by the UI, weight 0.
 *   2. Golden DB: latest daily close per symbol = the 1D baseline.
 *   3. Node: pct_1d = (current_price - prev_close)/prev_close; weight =
 *      market_cap / Σ(market_cap). Sorted by weight desc.
 *
 * Caching: 60s s-maxage — same cadence as the equity pinger's effect on
 * current_price; the membership list itself only changes at NSE rebalances.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql, golden } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConstituentRow = {
  symbol: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  pct_1d: number | null;     // fraction, e.g. -0.012 = -1.2%
  market_cap_cr: number | null;
  weight_pct: number | null; // approx, by full market cap. null when no cap.
};

export type ConstituentsResponse = {
  code: string;
  count: number;
  total_mcap_cr: number;
  fetched_at: string | null;
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
      code, count: 0, total_mcap_cr: 0, fetched_at: null, constituents: [],
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

  // 3. Compute 1D + weights in Node.
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
    const weight =
      r.market_cap_cr != null && r.market_cap_cr > 0 && totalCap > 0
        ? (r.market_cap_cr / totalCap) * 100
        : null;
    return {
      symbol: r.symbol,
      company_name: r.company_name,
      sector: r.sector,
      price: r.current_price,
      pct_1d: pct != null && isFinite(pct) ? pct : null,
      market_cap_cr: r.market_cap_cr,
      weight_pct: weight,
    };
  });

  // Sort by weight desc (members with a cap first), then by symbol.
  constituents.sort((a, b) => {
    const aw = a.weight_pct ?? -1;
    const bw = b.weight_pct ?? -1;
    if (bw !== aw) return bw - aw;
    return a.symbol.localeCompare(b.symbol);
  });

  return NextResponse.json<ConstituentsResponse>({
    code,
    count: constituents.length,
    total_mcap_cr: totalCap,
    fetched_at: latestTs,
    constituents,
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
