/**
 * GET /api/scanner/index-ohlc — OHLC candles for one NSE thematic index.
 *
 * The Themes grid pins a purple index chart in slot 1 and pages its constituents
 * beside it. Constituent candles come from /api/scanner/ohlc (golden); the index
 * itself isn't a golden stock, so it fetches its bars here from
 * app.market_index_history via loadIndexCandles.
 *
 * Query params:
 *   code — the internal index_code (e.g. NIFTYAUTO).
 *   days — calendar-day lookback; clamped to [5, 3660] (1W … 10Y).
 */
import { NextResponse } from "next/server";
import { loadIndexCandles } from "@/lib/indexCandles";

export const dynamic = "force-dynamic";

const MIN_DAYS = 5;
const MAX_DAYS = 3660;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  const rawDays = Number(url.searchParams.get("days"));

  if (!code) return NextResponse.json({ candles: [] });

  const days = Number.isFinite(rawDays)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(rawDays)))
    : 180;

  const candles = await loadIndexCandles(code, days);
  return NextResponse.json({ candles });
}
