/**
 * /api/watchlist — fetch stock card data for an arbitrary list of symbols.
 *
 * The /watchlist page reads symbols from localStorage on the client, then
 * calls this endpoint to populate them with current scores, prices, and
 * returns. We can't render server-side because we don't know which symbols
 * are watched without the user's localStorage.
 *
 * Reads from app.cluster_stocks_panel_cache — same materialised table that
 * powers /sectors, so this is a single fast read with no joins.
 *
 * Cost (Rule #1): one cheap indexed query per watchlist page load (max 100
 * symbols, ~100ms cold).  Output is small JSON (a few KB), no caching
 * needed at this volume.  If watchlist usage grows we can add a
 * Cache-Control to coalesce repeated visits within a minute.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 100;

type WatchRow = {
  symbol: string;
  company_name: string | null;
  sector_name: string | null;
  industry_name: string | null;
  maturity_tier: string;
  market_cap_cr: number | null;
  current_price: number | null;
  composite_pct: number | null;
  quality_pct: number | null;
  valuation_pct: number | null;
  momentum_pct: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
  ret_1y: number | null;
};

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") || "";
  // Sanitise: split, trim, uppercase, dedupe, cap.  Filter out anything
  // that isn't a clean alphanumeric symbol so the SQL parameter is safe.
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9&-]+$/.test(s) && s.length <= 30),
    ),
  ).slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({ rows: [], snapshot_date: null });
  }

  // Pull from the materialised panel cache — has identity, scores, prices,
  // and returns all pre-joined. cluster_stocks_panel_cache uses the latest
  // snapshot only, which is what we want here.
  const rows = await sql<WatchRow[]>`
    SELECT
      c.symbol,
      c.company_name,
      mc.name        AS sector_name,
      cl.name        AS industry_name,
      c.maturity_tier,
      c.market_cap_cr::float  AS market_cap_cr,
      c.current_price::float  AS current_price,
      c.composite_pct::float  AS composite_pct,
      c.quality_pct::float    AS quality_pct,
      c.valuation_pct::float  AS valuation_pct,
      c.momentum_pct::float   AS momentum_pct,
      c.ret_1w::float         AS ret_1w,
      c.ret_1m::float         AS ret_1m,
      c.ret_1y::float         AS ret_1y
    FROM app.cluster_stocks_panel_cache c
    JOIN app.cluster cl ON cl.id = c.cluster_id
    JOIN app.meta_cluster mc ON mc.id = cl.meta_cluster_id
    WHERE c.snapshot_date = (SELECT MAX(snapshot_date) FROM app.cluster_stocks_panel_cache)
      AND c.symbol = ANY(${symbols})
  `;

  return NextResponse.json({
    rows,
    snapshot_date: rows[0] ? null : null,  // can derive later if useful
  });
}
