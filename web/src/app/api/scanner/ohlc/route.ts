/**
 * GET /api/scanner/ohlc — split-safe daily candles for the Graph tab.
 *
 * The Graph tab paints 4 candlestick+volume charts per page and lazily fetches
 * only the visible page's symbols (never the whole ~2,100-name universe). This
 * route reuses the batched loader — one golden query per call.
 *
 * Query params:
 *   syms — comma-separated BARE symbols (no ".NS"); capped for sanity.
 *   days — calendar-day lookback; clamped to [30, 1825] (≈1 month … 5 years).
 */
import { NextResponse } from "next/server";
import { loadCandles } from "@/lib/candles";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 8;
const MIN_DAYS = 5; // 1W window
// 10Y is the labelled max preset; the "ALL" toggle sends a larger value that we
// clamp here to ~30Y so full listed history comes back (weekly-rolled past ~2Y).
const MAX_DAYS = 11000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSyms = (url.searchParams.get("syms") ?? "").trim();
  const rawDays = Number(url.searchParams.get("days"));

  const syms = rawSyms
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (syms.length === 0) return NextResponse.json({ data: {} });

  const days = Number.isFinite(rawDays)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(rawDays)))
    : 180;

  const data = await loadCandles(syms, days);
  return NextResponse.json({ data });
}
