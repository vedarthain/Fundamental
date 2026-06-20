/**
 * GET /api/market/index-series?code=NIFTYIT — 1-year daily close series for one
 * index, for the headline-chart **index switcher**.
 *
 * Why separate from /api/market/overview: that payload only ships the full
 * series for the two default hero indices (NIFTY 50 / NIFTY BANK) to stay
 * lean. When the user swaps the hero panel to another index, the client
 * lazy-loads that index's series from here instead of bloating every page load.
 *
 * Data depth: app.market_index_history currently holds ~1 year per index, so
 * this returns up to ~400 days. (3Y/5Y would need an NSE history backfill.)
 *
 * Cached 1h at the CDN — index closes only change once daily (EOD).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import type { IndexSeriesPoint } from "../overview/route";

export const runtime = "nodejs";

// Allowlist of index codes we track (matches app.market_index_history). Guards
// the endpoint against arbitrary input even though the query is parameterized.
const VALID_CODES = new Set([
  "NIFTY50", "NIFTYBANK", "NIFTYNEXT50", "NIFTY100", "NIFTY500",
  "NIFTYMIDCAP100", "NIFTYSMALLCAP100", "NIFTYIT", "NIFTYAUTO",
  "NIFTYFMCG", "NIFTYPHARMA", "NIFTYENERGY", "NIFTYMETAL", "NIFTYREALTY",
]);

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") || "").toUpperCase();
  if (!VALID_CODES.has(code)) {
    return NextResponse.json({ error: "unknown index code" }, { status: 400 });
  }

  let series: IndexSeriesPoint[] = [];
  try {
    series = await sql<IndexSeriesPoint[]>`
      SELECT date::text AS date, close::float AS close
        FROM app.market_index_history
       WHERE index_code = ${code}
         AND close IS NOT NULL
         AND date > (CURRENT_DATE - INTERVAL '400 days')
       ORDER BY date ASC
    `;
  } catch {
    series = []; // fail-soft: client falls back to the row's short sparkline
  }

  return NextResponse.json(
    { code, series },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } },
  );
}
