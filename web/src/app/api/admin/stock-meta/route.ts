/**
 * Admin-only per-symbol stock metadata for the verdict detail page's header
 * card: maturity tier ("Long-established" etc.), market-cap tier (Large/Mid/
 * Small), listing date, and live intraday price + 1-day % change.
 *
 * Deliberately NOT a reuse of loadAllStocks() (src/lib/allStocks.ts) — that
 * function computes 1D/1W/1M/1Y/3Y returns for the ENTIRE universe in one
 * call (five golden queries each scanning every symbol), which is the right
 * shape for a scanner table but would be paying for four unused horizons
 * every time this page opens one stock. This route does the same 1D
 * calculation (last close vs the close before it, from golden.price_history,
 * ADJUSTED close to match the price chart) but scoped to one symbol.
 *
 * Same one-route-per-concern reasoning as /api/admin/stock-context: the
 * verdict route already serves three shapes, and this is a different table
 * family (app.universe / app.screener_meta / golden.price_history) read for
 * a different purpose (page chrome, not the verdict itself).
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql, golden } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Meta = {
  maturity_tier: string | null;
  market_cap_category: string | null;
  listing_date: string | null;
  current_price: number | null;
  price_fetched_at: string | null;
  ret_1d: number | null;
  scores_snapshot_date: string | null;
};

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  let base: {
    maturity_tier: string | null;
    market_cap_category: string | null;
    listing_date: string | null;
    cache_price: number | null;
    intraday_price: number | null;
    price_fetched_at: string | null;
    scores_snapshot_date: string | null;
  } | null = null;

  try {
    const rows = await sql<
      {
        maturity_tier: string | null;
        market_cap_category: string | null;
        listing_date: string | null;
        cache_price: number | null;
        intraday_price: number | null;
        price_fetched_at: string | null;
        scores_snapshot_date: string | null;
      }[]
    >`
      SELECT u.maturity_tier,
             u.market_cap_category,
             u.listing_date::text AS listing_date,
             p.current_price::float8 AS cache_price,
             p.snapshot_date::text AS scores_snapshot_date,
             sm.current_price::float8 AS intraday_price,
             sm.price_fetched_at::text AS price_fetched_at
        FROM app.universe u
        LEFT JOIN app.cluster_stocks_panel_cache p
               ON p.symbol = u.symbol
              AND p.snapshot_date = (SELECT max(snapshot_date) FROM app.cluster_stocks_panel_cache)
        LEFT JOIN app.screener_meta sm ON sm.symbol = u.symbol
       WHERE u.symbol = ${symbol}
       LIMIT 1
    `;
    base = rows[0] ?? null;
  } catch {
    base = null;
  }

  let ret_1d: number | null = null;
  try {
    const px = await golden<{ c: string }[]>`
      SELECT COALESCE(adj_close, close)::text AS c
        FROM golden.price_history
       WHERE symbol = ${symbol + ".NS"}
         AND interval = '1d'
         AND COALESCE(adj_close, close) IS NOT NULL
         AND date >= CURRENT_DATE - 16
       ORDER BY date DESC
       LIMIT 2
    `;
    if (px.length === 2) {
      const last = Number(px[0].c);
      const prev = Number(px[1].c);
      if (prev > 0) ret_1d = ((last - prev) / prev) * 100;
    }
  } catch {
    ret_1d = null;
  }

  const usingIntraday = base?.intraday_price != null;
  const meta: Meta = {
    maturity_tier: base?.maturity_tier ?? null,
    market_cap_category: base?.market_cap_category ?? null,
    listing_date: base?.listing_date ?? null,
    current_price: base?.intraday_price ?? base?.cache_price ?? null,
    price_fetched_at: usingIntraday ? (base?.price_fetched_at ?? null) : null,
    ret_1d,
    scores_snapshot_date: base?.scores_snapshot_date ?? null,
  };

  return NextResponse.json(meta, { headers: { "Cache-Control": "no-store" } });
}
