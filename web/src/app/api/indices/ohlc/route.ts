/**
 * GET /api/indices/ohlc?code=NIFTY50 — full daily OHLC history for one index.
 *
 * Powers the candlestick chart on /indices. Returns the whole series (ascending
 * by date); the client slices it per range button (1W…ALL) with no refetch, so
 * range switching is instant. Depth goes back ~2000–2006 per index (deep
 * Upstox backfill; see scripts/fetch-index-history-upstox.py), so ALL/10Y are
 * real candles, not a truncated tail.
 *
 * Source is app.market_index_history (EOD, authoritative — NSE daily driver +
 * Upstox backfill). No Upstox at request time; cached 1h at the CDN since index
 * bars only change once daily (EOD).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

// One daily candle. `time` is a business-day string ("YYYY-MM-DD"), which is
// exactly what lightweight-charts accepts for a day-resolution series.
export type IndexCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

// The 23 indices we track (matches app.market_index_history + the board groups
// in IndicesClient). Allowlisted so the endpoint can't be probed with junk even
// though the query is parameterised.
const VALID_CODES = new Set([
  "NIFTY50", "NIFTYBANK",
  "NIFTY100", "NIFTY500", "NIFTYNEXT50", "NIFTYMIDCAP100", "NIFTYSMALLCAP100",
  "NIFTYIT", "NIFTYAUTO", "NIFTYFMCG", "NIFTYPHARMA", "NIFTYENERGY", "NIFTYMETAL",
  "NIFTYREALTY", "NIFTYHEALTHCARE", "NIFTYCONSDUR", "NIFTYOILGAS", "NIFTYMEDIA",
  "NIFTYMIDSMALLHEALTH",
  "NIFTYFINSERVICE", "NIFTYFINSRV2550", "NIFTYPVTBANK", "NIFTYPSUBANK",
]);

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") || "").toUpperCase();
  if (!VALID_CODES.has(code)) {
    return NextResponse.json({ error: "unknown index code" }, { status: 400 });
  }

  let candles: IndexCandle[] = [];
  try {
    candles = await sql<IndexCandle[]>`
      SELECT date::text AS time,
             open::float  AS open,
             high::float  AS high,
             low::float   AS low,
             close::float AS close
        FROM app.market_index_history
       WHERE index_code = ${code}
         AND open IS NOT NULL AND high IS NOT NULL
         AND low  IS NOT NULL AND close IS NOT NULL
       ORDER BY date ASC
    `;
  } catch {
    candles = []; // fail-soft: client shows an empty-chart message
  }

  return NextResponse.json(
    { code, candles },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } },
  );
}
